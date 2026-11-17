// Runs the detector on a real camera frame (raw RGBA at 960 px) and reports what it finds.
const fs = require('fs'), BF = require('../../core.js');
const [file, W, H] = [process.argv[2], +process.argv[3], +process.argv[4]];
const d = new Uint8ClampedArray(fs.readFileSync(file));
const pts = JSON.parse(process.argv[5]);
// refine each hand-placed point to the most colourful pixel nearby and print its colour
for (const [name, x, y] of pts) {
  let best = -1, bx = x, by = y;
  for (let yy = y - 12; yy <= y + 12; yy++) for (let xx = x - 12; xx <= x + 12; xx++) { const i = (yy * W + xx) * 4, c = BF.rgbToHsv(d[i], d[i + 1], d[i + 2]); if (c.s * c.v > best && c.h > 70 && c.h < 180) { best = c.s * c.v; bx = xx; by = yy; } }
  const i = (by * W + bx) * 4, s = d[i] + d[i + 1] + d[i + 2] + 1;
  console.log(name.padEnd(6), 'at', bx, by, 'rgb', d[i], d[i + 1], d[i + 2], 'hsv', JSON.stringify(BF.rgbToHsv(d[i], d[i + 1], d[i + 2]), (k, v) => typeof v === 'number' ? +v.toFixed(2) : v), 'chroma', ((d[i] - d[i + 1]) / s).toFixed(3), ((d[i] + d[i + 1] - 2 * d[i + 2]) / s).toFixed(3));
  pts.find(p => p[0] === name).push(bx, by);
}
for (const [name, , , bx, by] of pts) {
  const m0 = BF.learnColor(d, W, H, bx, by), m = m0 && BF.refineColor(d, W, H, m0);
  if (!m) { console.log('tap', name, '-> refused'); continue; }
  const a = BF.autoTolerance(d, W, H, m, [4, 5, 7]);
  const per = BF.TOLS.map(t => { const bl = BF.findBlobs(d, W, H, Object.assign({}, m, { tol: t })); const hit = pts.filter(p => bl.some(b => Math.hypot(b.x - p[3], b.y - p[4]) < 8)).length; return `${t}:${bl.length}(${hit}✓)`; });
  console.log('tap', name.padEnd(6), 'area', m.area, 'from', m.n || 1, 'iMin', Math.round(m.iMin), 'auto', a.tol, '|', per.join(' '));
}
