// Runs video mode on a real clip: node test/real/runvideo.js clip.mp4 t0 secs '{"label":[x,y],...}' [W H]
// Frames are decoded by ffmpeg at the clip's own size; the tracker and analysis are the app's.
const { spawn } = require('child_process'), BF = require('../../core.js');
const [file, t0s, secs, initJ] = process.argv.slice(2), W = +(process.argv[6] || 478), H = +(process.argv[7] || 850), t0 = +t0s;
const named = JSON.parse(initJ);
function frames(start, dur, onFrame) {
  return new Promise(res => {
    const ff = spawn('ffmpeg', ['-loglevel', 'error', '-ss', String(start), '-i', file, '-t', String(dur), '-vf', 'scale=' + W + ':' + H, '-f', 'rawvideo', '-pix_fmt', 'rgba', '-']);
    let buf = Buffer.alloc(0), i = 0; const size = W * H * 4;
    ff.stdout.on('data', d => { buf = Buffer.concat([buf, d]); while (buf.length >= size) { onFrame(new Uint8ClampedArray(buf.subarray(0, size)), i++); buf = buf.subarray(size); } });
    ff.on('close', res);
  });
}
(async () => {
  let first = null; await frames(t0, 0.02, d => { if (!first) first = d; });
  const tap = named[process.env.TAP || 'knee'] || named[Object.keys(named)[0]];
  const m = BF.refineColor(first, W, H, BF.learnColor(first, W, H, tap[0], tap[1]));
  const init = {}; Object.keys(named).forEach(l => { init[l] = BF.snapToSticker(first, W, H, m, named[l][0], named[l][1]) || named[l]; });
  console.log('colour from', m.n || 1, 'stickers; snapped', JSON.stringify(Object.fromEntries(Object.entries(init).map(([k, v]) => [k, v.map(Math.round)]))));
  const tr = BF.createLocalTracker(m, init, W, H, { data0: first }), out = [];
  await frames(t0, +secs, (d, i) => { const t = t0 + i / 59.94; out.push({ t, pts: tr.step(d, t) }); });
  const labels = BF.SIDE_LABELS, uni = BF.resample(out, labels, 30);
  const seen = {}; Object.keys(init).forEach(l => { seen[l] = Math.round(100 * uni.filter(f => f.pts[l]).length / uni.length); });
  const rebuilt = BF.fillKnee(uni);
  const res = BF.analyzeSide(uni, { fps: 30, crankMm: 172.5, minCycles: 4 });
  console.log('seen %', JSON.stringify(seen), '| knee rebuilt on', Math.round(100 * rebuilt / uni.length), '% | cadence', res.cadence && res.cadence.toFixed(0), '| strokes', res.cycles);
  console.log('metrics', JSON.stringify(Object.fromEntries(Object.entries(res.metrics).map(([k, v]) => [k, Number.isFinite(v) ? +v.toFixed(1) : null]))), '| slip', res.slip, '| pathRatio', res.pathRatio && res.pathRatio.toFixed(2));
  require('fs').writeFileSync('/tmp/fl/track.json', JSON.stringify(out.map(f => ({ t: f.t, pts: f.pts }))));
})();
