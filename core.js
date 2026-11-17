// Fit Loop core: sticker detection, tracking, automatic labelling, angle maths, pedal-stroke analysis, recommendations.
// Pure functions, no DOM. Shared by the app and the node tests.
const BF = (function () {
  'use strict';

  // ---------- colour ----------
  function rgbToHsv(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
    let h = 0;
    if (d > 0) {
      if (mx === r) h = ((g - b) / d) % 6;
      else if (mx === g) h = (b - r) / d + 2;
      else h = (r - g) / d + 4;
      h *= 60; if (h < 0) h += 360;
    }
    return { h, s: mx === 0 ? 0 : d / mx, v: mx };
  }

  // Average colour in a (2r+1)^2 window -> colour spec used for thresholding.
  function sampleColor(data, w, h, x, y, r) {
    r = r || 2;
    let R = 0, G = 0, B = 0, n = 0;
    for (let yy = Math.max(0, y - r); yy <= Math.min(h - 1, y + r); yy++)
      for (let xx = Math.max(0, x - r); xx <= Math.min(w - 1, x + r); xx++) {
        const i = (yy * w + xx) * 4; R += data[i]; G += data[i + 1]; B += data[i + 2]; n++;
      }
    const c = rgbToHsv(R / n, G / n, B / n);
    return { h: c.h, s: c.s, v: c.v, tol: 1 };
  }

  function hueDist(a, b) { const d = Math.abs(a - b) % 360; return d > 180 ? 360 - d : d; }

  // tol scales all thresholds (0.5 strict .. 2 loose)
  function makeMatcher(spec) {
    const t = spec.tol || 1;
    const hTol = 16 * t;
    const sMin = Math.max(0.18, spec.s * (1 - 0.45 * t));
    const vMin = Math.max(0.15, spec.v * (1 - 0.55 * t));
    return function (r, g, b) {
      const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
      if (mx / 255 < vMin) return false;
      const d = mx - mn;
      if (mx === 0 || d / mx < sMin) return false;
      let h;
      if (mx === r) h = ((g - b) / d) % 6; else if (mx === g) h = (b - r) / d + 2; else h = (r - g) / d + 4;
      h *= 60; if (h < 0) h += 360;
      return hueDist(h, spec.h) <= hTol;
    };
  }

  // Connected components on the colour mask. Returns [{x,y,area}] sorted by area desc.
  let _mask = null, _stack = null; // reused between frames: a live camera calls this 30 times a second
  function findBlobs(data, w, h, spec, opts) {
    opts = opts || {};
    const minArea = opts.minArea || 4, maxArea = opts.maxArea || (w * h) / 50;
    const match = makeMatcher(spec);
    if (!_mask || _mask.length !== w * h) { _mask = new Uint8Array(w * h); _stack = new Int32Array(w * h); }
    const mask = _mask, stack = _stack;
    for (let i = 0, p = 0; p < w * h; p++, i += 4) mask[p] = match(data[i], data[i + 1], data[i + 2]) ? 1 : 0;
    const blobs = [];
    for (let p = 0; p < w * h; p++) {
      if (mask[p] !== 1) continue;
      let sp = 0, area = 0, sx = 0, sy = 0;
      stack[sp++] = p; mask[p] = 2;
      while (sp) {
        const q = stack[--sp], qx = q % w, qy = (q - qx) / w;
        area++; sx += qx; sy += qy;
        if (qx > 0 && mask[q - 1] === 1) { mask[q - 1] = 2; stack[sp++] = q - 1; }
        if (qx < w - 1 && mask[q + 1] === 1) { mask[q + 1] = 2; stack[sp++] = q + 1; }
        if (qy > 0 && mask[q - w] === 1) { mask[q - w] = 2; stack[sp++] = q - w; }
        if (qy < h - 1 && mask[q + w] === 1) { mask[q + w] = 2; stack[sp++] = q + w; }
      }
      if (area >= minArea && area <= maxArea) blobs.push({ x: sx / area + 0.5, y: sy / area + 0.5, area });
    }
    blobs.sort((a, b) => b.area - a.area);
    return blobs.slice(0, 40);
  }

  // ---------- tracking ----------
  // labels: array of names. init: {name:[x,y]}. Returns tracker with step(blobs) -> {name:[x,y]|null}
  // Min-cost assignment (Hungarian, rows <= cols). cost[i][j]; returns col index per row.
  function hungarian(cost) {
    const n = cost.length, m = cost[0].length, INF = 1e18;
    const u = new Array(n + 1).fill(0), v = new Array(m + 1).fill(0), p = new Array(m + 1).fill(0), way = new Array(m + 1).fill(0);
    for (let i = 1; i <= n; i++) {
      p[0] = i; let j0 = 0;
      const minv = new Array(m + 1).fill(INF), used = new Array(m + 1).fill(false);
      do {
        used[j0] = true; const i0 = p[j0]; let delta = INF, j1 = 0;
        for (let j = 1; j <= m; j++) if (!used[j]) {
          const cur = cost[i0 - 1][j - 1] - u[i0] - v[j];
          if (cur < minv[j]) { minv[j] = cur; way[j] = j0; }
          if (minv[j] < delta) { delta = minv[j]; j1 = j; }
        }
        for (let j = 0; j <= m; j++) { if (used[j]) { u[p[j]] += delta; v[j] -= delta; } else minv[j] -= delta; }
        j0 = j1;
      } while (p[j0] !== 0);
      do { const j1 = way[j0]; p[j0] = p[j1]; j0 = j1; } while (j0);
    }
    const res = new Array(n).fill(-1);
    for (let j = 1; j <= m; j++) if (p[j]) res[p[j] - 1] = j - 1;
    return res;
  }

  // Snap a tap to the nearest blob within r, else keep the tap.
  function snap(blobs, x, y, r) {
    let best = null, bd = r;
    blobs.forEach(b => { const d = Math.hypot(b.x - x, b.y - y); if (d < bd) { bd = d; best = b; } });
    return best ? [best.x, best.y] : [x, y];
  }

  // ---------- geometry ----------
  function angleAt(a, b, c) { // interior angle at b, degrees
    const v1x = a[0] - b[0], v1y = a[1] - b[1], v2x = c[0] - b[0], v2y = c[1] - b[1];
    const d = Math.hypot(v1x, v1y) * Math.hypot(v2x, v2y);
    if (!d) return NaN;
    return Math.acos(Math.max(-1, Math.min(1, (v1x * v2x + v1y * v2y) / d))) * 180 / Math.PI;
  }
  function median(a) { const b = a.filter(Number.isFinite).sort((x, y) => x - y); if (!b.length) return NaN; const m = b.length >> 1; return b.length % 2 ? b[m] : (b[m - 1] + b[m]) / 2; }

  // Fill gaps (<= maxGap frames) by linear interpolation, then 3-tap smooth.
  function cleanSeries(frames, label, maxGap, smooth) {
    maxGap = maxGap || 4;
    const n = frames.length, out = new Array(n).fill(null);
    let last = -1;
    for (let i = 0; i < n; i++) {
      const p = frames[i].pts[label];
      if (!p) continue;
      out[i] = p.slice();
      if (last >= 0 && i - last > 1 && i - last - 1 <= maxGap) {
        const a = out[last];
        for (let k = last + 1; k < i; k++) { const t = (k - last) / (i - last); out[k] = [a[0] + (p[0] - a[0]) * t, a[1] + (p[1] - a[1]) * t]; }
      }
      last = i;
    }
    if (!smooth) return out;
    const sm = out.map((p, i) => {
      if (!p) return null;
      const q = [out[i - 1], p, out[i + 1]].filter(Boolean);
      return [q.reduce((s, v) => s + v[0], 0) / q.length, q.reduce((s, v) => s + v[1], 0) / q.length];
    });
    return sm;
  }

  // Peaks (local maxima) of a numeric series with nulls, min separation in frames.
  function findPeaks(sig, minSep) {
    const idx = [];
    for (let i = 1; i < sig.length - 1; i++) {
      const v = sig[i]; if (v == null) continue;
      let ok = true;
      for (let k = Math.max(0, i - minSep); k <= Math.min(sig.length - 1, i + minSep); k++)
        if (k !== i && sig[k] != null && (sig[k] > v || (sig[k] === v && k < i))) { ok = false; break; }
      if (ok) idx.push(i);
    }
    return idx;
  }

  // Dominant period (frames) via autocorrelation.
  function estimatePeriod(sig) {
    const vals = sig.filter(v => v != null); if (vals.length < 20) return null;
    const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
    const x = sig.map(v => (v == null ? 0 : v - mean));
    const n = x.length; let best = null, bestR = 0.2;
    const r0 = x.reduce((s, v) => s + v * v, 0) || 1;
    let prev = 1, falling = true;
    for (let lag = 4; lag < n / 2; lag++) {
      let r = 0; for (let i = 0; i + lag < n; i++) r += x[i] * x[i + lag];
      r = r / r0 * n / (n - lag);
      if (falling) { if (r > prev) falling = false; }
      else if (r > bestR && r >= prev) { bestR = r; best = lag; }
      else if (best && r < prev) break;
      prev = r;
    }
    return best;
  }

  // Put irregular camera frames onto a steady fps grid. Short gaps are bridged in a straight line.
  function resample(frames, labels, fps) {
    if (frames.length < 2) return frames;
    const t0 = frames[0].t, t1 = frames[frames.length - 1].t, out = [], near = 0.6 / fps;
    let j = 0;
    for (let tt = t0; tt <= t1 + 1e-6; tt += 1 / fps) {
      while (j + 1 < frames.length && frames[j + 1].t <= tt) j++;
      const a = frames[j], b = frames[Math.min(j + 1, frames.length - 1)], pts = {};
      labels.forEach(l => {
        const pa = a.pts[l], pb = b.pts[l];
        if (pa && pb && b.t > a.t && b.t - a.t <= 0.12) { const u = Math.max(0, Math.min(1, (tt - a.t) / (b.t - a.t))); pts[l] = [pa[0] + (pb[0] - pa[0]) * u, pa[1] + (pb[1] - pa[1]) * u]; }
        else if (pa && Math.abs(tt - a.t) <= near) pts[l] = pa.slice();
        else if (pb && Math.abs(tt - b.t) <= near) pts[l] = pb.slice();
        else pts[l] = null;
      });
      out.push({ t: tt, pts });
    }
    return out;
  }

  // ---------- anonymous multi-target tracking (live) ----------
  // Tracks every blob without knowing which joint it is. Labels are attached afterwards (autoLabel*).
  function createAnonTracker(w, opts) {
    opts = opts || {};
    const keep = opts.keep || 1.0, histLen = opts.hist || 14, base = w * 0.07;
    let nextId = 1;
    const tracks = [];
    return {
      tracks,
      get(id) { for (let i = 0; i < tracks.length; i++) if (tracks[i].id === id) return tracks[i]; return null; },
      reset() { tracks.length = 0; },
      step(blobs, t) {
        const used = new Array(blobs.length).fill(false);
        if (tracks.length) {
          const BIG = 1e6;
          const pred = tracks.map(s => {
            const dt = Math.min(0.2, Math.max(0, t - s.t));
            // the search radius grows with the time since the last frame, so a slow phone does not lose fast stickers
            return [s.p[0] + s.v[0] * dt, s.p[1] + s.v[1] * dt, base * (1 + Math.min(s.miss, 4) * 0.5) * Math.max(1, dt / 0.04)];
          });
          const cost = tracks.map((s, i) => {
            const row = blobs.map(b => { const d = Math.hypot(b.x - pred[i][0], b.y - pred[i][1]); return d <= pred[i][2] ? d * d : BIG; });
            tracks.forEach((_, k) => row.push(k === i ? pred[i][2] * pred[i][2] : BIG));
            return row;
          });
          const asg = hungarian(cost);
          tracks.forEach((s, i) => {
            const j = asg[i];
            if (j >= 0 && j < blobs.length && cost[i][j] < BIG) {
              const b = blobs[j]; used[j] = true;
              const dt = t - s.t;
              if (dt > 0 && !s.miss) { const nv = [(b.x - s.p[0]) / dt, (b.y - s.p[1]) / dt]; s.v = [0.7 * nv[0] + 0.3 * s.v[0], 0.7 * nv[1] + 0.3 * s.v[1]]; }
              else s.v = [0, 0];
              s.p = [b.x, b.y]; s.t = t; s.miss = 0; s.area = b.area;
              s.hist.push([t, b.x, b.y]);
              while (s.hist.length && t - s.hist[0][0] > histLen) s.hist.shift();
            } else { s.miss++; s.v = [0, 0]; }
          });
        }
        for (let i = tracks.length - 1; i >= 0; i--) if (t - tracks[i].t > keep) tracks.splice(i, 1);
        blobs.forEach((b, j) => { if (!used[j]) tracks.push({ id: nextId++, p: [b.x, b.y], v: [0, 0], t, born: t, miss: 0, area: b.area, hist: [[t, b.x, b.y]] }); });
      },
    };
  }

  const mean = a => a.reduce((s, v) => s + v, 0) / (a.length || 1);
  function pct(a, q) { const b = a.slice().sort((x, y) => x - y); if (!b.length) return NaN; return b[Math.min(b.length - 1, Math.max(0, Math.round(q * (b.length - 1))))]; }

  // Tracks that were visible for (almost) the whole recent window.
  function stableTracks(tracks, now, win) {
    const t0 = now - win;
    const c = tracks.filter(s => now - s.t < 0.25 && s.hist[0][0] <= t0 + 0.5).map(s => {
      const h = s.hist.filter(q => q[0] >= t0), xs = h.map(q => q[1]), ys = h.map(q => q[2]);
      return { s, h, n: h.length, mx: mean(xs), my: mean(ys), ext: h.length ? Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)) : 0 };
    });
    const mostSamples = Math.max(0, ...c.map(x => x.n));
    return c.filter(x => x.n >= 12 && x.n >= mostSamples * 0.6);
  }
  // Coefficient of variation of the distance between two tracks (0 = rigid link).
  function linkCv(a, b) {
    const m = new Map(a.h.map(q => [q[0], q])), d = [];
    b.h.forEach(q => { const p = m.get(q[0]); if (p) d.push(Math.hypot(p[1] - q[1], p[2] - q[2])); });
    if (d.length < 8) return Infinity;
    const mu = mean(d); if (mu < 1) return Infinity;
    return Math.sqrt(mean(d.map(v => (v - mu) * (v - mu)))) / mu;
  }

  // Work out which sticker is which from how they move while the rider pedals.
  // 4 stickers: hip, knee, ankle, foot. 5: + shoulder. 7: + elbow, wrist.
  function autoLabelSide(tracks, now, w, win) {
    const c = stableTracks(tracks, now, win || 2.5), n = c.length;
    if (n !== 4 && n !== 5 && n !== 7) return { ok: false, reason: 'count', n };
    c.sort((a, b) => b.ext - a.ext);
    const movers = c.slice(0, 3), statics = c.slice(3);
    if (movers[2].ext < w * 0.03) return { ok: false, reason: 'still', n };
    if (statics[0].ext > movers[2].ext * 0.6) return { ok: false, reason: 'unsure', n };
    movers.sort((a, b) => a.my - b.my);
    const knee = movers[0], lower = movers.slice(1);
    statics.sort((a, b) => linkCv(a, knee) - linkCv(b, knee));
    const hip = statics[0], rest = statics.slice(1);
    rest.sort((a, b) => a.my - b.my);
    const shoulder = rest[0] || null;
    const dir = (shoulder ? shoulder.mx - hip.mx : mean(lower.map(x => x.mx)) - hip.mx) >= 0 ? 1 : -1;
    lower.sort((a, b) => dir * (b.mx - a.mx));
    const foot = lower[0], ankle = lower[1];
    const thigh = linkCv(hip, knee), shank = linkCv(knee, ankle);
    if (!(thigh < 0.12) || !(shank < 0.12) || !(linkCv(ankle, foot) < 0.25)) return { ok: false, reason: 'unsure', n };
    // the ball of the foot stays ahead of the ankle bone all the way round; if not, two tracks crossed in this window
    const am = new Map(ankle.h.map(q => [q[0], q[1]]));
    let ahead = 0, both = 0;
    foot.h.forEach(q => { const ax = am.get(q[0]); if (ax != null) { both++; if (dir * (q[1] - ax) > 0) ahead++; } });
    if (both < 8 || ahead < both * 0.97) return { ok: false, reason: 'unsure', n };
    const map = { hip: hip.s.id, knee: knee.s.id, ankle: ankle.s.id, foot: foot.s.id };
    if (shoulder) map.shoulder = shoulder.s.id;
    if (rest.length === 3) {
      const arm = rest.slice(1).sort((a, b) => Math.abs(b.mx - hip.mx) - Math.abs(a.mx - hip.mx));
      map.wrist = arm[0].s.id; map.elbow = arm[1].s.id;
    }
    return { ok: true, n, dir, map };
  }

  // Front view: two kneecaps above two shoes. The rider faces the camera, so their right side is on the left of the image.
  function autoLabelFront(tracks, now, w, win) {
    const c = stableTracks(tracks, now, win || 2.5), n = c.length;
    if (n !== 4) return { ok: false, reason: 'count', n };
    c.sort((a, b) => a.my - b.my);
    const knees = c.slice(0, 2).sort((a, b) => a.mx - b.mx), feet = c.slice(2).sort((a, b) => a.mx - b.mx);
    if (Math.max(feet[0].ext, feet[1].ext) < w * 0.03) return { ok: false, reason: 'still', n };
    return { ok: true, n, dir: 1, map: { kneeR: knees[0].s.id, kneeL: knees[1].s.id, footR: feet[0].s.id, footL: feet[1].s.id } };
  }

  // ---------- skeleton (segment lengths stay constant: used to catch swapped or slipping stickers) ----------
  const SEGS = [['hip', 'knee'], ['knee', 'ankle'], ['ankle', 'foot'], ['shoulder', 'elbow'], ['elbow', 'wrist']];
  const segLen = (pts, s) => (pts[s[0]] && pts[s[1]] ? Math.hypot(pts[s[0]][0] - pts[s[1]][0], pts[s[0]][1] - pts[s[1]][1]) : NaN);
  function learnSkeleton(frames) {
    const sk = {};
    SEGS.forEach(s => { const v = median(frames.map(f => segLen(f.pts, s))); if (Number.isFinite(v) && v > 2) sk[s.join('-')] = v; });
    return sk;
  }
  function skeletonError(pts, sk) {
    let max = 0, sum = 0;
    SEGS.forEach(s => { const ref = sk[s.join('-')], l = segLen(pts, s); if (!ref || !Number.isFinite(l)) return; const e = Math.abs(l - ref) / ref; sum += e; if (e > max) max = e; });
    return { max, sum };
  }
  // If the skeleton is badly stretched, find the pair of labels whose exchange repairs it.
  function findSwap(pts, sk, tol) {
    tol = tol || 0.3;
    const e0 = skeletonError(pts, sk);
    if (e0.max < tol) return null;
    const ls = Object.keys(pts).filter(l => pts[l]);
    let best = null, bestSum = e0.sum;
    for (let i = 0; i < ls.length; i++) for (let j = i + 1; j < ls.length; j++) {
      const q = Object.assign({}, pts); q[ls[i]] = pts[ls[j]]; q[ls[j]] = pts[ls[i]];
      const e = skeletonError(q, sk);
      if (e.max < tol * 0.6 && e.sum < bestSum) { bestSum = e.sum; best = [ls[i], ls[j]]; }
    }
    return best;
  }
  function segmentStability(frames) {
    const out = {};
    SEGS.forEach(s => {
      const d = frames.map(f => segLen(f.pts, s)).filter(Number.isFinite);
      if (d.length < 20) return;
      const mu = mean(d); out[s.join('-')] = Math.sqrt(mean(d.map(v => (v - mu) * (v - mu)))) / mu;
    });
    return out;
  }
  // Which sticker is most likely sliding or off the joint, from which segments change length.
  function slippingSticker(cv) {
    const bad = (k, th) => cv[k] != null && cv[k] > th;
    const thigh = bad('hip-knee', 0.07), shank = bad('knee-ankle', 0.07), foot = bad('ankle-foot', 0.14);
    const upper = bad('shoulder-elbow', 0.1), fore = bad('elbow-wrist', 0.1);
    if (thigh && shank) return 'knee';
    if (thigh) return 'hip';
    if (shank) return 'ankle';
    if (foot) return 'foot';
    if (upper && fore) return 'elbow';
    if (upper) return 'shoulder';
    if (fore) return 'wrist';
    return null;
  }

  // ---------- live session: search for the stickers, name them, follow them, start again if they are lost ----------
  function createSession(view, w) {
    const side = view === 'side', labels = side ? SIDE_LABELS : FRONT_LABELS;
    const tracker = createAnonTracker(w);
    let map = null, dir = 1, skel = null, recent = [], lastTry = -1, badSince = null, lostSince = null, info = { ok: false, reason: 'count', n: 0 };
    const last = {}, deadSince = {};
    const drop = () => { map = null; skel = null; recent = []; badSince = lostSince = null; };
    return {
      tracker, labels,
      get labelled() { return !!map; },
      get dir() { return dir; },
      reset() { drop(); tracker.reset(); info = { ok: false, reason: 'count', n: 0 }; },
      step(blobs, t) {
        tracker.step(blobs, t);
        if (!map) {
          if (t - lastTry >= 0.25) {
            lastTry = t;
            info = side ? autoLabelSide(tracker.tracks, t, w) : autoLabelFront(tracker.tracks, t, w);
            if (info.ok) { map = Object.assign({}, info.map); dir = info.dir; labels.forEach(l => { delete last[l]; delete deadSince[l]; }); }
          }
          if (!map) return { state: 'search', reason: info.reason, n: info.n };
        }
        const pts = {}, missing = [];
        let total = 0;
        labels.forEach(l => {
          if (map[l] == null) { pts[l] = null; return; }
          total++;
          let tr = tracker.get(map[l]);
          if (!tr && last[l]) { // its track ended: adopt a fresh unclaimed track near where the sticker was last seen
            const taken = new Set(Object.values(map));
            let best = null, bd = w * 0.12;
            tracker.tracks.forEach(c => { if (taken.has(c.id) || c.hist.length < 3 || t - c.t > 0.12) return; const d = Math.hypot(c.p[0] - last[l][0], c.p[1] - last[l][1]); if (d < bd) { bd = d; best = c; } });
            if (best) { map[l] = best.id; tr = best; }
          }
          if (!tr) { if (deadSince[l] == null) deadSince[l] = t; } else delete deadSince[l];
          pts[l] = tr && t - tr.t < 0.12 ? tr.p.slice() : null;
          if (pts[l]) last[l] = pts[l]; else missing.push(l);
        });
        const swap = (a, b) => { [map[a], map[b]] = [map[b], map[a]]; [pts[a], pts[b]] = [pts[b], pts[a]]; [last[a], last[b]] = [last[b], last[a]]; };
        if (side) {
          if (pts.ankle && pts.foot && dir * (pts.foot[0] - pts.ankle[0]) < 0) swap('ankle', 'foot');
          if (!skel && recent.length >= 45) skel = learnSkeleton(recent);
          if (skel) { const sw = findSwap(pts, skel); if (sw) swap(sw[0], sw[1]); }
          const bad = skel ? skeletonError(pts, skel).max > 0.3 : false;
          badSince = bad ? (badSince == null ? t : badSince) : null;
          if (!skel) { recent.push({ t, pts }); }
        }
        lostSince = missing.length * 2 >= total ? (lostSince == null ? t : lostSince) : null;
        const dead = labels.some(l => deadSince[l] != null && t - deadSince[l] > 2);
        if ((badSince != null && t - badSince > 1) || (lostSince != null && t - lostSince > 1.5) || dead) {
          drop(); labels.forEach(l => { delete deadSince[l]; });
          return { state: 'search', reason: 'lost', n: 0 };
        }
        return { state: 'track', pts, dir, missing, n: total };
      },
    };
  }

  // ---------- targets ----------
  const TARGETS = {
    road_endurance: { kneeExt: [140, 150], kneeFlex: [68, 78], hipMin: [45, 60], torso: [40, 55], shoulder: [80, 95], elbow: [150, 165], ankleRom: [15, 30], kops: [-20, 15] },
    road_performance: { kneeExt: [140, 150], kneeFlex: [66, 76], hipMin: [42, 55], torso: [30, 45], shoulder: [85, 95], elbow: [150, 165], ankleRom: [15, 30], kops: [-15, 15] },
    tt: { tt: true, kneeExt: [140, 150], kneeFlex: [64, 75], hipMin: [40, 55], torso: [5, 20], shoulder: [80, 95], elbow: [90, 110], ankleRom: [15, 30], kops: [0, 40] },
  };
  const FRONT_TARGETS = { kneeTravel: [0, 15], kneeOffset: [-15, 15] };
  const SIDE_LABELS = ['shoulder', 'elbow', 'wrist', 'hip', 'knee', 'ankle', 'foot'];
  const FRONT_LABELS = ['kneeL', 'footL', 'kneeR', 'footR'];
  const SIDE_KEYS = ['kneeExt', 'kneeFlex', 'hipMin', 'torso', 'shoulder', 'elbow', 'ankleRom', 'kops'];
  const FRONT_KEYS = ['kneeTravelL', 'kneeTravelR', 'kneeOffsetL', 'kneeOffsetR'];
  const isMm = k => k === 'kops' || k.startsWith('kneeTravel') || k.startsWith('kneeOffset');

  // ---------- analysis ----------
  // frames: uniform [{t, pts:{label:[x,y]|null}}]
  function series(frames, labels) {
    const S = {}, R = {};
    labels.forEach(l => { S[l] = cleanSeries(frames, l); R[l] = frames.map(f => f.pts[l] || null); });
    return { S, R };
  }
  function cyclesFrom(sig, fps) {
    const per = estimatePeriod(sig);
    if (!per) return { per: null, bounds: [] };
    const peaks = findPeaks(sig, Math.max(2, Math.round(per * 0.35)));
    const bounds = [];
    for (let i = 0; i + 1 < peaks.length; i++) {
      const len = peaks[i + 1] - peaks[i];
      if (len > per * 0.6 && len < per * 1.5) bounds.push([peaks[i], peaks[i + 1]]);
    }
    return { per, bounds, peaks, cadence: fps ? 60 * fps / per : null };
  }
  const spread = a => { const b = a.filter(Number.isFinite); return b.length > 1 ? Math.max(...b) - Math.min(...b) : 0; };

  // The foot sticker travels up and down by twice the crank length: that gives the scale without a ruler.
  // Seen square-on its path is as wide as it is tall; a narrower path means the camera is turned.
  function footScale(frames, labels, crankMm) {
    const rs = [], ratios = [];
    labels.forEach(l => {
      const xs = [], ys = [];
      frames.forEach(f => { const p = f.pts[l]; if (p) { xs.push(p[0]); ys.push(p[1]); } });
      if (ys.length < 20) return;
      const ry = (pct(ys, 0.98) - pct(ys, 0.02)) / 2, rx = (pct(xs, 0.98) - pct(xs, 0.02)) / 2;
      if (ry > 3) { rs.push(ry); ratios.push(rx / ry); }
    });
    if (!rs.length || !crankMm) return { mmPerPx: null, ratio: null };
    return { mmPerPx: crankMm / mean(rs), ratio: mean(ratios) };
  }

  function analyzeSide(frames, opts) {
    const fps = opts.fps || 30;
    const { S, R } = series(frames, SIDE_LABELS);
    const n = frames.length;
    const dxs = [];
    for (let i = 0; i < n; i++) {
      if (S.shoulder[i] && S.hip[i]) dxs.push(S.shoulder[i][0] - S.hip[i][0]);
      else if (S.foot[i] && S.hip[i]) dxs.push(S.foot[i][0] - S.hip[i][0]);
    }
    const dir = opts.dir || (median(dxs) >= 0 ? 1 : -1);
    for (let i = 0; i < n; i++) { const a = R.ankle[i], f = R.foot[i]; if (a && f && dir * (f[0] - a[0]) < 0) { R.ankle[i] = f; R.foot[i] = a; } }
    const ang = { knee: [], hip: [], ankle: [], elbow: [], shoulder: [], torso: [] };
    for (let i = 0; i < n; i++) {
      const g = l => R[l][i];
      ang.knee.push(g('hip') && g('knee') && g('ankle') ? angleAt(g('hip'), g('knee'), g('ankle')) : null);
      ang.hip.push(g('shoulder') && g('hip') && g('knee') ? angleAt(g('shoulder'), g('hip'), g('knee')) : null);
      ang.ankle.push(g('knee') && g('ankle') && g('foot') ? angleAt(g('knee'), g('ankle'), g('foot')) : null);
      ang.elbow.push(g('shoulder') && g('elbow') && g('wrist') ? angleAt(g('shoulder'), g('elbow'), g('wrist')) : null);
      ang.shoulder.push(g('hip') && g('shoulder') && g('elbow') ? angleAt(g('hip'), g('shoulder'), g('elbow')) : null);
      ang.torso.push(g('hip') && g('shoulder') ? Math.atan2(-(g('shoulder')[1] - g('hip')[1]), dir * (g('shoulder')[0] - g('hip')[0])) * 180 / Math.PI : null);
    }
    const coverage = {};
    SIDE_LABELS.forEach(l => { coverage[l] = R[l].filter(Boolean).length / Math.max(1, n); });
    const res = { kind: 'side', dir, coverage, series: ang, frames: n, metrics: {}, cycles: 0, cadence: null, stable: false };
    if (n < 30) return res;
    const footSig = S.foot.map((p, i) => (p ? p[1] : (S.ankle[i] ? S.ankle[i][1] : null)));
    const cyc = cyclesFrom(footSig, fps);
    res.cadence = cyc.cadence; res.cycles = cyc.bounds.length;
    if (cyc.bounds.length < 2) return res;
    const sc = footScale(frames, ['foot'], opts.crankMm);
    res.mmPerPx = sc.mmPerPx; res.pathRatio = sc.ratio;
    const per = { kneeExt: [], kneeFlex: [], hipMin: [], ankleRom: [], kops: [] };
    cyc.bounds.forEach(([a, b]) => {
      const sl = k => ang[k].slice(a, b + 1).filter(Number.isFinite);
      const kn = sl('knee'), hp = sl('hip'), ak = sl('ankle');
      if (kn.length > 3) { per.kneeExt.push(Math.max(...kn)); per.kneeFlex.push(Math.min(...kn)); }
      if (hp.length > 3) per.hipMin.push(Math.min(...hp));
      if (ak.length > 3) per.ankleRom.push(Math.max(...ak) - Math.min(...ak));
      let bi = -1, bx = -Infinity; // 3 o'clock = foot furthest forward
      for (let i = a; i <= b; i++) { const f = S.foot[i]; if (f && dir * f[0] > bx) { bx = dir * f[0]; bi = i; } }
      if (bi >= 0 && R.knee[bi] && R.foot[bi]) per.kops.push(dir * (R.knee[bi][0] - R.foot[bi][0]));
    });
    const m = res.metrics;
    m.kneeExt = median(per.kneeExt); m.kneeFlex = median(per.kneeFlex); m.hipMin = median(per.hipMin); m.ankleRom = median(per.ankleRom);
    m.torso = median(ang.torso); m.shoulder = median(ang.shoulder); m.elbow = median(ang.elbow);
    m.kops = sc.mmPerPx ? median(per.kops) * sc.mmPerPx : NaN;
    res.spread = spread(per.kneeExt);
    res.segCv = segmentStability(frames);
    res.slip = slippingSticker(res.segCv);
    res.stable = res.cycles >= (opts.minCycles || 6) && res.spread <= 4 && coverage.hip >= 0.9 && coverage.knee >= 0.9 && coverage.ankle >= 0.9;
    return res;
  }

  function analyzeFront(frames, opts) {
    const fps = opts.fps || 30;
    const { S, R } = series(frames, FRONT_LABELS);
    const n = frames.length;
    const res = { kind: 'front', frames: n, metrics: {}, coverage: {}, cycles: 0, cadence: null, stable: false };
    FRONT_LABELS.forEach(l => { res.coverage[l] = R[l].filter(Boolean).length / Math.max(1, n); });
    if (n < 30) return res;
    const center = [];
    for (let i = 0; i < n; i++) if (S.footL[i] && S.footR[i]) center.push((S.footL[i][0] + S.footR[i][0]) / 2);
    const c = median(center);
    const sc = footScale(frames, ['footL', 'footR'], opts.crankMm);
    res.mmPerPx = sc.mmPerPx;
    const unit = sc.mmPerPx || NaN;
    const spreads = [];
    ['L', 'R'].forEach(side => {
      const kn = R['knee' + side], ft = R['foot' + side];
      const cyc = cyclesFrom(S['knee' + side].map(p => (p ? -p[1] : null)), fps);
      if (side === 'L') { res.cadence = cyc.cadence; res.cycles = cyc.bounds.length; }
      const travel = cyc.bounds.map(([a, b]) => { const xs = kn.slice(a, b + 1).filter(Boolean).map(p => p[0]); return xs.length > 3 ? Math.max(...xs) - Math.min(...xs) : NaN; });
      const offs = [];
      for (let i = 0; i < n; i++) if (kn[i] && ft[i] && Number.isFinite(c)) offs.push(Math.abs(ft[i][0] - c) - Math.abs(kn[i][0] - c));
      res.metrics['kneeTravel' + side] = median(travel) * unit;
      res.metrics['kneeOffset' + side] = median(offs) * unit;
      spreads.push(spread(travel) * unit);
    });
    res.stable = res.cycles >= (opts.minCycles || 6) && FRONT_LABELS.every(l => res.coverage[l] >= 0.9) && Math.max(...spreads) <= 12;
    return res;
  }

  // ---------- status + recommendation ----------
  function status(v, range) {
    if (!Number.isFinite(v) || !range) return 'na';
    const [lo, hi] = range, w = Math.max(2, (hi - lo) * 0.15);
    if (v >= lo && v <= hi) return 'ok';
    if (v >= lo - w && v <= hi + w) return 'near';
    return 'out';
  }
  function targetFor(key, t) {
    if (t[key]) return t[key];
    if (key.startsWith('kneeTravel')) return FRONT_TARGETS.kneeTravel;
    if (key.startsWith('kneeOffset')) return FRONT_TARGETS.kneeOffset;
    return null;
  }
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  // One change at a time, in fitting order: saddle height, setback, front-end height, reach.
  // Returns codes and numbers only; the app turns them into sentences in the chosen language.
  function recommend(m, view, t) {
    const out = k => Number.isFinite(m[k]) && status(m[k], t[k]) !== 'ok';
    const cands = [], later = [];
    if (view === 'side') {
      if (out('kneeExt')) {
        const delta = (m.kneeExt < t.kneeExt[0] ? t.kneeExt[0] + 2 : t.kneeExt[1] - 2) - m.kneeExt;
        cands.push({ key: 'kneeExt', code: delta > 0 ? 'saddle_up' : 'saddle_down', mm: clamp(Math.round(Math.abs(delta) * 2.2), 2, 6), v: m.kneeExt, range: t.kneeExt });
      }
      if (out('kops')) {
        const move = clamp(Math.round(m.kops - clamp(m.kops, t.kops[0] + 3, t.kops[1] - 3)), -10, 10);
        if (Math.abs(move) >= 2) cands.push({ key: 'kops', code: move > 0 ? 'saddle_back' : 'saddle_fwd', mm: Math.abs(move), comp: Math.max(1, Math.round(Math.abs(move) / 3)), v: m.kops, range: t.kops });
      }
      const hipLow = out('hipMin') && m.hipMin < t.hipMin[0];
      if (hipLow) cands.push({ key: 'hipMin', code: 'front_up', mm: t.tt ? 10 : 5, tt: !!t.tt, v: m.hipMin, range: t.hipMin });
      if (out('torso') && !hipLow) cands.push({ key: 'torso', code: m.torso < t.torso[0] ? 'front_up' : 'front_down', mm: 5, tt: !!t.tt, v: m.torso, range: t.torso });
      if (out('shoulder')) cands.push({ key: 'shoulder', code: m.shoulder > t.shoulder[1] ? 'reach_shorter' : 'reach_longer', mm: 10, tt: !!t.tt, v: m.shoulder, range: t.shoulder });
      if (out('elbow')) later.push({ key: 'elbow', code: m.elbow > t.elbow[1] ? 'elbow_locked' : 'elbow_bent' });
      if (out('ankleRom')) later.push({ key: 'ankleRom', code: m.ankleRom > t.ankleRom[1] ? 'ankle_much' : 'ankle_little' });
      if (out('kneeFlex') && !out('kneeExt')) later.push({ key: 'kneeFlex', code: 'knee_crowded', v: m.kneeFlex });
    } else {
      ['L', 'R'].forEach(s => {
        const tv = m['kneeTravel' + s], of = m['kneeOffset' + s];
        if (Number.isFinite(tv) && tv > FRONT_TARGETS.kneeTravel[1]) later.push({ key: 'kneeTravel' + s, code: 'knee_travel', side: s, v: tv });
        if (Number.isFinite(of) && Math.abs(of) > FRONT_TARGETS.kneeOffset[1]) later.push({ key: 'kneeOffset' + s, code: 'knee_offset', side: s, v: Math.abs(of), inside: of > 0 });
      });
    }
    const next = cands.shift() || null;
    return { next, later: cands.concat(later) };
  }

  return { rgbToHsv, sampleColor, makeMatcher, findBlobs, hungarian, snap, angleAt, median, cleanSeries, findPeaks, estimatePeriod, resample,
    createAnonTracker, createSession, stableTracks, autoLabelSide, autoLabelFront, learnSkeleton, skeletonError, findSwap, segmentStability, slippingSticker,
    footScale, analyzeSide, analyzeFront, recommend, status, targetFor, isMm,
    TARGETS, FRONT_TARGETS, SIDE_LABELS, FRONT_LABELS, SIDE_KEYS, FRONT_KEYS, SEGS };
})();
if (typeof module !== 'undefined') module.exports = BF;
