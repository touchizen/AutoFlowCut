#!/usr/bin/env node
/**
 * R9: ElevenLabs TTS Generation for "Words I Never Said"
 * Node.js version — generates mp3 + SRT from narration.txt and dialogs.json
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// === Config ===
const API_KEY = (() => {
  if (process.env.ELEVENLABS_API_KEY) return process.env.ELEVENLABS_API_KEY;
  const credPaths = [
    path.join(process.env.HOME || process.env.USERPROFILE, '.elevenlabs', 'credentials'),
  ];
  for (const p of credPaths) {
    if (fs.existsSync(p)) return fs.readFileSync(p, 'utf8').trim();
  }
  throw new Error('ElevenLabs API key not found');
})();

const MODEL = 'eleven_multilingual_v2';
const BASE_URL = 'https://api.elevenlabs.io/v1/text-to-speech';

// English voice IDs (ElevenLabs preset voices)
const VOICE_MAP = {
  'Narrator':       'pNInz6obpgDQGcFmaJgB',  // Adam - deep warm male narrator
  'Sophie':         '21m00Tcm4TlvDq8ikWAM',  // Rachel - young American female
  'Richard':        'VR6AewLTigWG4xSOukaG',  // Arnold - middle-aged American male
  'George':         'TxGEqnHWrfWFTfGW9XjX',  // Josh - elderly warm male
  'Tom':            'ErXwobaYiN019PkySvjV',  // Antoni - young American male
  'Eleanor_young':  'EXAVITQu4vr4xnSDxMaL',  // Bella - young British female
  'Eleanor':        'MF3mGyEYCl7XYWbV9V6O',  // Elli - older female
  'Nurse_1944':     'MF3mGyEYCl7XYWbV9V6O',  // Elli - clinical female
};

const VOICE_SETTINGS = {
  stability: 0.65,
  similarity_boost: 0.8,
  style: 0.3,
};

// === Parse script into segments ===
// Each (Narration) or (Dialogue) block = 1 segment. No merging.
function parseScript(scriptPath, dialogsPath) {
  const script = fs.readFileSync(scriptPath, 'utf8');
  const dialogs = JSON.parse(fs.readFileSync(dialogsPath, 'utf8'))
    .filter(d => d.line);

  // Extract Hook section (at end of file) and main sections
  const hookMatch = script.match(/## HOOK \(Cold Open\)[^\n]*\n([\s\S]*?)(?:\n---\n\*END OF SCRIPT\*|$)/);
  const mainMatch = script.match(/## ACT I[\s\S]*?(?=## HOOK \(Cold Open\))/);

  const hookText = hookMatch ? hookMatch[1] : '';
  const mainText = mainMatch ? mainMatch[0] : '';

  // Playback order: Hook first, then Acts
  const fullText = hookText + '\n' + mainText;

  const segments = [];
  let dialogIdx = 0;
  let currentTag = null; // 'narration' | 'dialog' | null

  for (const line of fullText.split('\n')) {
    const stripped = line.trim();
    if (!stripped) continue;

    // Skip markdown headers, separators, metadata
    if (stripped.startsWith('#') || stripped === '---') continue;
    if (stripped.startsWith('**[') || stripped.startsWith('**Episode') ||
        stripped.startsWith('**Duration') || stripped.startsWith('**Narration') ||
        stripped.startsWith('**Language')) continue;
    if (stripped === 'END OF SCRIPT' || stripped === '*END OF SCRIPT*') continue;

    // Skip SFX
    if (stripped.startsWith('(SFX:')) continue;

    // Detect tag lines
    if (stripped.match(/^\(Narration( —.*?)?\)$/)) {
      currentTag = 'narration';
      continue;
    }
    if (stripped.match(/^\(Dialogue — .+\)$/)) {
      currentTag = 'dialog';
      continue;
    }

    // Content line — create a segment based on current tag
    if (stripped.startsWith('"') && stripped.endsWith('"')) {
      // Quoted dialogue line
      const dialogText = stripped.slice(1, -1);
      let matched = false;
      for (let j = dialogIdx; j < Math.min(dialogIdx + 10, dialogs.length); j++) {
        if (dialogs[j].line === dialogText) {
          segments.push({ type: 'dialog', text: dialogText, character: dialogs[j].character });
          dialogIdx = j + 1;
          matched = true;
          break;
        }
      }
      if (!matched) {
        segments.push({ type: 'narration', text: dialogText, character: 'Narrator' });
      }
    } else {
      // Regular narration line — clean italic markers, each = 1 segment
      const clean = stripped.replace(/\*/g, '').replace(/^"|"$/g, '').trim();
      if (clean) segments.push({ type: 'narration', text: clean, character: 'Narrator' });
    }
  }

  return segments;
}

