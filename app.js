// Fit Loop app: riders, history and the live camera view. Measurement logic lives in core.js.
(function () {
'use strict';
const $ = s => document.querySelector(s);
const app = $('#app');
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = p => p + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const lower1 = s => s.charAt(0).toLowerCase() + s.slice(1);

// ---------------- storage (this device only) ----------------
const DB = {
  data: { riders: [], checks: [], color: null, settings: { voice: true, autosave: true, facing: 'environment', lang: null } },
  load() {
    try { const raw = localStorage.getItem('fitloop.v2'); if (raw) { const d = JSON.parse(raw); Object.assign(this.data, d, { settings: Object.assign(this.data.settings, d.settings || {}) }); } } catch (e) { /* start empty */ }
  },
  save() {
    try { localStorage.setItem('fitloop.v2', JSON.stringify(this.data)); return true; } catch (e) { toast(T('save_failed')); return false; }
  },
  rider(id) { return this.data.riders.find(r => r.id === id); },
  checks(riderId) { return this.data.checks.filter(c => c.riderId === riderId).sort((a, b) => b.created - a.created); },
};
DB.load();

// ---------------- language ----------------
let lang = DB.data.settings.lang || ((navigator.language || 'fr').toLowerCase().startsWith('fr') ? 'fr' : 'en');
function T(k, v) {
  let s = I18N[lang][k]; if (s == null) s = I18N.en[k]; if (s == null) return k;
  return v ? s.replace(/\{(\w+)\}/g, (_, n) => (v[n] == null ? '' : v[n])) : s;
}
const has = k => I18N.en[k] != null;
const num = (v, d) => Number(v).toLocaleString(lang === 'fr' ? 'fr-FR' : 'en-GB', { minimumFractionDigits: d, maximumFractionDigits: d });
const fmtDate = ts => new Date(ts).toLocaleDateString(lang === 'fr' ? 'fr-FR' : 'en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) + ' · ' + new Date(ts).toLocaleTimeString(lang === 'fr' ? 'fr-FR' : 'en-GB', { hour: '2-digit', minute: '2-digit' });

let toastTimer;
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, 3500); }

// ---------------- recommendation texts ----------------
function recText(n) {
  const tt = n.tt ? '_tt' : '';
  const part = T('part_' + (n.code === 'saddle_up' || n.code === 'saddle_down' ? 'height' : n.code.startsWith('saddle') ? 'setback' : n.code.startsWith('front') ? 'front' : 'reach'));
  const title = T(has('do_' + n.code + tt) ? 'do_' + n.code + tt : 'do_' + n.code, { mm: n.mm });
  const whyKey = 'why_' + n.key + (n.key === 'kneeExt' ? (n.code === 'saddle_up' ? '_low' : '_high') : n.key === 'kops' ? (n.v >= 0 ? '_ahead' : '_behind') : n.key === 'shoulder' ? (n.code === 'reach_shorter' ? '_long' : '_short') : '');
  const why = T(whyKey, { v: Math.abs(n.v).toFixed(0), lo: n.range[0], hi: n.range[1] });
  const how = T(has('how_' + n.code + tt) ? 'how_' + n.code + tt : 'how_' + n.code, { mm: n.mm, comp: n.comp });
  return { part, title, why, how };
}
function laterText(l) {
  if (l.mm != null) { const r = recText(l); return r.part + ' : ' + lower1(r.title) + '.'; }
  return T('later_' + l.code, { v: l.v != null ? Math.round(l.v) : '', side: T(l.side === 'L' ? 'left' : 'right'), where: T(l.inside ? 'inside' : 'outside') });
}
function changeHTML(rec, heading) {
  if (!rec) return '';
  const later = rec.later && rec.later.length ? rec.later.map(l => `<li>${esc(laterText(l))}</li>`).join('') : '';
  if (!rec.next) return `<section class="change"><span class="eyebrow">${esc(heading)}</span><h2>${esc(T('no_change'))}</h2>${later ? `<ul>${later}</ul>` : `<p class="muted">${esc(T('all_good'))}</p>`}</section>`;
  const r = recText(rec.next);
  return `<section class="change"><span class="eyebrow">${esc(heading)} · ${esc(r.part)}</span><h2>${esc(r.title)}</h2><p>${esc(r.why)}</p><p class="muted small">${esc(r.how)}</p>
    ${later ? `<details><summary>${esc(T('later', { n: rec.later.length }))}</summary><ul>${later}</ul></details>` : ''}</section>`;
}

// ---------------- shared render helpers ----------------
function targetsFor(r) {
  const t = JSON.parse(JSON.stringify(BF.TARGETS[r.discipline] || BF.TARGETS.road_endurance));
  if (r.targets) Object.keys(r.targets).forEach(k => { if (Array.isArray(r.targets[k])) t[k] = r.targets[k]; });
  return t;
}
function fmtVal(k, v) {
  if (!Number.isFinite(v)) return '—';
  if (BF.isMm(k)) return (v > 0 && (k === 'kops' || k.startsWith('kneeOffset')) ? '+' : '') + Math.round(v) + ' mm';
  return num(v, 1) + '°';
}
function gauge(v, range) {
  if (!range || !Number.isFinite(v)) return '';
  const [lo, hi] = range, span = Math.max(hi - lo, 10), min = lo - span * 0.9, max = hi + span * 0.9;
  const x = val => 6 + (Math.max(min, Math.min(max, val)) - min) / (max - min) * 288;
  const st = BF.status(v, range);
  return `<svg viewBox="0 0 300 22" preserveAspectRatio="none" aria-hidden="true"><rect x="6" y="9" width="288" height="4" rx="2" fill="var(--line)"/>
    <rect x="${x(lo)}" y="6" width="${x(hi) - x(lo)}" height="10" rx="2" fill="var(--band)"/>
    <line x1="${x(v)}" x2="${x(v)}" y1="2" y2="20" stroke="var(--${st === 'na' ? 'muted' : st})" stroke-width="3" stroke-linecap="round"/></svg>`;
}
const keysFor = view => (view === 'front' ? BF.FRONT_KEYS : BF.SIDE_KEYS);
function metricsHTML(check, t, prev) {
  return keysFor(check.view).filter(k => Number.isFinite(check.metrics[k])).map(k => {
    const v = check.metrics[k], range = BF.targetFor(k, t), st = BF.status(v, range), unit = BF.isMm(k) ? ' mm' : '°';
    const pv = prev && prev.metrics ? prev.metrics[k] : NaN, d = Number.isFinite(pv) ? v - pv : NaN;
    return `<div class="metric"><div class="name">${esc(T('m_' + k))}</div><div class="val">${fmtVal(k, v)}</div><div class="st"><span class="pill ${st}">${esc(T('st_' + st))}</span></div>
      <div class="hint">${esc(T('h_' + k))}${range ? ` · ${esc(T('target'))} <span class="mono">${range[0]} – ${range[1]}${unit}</span>` : ''}</div>
      <div class="delta">${Number.isFinite(d) ? (d >= 0 ? '+' : '−') + num(Math.abs(d), BF.isMm(k) ? 0 : 1) + unit + ' ' + esc(T('vs_last')) : ''}</div><div></div>
      <div class="gauge">${gauge(v, range)}</div></div>`;
  }).join('');
}
function chipsHTML(c, t) {
  const keys = c.view === 'front' ? BF.FRONT_KEYS : ['kneeExt', 'hipMin', 'torso', 'kops'];
  return `<div class="chips">${keys.filter(k => Number.isFinite(c.metrics[k])).map(k => `<span class="chip ${BF.status(c.metrics[k], BF.targetFor(k, t))}">${esc(T('s_' + k))} ${fmtVal(k, c.metrics[k])}</span>`).join('')}</div>`;
}
const discOpts = sel => Object.keys(BF.TARGETS).map(k => `<option value="${k}"${k === sel ? ' selected' : ''}>${esc(T('d_' + k))}</option>`).join('');
const lastCheck = (riderId, view, before, except) => DB.checks(riderId).find(c => c.view === view && c.id !== except && (!before || c.created < before)) || null;

// ---------------- pages ----------------
const S = { view: 'home', riderId: null, checkId: null, confirmDel: false };
function go(view, extra) { Object.assign(S, { view, confirmDel: false }, extra || {}); render(); window.scrollTo(0, 0); }
function render() {
  document.documentElement.lang = lang; $('#langBtn').textContent = lang === 'fr' ? 'EN' : 'FR';
  if (S.view === 'rider') return renderRider();
  if (S.view === 'check') return renderCheck();
  if (S.view === 'video') return FL.video ? FL.video.render() : go('rider');
  renderHome();
}

function renderHome() {
  const riders = DB.data.riders.slice().sort((a, b) => a.name.localeCompare(b.name));
  app.innerHTML = `
    <section class="stack"><span class="eyebrow">${esc(T('tagline'))}</span><h1>${esc(T('riders'))}</h1><p class="muted">${esc(T('home_intro'))}</p></section>
    ${riders.length ? `<div class="riders">${riders.map(r => {
      const cs = DB.checks(r.id), last = cs.find(c => c.view === 'side'), next = last && last.rec && last.rec.next;
      return `<button class="rider" data-act="openRider" data-id="${esc(r.id)}"><h3>${esc(r.name)}</h3><span class="pill na">${esc(T('checks_n', { n: cs.length }))}</span>
        <span class="muted small">${esc(T('d_' + r.discipline))}${r.bike ? ' · ' + esc(r.bike) : ''}</span><span></span>
        <span class="nextline">${next ? `${esc(T('next'))} : <b>${esc(recText(next).title)}</b>` : last ? esc(T('no_change')) : `<span class="muted">${esc(T('no_checks'))}</span>`}</span></button>`;
    }).join('')}</div>` : `<section class="sheet"><ol class="how"><li>${esc(T('how_1'))}</li><li>${esc(T('how_2'))}</li><li>${esc(T('how_3'))}</li></ol></section>`}
    <section class="sheet"><details ${riders.length ? '' : 'open'}><summary>${esc(T(riders.length ? 'add_rider' : 'add_first'))}</summary>
      <form id="addRider" class="stack" style="margin-top:12px">
        <div class="grid2"><label class="field">${esc(T('name'))}<input type="text" id="rName" required placeholder="${esc(T('name_ph'))}"></label>
          <label class="field">${esc(T('style'))}<select id="rDisc">${discOpts('road_endurance')}</select></label></div>
        <div class="grid2"><label class="field">${esc(T('bike'))}<input type="text" id="rBike" placeholder="${esc(T('bike_ph'))}"></label>
          <label class="field">${esc(T('crank'))}<input type="number" id="rCrank" value="172.5" min="140" max="185" step="0.5"></label></div>
        <p class="muted small">${esc(T('crank_help'))}</p>
        <div class="row"><button class="btn primary" type="submit">${esc(T('add'))}</button></div>
      </form></details></section>
    <section class="sheet"><h3>${esc(T('data'))}</h3><p class="muted small">${esc(T('data_help'))}</p>
      <div class="row"><button class="btn small" data-act="export">${esc(T('export'))}</button><button class="btn small" data-act="import">${esc(T('import'))}</button></div></section>`;
  $('#addRider').addEventListener('submit', e => {
    e.preventDefault();
    const name = $('#rName').value.trim(); if (!name) return;
    const r = { id: uid('r'), name, discipline: $('#rDisc').value, bike: $('#rBike').value.trim(), crankMm: parseFloat($('#rCrank').value) || 172.5, created: Date.now() };
    DB.data.riders.push(r); DB.save(); go('rider', { riderId: r.id });
  });
}

function guideSVG(view) {
  const L = k => esc(T('l_' + k));
  if (view === 'front') return `<svg viewBox="0 0 320 210" role="img" aria-label="${esc(T('front'))}">
    <g stroke="var(--ink)" stroke-width="10" stroke-linecap="round" fill="none" opacity=".85"><path d="M140 60 L128 120 L134 180"/><path d="M180 60 L192 120 L186 180"/><path d="M140 60 L180 60"/></g>
    <g fill="var(--accent)" stroke="var(--sheet)" stroke-width="2"><circle cx="128" cy="120" r="6"/><circle cx="134" cy="184" r="6"/><circle cx="192" cy="120" r="6"/><circle cx="186" cy="184" r="6"/></g>
    <g font-family="IBM Plex Sans, system-ui, sans-serif" font-size="11" fill="var(--ink)"><text x="116" y="124" text-anchor="end">${L('kneeR')}</text><text x="122" y="188" text-anchor="end">${L('footR')}</text><text x="204" y="124">${L('kneeL')}</text><text x="198" y="188">${L('footL')}</text></g></svg>`;
  return `<svg viewBox="0 0 320 210" role="img" aria-label="${esc(T('side'))}">
    <g fill="none" stroke="var(--muted)" stroke-width="2"><circle cx="70" cy="150" r="45"/><circle cx="250" cy="150" r="45"/><path d="M70 150 L140 150 L120 82 L222 88 Z M140 150 L250 150 M222 88 L232 70 L246 68 M120 82 L114 70"/><line x1="140" y1="150" x2="152" y2="171"/></g>
    <g stroke="var(--ink)" stroke-width="7" stroke-linecap="round" fill="none" opacity=".85"><path d="M116 66 L176 34 L196 58 L236 70"/><path d="M116 66 L160 104 L150 160 L164 168"/></g>
    <circle cx="176" cy="20" r="11" fill="var(--ink)" opacity=".85"/>
    <g fill="var(--accent)" stroke="var(--sheet)" stroke-width="2"><circle cx="176" cy="34" r="6"/><circle cx="196" cy="58" r="6"/><circle cx="232" cy="70" r="6"/><circle cx="116" cy="66" r="6"/><circle cx="160" cy="104" r="6"/><circle cx="150" cy="160" r="6"/><circle cx="164" cy="168" r="6"/></g>
    <g font-family="IBM Plex Sans, system-ui, sans-serif" font-size="11" fill="var(--ink)"><text x="166" y="32" text-anchor="end">${L('shoulder')}</text><text x="205" y="54">${L('elbow')}</text><text x="242" y="64">${L('wrist')}</text>
      <text x="106" y="62" text-anchor="end">${L('hip')}</text><text x="170" y="108">${L('knee')}</text><text x="140" y="164" text-anchor="end">${L('ankle')}</text><text x="174" y="180">${L('foot')}</text></g></svg>`;
}

function renderRider() {
  const r = DB.rider(S.riderId); if (!r) return go('home');
  const t = targetsFor(r), cs = DB.checks(r.id);
  const lastSide = cs.find(c => c.view === 'side'), lastFront = cs.find(c => c.view === 'front');
  let rec = lastSide ? lastSide.rec : null;
  if (lastFront && lastFront.rec && rec) rec = { next: rec.next, later: rec.later.concat(lastFront.rec.later) };
  else if (lastFront && !rec) rec = lastFront.rec;
  app.innerHTML = `
    <section class="stack"><button class="btn ghost small" data-act="home" style="width:fit-content">${esc(T('back_riders'))}</button>
      <div class="stack" style="gap:4px"><span class="eyebrow">${esc(T('d_' + r.discipline))}${r.bike ? ' · ' + esc(r.bike) : ''} · ${num(r.crankMm || 172.5, 1)} mm</span><h1>${esc(r.name)}</h1></div></section>
    ${rec ? changeHTML(rec, T('next')) : `<section class="sheet"><h3>${esc(T('first_check'))}</h3><p class="muted">${esc(T('first_check_p'))}</p></section>`}
    <div class="row"><button class="btn primary" data-act="vRecord" data-v="side">${esc(T('vid_record_side'))}</button><button class="btn" data-act="vPick" data-v="side">${esc(T('vid_pick'))}</button></div>
    <div class="row"><button class="btn small" data-act="vRecord" data-v="front">${esc(T('vid_record_front'))}</button><button class="btn small" data-act="vPick" data-v="front">${esc(T('vid_pick_front'))}</button>
      <button class="btn ghost small" data-act="live" data-v="side">${esc(T('live_beta'))}</button></div>
    <p class="muted small">${esc(T('vid_tips'))}</p>
    <section class="sheet"><details ${cs.length ? '' : 'open'}><summary>${esc(T('prep'))}</summary>
      <div class="guide"><div class="stack">${guideSVG('side')}${guideSVG('front')}</div>
        <div class="stack"><h3>${esc(T('stickers'))}</h3><ol class="tips"><li>${esc(T('prep_s1'))}</li><li>${esc(T('prep_s2'))}</li><li>${esc(T('prep_s3'))}</li><li>${esc(T('prep_f1'))}</li></ol>
          <h3>${esc(T('phone'))}</h3><ol class="tips"><li>${esc(T('prep_p1'))}</li><li>${esc(T('prep_p2'))}</li><li>${esc(T('prep_p3'))}</li><li>${esc(T('prep_p4'))}</li></ol></div></div></details></section>
    <section class="sheet"><div class="row" style="justify-content:space-between"><h2>${esc(T('history'))}</h2><span class="muted mono" style="font-size:12px">${esc(T('newest'))}</span></div>
      <div>${cs.length ? cs.map(c => `<button class="check" data-act="openCheck" data-id="${esc(c.id)}">
        ${c.thumb ? `<img class="thumb" src="${c.thumb}" alt="">` : `<span class="thumb">${esc(T(c.view))}</span>`}
        <span style="min-width:0"><b>${esc(c.note || T('check'))}</b><br><span class="muted" style="font-size:12.5px">${fmtDate(c.created)} · ${esc(T(c.view))}${c.cadence ? ' · ' + Math.round(c.cadence) + ' ' + esc(T('rpm')) : ''}</span>${chipsHTML(c, t)}</span>
        <span aria-hidden="true" class="muted">›</span></button>`).join('') : `<p class="muted">${esc(T('no_checks'))}</p>`}</div></section>
    <section class="sheet"><details><summary>${esc(T('settings'))}</summary><div class="stack" style="margin-top:12px">
      <div class="grid2"><label class="field">${esc(T('name'))}<input type="text" id="eName" value="${esc(r.name)}"></label><label class="field">${esc(T('style'))}<select id="eDisc">${discOpts(r.discipline)}</select></label></div>
      <div class="grid2"><label class="field">${esc(T('bike'))}<input type="text" id="eBike" value="${esc(r.bike || '')}"></label><label class="field">${esc(T('crank'))}<input type="number" id="eCrank" value="${r.crankMm || 172.5}" min="140" max="185" step="0.5"></label></div>
      <p class="muted small">${esc(T('targets_help'))}</p>
      <div class="targets"><table><tbody>${BF.SIDE_KEYS.map(k => `<tr><td>${esc(T('m_' + k))}</td>
        <td><input type="number" id="t_${k}_0" value="${t[k][0]}" step="1" aria-label="${esc(T('m_' + k))} min"></td><td><input type="number" id="t_${k}_1" value="${t[k][1]}" step="1" aria-label="${esc(T('m_' + k))} max"></td><td class="muted">${BF.isMm(k) ? 'mm' : '°'}</td></tr>`).join('')}</tbody></table></div>
      <div class="row"><button class="btn primary" data-act="saveRider">${esc(T('save_settings'))}</button><button class="btn small ghost" data-act="resetTargets">${esc(T('reset_targets'))}</button></div>
      ${S.confirmDel ? `<div class="confirm"><p>${esc(T('del_rider_q', { name: r.name, n: cs.length }))}</p><div class="row"><button class="btn danger" data-act="delRider">${esc(T('del'))}</button><button class="btn" data-act="cancelDel">${esc(T('keep'))}</button></div></div>`
        : `<div><button class="btn small ghost danger" data-act="askDel">${esc(T('del_rider'))}</button></div>`}
    </div></details></section>`;
}

function renderCheck() {
  const r = DB.rider(S.riderId), c = DB.data.checks.find(x => x.id === S.checkId);
  if (!r || !c) return go('rider');
  const t = targetsFor(r), prev = lastCheck(r.id, c.view, c.created, c.id);
  app.innerHTML = `
    <section class="stack"><button class="btn ghost small" data-act="openRider" data-id="${esc(r.id)}" style="width:fit-content">← ${esc(r.name)}</button>
      <span class="eyebrow">${fmtDate(c.created)} · ${esc(T(c.view))}${c.cadence ? ' · ' + Math.round(c.cadence) + ' ' + esc(T('rpm')) : ''}${c.cycles ? ' · ' + c.cycles + ' ' + esc(T('strokes')) : ''}</span><h1>${esc(c.note || T('check'))}</h1></section>
    ${c.thumb ? `<div class="frame"><img src="${c.thumb}" alt=""></div>` : ''}
    ${changeHTML(c.rec, T('rec_after'))}
    <section class="sheet"><h2>${esc(T('measurements'))}</h2><div>${metricsHTML(c, t, prev)}</div>${prev ? `<p class="muted" style="font-size:12.5px">${esc(T('vs_prev', { date: fmtDate(prev.created) }))}</p>` : ''}</section>
    <section class="sheet"><label class="field">${esc(T('note'))}<input type="text" id="cNote" value="${esc(c.note || '')}"></label>
      <div class="row"><button class="btn primary small" data-act="saveNote">${esc(T('save_settings'))}</button></div></section>
    ${S.confirmDel ? `<div class="confirm"><p>${esc(T('del_check_q'))}</p><div class="row"><button class="btn danger" data-act="delCheck">${esc(T('del'))}</button><button class="btn" data-act="cancelDel">${esc(T('keep'))}</button></div></div>`
      : `<div><button class="btn small ghost danger" data-act="askDel">${esc(T('del_check'))}</button></div>`}`;
}

// ---------------- voice ----------------
let lastSay = 0;
function say(text, force) {
  if (!DB.data.settings.voice || !('speechSynthesis' in window)) return;
  const now = performance.now(); if (!force && now - lastSay < 7000) return; lastSay = now;
  try { speechSynthesis.cancel(); const u = new SpeechSynthesisUtterance(text); u.lang = lang === 'fr' ? 'fr-FR' : 'en-GB'; speechSynthesis.speak(u); } catch (e) { /* no voice on this device */ }
}

// ---------------- live view ----------------
const vid = $('#vid'), viewC = $('#view'), vctx = viewC.getContext('2d');
const work = document.createElement('canvas'), wctx = work.getContext('2d', { willReadFrequently: true });
const L = { on: false };
const MIN_CYCLES = 6;

async function startLive(view, file) {
  const r = DB.rider(S.riderId); if (!r) return;
  stopLive(true);
  const col = DB.data.colorModel;
  Object.assign(L, { on: true, view, rider: r, targets: targetsFor(r), ses: null, W: 0, model: col || null, tol: col ? col.tol : 1, autoTol: col ? col.autoTol !== false : true, pick: null, pickMode: false,
    rejected: [], lastTune: 0, debug: false, snap: false, countSeen: null, countSince: 0,
    frames: [], recent: [], out: { state: 'nocolor' }, blobs: [], result: null, rec: null, lastHud: 0, idleSince: null, paused: false, savedBout: false, savedAt: 0,
    wasTrack: false, lastVideoTime: -1, tilt: null, stream: null, file: !!file, prev: lastCheck(r.id, view), fps: 0, fpsN: 0, fpsT: 0 });
  $('#live').hidden = false; document.body.style.overflow = 'hidden';
  $('#hud').innerHTML = `<div class="hud-status">${esc(T('live_starting'))}</div>`; renderTools();
  say(' ', true); lastSay = 0; // unlocks speech on iOS: must happen inside the tap
  try {
    vid.loop = !!file;
    if (file) { vid.srcObject = null; vid.src = URL.createObjectURL(file); }
    else {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) throw Object.assign(new Error('insecure'), { name: window.isSecureContext ? 'NotFoundError' : 'InsecureError' });
      const base = { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } }, dev = DB.data.settings.deviceId;
      try { L.stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: Object.assign({}, base, dev ? { deviceId: { exact: dev } } : { facingMode: { ideal: DB.data.settings.facing } }) }); }
      catch (e) {
        if (!dev || e.name === 'NotAllowedError') throw e;
        delete DB.data.settings.deviceId; DB.save(); // that camera is gone: fall back to front/back
        L.stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: Object.assign({}, base, { facingMode: { ideal: DB.data.settings.facing } }) });
      }
      // widest view the camera allows (some phones expose the 0.5x lens as a zoom below 1)
      try { const tr = L.stream.getVideoTracks()[0], cap = tr.getCapabilities ? tr.getCapabilities() : {}; if (cap.zoom && cap.zoom.min < 1) await tr.applyConstraints({ advanced: [{ zoom: cap.zoom.min }] }); } catch (e) { /* no zoom control */ }
      vid.removeAttribute('src'); vid.srcObject = L.stream;
    }
    await vid.play();
  } catch (e) {
    const msg = file ? T('video_bad') : e.name === 'NotAllowedError' || e.name === 'SecurityError' ? T('cam_denied') : e.name === 'InsecureError' ? T('cam_insecure') : T('cam_none');
    stopLive(); toast(msg); return;
  }
  if (!L.on) return;
  try { if (navigator.wakeLock) L.wake = await navigator.wakeLock.request('screen'); } catch (e) { /* optional */ }
  watchTilt();
  schedule();
}
function stopLive(silent) {
  if (!L.on && silent) return;
  L.on = false;
  if (L.stream) L.stream.getTracks().forEach(t => t.stop());
  if (L.wake) { try { L.wake.release(); } catch (e) { /* already released */ } L.wake = null; }
  if (L.raf) cancelAnimationFrame(L.raf);
  window.removeEventListener('devicemotion', onMotion);
  try { vid.pause(); } catch (e) { /* not playing */ }
  if (vid.src && vid.src.startsWith('blob:')) URL.revokeObjectURL(vid.src);
  vid.srcObject = null; vid.removeAttribute('src');
  $('#live').hidden = true; document.body.style.overflow = '';
  if ('speechSynthesis' in window) speechSynthesis.cancel();
  if (!silent) render();
}
function schedule() {
  if (!L.on) return;
  if (vid.requestVideoFrameCallback) vid.requestVideoFrameCallback(() => { frame(); schedule(); });
  else L.raf = requestAnimationFrame(() => { if (vid.currentTime !== L.lastVideoTime) { L.lastVideoTime = vid.currentTime; frame(); } schedule(); });
}

