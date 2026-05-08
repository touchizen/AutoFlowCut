// Helper library for W5 TTS/SFX pipeline (Node.js).
// Used by draft_subtitles.cjs, generate_tts_elevenlabs.cjs, generate_tts_typecast.cjs,
// build_srt.cjs, merge_audio.cjs, generate_sfx.cjs.
'use strict';

const fs = require('fs');
const path = require('path');
const https = require('https');
const { spawnSync } = require('child_process');

// Resolve a TTS provider's API key in this order:
//   1. process.env[<ENVNAME>] if set
//   2. ~/.<provider>/credentials matched as dotenv-style `KEY=value`
//   3. fall back to the whole file trimmed (legacy: file contains only the key)
// Supported providers: 'elevenlabs' (default), 'typecast'.
function readApiKey(provider = 'elevenlabs') {
  const PROVIDERS = {
    elevenlabs: { dir: '.elevenlabs', envName: 'ELEVENLABS_API_KEY' },
    typecast:   { dir: '.typecast',   envName: 'TYPECAST_API_KEY'   },
  };
  const cfg = PROVIDERS[provider];
  if (!cfg) throw new Error(`readApiKey: unknown provider "${provider}"`);

  const fromEnv = process.env[cfg.envName];
  if (fromEnv && fromEnv.trim()) return fromEnv.trim();

  const home = process.env.HOME || process.env.USERPROFILE;
  const p = path.join(home, cfg.dir, 'credentials');
  const raw = fs.readFileSync(p, 'utf8');
  const re = new RegExp(`^\\s*${cfg.envName}\\s*=\\s*([^\\s\\r\\n]+)`, 'm');
  const m = raw.match(re);
  return m ? m[1] : raw.trim();
}

function httpsRequest({ method = 'GET', host = 'api.elevenlabs.io', pathUrl, headers = {}, body = null, timeoutMs = 180000 }) {
  return new Promise((resolve, reject) => {
    const opts = { method, host, path: pathUrl, headers: { ...headers } };
    if (body) opts.headers['Content-Length'] = Buffer.byteLength(body);
    const req = https.request(opts, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const buf = Buffer.concat(chunks);
        resolve({ statusCode: res.statusCode, headers: res.headers, buffer: buf });
      });
    });
    req.on('error', reject);
    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error(`Timeout after ${timeoutMs}ms`));
    });
    if (body) req.write(body);
    req.end();
  });
}

// Split narration text into paragraph-level segments, then further split long
// paragraphs at sentence boundaries to stay under maxChars (TTS request limit).
// Preserves order. Each segment carries its origin `paragraph_idx` so dialogue
// insertion (W5-1f) can resolve "after_paragraph" placement to a real timecode.
// Returns [{index, text, paragraph_idx}]
function splitNarration(raw, maxChars = 2500) {
  const paragraphs = raw
    .split(/\r?\n\s*\r?\n/)
    .map((p) => p.replace(/\s+/g, ' ').trim())
    .filter((p) => p.length > 0);

  const segments = [];
  let segIdx = 0;
  for (let pIdx = 0; pIdx < paragraphs.length; pIdx++) {
    const para = paragraphs[pIdx];
    if (para.length <= maxChars) {
      segments.push({ index: segIdx++, text: para, paragraph_idx: pIdx });
      continue;
    }
    // Split at sentence boundaries
    const sentences = para.match(/[^.!?]+[.!?]+["')\]]*\s*|[^.!?]+$/g) || [para];
    let cur = '';
    for (const s of sentences) {
      if ((cur + s).length > maxChars && cur) {
        segments.push({ index: segIdx++, text: cur.trim(), paragraph_idx: pIdx });
        cur = s;
      } else {
        cur += s;
      }
    }
    if (cur.trim()) segments.push({ index: segIdx++, text: cur.trim(), paragraph_idx: pIdx });
  }
  return segments;
}

// Inject inline phonetic hints for tricky Gaelic/French terms so ElevenLabs
// pronounces them intelligibly with eleven_multilingual_v2. These substitutions
// are applied ONLY to the TTS input, never to the displayed subtitle text.
function applyPronunciationHints(text) {
  const pairs = [
    [/Eilean\s+M[oò]r/gi, 'Ellan More'],
    [/Eilean/gi, 'Ellan'],
    [/daoine\s+s[ií]th/gi, 'doon-yuh shee'],
    [/Clanranald/gi, 'Clan Ranald'],
    [/le\s+cafard\s+des\s+gardiens\s+de\s+phare/gi, 'luh kah-far day gar-dyen duh far'],
    [/Breasclete/gi, 'Brays-kleet'],
    [/Flannan/gi, 'Flan-an'],
    [/Hesperus/gi, 'Hess-per-us'],
    [/Bernera/gi, 'Ber-ne-ra'],
  ];
  let out = text;
  for (const [re, rep] of pairs) out = out.replace(re, rep);
  return out;
}

function ffprobeDuration(mp3Path) {
  const r = spawnSync('ffprobe', ['-v', 'quiet', '-show_entries', 'format=duration', '-of', 'csv=p=0', mp3Path], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`ffprobe failed for ${mp3Path}: ${r.stderr}`);
  return parseFloat(r.stdout.trim());
}

function fmtTimestamp(sec) {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  const ms = Math.floor((sec - Math.floor(sec)) * 1000);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')},${String(ms).padStart(3, '0')}`;
}

// Inverse of fmtTimestamp: "HH:MM:SS,mmm" or "HH:MM:SS.mmm" → seconds (float).
function parseSrtTimeToSec(s) {
  const clean = String(s).replace(',', '.').trim();
  const parts = clean.split(':');
  if (parts.length !== 3) throw new Error(`Invalid SRT time: "${s}"`);
  const [h, m, sFull] = parts;
  return parseInt(h, 10) * 3600 + parseInt(m, 10) * 60 + parseFloat(sFull);
}

function fmtMMSS(sec) {
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return `${String(m).padStart(2, '0')}${String(s).padStart(2, '0')}`;
}

function fmtHHMMSS(sec) {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.round(sec % 60);
  return `${String(h).padStart(2, '0')}${String(m).padStart(2, '0')}${String(s).padStart(2, '0')}`;
}

async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

module.exports = {
  readApiKey,
  httpsRequest,
  splitNarration,
  applyPronunciationHints,
  ffprobeDuration,
  fmtTimestamp,
  parseSrtTimeToSec,
  fmtMMSS,
  fmtHHMMSS,
  sleep,
};
