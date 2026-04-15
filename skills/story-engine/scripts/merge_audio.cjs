// merge_audio.cjs — concat per-part segment mp3s into final_{part}.mp3 using
// ffmpeg concat demuxer.
// Usage: node merge_audio.cjs <segmentsDir> <outMp3>
'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

function main() {
  const [, , segDir, outMp3] = process.argv;
  if (!segDir || !outMp3) {
    console.error('usage: node merge_audio.cjs <segmentsDir> <outMp3>');
    process.exit(2);
  }
  const idx = JSON.parse(fs.readFileSync(path.join(segDir, 'index.json'), 'utf8'));
  const listPath = path.join(segDir, 'concat.txt');
  const lines = idx.map((s) => `file '${s.mp3.replace(/'/g, "'\\''")}'`);
  fs.writeFileSync(listPath, lines.join('\n') + '\n');

  // Because mp3 frames vary slightly, use -c copy for speed; it'll concatenate
  // frame-accurately enough for subtitle alignment (<10ms drift).
  const r = spawnSync('ffmpeg', ['-y', '-f', 'concat', '-safe', '0', '-i', listPath, '-c', 'copy', outMp3], { stdio: 'inherit' });
  if (r.status !== 0) process.exit(r.status);
  console.log(`Merged -> ${outMp3}`);
}

main();