// Phone tilt from gravity: only how far it is from level, so no sign convention is needed.
function onMotion(e) {
  const g = e.accelerationIncludingGravity; if (!g || g.x == null) return;
  if (Math.abs(g.z) > 8.5) { L.tilt = null; return; } // lying flat
  const ax = Math.abs(g.x), ay = Math.abs(g.y), dev = Math.min(Math.atan2(ay, ax), Math.atan2(ax, ay)) * 180 / Math.PI;
  L.tilt = L.tilt == null ? dev : L.tilt * 0.9 + dev * 0.1;
}
function watchTilt() {
  const add = () => window.addEventListener('devicemotion', onMotion);
  try {
    if (typeof DeviceMotionEvent !== 'undefined' && typeof DeviceMotionEvent.requestPermission === 'function') DeviceMotionEvent.requestPermission().then(s => { if (s === 'granted') add(); }).catch(() => {});
    else if (typeof DeviceMotionEvent !== 'undefined') add();
  } catch (e) { /* no motion sensor */ }
}

const counts = () => (L.view === 'side' ? [4, 5, 7] : [4]);
function learnColor(img, W, H, x, y) {
  const m0 = BF.learnColor(img.data, W, H, x, y);
  if (!m0) { toast(T('color_dull')); return; }
  const m = BF.refineColor(img.data, W, H, m0); // relearn from every sticker found, not only the tapped one
  L.model = m; L.pickMode = false; L.autoTol = true;
  const at = BF.autoTolerance(img.data, W, H, m, counts());
  L.tol = at.tol || 1; // none found: stay at the default and show the real count
  saveModel();
  if (L.ses) L.ses.reset(); L.frames = []; L.result = null;
  toast(T('color_learned') + (at.tol ? ' ' + T('tol_set', { n: at.n }) : '')); renderTools();
}
function saveModel() { DB.data.colorModel = Object.assign({}, L.model, { tol: L.tol, autoTol: L.autoTol }); DB.save(); }
function snapshot(img, W, H) {
  const c = document.createElement('canvas'); c.width = W; c.height = H; c.getContext('2d').putImageData(img, 0, 0);
  c.toBlob(b => {
    if (!b) return;
    const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = 'fit-loop-camera-' + new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-') + '.png';
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    toast(T('snap_saved'));
  }, 'image/png');
}

