// node test/test.js — checks detection, automatic labelling, swap repair and the measurements against a synthetic rider.
const BF = require('../core.js');
const { W, H, sidePose, frontPose, render } = require('./synth.js');
let fails = 0;
const near = (name, got, exp, tol) => { const ok = Math.abs(got - exp) <= tol; if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}: ${Number(got).toFixed(2)} (expected ${exp.toFixed(2)} ±${tol})`); };
const truthy = (name, ok, info) => { if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${info ? ': ' + info : ''}`); };

// Runs the same pipeline as the live screen. drop: fraction of camera frames skipped.
function runLive({ view = 'side', dir = 1, cad = 90, secs = 14, only = null, drop = 0, camFps = 30 }) {
  const poseAt = t => (view === 'side' ? sidePose(t, dir, cad) : frontPose(t, cad));
  const p0 = poseAt(0), key = view === 'side' ? 'knee' : 'kneeL';
  const spec = BF.sampleColor(render(p0, 1, only), W, H, Math.round(p0[key][0]), Math.round(p0[key][1]), 1);
  let sk = 5;
  const ses = BF.createSession(view, W);
  let labelledAt = null, relabels = 0, was = false;
  const frames = [], labels = ses.labels;
  for (let f = 0; f < secs * camFps; f++) {
    const t = f / camFps;
    if (drop && f > 0 && ((sk = (sk * 69069 + 1) % 1000) < drop * 1000)) continue;
    const out = ses.step(BF.findBlobs(render(poseAt(t), f + 7, only), W, H, spec, { minArea: 6 }), t);
    if (out.state === 'track') { if (!was) { relabels++; if (labelledAt == null) labelledAt = t; } frames.push({ t, pts: out.pts }); }
    was = out.state === 'track';
  }
  const map = frames.length ? frames[frames.length - 1].pts : null, labelDir = ses.dir, swapsFixed = relabels - 1;
  // label accuracy against the truth
  let wrong = 0, seen = 0;
  frames.forEach(fr => { const p = poseAt(fr.t); labels.forEach(l => { if (!fr.pts[l]) return; seen++; if (Math.hypot(fr.pts[l][0] - p[l][0], fr.pts[l][1] - p[l][1]) > 4) wrong++; }); });
  const uni = BF.resample(frames, labels, 30);
  const win = uni.slice(-300);
  const res = view === 'side' ? BF.analyzeSide(win, { fps: 30, crankMm: 172.5, dir: labelDir }) : BF.analyzeFront(win, { fps: 30, crankMm: 172.5 });
  return { res, map, labelledAt, wrong, seen, swapsFixed, poseAt, labelDir };
}
function truthSide(dir, cad) {
  const k = [], h = [], tr = [];
  for (let i = 0; i < 600; i++) { const p = sidePose(i / 100, dir, cad); k.push(BF.angleAt(p.hip, p.knee, p.ankle)); h.push(BF.angleAt(p.shoulder, p.hip, p.knee)); tr.push(Math.atan2(-(p.shoulder[1] - p.hip[1]), dir * (p.shoulder[0] - p.hip[0])) * 180 / Math.PI); }
  return { ext: Math.max(...k), flex: Math.min(...k), hip: Math.min(...h), torso: BF.median(tr) };
}

console.log('--- side, 7 stickers, facing right, 90 rpm');
let r = runLive({}), tr = truthSide(1, 90);
truthy('labelled automatically', !!r.map && Object.values(r.map).filter(Boolean).length === 7, r.map ? `after ${r.labelledAt.toFixed(1)} s` : 'never');
truthy('labels correct', r.wrong === 0, `${r.wrong} wrong of ${r.seen}`);
near('cadence', r.res.cadence, 90, 2);
near('knee extension', r.res.metrics.kneeExt, tr.ext, 1.5);
near('knee flexion', r.res.metrics.kneeFlex, tr.flex, 1.5);
near('hip closed', r.res.metrics.hipMin, tr.hip, 1.5);
near('torso', r.res.metrics.torso, tr.torso, 1.5);
near('scale from crank (mm/px)', r.res.mmPerPx, 172.5 / 40, 0.25);
near('foot path ratio (square-on = 1)', r.res.pathRatio, 1, 0.08);
truthy('measurement stable', r.res.stable, `${r.res.cycles} strokes, spread ${r.res.spread.toFixed(1)}°`);
truthy('no slipping sticker flagged', r.res.slip === null, String(r.res.slip));

console.log('--- side, 4 stickers (no arm, no shoulder), facing left, 75 rpm');
r = runLive({ dir: -1, cad: 75, only: ['hip', 'knee', 'ankle', 'foot'] }); tr = truthSide(-1, 75);
truthy('labelled automatically', !!r.map && Object.values(r.map).filter(Boolean).length === 4 && r.labelDir === -1, r.map ? `dir ${r.labelDir}` : 'never');
truthy('labels correct', r.wrong === 0, `${r.wrong} wrong of ${r.seen}`);
near('knee extension', r.res.metrics.kneeExt, tr.ext, 1.5);

