// Synthetic rider used by the tests: joint positions over time and a renderer that paints stickers on a noisy background.
const W = 640, H = 360;
function ik(hip, foot, L1, L2, dir) {
  const dx = foot[0] - hip[0], dy = foot[1] - hip[1], d = Math.min(Math.hypot(dx, dy), L1 + L2 - 0.01);
  const a = (L1 * L1 - L2 * L2 + d * d) / (2 * d), h = Math.sqrt(Math.max(0, L1 * L1 - a * a));
  const ux = dx / d, uy = dy / d, px = hip[0] + a * ux, py = hip[1] + a * uy;
  const k1 = [px - h * uy, py + h * ux], k2 = [px + h * uy, py - h * ux];
  return (k1[0] - k2[0]) * dir > 0 ? k1 : k2;
}
// Side view. dir: +1 rider faces right. cad in rpm. Crank radius is 40 px.
function sidePose(t, dir, cad) {
  const cx = W / 2, bb = [cx + dir * 40, 275], R = 40;
  const th = 2 * Math.PI * cad / 60 * t;
  const pedal = [bb[0] + dir * R * Math.cos(th), bb[1] + R * Math.sin(th)];
  const foot = [pedal[0] + dir * 5, pedal[1] - 4];
  const ankle = [pedal[0] - dir * 21 + dir * 4 * Math.sin(th), pedal[1] - 16];
  const hip = [cx - dir * 60 + 1.5 * Math.sin(th), 148 + 1.5 * Math.cos(th)];
  const knee = ik(hip, ankle, 96, 88, dir);
  const shoulder = [cx + dir * 47, 88 + 2 * Math.sin(th * 2)];
  const elbow = [shoulder[0] + dir * 29, shoulder[1] + 43];
  const wrist = [elbow[0] + dir * 40, elbow[1] + 16];
  return { shoulder, elbow, wrist, hip, knee, ankle, foot };
}
// Front view: knees wobble sideways, feet go up and down in opposite phase.
function frontPose(t, cad) {
  const th = 2 * Math.PI * cad / 60 * t, cx = W / 2;
  return {
    kneeR: [cx - 42 + 6 * Math.sin(th), 180 - 34 * Math.cos(th)], footR: [cx - 50, 290 - 40 * Math.cos(th)],
    kneeL: [cx + 40 + 3 * Math.sin(th + Math.PI), 180 + 34 * Math.cos(th)], footL: [cx + 50, 290 + 40 * Math.cos(th)],
  };
}
function render(p, seed, only) {
  const d = new Uint8ClampedArray(W * H * 4);
  let s = seed;
  const rnd = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  for (let i = 0; i < W * H; i++) { const g = 150 + rnd() * 40; d[i * 4] = g; d[i * 4 + 1] = g - 5; d[i * 4 + 2] = g + 5; d[i * 4 + 3] = 255; }
  const disc = (x, y, r, c) => {
    for (let yy = Math.floor(y - r); yy <= y + r; yy++) for (let xx = Math.floor(x - r); xx <= x + r; xx++) {
      if (xx < 0 || yy < 0 || xx >= W || yy >= H || Math.hypot(xx + 0.5 - x, yy + 0.5 - y) > r) continue;
      const i = (yy * W + xx) * 4; d[i] = c[0] + rnd() * 10; d[i + 1] = c[1] + rnd() * 10; d[i + 2] = c[2] + rnd() * 10;
    }
  };
  if (p.hip) { disc(p.hip[0], p.hip[1], 18, [30, 30, 35]); disc(p.knee[0], p.knee[1], 12, [30, 30, 35]); }
  disc(80, 80, 13, [240, 120, 20]); disc(560, 50, 18, [90, 130, 90]); // distractors: orange bottle, dull green poster
  Object.keys(p).forEach(k => { if (!only || only.includes(k)) disc(p[k][0], p[k][1], 5, [40, 230, 60]); });
  return d;
}
module.exports = { W, H, sidePose, frontPose, render };