function frame() {
  if (!L.on || !vid.videoWidth) return;
  const t = performance.now() / 1000;
  const k = Math.min(1, 960 / Math.max(vid.videoWidth, vid.videoHeight));
  const W = Math.round(vid.videoWidth * k), H = Math.round(vid.videoHeight * k);
  if (W !== L.W || H !== L.H) { L.W = W; L.H = H; work.width = viewC.width = W; work.height = viewC.height = H; L.ses = BF.createSession(L.view, W); L.frames = []; }
  wctx.drawImage(vid, 0, 0, W, H);
  const img = wctx.getImageData(0, 0, W, H);
  if (L.snap) { L.snap = false; snapshot(img, W, H); }
  if (L.pick) { learnColor(img, W, H, L.pick[0] * W, L.pick[1] * H); L.pick = null; }
  L.rejected = [];
  L.blobs = L.model ? BF.findBlobs(img.data, W, H, Object.assign({}, L.model, { tol: L.tol }), { rejected: L.rejected }) : [];
  // wrong number of stickers for a while: try other tolerances on this frame
  if (L.model && L.autoTol && L.out.state === 'search' && L.out.reason === 'count' && !counts().includes(L.blobs.length) && t - L.lastTune > 3) {
    L.lastTune = t;
    const at = BF.autoTolerance(img.data, W, H, L.model, counts());
    if (at.tol && at.tol !== L.tol) { L.tol = at.tol; saveModel(); L.blobs = BF.findBlobs(img.data, W, H, Object.assign({}, L.model, { tol: L.tol }), { rejected: (L.rejected = []) }); }
  }
  if (L.debug && L.model) { // paint what matches the sticker colour
    const mk = BF.lastMask(), d = img.data;
    for (let p = 0; p < mk.length; p++) if (mk[p]) { d[p * 4] = 255; d[p * 4 + 1] = 0; d[p * 4 + 2] = 255; }
    wctx.putImageData(img, 0, 0);
  }
  const out = L.model ? L.ses.step(L.blobs, t) : { state: 'nocolor' };
  L.out = out;
  const isTrack = out.state === 'track';
  if (isTrack && !L.wasTrack) say(T('v_ready'));
  if (!isTrack && L.wasTrack) { L.frames = []; L.recent = []; L.result = null; L.rec = null; if (out.reason === 'lost') say(T('v_lost')); }
  L.wasTrack = isTrack;
  if (isTrack) {
    const foot = out.pts[L.view === 'side' ? 'foot' : 'footL'];
    if (foot) { L.recent.push([t, foot[1]]); while (L.recent.length && t - L.recent[0][0] > 2) L.recent.shift(); }
    if (!L.paused) { L.frames.push({ t, pts: out.pts }); while (L.frames.length && t - L.frames[0].t > 12) L.frames.shift(); }
  }
  draw(out);
  L.fpsN++; if (t - L.fpsT >= 1) { L.fps = L.fpsN / (t - L.fpsT); L.fpsN = 0; L.fpsT = t; }
  if (t - L.lastHud >= 0.5) { L.lastHud = t; analyse(t); renderHud(t); }
}