// === TTS API call ===
async function generateTTS(text, voiceId, outputPath) {
  const url = `${BASE_URL}/${voiceId}/with-timestamps`;
  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      'xi-api-key': API_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      text,
      model_id: MODEL,
      voice_settings: VOICE_SETTINGS,
    }),
  });

  if (!resp.ok) {
    const err = await resp.text();
    console.error(`  ERROR ${resp.status}: ${err.slice(0, 200)}`);
    return false;
  }

  const result = await resp.json();
  const audioB64 = result.audio_base64 || '';
  fs.writeFileSync(outputPath, Buffer.from(audioB64, 'base64'));

  // Save timestamps
  const tsPath = outputPath.replace('.mp3', '.json');
  const alignment = result.alignment || {};
  fs.writeFileSync(tsPath, JSON.stringify(alignment, null, 2));

  return true;
}

// === Get mp3 duration using audio header parsing ===
function getMp3Duration(mp3Path) {
  const buf = fs.readFileSync(mp3Path);
  // Simple estimate: file size / bitrate
  // ElevenLabs typically outputs 128kbps mp3
  const fileSizeBytes = buf.length;
  const bitrateKbps = 128;
  const durationSec = (fileSizeBytes * 8) / (bitrateKbps * 1000);
  return durationSec;
}

