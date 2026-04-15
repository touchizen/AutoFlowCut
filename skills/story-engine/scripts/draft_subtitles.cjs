// draft_subtitles.cjs — auto-draft meaning-unit subtitle splits.
// Usage: node draft_subtitles.cjs <segmentsDir> <outFile>
// The segmentsDir must contain index.json written by generate_tts.cjs.
// Output format (per W5 doc):
//   [NNN|N] chunk1|chunk2|chunk3
// Each chunk <= 42 chars, split at clause/sentence boundaries (;:,— . ! ? or
// conjunctions) so that SRT lines remain readable.
'use strict';

const fs = require('fs');
const path = require('path');

const MAX_CHARS = 42;

// Split a paragraph into chunks under MAX_CHARS. Tries punctuation first,
// falls back to space-boundary.
function splitChunks(text) {
  const out = [];
  let remaining = text.trim();

  // Primary pass: sentence boundaries.
  const sentences = remaining.match(/[^.!?]+[.!?]+["')\]]*\s*|[^.!?]+$/g) || [remaining];

  for (const sent of sentences) {
    let s = sent.trim();
    if (!s) continue;
    if (s.length <= MAX_CHARS) { out.push(s); continue; }

    // Secondary: split on clause punctuation.
    const parts = s.split(/(?<=[,;:—–-])\s+/);
    let buf = '';
    for (const p of parts) {
      if (!buf) { buf = p; continue; }
      if ((buf + ' ' + p).length <= MAX_CHARS) { buf += ' ' + p; }
      else {
        if (buf.length <= MAX_CHARS) out.push(buf);
        else pushSpaceSplit(buf, out);
        buf = p;
      }
    }
    if (buf) {
      if (buf.length <= MAX_CHARS) out.push(buf);
      else pushSpaceSplit(buf, out);
    }
  }
  return out.map((x) => x.trim()).filter(Boolean);
}

function pushSpaceSplit(s, out) {
  // Tertiary: hard split at word boundary.
  const words = s.split(/\s+/);
  let buf = '';
  for (const w of words) {
    if (!buf) { buf = w; continue; }
    if ((buf + ' ' + w).length <= MAX_CHARS) buf += ' ' + w;
    else { out.push(buf); buf = w; }
  }
  if (buf) out.push(buf);
}

function main() {
  const [, , segDir, outFile] = process.argv;
  if (!segDir || !outFile) {
    console.error('usage: node draft_subtitles.cjs <segmentsDir> <outFile>');
    process.exit(2);
  }
  const idx = JSON.parse(fs.readFileSync(path.join(segDir, 'index.json'), 'utf8'));
  const lines = [];
  for (const seg of idx) {
    const n = String(seg.index).padStart(3, '0');
    const chunks = splitChunks(seg.text);
    // Sanity: no empty chunks, no chunk > MAX_CHARS (warn only; ffmpeg will still run)
    for (const c of chunks) {
      if (c.length > MAX_CHARS) console.error(`warn: ${n} chunk exceeds ${MAX_CHARS}: ${c}`);
    }
    lines.push(`[${n}|N] ${chunks.join('|')}`);
  }
  fs.writeFileSync(outFile, lines.join('\n') + '\n');
  console.log(`Wrote ${lines.length} segment-lines -> ${outFile}`);
}

main();