function analyse(t) {
  if (L.out.state !== 'track') return;
  // pedalling or stopped? (vertical travel of the foot over the last 2 s)
  const ys = L.recent.map(q => q[1]);
  const idle = ys.length > 8 && Math.max(...ys) - Math.min(...ys) < L.W * 0.02;
  if (idle) { if (L.idleSince == null) L.idleSince = t; if (t - L.idleSince > 3 && !L.paused) { L.paused = true; L.frames = []; L.result = null; L.savedBout = false; } }
  else { L.idleSince = null; L.paused = false; }
  if (L.paused) return;
  const win = L.frames.filter(f => f.t >= t - 10);
  if (win.length < 45 || win[win.length - 1].t - win[0].t < 3) { L.result = null; return; }
  const uni = BF.resample(win, L.ses.labels, 30), opts = { fps: 30, crankMm: L.rider.crankMm || 172.5, dir: L.out.dir, minCycles: MIN_CYCLES };
  const res = L.view === 'side' ? BF.analyzeSide(uni, opts) : BF.analyzeFront(uni, opts);
  L.result = res;
  L.rec = res.cycles >= 2 ? BF.recommend(res.metrics, L.view, L.targets) : null;
  if (res.stable && !L.savedBout && DB.data.settings.autosave) saveCheck(true);
}

