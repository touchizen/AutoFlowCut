const fs = require('fs');

const srt = fs.readFileSync('C:/workspace/Flow2CapCut/story/ep1/final.srt', 'utf8');
const blocks = srt.trim().split(/\n\n+/);
const MAX_CHARS = 25;

function timeToMs(t) {
  const [h, m, rest] = t.split(':');
  const [s, ms] = rest.split(',');
  return +h * 3600000 + +m * 60000 + +s * 1000 + +ms;
}

function msToTime(ms) {
  const h = String(Math.floor(ms / 3600000)).padStart(2, '0');
  const m = String(Math.floor((ms % 3600000) / 60000)).padStart(2, '0');
  const s = String(Math.floor((ms % 60000) / 1000)).padStart(2, '0');
  const mil = String(ms % 1000).padStart(3, '0');
  return `${h}:${m}:${s},${mil}`;
}

function splitByMeaning(text, maxLen) {
  if (text.length <= maxLen) return [text];
  
  const chunks = [];
  // Split by punctuation first, then by words
  const sentences = text.split(/(?<=[.!?,;:—])\s+/);
  
  let current = '';
  for (const sentence of sentences) {
    if (sentence.length <= maxLen) {
      if ((current + ' ' + sentence).trim().length <= maxLen) {
        current = (current + ' ' + sentence).trim();
      } else {
        if (current) chunks.push(current);
        current = sentence;
      }
    } else {
      // Sentence too long, split by word groups
      if (current) { chunks.push(current); current = ''; }
      const words = sentence.split(' ');
      let buf = '';
      for (const word of words) {
        if ((buf + ' ' + word).trim().length <= maxLen) {
          buf = (buf + ' ' + word).trim();
        } else {
          if (buf) chunks.push(buf);
          buf = word;
        }
      }
      if (buf) current = buf;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

let idx = 1;
const output = [];

for (const block of blocks) {
  const lines = block.split('\n');
  if (lines.length < 3) continue;
  
  const [startStr, endStr] = lines[1].split(' --> ');
  const startMs = timeToMs(startStr);
  const endMs = timeToMs(endStr);
  const text = lines.slice(2).join(' ');
  const totalDur = endMs - startMs;
  
  const chunks = splitByMeaning(text, MAX_CHARS);
  const totalChars = chunks.reduce((a, c) => a + c.length, 0);
  
  let offset = startMs;
  for (let i = 0; i < chunks.length; i++) {
    const chunkDur = Math.round((chunks[i].length / totalChars) * totalDur);
    const chunkEnd = (i === chunks.length - 1) ? endMs : offset + chunkDur;
    
    output.push(`${idx}\n${msToTime(offset)} --> ${msToTime(chunkEnd)}\n${chunks[i]}\n`);
    idx++;
    offset = chunkEnd;
  }
}

fs.writeFileSync('C:/workspace/Flow2CapCut/story/ep1/final_split.srt', output.join('\n'), 'utf8');
console.log(`Done: ${idx - 1} subtitles created`);

// Verify
let over25 = 0, maxLen = 0;
for (const chunk of output) {
  const lines = chunk.split('\n');
  const text = lines[2] || '';
  if (text.length > 25) { over25++; }
  if (text.length > maxLen) maxLen = text.length;
}
console.log(`25자 초과: ${over25}, 최대: ${maxLen}자`);