console.log('--- side, 5 stickers (with shoulder), 85 rpm');
r = runLive({ cad: 85, only: ['shoulder', 'hip', 'knee', 'ankle', 'foot'] }); tr = truthSide(1, 85);
truthy('labelled automatically', !!r.map && Object.values(r.map).filter(Boolean).length === 5);
truthy('labels correct', r.wrong === 0, `${r.wrong} wrong of ${r.seen}`);
near('hip closed', r.res.metrics.hipMin, tr.hip, 1.5);

console.log('--- side, 60 fps camera with 45% of frames dropped, 95 rpm');
r = runLive({ cad: 95, drop: 0.45, camFps: 60 }); tr = truthSide(1, 95);
truthy('labelled automatically', !!r.map);
truthy('labels correct after swap repair', r.wrong <= r.seen * 0.01, `${r.wrong} wrong of ${r.seen}, ${r.swapsFixed} re-labellings`);
near('knee extension', r.res.metrics.kneeExt, tr.ext, 2.5);

console.log('--- swap repair on a single frame');
{
  const fr = []; for (let i = 0; i < 60; i++) fr.push({ t: i / 30, pts: sidePose(i / 30, 1, 90) });
  const sk = BF.learnSkeleton(fr), p = Object.assign({}, sidePose(0.2, 1, 90));
  [p.knee, p.elbow] = [p.elbow, p.knee];
  const sw = BF.findSwap(p, sk);
  truthy('knee/elbow swap found', !!sw && sw.slice().sort().join() === 'elbow,knee', JSON.stringify(sw));
  truthy('clean frame left alone', BF.findSwap(sidePose(0.2, 1, 90), sk) === null);
}

console.log('--- slipping sticker');
{
  const fr = []; for (let i = 0; i < 300; i++) { const t = i / 30, p = sidePose(t, 1, 90); p.hip = [p.hip[0] + 14 * Math.sin(2 * Math.PI * 1.5 * t), p.hip[1]]; fr.push({ t, pts: p }); }
  truthy('moving hip sticker flagged', BF.slippingSticker(BF.segmentStability(fr)) === 'hip');
}

console.log('--- front, 4 stickers, 90 rpm');
r = runLive({ view: 'front' });
truthy('labelled automatically', !!r.map);
truthy('labels correct', r.wrong === 0, `${r.wrong} wrong of ${r.seen}`);
near('right knee travel (mm)', r.res.metrics.kneeTravelR, 12 * 172.5 / 40, 6);
near('left knee travel (mm)', r.res.metrics.kneeTravelL, 6 * 172.5 / 40, 6);

console.log('--- rider gets off for 4 s, then pedals again');
{
  const p0 = sidePose(0, 1, 90), spec = BF.sampleColor(render(p0, 1), W, H, Math.round(p0.knee[0]), Math.round(p0.knee[1]), 1);
  const ses = BF.createSession('side', W);
  let lostAt = null, backAt = null, wrong = 0, was = false;
  for (let f = 0; f < 16 * 30; f++) {
    const t = f / 30, away = t >= 6 && t < 10, p = sidePose(t, 1, 90);
    const out = ses.step(BF.findBlobs(render(p, f + 7, away ? [] : null), W, H, spec, { minArea: 6 }), t);
    const on = out.state === 'track';
    if (was && !on && lostAt == null) lostAt = t;
    if (!was && on && lostAt != null && backAt == null) backAt = t;
    if (on && t > 10) BF.SIDE_LABELS.forEach(l => { if (out.pts[l] && Math.hypot(out.pts[l][0] - p[l][0], out.pts[l][1] - p[l][1]) > 4) wrong++; });
    was = on;
  }
  truthy('loss noticed', lostAt != null && lostAt < 8.5, lostAt != null ? `at ${lostAt.toFixed(1)} s` : 'never');
  truthy('found again without help', backAt != null && backAt < 13.5, backAt != null ? `at ${backAt.toFixed(1)} s` : 'never');
  truthy('labels correct after return', wrong === 0, `${wrong} wrong`);
}

console.log('--- recommendation');
{
  const rec = BF.recommend({ kneeExt: 135, kneeFlex: 67, hipMin: 44, torso: 37, shoulder: 97, elbow: 157, ankleRom: 26, kops: 8 }, 'side', BF.TARGETS.road_endurance);
  truthy('saddle first', rec.next && rec.next.code === 'saddle_up' && rec.next.mm === 6, JSON.stringify(rec.next));
  truthy('others queued', rec.later.length >= 2, rec.later.map(l => l.code).join(','));
}
console.log(fails ? `\n${fails} FAILED` : '\nALL PASS');
process.exit(fails ? 1 : 0);