function saveCheck(auto) {
  const res = L.result; if (!res || res.cycles < 2) return;
  const r = L.rider, prev = lastCheck(r.id, L.view);
  let thumb = null;
  try { const c = document.createElement('canvas'); c.width = 320; c.height = Math.round(320 * L.H / L.W); c.getContext('2d').drawImage(viewC, 0, 0, c.width, c.height); thumb = c.toDataURL('image/jpeg', 0.6); } catch (e) { /* no thumbnail */ }
  const metrics = {}; Object.keys(res.metrics).forEach(k => { if (Number.isFinite(res.metrics[k])) metrics[k] = Math.round(res.metrics[k] * 10) / 10; });
  const note = !prev ? T('note_start') : prev.rec && prev.rec.next ? T('note_after', { what: lower1(recText(prev.rec.next).title) }) : '';
  const check = { id: uid('c'), riderId: r.id, created: Date.now(), view: L.view, note, cadence: res.cadence, cycles: res.cycles, metrics, rec: BF.recommend(metrics, L.view, L.targets), thumb, auto: !!auto,
    quality: { pathRatio: res.pathRatio || null, slip: res.slip || null, stable: !!res.stable } };
  DB.data.checks.push(check);
  if (!DB.save()) { DB.data.checks.pop(); return; }
  L.savedBout = true; L.savedAt = performance.now() / 1000; L.prev = check;
  let speech = T('v_saved');
  if (L.view === 'side' && Number.isFinite(metrics.kneeExt)) speech += ' ' + T('v_knee', { v: Math.round(metrics.kneeExt) });
  speech += ' ' + (check.rec.next ? T('v_next', { what: lower1(recText(check.rec.next).title).replace(/ mm\b/, ' ' + T('v_mm')) }) : T('v_none'));
  say(speech, true);
}

