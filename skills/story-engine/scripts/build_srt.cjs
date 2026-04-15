// build_srt.cjs — build per-part SRT from character-level alignment JSONs and
// subtitles_{part}.txt meaning-unit splits.
// Usage: node build_srt.cjs <segmentsDir> <subtitlesFile> <outSrt> [<timelineJson>]
// Also writes cumulative segment offsets so that times are against the final
// concatenated per-part mp3.
'use strict';

const fs = require('fs');
const path = require('path');
const { ffprobeDuration, fmtTimestamp } = require('./lib_afc.cjs');

function parseSubtitles(p) {
  const out = [];
  const lines = fs.readFileSync(p, 'utf8').split(/\r?\n/).filter(Boolean);
  for (const line of lines) {
    const m = line.match(/^\[(\d+)\|([^\]]+)\]\s*(.*)$/);
    if (!m) continue;
    const [, idxStr, tag, rest] = m;
    const chunks = rest.split('|').map((s) => s.trim()).filter(Boolean);
    out.push({ index: parseInt(idxStr, 10), tag, chunks });
  }
  return out;
}

// Find a subsequence of characters in the alignment array that corresponds to
// `chunk`. We match greedily from `startIdx` by comparing characters (space
// and punctuation insensitive). Returns [startCharIdx, endCharIdx] or null.
function locateChunk(alignment, chunk, startIdx) {
  const chars = alignment.characters;
  const normChunk = chunk.replace(/\s+/g, '').toLowerCase();
  const N = chars.length;
  let cursor = startIdx;

  while (cursor < N) {
    // Try to match starting from `cursor`.
    let matched = 0;
    let i = cursor;
    let startFound = -1;
    while (i < N && matched < normChunk.length) {
      const ch = chars[i].toLowerCase();
      if (/\s/.test(ch)) { i += 1; continue; }
      if (ch === normChunk[matched]) {
        if (startFound < 0) startFound = i;
        matched += 1;
        i += 1;
      } else if (matched === 0) {
        // Haven't started matching; skip this char.
        i += 1;
      } else {
        // Mismatch mid-match: restart from next char after startFound.
        i = startFound + 1;
        startFound = -1;
        matched = 0;
      }
    }
    if (matched === normChunk.length && startFound >= 0) {
      return [startFound, i - 1];
    }
    // Could not match from cursor — advance one and retry.
    cursor += 1;
    if (cursor > startIdx + Math.max(normChunk.length * 4, 200)) break;
  }
  return null;
}

async function main() {
  const [, , segDir, subsPath, outSrt, timelineJson] = process.argv;
  if (!segDir || !subsPath || !outSrt) {
    console.error('usage: node build_srt.cjs <segmentsDir> <subtitlesFile> <outSrt> [<timelineJson>]');
    process.exit(2);
  }
  const idx = JSON.parse(fs.readFileSync(path.join(segDir, 'index.json'), 'utf8'));
  const subs = parseSubtitles(subsPath);
  const subsByIdx = new Map(subs.map((s) => [s.index, s]));

  // Compute cumulative offset per segment via ffprobe on each mp3.
  const offsets = [];
  let cum = 0;
  for (const seg of idx) {
    const mp3 = path.join(segDir, seg.mp3);
    const dur = ffprobeDuration(mp3);
    offsets.push({ index: seg.index, start: cum, end: cum + dur, duration: dur });
    cum += dur;
  }

  const srtLines = [];
  let cueNo = 1;

  for (const seg of idx) {
    const meta = JSON.parse(fs.readFileSync(path.join(segDir, seg.json), 'utf8'));
    const alignment = meta.alignment;
    const segOffset = offsets.find((o) => o.index === seg.index).start;
    const sub = subsByIdx.get(seg.index);
    if (!sub || !alignment) continue;
    let charCursor = 0;
    // Time of the last assigned chunk (to avoid overlap)
    let lastEnd = -1;
    for (let ci = 0; ci < sub.chunks.length; ci += 1) {
      const chunk = sub.chunks[ci];
      const loc = locateChunk(alignment, chunk, charCursor);
      let startTime, endTime;
      if (loc) {
        const [sIdx, eIdx] = loc;
        startTime = alignment.character_start_times_seconds[sIdx];
        endTime = alignment.character_end_times_seconds[eIdx];
        charCursor = eIdx + 1;
      } else {
        // Fallback: proportional allocation within the segment.
        const total = sub.chunks.length;
        const dur = offsets.find((o) => o.index === seg.index).duration;
        startTime = (ci / total) * dur;
        endTime = ((ci + 1) / total) * dur;
      }
      const absStart = Math.max(lastEnd + 0.001, segOffset + startTime);
      const absEnd = Math.max(absStart + 0.4, segOffset + endTime);
      lastEnd = absEnd;
      srtLines.push(`${cueNo}`);
      srtLines.push(`${fmtTimestamp(absStart)} --> ${fmtTimestamp(absEnd)}`);
      srtLines.push(chunk);
      srtLines.push('');
      cueNo += 1;
    }
  }
  fs.writeFileSync(outSrt, srtLines.join('\n'));
  if (timelineJson) {
    fs.writeFileSync(timelineJson, JSON.stringify({ segments: offsets, totalDuration: cum }, null, 2));
  }
  console.log(`Wrote ${cueNo - 1} cues -> ${outSrt} (total ${cum.toFixed(2)}s)`);
}

main().catch((e) => { console.error(e.stack || e.message); process.exit(1); });