// === Format SRT time ===
function formatSrtTime(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${s.toFixed(3).padStart(6, '0')}`.replace('.', ',');
}

// === Main ===
async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const startFrom = parseInt(process.argv.find(a => a.startsWith('--start='))?.split('=')[1] || '0');

  const segmentsJsonPath = path.join(__dirname, 'segments.json');
  const segmentsDir = path.join(__dirname, 'segments');

  // Load pre-parsed segments
  const segments = JSON.parse(fs.readFileSync(segmentsJsonPath, 'utf8'));

  console.log(`\n=== ${segments.length} segments parsed ===\n`);
  for (let i = 0; i < segments.length; i++) {
    const { type, text, character } = segments[i];
    const preview = text.slice(0, 60) + (text.length > 60 ? '...' : '');
    console.log(`  ${String(i).padStart(3, '0')} [${type.toUpperCase().padEnd(9)}] ${character.padEnd(15)} | ${preview}`);
  }

  // Save segments metadata
  const segJsonPath = path.join(__dirname, 'segments.json');
  fs.writeFileSync(segJsonPath, JSON.stringify(segments.map((s, i) => ({ idx: i, ...s })), null, 2));
  console.log(`\nSegments metadata: ${segJsonPath}`);

  if (dryRun) {
    console.log('\n[DRY RUN] TTS generation skipped');
    return;
  }

  // Generate TTS
  fs.mkdirSync(segmentsDir, { recursive: true });

  let cumulative = 0;
  const timelineData = [];
  const srtLines = [];
  let srtSeq = 1;

  for (let i = 0; i < segments.length; i++) {
    const { type, text, character } = segments[i];
    const voiceId = VOICE_MAP[character] || VOICE_MAP['Narrator'];
    const mp3Path = path.join(segmentsDir, `${String(i).padStart(3, '0')}_${character}.mp3`);

    if (i < startFrom) {
      // Already generated, just measure
      if (fs.existsSync(mp3Path)) {
        const dur = getMp3Duration(mp3Path);
        timelineData.push({
          idx: i, type, character, text,
          duration: Math.round(dur * 1000) / 1000,
          start: Math.round(cumulative * 1000) / 1000,
          end: Math.round((cumulative + dur) * 1000) / 1000,
        });

        // SRT entry
        const subtitle = type === 'dialog' ? `(${character}) ${text}` : text;
        srtLines.push(`${srtSeq}`);
        srtLines.push(`${formatSrtTime(cumulative)} --> ${formatSrtTime(cumulative + dur)}`);
        srtLines.push(subtitle);
        srtLines.push('');
        srtSeq++;
        cumulative += dur;
      }
      continue;
    }

    if (fs.existsSync(mp3Path)) {
      console.log(`  ${String(i).padStart(3, '0')} SKIP (exists)`);
      const dur = getMp3Duration(mp3Path);
      timelineData.push({
        idx: i, type, character, text,
        duration: Math.round(dur * 1000) / 1000,
        start: Math.round(cumulative * 1000) / 1000,
        end: Math.round((cumulative + dur) * 1000) / 1000,
      });
      const subtitle = type === 'dialog' ? `(${character}) ${text}` : text;
      srtLines.push(`${srtSeq}`);
      srtLines.push(`${formatSrtTime(cumulative)} --> ${formatSrtTime(cumulative + dur)}`);
      srtLines.push(subtitle);
      srtLines.push('');
      srtSeq++;
      cumulative += dur;
      continue;
    }

    console.log(`  ${String(i).padStart(3, '0')} Generating... [${character}] ${text.slice(0, 40)}...`);
    const success = await generateTTS(text, voiceId, mp3Path);

    if (success) {
      const size = fs.statSync(mp3Path).size;
      const dur = getMp3Duration(mp3Path);
      console.log(`  ${String(i).padStart(3, '0')} OK (${(size / 1024).toFixed(1)}KB, ${dur.toFixed(1)}s)`);

      timelineData.push({
        idx: i, type, character, text,
        duration: Math.round(dur * 1000) / 1000,
        start: Math.round(cumulative * 1000) / 1000,
        end: Math.round((cumulative + dur) * 1000) / 1000,
      });

      // SRT
      const tsPath = mp3Path.replace('.mp3', '.json');
      let subtitle = type === 'dialog' ? `(${character}) ${text}` : text;
      srtLines.push(`${srtSeq}`);
      srtLines.push(`${formatSrtTime(cumulative)} --> ${formatSrtTime(cumulative + dur)}`);
      srtLines.push(subtitle);
      srtLines.push('');
      srtSeq++;
      cumulative += dur;
    } else {
      console.log(`  ${String(i).padStart(3, '0')} FAILED`);
    }

    // Rate limit
    await new Promise(r => setTimeout(r, 500));
  }

  // Save timeline
  const timelinePath = path.join(__dirname, 'timeline.json');
  fs.writeFileSync(timelinePath, JSON.stringify(timelineData, null, 2));
  console.log(`\nTimeline: ${timelinePath}`);

  // Save SRT
  const srtPath = path.join(__dirname, 'final.srt');
  fs.writeFileSync(srtPath, srtLines.join('\n'));
  console.log(`SRT: ${srtPath} (${srtSeq - 1} entries)`);

  // Save filelist for concat
  const filelistPath = path.join(segmentsDir, 'filelist.txt');
  const filelistContent = segments.map((s, i) =>
    `file '${String(i).padStart(3, '0')}_${s.character}.mp3'`
  ).join('\n');
  fs.writeFileSync(filelistPath, filelistContent);
  console.log(`Filelist: ${filelistPath}`);

  const totalMin = Math.floor(cumulative / 60);
  const totalSec = (cumulative % 60).toFixed(1);
  console.log(`\nTotal duration: ${totalMin}m ${totalSec}s`);
}

main().catch(console.error);