// ---- drawing ----
function uiK() { const w = viewC.getBoundingClientRect().width; return w ? Math.max(1, viewC.width / w) : 1; }
function tag(text, x, y, big) {
  const K = uiK();
  vctx.font = big ? `600 ${Math.round(15 * K)}px "IBM Plex Mono", ui-monospace, monospace` : `600 ${Math.round(11 * K)}px "IBM Plex Sans", system-ui, sans-serif`;
  const w = vctx.measureText(text).width + 8 * K, h = (big ? 20 : 16) * K;
  x = Math.max(0, Math.min(viewC.width - w, x));
  vctx.fillStyle = 'rgba(16,20,26,.82)'; vctx.fillRect(x, y - h + 4 * K, w, h);
  vctx.fillStyle = '#ffffff'; vctx.fillText(text, x + 4 * K, y);
}
function draw(out) {
  const K = uiK(), acc = '#ff6a1f';
  vctx.drawImage(work, 0, 0);
  if (out.state !== 'track') {
    vctx.lineWidth = 2 * K;
    L.blobs.forEach(b => { vctx.strokeStyle = '#000'; vctx.beginPath(); vctx.arc(b.x, b.y, 11 * K, 0, 7); vctx.stroke(); vctx.strokeStyle = '#fff'; vctx.beginPath(); vctx.arc(b.x, b.y, 9 * K, 0, 7); vctx.stroke(); });
    if (L.debug) { // rejected: right colour, wrong size or shape
      vctx.strokeStyle = '#ff3b3b'; vctx.lineWidth = 2 * K;
      L.rejected.forEach(b => { const r = 6 * K; vctx.beginPath(); vctx.moveTo(b.x - r, b.y - r); vctx.lineTo(b.x + r, b.y + r); vctx.moveTo(b.x + r, b.y - r); vctx.lineTo(b.x - r, b.y + r); vctx.stroke(); });
    }
    return;
  }
  const P = out.pts, segs = L.view === 'side' ? [['wrist', 'elbow'], ['elbow', 'shoulder'], ['shoulder', 'hip'], ['hip', 'knee'], ['knee', 'ankle'], ['ankle', 'foot']] : [['kneeL', 'footL'], ['kneeR', 'footR']];
  vctx.lineCap = 'round';
  segs.forEach(([a, b]) => {
    const p = P[a], q = P[b]; if (!p || !q) return;
    vctx.strokeStyle = 'rgba(0,0,0,.55)'; vctx.lineWidth = 6 * K; vctx.beginPath(); vctx.moveTo(p[0], p[1]); vctx.lineTo(q[0], q[1]); vctx.stroke();
    vctx.strokeStyle = acc; vctx.lineWidth = 3 * K; vctx.beginPath(); vctx.moveTo(p[0], p[1]); vctx.lineTo(q[0], q[1]); vctx.stroke();
  });
  Object.keys(P).forEach(l => { const p = P[l]; if (!p) return; vctx.fillStyle = '#fff'; vctx.beginPath(); vctx.arc(p[0], p[1], 5 * K, 0, 7); vctx.fill(); vctx.fillStyle = acc; vctx.beginPath(); vctx.arc(p[0], p[1], 3 * K, 0, 7); vctx.fill(); });
  if (L.view === 'side') {
    const d = out.dir, off = d > 0 ? 12 * K : -58 * K;
    if (P.hip && P.knee && P.ankle) tag(Math.round(BF.angleAt(P.hip, P.knee, P.ankle)) + '°', P.knee[0] + off, P.knee[1] + 4 * K, true);
    if (P.shoulder && P.hip && P.knee) tag(Math.round(BF.angleAt(P.shoulder, P.hip, P.knee)) + '°', P.hip[0] - off - 46 * K, P.hip[1] + 4 * K, true);
  }
}

// Skeleton for any canvas: lines between joints, joint dots, optional names and angles.
function drawPose(ctx, P, view, K, names, angles) {
  const acc = '#ff6a1f', segs = view === 'side' ? [['wrist', 'elbow'], ['elbow', 'shoulder'], ['shoulder', 'hip'], ['hip', 'knee'], ['knee', 'ankle'], ['ankle', 'foot']] : [['kneeL', 'footL'], ['kneeR', 'footR']];
  ctx.lineCap = 'round';
  segs.forEach(([a, b]) => {
    const p = P[a], q = P[b]; if (!p || !q) return;
    ctx.strokeStyle = 'rgba(0,0,0,.55)'; ctx.lineWidth = 6 * K; ctx.beginPath(); ctx.moveTo(p[0], p[1]); ctx.lineTo(q[0], q[1]); ctx.stroke();
    ctx.strokeStyle = acc; ctx.lineWidth = 3 * K; ctx.beginPath(); ctx.moveTo(p[0], p[1]); ctx.lineTo(q[0], q[1]); ctx.stroke();
  });
  const label = (text, x, y, big) => {
    ctx.font = big ? `600 ${Math.round(15 * K)}px "IBM Plex Mono", ui-monospace, monospace` : `600 ${Math.round(12 * K)}px "IBM Plex Sans", system-ui, sans-serif`;
    const w = ctx.measureText(text).width + 8 * K, h = (big ? 20 : 17) * K; x = Math.max(0, Math.min(ctx.canvas.width - w, x));
    ctx.fillStyle = 'rgba(16,20,26,.82)'; ctx.fillRect(x, y - h + 4 * K, w, h); ctx.fillStyle = '#fff'; ctx.fillText(text, x + 4 * K, y);
  };
  Object.keys(P).forEach(l => {
    const p = P[l]; if (!p) return;
    ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(p[0], p[1], 5 * K, 0, 7); ctx.fill(); ctx.fillStyle = acc; ctx.beginPath(); ctx.arc(p[0], p[1], 3 * K, 0, 7); ctx.fill();
    if (names) label(T('l_' + l), p[0] + 10 * K, p[1] - 10 * K);
  });
  if (angles && view === 'side') {
    const d = P.foot && P.hip ? Math.sign(P.foot[0] - P.hip[0]) || 1 : 1, off = d > 0 ? 12 * K : -60 * K;
    if (P.hip && P.knee && P.ankle) label(Math.round(BF.angleAt(P.hip, P.knee, P.ankle)) + '°', P.knee[0] + off, P.knee[1] + 5 * K, true);
    if (P.shoulder && P.hip && P.knee) label(Math.round(BF.angleAt(P.shoulder, P.hip, P.knee)) + '°', P.hip[0] - off - 48 * K, P.hip[1] + 5 * K, true);
  }
}
function defaultNote(view) {
  const prev = lastCheck(S.riderId, view);
  return !prev ? T('note_start') : prev.rec && prev.rec.next ? T('note_after', { what: lower1(recText(prev.rec.next).title) }) : '';
}
function makeCheck(view, res, thumb, note, source) {
  const metrics = {}; Object.keys(res.metrics || {}).forEach(k => { if (Number.isFinite(res.metrics[k])) metrics[k] = Math.round(res.metrics[k] * 10) / 10; });
  return { id: uid('c'), riderId: S.riderId, created: Date.now(), view, note: note != null ? note : defaultNote(view), cadence: res.cadence, cycles: res.cycles, metrics,
    rec: BF.recommend(metrics, view, targetsFor(DB.rider(S.riderId))), thumb, source: source || 'live',
    quality: { pathRatio: res.pathRatio || null, slip: res.slip || null, stable: !!res.stable } };
}
function storeCheck(check) { DB.data.checks.push(check); if (!DB.save()) { DB.data.checks.pop(); return false; } return true; }
window.FL = { $, esc, T, num, toast, go: v => go(v), rider: () => DB.rider(S.riderId), targetsFor, lastCheck, changeHTML, metricsHTML, makeCheck, saveCheck: storeCheck, defaultNote, drawPose };

