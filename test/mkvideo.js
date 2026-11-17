// Writes raw RGB frames of the synthetic rider to stdout (640x360, 30 fps). Pipe into ffmpeg to get a test video.
// usage: node test/mkvideo.js side|front [seconds] | ffmpeg -f rawvideo -pix_fmt rgb24 -s 640x360 -r 30 -i - out.y4m
const { W, H, sidePose, frontPose, render } = require('./synth.js');
const view = process.argv[2] || 'side', secs = parseFloat(process.argv[3] || '14');
for (let f = 0; f < 30 * secs; f++) {
  const t = f / 30, d = render(view === 'side' ? sidePose(t, 1, 90) : frontPose(t, 90), f + 3), out = Buffer.alloc(W * H * 3);
  for (let i = 0; i < W * H; i++) { out[i * 3] = d[i * 4]; out[i * 3 + 1] = d[i * 4 + 1]; out[i * 3 + 2] = d[i * 4 + 2]; }
  process.stdout.write(out);
}
