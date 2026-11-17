// Fit Loop video mode: record or pick a video, name each sticker once, let the app follow them and measure.
// Uses the shared helpers exposed by app.js on window.FL.
(function () {
'use strict';
const FL = window.FL, { $, esc, T, num, toast } = FL;
const app = $('#app'), vid = $('#vid');
const AN = 1280; // analysis size (long side): stickers stay several pixels wide at 2 m
const work = document.createElement('canvas'), wctx = work.getContext('2d', { willReadFrequently: true });
const ORDER = { side: ['hip', 'knee', 'ankle', 'foot', 'shoulder', 'elbow', 'wrist'], front: ['kneeR', 'footR', 'kneeL', 'footL'] };
const REQUIRED = { hip: 1, knee: 1, ankle: 1, foot: 1, kneeR: 1, footR: 1, kneeL: 1, footL: 1 };
const V = {};

function open(view) { V.view = view; V.capture = true; $('#fileRecord').click(); }
function pick(view) { V.view = view; $('#fileVideoPick').click(); }

async function load(file) {
  if (!V.view) V.view = 'side';
  if (V.url) URL.revokeObjectURL(V.url);
  Object.assign(V, { url: URL.createObjectURL(file), model: null, init: {}, li: 0, phase: 'color', frames: null, result: null, blobs: [], cancel: false });
  vid.srcObject = null; vid.loop = false; vid.muted = true; vid.src = V.url;
  try {
    await new Promise((res, rej) => { vid.onloadedmetadata = res; vid.onerror = () => rej(new Error('decode')); setTimeout(() => rej(new Error('timeout')), 20000); });
  } catch (e) { toast(T('video_bad')); return; }
  V.duration = vid.duration; V.srcW = vid.videoWidth; V.srcH = vid.videoHeight;
  const k = Math.min(1, AN / Math.max(V.srcW, V.srcH));
  V.W = Math.round(V.srcW * k); V.H = Math.round(V.srcH * k); work.width = V.W; work.height = V.H;
  V.t0 = Math.min(2, Math.max(0, V.duration - 10));
  FL.go('video');
  await grab();
}

function seek(t) {
  return new Promise(res => {
    let done = false; const fin = () => { if (done) return; done = true; vid.removeEventListener('seeked', fin); res(); };
    vid.addEventListener('seeked', fin); vid.currentTime = Math.max(0, Math.min(t, V.duration - 0.02)); setTimeout(fin, 3000);
  });
}
async function grab() {
  await seek(V.t0);
  wctx.drawImage(vid, 0, 0, V.W, V.H);
  V.frame = wctx.getImageData(0, 0, V.W, V.H);
  V.blobs = V.model ? BF.findBlobs(V.frame.data, V.W, V.H, Object.assign({}, V.model, { tol: 1.3 })) : [];
  draw();
}

// ---------- set-up screen ----------
function render() {
  if (V.phase === 'process') return renderProcess();
  if (V.phase === 'result') return renderResult();
  const order = ORDER[V.view], cur = order[V.li];
  let prompt, controls = '';
  if (V.phase === 'color') {
    prompt = T('vid_color');
  } else {
    prompt = cur ? T('vid_name', { label: T('l_' + cur) }) : T('vid_named');
    const ready = order.every(l => !REQUIRED[l] || V.init[l]);
    controls = `<div class="row">
      ${cur && !REQUIRED[cur] ? `<button class="btn small" data-act="vSkip">${esc(T('vid_skip', { label: T('l_' + cur) }))}</button>` : ''}
      <button class="btn small ghost" data-act="vUndo" ${V.li ? '' : 'disabled'}>${esc(T('vid_undo'))}</button>
      <button class="btn small ghost" data-act="vRecolor">${esc(T('vid_recolor'))}</button>
      <button class="btn primary" data-act="vRun" ${ready ? '' : 'disabled'}>${esc(T('vid_run'))}</button></div>`;
  }
  const help = V.view === 'front' && cur ? `<p class="muted small">${esc(T('vid_front_help'))}</p>` : '';
  app.innerHTML = `
    <section class="stack"><button class="btn ghost small" data-act="vBack" style="width:fit-content">${esc(T('back'))}</button>
      <span class="eyebrow">${esc(T(V.view === 'side' ? 'vid_title_side' : 'vid_title_front'))} · ${num(V.duration, 1)} s</span>
      <p class="prompt">${esc(prompt)}</p>${help}</section>
    <div class="frame"><canvas id="vCanvas" width="${V.W}" height="${V.H}" style="width:100%;height:auto;display:block;touch-action:manipulation"></canvas></div>
    <label class="field"><span>${esc(T('vid_frame'))} <span class="mono" id="vT0">${num(V.t0, 1)} s</span></span>
      <input type="range" id="vSlider" min="0" max="${Math.max(0, V.duration - 0.5).toFixed(2)}" step="0.1" value="${V.t0}"></label>
    <section class="sheet">${controls || `<p class="muted small">${esc(T('vid_color_help'))}</p>`}
      ${V.model ? `<p class="muted small">${esc(T('vid_seen', { n: V.blobs.length }))}</p>` : ''}</section>`;
  draw();
}

function draw() {
  const c = $('#vCanvas'); if (!c || !V.frame) return;
  const ctx = c.getContext('2d'), K = Math.max(1, c.width / (c.getBoundingClientRect().width || c.width));
  ctx.putImageData(V.frame, 0, 0);
  ctx.lineWidth = 2 * K;
  V.blobs.forEach(b => { ctx.strokeStyle = '#000'; ctx.beginPath(); ctx.arc(b.x, b.y, 12 * K, 0, 7); ctx.stroke(); ctx.strokeStyle = '#fff'; ctx.beginPath(); ctx.arc(b.x, b.y, 10 * K, 0, 7); ctx.stroke(); });
  FL.drawPose(ctx, V.init, V.view, K, true);
}

function tap(e) {
  const c = e.target, r = c.getBoundingClientRect(), x = (e.clientX - r.left) * c.width / r.width, y = (e.clientY - r.top) * c.height / r.height;
  if (V.phase === 'color') {
    const m0 = BF.learnColor(V.frame.data, V.W, V.H, x, y);
    if (!m0) { toast(T('color_dull')); return; }
    V.model = BF.refineColor(V.frame.data, V.W, V.H, m0);
    V.blobs = BF.findBlobs(V.frame.data, V.W, V.H, Object.assign({}, V.model, { tol: 1.3 }));
    V.phase = 'labels'; V.li = 0; V.init = {};
    return render();
  }
  const l = ORDER[V.view][V.li]; if (!l) return;
  V.init[l] = BF.snapToSticker(V.frame.data, V.W, V.H, V.model, x, y) || [x, y];
  V.li++; render();
}

// ---------- processing ----------
function renderProcess() {
  app.innerHTML = `<section class="stack"><span class="eyebrow">${esc(T('vid_processing'))}</span><h1>${esc(T('vid_following'))}</h1>
      <p class="muted">${esc(T('vid_keep_open'))}</p></section>
    <div class="frame"><canvas id="vLive" width="${V.W}" height="${V.H}" style="width:100%;height:auto;display:block"></canvas></div>
    <div class="progress"><i id="vProg"></i></div>
    <div class="row"><button class="btn" data-act="vCancel">${esc(T('vid_cancel'))}</button></div>`;
}
async function run() {
  V.phase = 'process'; V.cancel = false; render();
  const init = {}; Object.keys(V.init).forEach(l => { if (V.init[l]) init[l] = V.init[l]; });
  const tracker = BF.createLocalTracker(V.model, init, V.W, V.H), frames = [];
  const end = Math.min(V.duration - 0.05, V.t0 + 40), live = $('#vLive').getContext('2d');
  let lastDraw = 0;
  const handle = t => {
    wctx.drawImage(vid, 0, 0, V.W, V.H);
    const img = wctx.getImageData(0, 0, V.W, V.H), pts = tracker.step(img.data, t);
    frames.push({ t, pts });
    const p = $('#vProg'); if (p) p.style.width = Math.min(100, (t - V.t0) / (end - V.t0) * 100) + '%';
    if (performance.now() - lastDraw > 150) { lastDraw = performance.now(); live.putImageData(img, 0, 0); FL.drawPose(live, pts, V.view, Math.max(1, V.W / (live.canvas.getBoundingClientRect().width || V.W)), false); }
  };
  await seek(V.t0); handle(V.t0);
  if (vid.requestVideoFrameCallback) {
    await new Promise(resolve => {
      const stop = () => { vid.pause(); resolve(); };
      const cb = (now, meta) => {
        if (V.cancel) return stop();
        const t = meta.mediaTime;
        if (t > frames[frames.length - 1].t) handle(t);
        if (t >= end || vid.ended) return stop();
        vid.requestVideoFrameCallback(cb);
      };
      vid.requestVideoFrameCallback(cb); vid.onended = stop;
      vid.playbackRate = 0.5; vid.play().catch(stop);
    });
  }
  if (frames.length < 30 && !V.cancel) { // no frame callback (or it failed): step through by seeking
    frames.length = 0;
    for (let t = V.t0; t < end && !V.cancel; t += 1 / 30) { await seek(t); handle(t); }
  }
  if (V.cancel) { V.phase = 'labels'; return render(); }
  analyse(frames);
}

function analyse(frames) {
  const labels = V.view === 'side' ? BF.SIDE_LABELS : BF.FRONT_LABELS, uni = BF.resample(frames, labels, 30);
  const r = FL.rider(), opts = { fps: 30, crankMm: r.crankMm || 172.5, minCycles: 4 };
  const res = V.view === 'side' ? BF.analyzeSide(uni, opts) : BF.analyzeFront(uni, opts);
  V.frames = uni; V.result = res; V.phase = 'result';
  // frame to show: bottom of the stroke (largest knee angle) in the middle of the clip
  let show = Math.floor(uni.length / 2);
  if (res.series && res.series.knee) { const mid = Math.floor(uni.length / 2), span = 60; let best = -1; for (let i = Math.max(0, mid - span); i < Math.min(uni.length, mid + span); i++) { const v = res.series.knee[i]; if (Number.isFinite(v) && v > best) { best = v; show = i; } } }
  V.show = show; V.note = FL.defaultNote(V.view);
  render();
}

// ---------- result ----------
function renderResult() {
  const res = V.result, r = FL.rider(), t = FL.targetsFor(r), labels = Object.keys(V.init).filter(l => V.init[l]);
  const check = FL.makeCheck(V.view, res, null);
  const prev = FL.lastCheck(r.id, V.view);
  const warn = [];
  if (res.cycles < 2) warn.push(T('vid_few'));
  if (res.slip) warn.push(T('warn_slip', { label: T('l_' + res.slip) }));
  if (res.pathRatio && res.pathRatio < 0.93) warn.push(T('warn_yaw', { deg: Math.round(Math.acos(Math.min(1, res.pathRatio)) * 180 / Math.PI) }));
  // Leg stickers must be followed on most frames, or the angles come from too few points to be trusted.
  const legs = V.view === 'side' ? ['hip', 'knee', 'ankle', 'foot'] : ['kneeL', 'kneeR', 'footL', 'footR'];
  const cov = labels.map(l => [l, res.coverage ? res.coverage[l] || 0 : 0]);
  const weak = cov.filter(([l, c]) => legs.includes(l) && c < 0.8);
  const ok = res.cycles >= 2 && !weak.length;
  app.innerHTML = `
    <section class="stack"><span class="eyebrow">${esc(r.name)} · ${esc(T(V.view))}${res.cadence ? ' · ' + Math.round(res.cadence) + ' ' + esc(T('rpm')) : ''} · ${res.cycles} ${esc(T('strokes'))}</span>
      <h1>${esc(T(ok ? 'vid_done' : weak.length ? 'vid_unreliable' : 'vid_failed'))}</h1></section>
    <section class="sheet"><h3>${esc(T('vid_coverage'))}</h3><div class="chips">${cov.map(([l, c]) => `<span class="chip ${c >= 0.9 ? 'ok' : c >= 0.8 ? 'near' : 'out'}">${esc(T('l_' + l))} ${Math.round(c * 100)} %</span>`).join('')}</div>
      ${weak.length ? `<p class="small">${esc(T('vid_unreliable_p'))}</p>` : ''}</section>
    <div class="frame"><canvas id="vRes" width="${V.W}" height="${V.H}" style="width:100%;height:auto;display:block"></canvas></div>
    <label class="field"><span>${esc(T('vid_review'))}</span><input type="range" id="vScrub" min="0" max="${V.frames.length - 1}" step="1" value="${V.show}"></label>
    ${warn.length ? `<div class="warn">${warn.map(w => `<p>${esc(w)}</p>`).join('')}</div>` : ''}
    ${ok ? FL.changeHTML(check.rec, T('next')) : ''}
    ${ok ? `<section class="sheet"><h2>${esc(T('measurements'))}</h2><div>${FL.metricsHTML(check, t, prev)}</div></section>` : ''}
    <section class="sheet"><label class="field">${esc(T('note'))}<input type="text" id="vNote" value="${esc(V.note || '')}"></label>
      <div class="row">${ok ? `<button class="btn primary" data-act="vSave">${esc(T('b_save'))}</button>` : ''}
        <button class="btn" data-act="vRelabel">${esc(T('vid_relabel'))}</button><button class="btn ghost" data-act="vBack">${esc(T('vid_discard'))}</button></div></section>`;
  showFrame(V.show);
}
async function showFrame(i) {
  const c = $('#vRes'); if (!c) return;
  const f = V.frames[i]; if (!f) return;
  await seek(f.t);
  const ctx = c.getContext('2d'), K = Math.max(1, c.width / (c.getBoundingClientRect().width || c.width));
  ctx.drawImage(vid, 0, 0, V.W, V.H);
  FL.drawPose(ctx, f.pts, V.view, K, false, true);
}

function save() {
  const c = $('#vRes'); let thumb = null;
  try { const s = document.createElement('canvas'); s.width = 320; s.height = Math.round(320 * V.H / V.W); s.getContext('2d').drawImage(c, 0, 0, s.width, s.height); thumb = s.toDataURL('image/jpeg', 0.6); } catch (e) { /* no thumbnail */ }
  const note = ($('#vNote') || {}).value || '';
  if (FL.saveCheck(FL.makeCheck(V.view, V.result, thumb, note, 'video'))) { toast(T('saved')); cleanup(); FL.go('rider'); }
}
function cleanup() { try { vid.pause(); } catch (e) { /* not playing */ } vid.removeAttribute('src'); if (V.url) URL.revokeObjectURL(V.url); V.url = null; }

// ---------- events ----------
app.addEventListener('click', e => { if (e.target.id === 'vCanvas') tap(e); });
app.addEventListener('input', e => {
  if (e.target.id === 'vSlider') { V.t0 = parseFloat(e.target.value); const s = $('#vT0'); if (s) s.textContent = num(V.t0, 1) + ' s'; }
  if (e.target.id === 'vScrub') { clearTimeout(V.st); const i = +e.target.value; V.st = setTimeout(() => showFrame(i), 60); }
  if (e.target.id === 'vNote') V.note = e.target.value;
});
app.addEventListener('change', async e => {
  if (e.target.id === 'vSlider') {
    const named = Object.keys(V.init).length > 0;
    await grab();
    if (named) { V.init = {}; V.li = 0; toast(T('vid_renamed')); }
    render();
  }
});
['fileRecord', 'fileVideoPick'].forEach(id => $('#' + id).addEventListener('change', e => { const f = e.target.files[0]; e.target.value = ''; if (f) load(f); }));

FL.video = {
  open, pick, render,
  act(a) {
    switch (a) {
      case 'vSkip': V.li++; return render();
      case 'vUndo': V.li = Math.max(0, V.li - 1); delete V.init[ORDER[V.view][V.li]]; return render();
      case 'vRecolor': V.phase = 'color'; V.model = null; V.blobs = []; V.init = {}; V.li = 0; return render();
      case 'vRun': return run();
      case 'vCancel': V.cancel = true; return;
      case 'vRelabel': V.phase = 'labels'; V.init = {}; V.li = 0; return grab().then(render);
      case 'vSave': return save();
      case 'vBack': cleanup(); return FL.go('rider');
    }
  },
};
})();