// ---- HUD ----
function tile(k, v, prev) {
  const range = BF.targetFor(k, L.targets), st = BF.status(v, range), mm = BF.isMm(k);
  const pv = prev && prev.metrics ? prev.metrics[k] : NaN, d = Number.isFinite(pv) ? v - pv : NaN;
  const val = mm ? (v > 0 && k !== 'kneeTravelL' && k !== 'kneeTravelR' ? '+' : '') + Math.round(v) : Math.round(v) + '°';
  return `<div class="tile ${st}"><span class="tl">${esc(T('s_' + k))}</span><span class="tv">${val}${mm ? '<small style="font-size:.4em"> mm</small>' : ''}</span>
    <span class="tt">${range ? range[0] + '–' + range[1] : ''}${Number.isFinite(d) && Math.abs(d) >= (mm ? 1 : 0.5) ? ' · ' + (d >= 0 ? '+' : '−') + num(Math.abs(d), mm ? 0 : 1) : ''}</span></div>`;
}
function renderHud(t) {
  const out = L.out, warn = [];
  let status = '', good = false, sub = '', body = '';
  if (L.tilt != null && L.tilt > 2) warn.push(T('warn_tilt', { deg: Math.round(L.tilt) }));
  if (out.state === 'nocolor' || L.pickMode) status = T(L.model ? 'live_pick' : 'live_nocolor');
  else if (out.state === 'search') {
    const n = L.blobs.length;
    status = out.reason === 'still' || (out.reason === 'count' && counts().includes(n)) ? T('live_still') : out.reason === 'unsure' ? T('live_unsure') : out.reason === 'lost' ? T('live_lost') : T('live_count', { n, need: T('need_' + L.view) });
    body = `<div class="bigcount${counts().includes(n) ? ' good' : ''}">${n}<small> / ${esc(T('need_' + L.view))}</small></div><p class="muted small">${esc(T('live_tap_hint'))}</p>`;
    if (n > 7 || L.rejected.length > 12) warn.push(T('warn_many', { n: n + L.rejected.length }));
    // say the count aloud when it settles on a new value, so the rider hears it from the bike
    if (n !== L.countSeen) { L.countSeen = n; L.countSince = t; L.countSaid = false; }
    else if (!L.countSaid && t - L.countSince > 1.5 && out.reason === 'count' && !counts().includes(n)) { L.countSaid = true; say(T('v_count', { n }), true); }
  } else {
    const res = L.result;
    if (out.missing.length) warn.push(T('warn_missing', { list: out.missing.map(l => T('l_' + l)).join(', ') }));
    if (L.paused) status = T('live_paused');
    else if (!res || res.cycles < 2) status = T('live_measuring', { c: res ? res.cycles : 0, need: MIN_CYCLES });
    else {
      good = res.stable;
      status = t - L.savedAt < 6 ? T('live_saved') + ' ✓' : res.stable ? T('live_stable') + ' ✓' : T('live_measuring', { c: Math.min(res.cycles, MIN_CYCLES), need: MIN_CYCLES });
      if (t - L.savedAt < 6) good = true;
      sub = `${res.cadence ? Math.round(res.cadence) + ' ' + T('rpm') + ' · ' : ''}${res.cycles} ${T('strokes')}`;
      if (res.slip) warn.push(T('warn_slip', { label: T('l_' + res.slip) }));
      if (res.pathRatio && res.pathRatio < 0.93) warn.push(T('warn_yaw', { deg: Math.round(Math.acos(Math.min(1, res.pathRatio)) * 180 / Math.PI) }));
      const prev = L.prev && t - L.savedAt < 6 ? lastCheck(L.rider.id, L.view, L.prev.created, L.prev.id) : L.prev;
      if (L.rec) body += `<div class="hud-next"><span class="eyebrow">${esc(T('next'))}</span><b>${esc(L.rec.next ? recText(L.rec.next).title : T('no_change'))}</b></div>`;
      body += `<div class="tiles">${keysFor(L.view).filter(k => Number.isFinite(res.metrics[k])).map(k => tile(k, res.metrics[k], prev)).join('')}</div>`;
    }
  }
  $('#hud').innerHTML = `<div class="hud-status${good ? ' good' : ''}">${esc(status)}${sub ? `<small>${esc(sub)}</small>` : ''}</div>${body}${warn.length ? `<div class="hud-warn">${warn.map(w => `<p>${esc(w)}</p>`).join('')}</div>` : ''}`;
  const sb = $('#bSave'); if (sb) sb.disabled = !(L.result && L.result.cycles >= 2 && out.state === 'track');
}
function renderTools() {
  const s = DB.data.settings;
  $('#tools').innerHTML = `<button class="btn primary" id="bSave" data-act="saveNow" disabled>${esc(T('b_save'))}</button>
    <button class="btn${L.pickMode ? ' on' : ''}" data-act="pick">${esc(T('b_color'))}</button>
    <button class="btn" data-act="tolDown" aria-label="${esc(T('b_tol_long'))} −">${esc(T('b_tol'))} −</button><button class="btn" data-act="tolUp" aria-label="${esc(T('b_tol_long'))} +">${esc(T('b_tol'))} +</button>
    <button class="btn${L.autoTol ? ' on' : ''}" data-act="autoTol">${esc(T(L.autoTol ? 'b_tolauto_on' : 'b_tolauto_off'))}</button>
    <button class="btn${L.debug ? ' on' : ''}" data-act="debug">${esc(T('b_view'))}</button>
    <button class="btn" data-act="snap">${esc(T('b_snap'))}</button>
    ${L.file ? '' : `<button class="btn" data-act="flip">${esc(T('b_camera'))}</button>`}
    <button class="btn" data-act="voice">${esc(T(s.voice ? 'b_voice_on' : 'b_voice_off'))}</button>
    <button class="btn" data-act="auto">${esc(T(s.autosave ? 'b_auto_on' : 'b_auto_off'))}</button>
    <button class="btn" data-act="quit">${esc(T('b_quit'))}</button>`;
}
viewC.addEventListener('click', e => {
  if (!L.on || !(L.pickMode || !L.model || L.out.state !== 'track')) return; // a tap while searching relearns the colour
  const r = viewC.getBoundingClientRect(); L.pick = [(e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height];
});

// Cycle through every camera the phone exposes (front, main, wide…), not just front/back.
async function cycleCamera() {
  const s = DB.data.settings;
  let cams = [];
  try { cams = (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === 'videoinput'); } catch (e) { /* no list */ }
  const cur = L.stream && L.stream.getVideoTracks()[0] ? L.stream.getVideoTracks()[0].getSettings().deviceId : null;
  if (cams.length > 1) {
    const i = cams.findIndex(c => c.deviceId === cur), next = cams[(i + 1) % cams.length];
    s.deviceId = next.deviceId; DB.save();
    await startLive(L.view);
    toast(T('cam_switched', { i: (i + 1) % cams.length + 1, n: cams.length }) + (next.label ? ' · ' + next.label : ''));
  } else { delete s.deviceId; s.facing = s.facing === 'environment' ? 'user' : 'environment'; DB.save(); startLive(L.view); }
}

// ---------------- export / import ----------------
function exportData() {
  const blob = new Blob([JSON.stringify({ app: 'fit-loop', version: 2, exported: new Date().toISOString(), riders: DB.data.riders, checks: DB.data.checks })], { type: 'application/json' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'fit-loop-' + new Date().toISOString().slice(0, 10) + '.json';
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}
function importData(file) {
  const fr = new FileReader();
  fr.onload = () => {
    try {
      const d = JSON.parse(fr.result); if (d.app !== 'fit-loop' || !Array.isArray(d.riders) || !Array.isArray(d.checks)) throw new Error('format');
      let n = 0;
      d.riders.forEach(r => { if (r && r.id && r.name && !DB.rider(r.id)) { DB.data.riders.push(r); n++; } });
      d.checks.forEach(c => { if (c && c.id && c.riderId && c.metrics && !DB.data.checks.some(x => x.id === c.id)) { DB.data.checks.push(c); n++; } });
      DB.save(); toast(T('imported', { n })); render();
    } catch (e) { toast(T('import_bad')); }
  };
  fr.readAsText(file);
}

// ---------------- events ----------------
document.addEventListener('click', e => { const b = e.target.closest('[data-act]'); if (b) act(b.dataset.act, b); });
$('#fileImport').addEventListener('change', e => { const f = e.target.files[0]; e.target.value = ''; if (f) importData(f); });
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && L.on && navigator.wakeLock) navigator.wakeLock.request('screen').then(w => { L.wake = w; }).catch(() => {}); });

function act(a, b) {
  const s = DB.data.settings;
  if (/^v[A-Z]/.test(a) && a !== 'vRecord' && a !== 'vPick') return FL.video && FL.video.act(a, b);
  switch (a) {
    case 'home': if (L.on) stopLive(true); return go('home');
    case 'lang': lang = lang === 'fr' ? 'en' : 'fr'; s.lang = lang; DB.save(); return render();
    case 'openRider': return go('rider', { riderId: b.dataset.id });
    case 'openCheck': return go('check', { checkId: b.dataset.id });
    case 'live': return startLive(b.dataset.v);
    case 'vRecord': return FL.video.open(b.dataset.v);
    case 'vPick': return FL.video.pick(b.dataset.v);
    case 'export': return exportData();
    case 'import': return $('#fileImport').click();
    case 'quit': return stopLive();
    case 'saveNow': return saveCheck(false);
    case 'pick': L.pickMode = !L.pickMode; return renderTools();
    case 'tolUp': case 'tolDown': {
      const i = BF.TOLS.findIndex(v => v >= L.tol - 1e-6), j = Math.max(0, Math.min(BF.TOLS.length - 1, (i < 0 ? BF.TOLS.length - 1 : i) + (a === 'tolUp' ? 1 : -1)));
      L.tol = BF.TOLS[j]; L.autoTol = false; if (L.model) saveModel(); renderTools(); return toast(T('b_tol_long') + ' ' + num(L.tol, 2));
    }
    case 'autoTol': L.autoTol = !L.autoTol; L.lastTune = 0; if (L.model) saveModel(); return renderTools();
    case 'debug': L.debug = !L.debug; return renderTools();
    case 'snap': L.snap = true; return;
    case 'flip': return cycleCamera();
    case 'voice': s.voice = !s.voice; DB.save(); if (!s.voice && 'speechSynthesis' in window) speechSynthesis.cancel(); return renderTools();
    case 'auto': s.autosave = !s.autosave; DB.save(); return renderTools();
    case 'saveRider': {
      const r = DB.rider(S.riderId); if (!r) return;
      r.name = $('#eName').value.trim() || r.name; r.bike = $('#eBike').value.trim(); r.crankMm = parseFloat($('#eCrank').value) || r.crankMm || 172.5;
      const changed = $('#eDisc').value !== r.discipline; r.discipline = $('#eDisc').value;
      if (changed) delete r.targets;
      else { r.targets = {}; BF.SIDE_KEYS.forEach(k => { const lo = parseFloat($(`#t_${k}_0`).value), hi = parseFloat($(`#t_${k}_1`).value); if (Number.isFinite(lo) && Number.isFinite(hi) && lo <= hi) r.targets[k] = [lo, hi]; }); }
      DB.save(); toast(T('saved')); return render();
    }
    case 'resetTargets': { const r = DB.rider(S.riderId); if (r) { delete r.targets; DB.save(); toast(T('targets_reset')); render(); } return; }
    case 'saveNote': { const c = DB.data.checks.find(x => x.id === S.checkId); if (c) { c.note = $('#cNote').value.trim(); DB.save(); toast(T('saved')); render(); } return; }
    case 'askDel': S.confirmDel = true; return render();
    case 'cancelDel': S.confirmDel = false; return render();
    case 'delRider': DB.data.checks = DB.data.checks.filter(c => c.riderId !== S.riderId); DB.data.riders = DB.data.riders.filter(r => r.id !== S.riderId); DB.save(); return go('home');
    case 'delCheck': DB.data.checks = DB.data.checks.filter(c => c.id !== S.checkId); DB.save(); return go('rider');
  }
}

render();
})();
