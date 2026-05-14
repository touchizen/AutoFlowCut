// generate_tts_typecast.cjs — Typecast TTS with-timestamps (alignment).
// Two modes share the same /v1/text-to-speech/with-timestamps endpoint and
// store alignment in ElevenLabs-compatible shape so downstream scripts
// (draft_subtitles.cjs, build_srt.cjs, merge_audio.cjs) work identically
// regardless of TTS provider.
//
// Usage:
//   node generate_tts_typecast.cjs narration <narrationPath> <outDir> <voiceId>
//     → outDir/seg_NNN.mp3 + seg_NNN.json (alignment) + index.json
//       (mirrors generate_tts_elevenlabs.cjs)
//
//   node generate_tts_typecast.cjs dialogue <dialogsJson> <outDir> <ttsSettings> [<segmentsDir>]
//     → outDir/{part}_{order:03d}_{character}_{HHMMSS}.mp3 + result_{part}.json
//       (per-line dialogue with timecode-coded filenames for W8 auto-placement;
//        {part} derived from dialogsJson basename, e.g. dialogs_setup.json → "setup",
//        so running 4 parts into the same outDir preserves all 4 result files AND
//        prevents per-part mp3 filename collisions on identical {order, character, HHMMSS})
//
//     start time resolution per dialog:
//       1. dialog.start (SRT-format string) → use as-is
//       2. else dialog.after_paragraph (int) + segmentsDir → cumulate ffprobe
//          durations through the LAST segment with paragraph_idx === after_paragraph
//          and add a 0.3s gap → use as start
//       3. else throw (no silent 00:00:00 collision)
'use strict';

const fs = require('fs');
const path = require('path');
const { httpsRequest, splitNarration, ffprobeDuration, fmtTimestamp, parseSrtTimeToSec, readApiKey, sleep } = require('./lib_afc.cjs');

const API_HOST = 'api.typecast.ai';
const API_PATH = '/v1/text-to-speech/with-timestamps';
const MODEL = 'ssfm-v21';

// Korean emotion → Typecast emotion (normal/happy/sad/angry).
// Conservative mapping; unrecognized emotions fall back to normal.
const EMOTION_MAP = {
  '혼란': 'normal', '담담': 'normal', '단호': 'normal', '의아': 'normal',
  '결의': 'normal', '무관심': 'normal', '맹세': 'normal', '깨달음': 'normal',
  '차분/결의': 'normal', '담담/일상': 'normal', '수군거림': 'normal', '경계': 'normal',
  '절박': 'sad', '걱정': 'sad', '불안 억누름': 'sad', '공포': 'sad',
  '간절': 'sad', '자기희생': 'sad', '간청': 'sad', '죄책감/절규': 'sad',
  '결연/자기희생': 'sad', '처절한 의지': 'sad', '두려움/슬픔': 'sad',
  '짜증': 'angry', '분노': 'angry', '경악': 'angry', '냉혹': 'angry',
  '조롱': 'happy', '비아냥': 'happy', '비웃음': 'happy',
  '흥분/깨달음': 'happy', '희망': 'happy', '안도/환희': 'happy', '깨달음/흥분': 'happy',
};

// Derive part name from dialogs JSON path: dialogs_setup.json → "setup",
// dialogs_part1_setup.json → "part1_setup". Used to name per-part result file.
// Falls back to "unknown" if the basename doesn't match the dialogs_<part>.json
// pattern (caller can still rely on the unique mp3 filenames in that case).
function derivePartFromDialogsPath(dialogsPath) {
  const base = path.basename(dialogsPath, '.json');
  const m = /^dialogs[_\-](.+)$/i.exec(base);
  return m ? m[1] : 'unknown';
}

// Parse W5-0 tts_settings.md:  character: voice_id   # comment
function parseTtsSettings(p) {
  const out = {};
  for (const line of fs.readFileSync(p, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([^#\s][^:]*?)\s*:\s*([A-Za-z0-9_-]+)/);
    if (!m) continue;
    out[m[1].trim()] = m[2].trim();
  }
  return out;
}

function tcFromSrtTime(srtTime) {
  const clean = (srtTime || '00:00:00,000').replace(',', '.').trim();
  const [h, m, sFull] = clean.split(':');
  const s = Math.floor(parseFloat(sFull));
  return `${String(parseInt(h, 10)).padStart(2, '0')}${String(parseInt(m, 10)).padStart(2, '0')}${String(s).padStart(2, '0')}`;
}

// Convert Typecast `characters: [{text,start,end}]` → ElevenLabs-compatible
// `{characters, character_start_times_seconds, character_end_times_seconds}`
// so build_srt.cjs needs no provider branching.
function toElevenlabsAlignment(tcResp) {
  const chars = tcResp.characters || [];
  return {
    characters: chars.map((c) => c.text),
    character_start_times_seconds: chars.map((c) => c.start),
    character_end_times_seconds: chars.map((c) => c.end),
  };
}

async function callTypecast(apiKey, { voiceId, text, emotion = 'normal', intensity = 1.0 }) {
  // Typecast /v1/text-to-speech/with-timestamps expects emotion under `prompt`
  // (PresetPrompt schema). A top-level `emotion` field is silently ignored:
  // verified empirically that top-level emotion=angry produced normal-default
  // audio (same duration as prompt.emotion_preset=normal). PresetPrompt is the
  // documented path: emotion_type=preset + emotion_preset (normal/happy/sad/
  // angry by default; voice-specific extras like regret/urgent/whisper/...).
  const body = JSON.stringify({
    text,
    voice_id: voiceId,
    model: MODEL,
    prompt: {
      emotion_type: 'preset',
      emotion_preset: emotion,
      emotion_intensity: intensity,
    },
    output: { audio_format: 'mp3' },
  });
  const res = await httpsRequest({
    method: 'POST',
    host: API_HOST,
    pathUrl: API_PATH,
    headers: {
      'x-api-key': apiKey,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    },
    body,
    timeoutMs: 240000,
  });
  if (res.statusCode !== 200) {
    const snippet = res.buffer.toString('utf8').slice(0, 300);
    throw new Error(`Typecast ${res.statusCode}: ${snippet}`);
  }
  const payload = JSON.parse(res.buffer.toString('utf8'));
  return {
    audioMp3: Buffer.from(payload.audio, 'base64'),
    duration: payload.audio_duration,
    alignment: toElevenlabsAlignment(payload),
  };
}

// Typecast voice IDs all start with "tc_". Reject anything else early so users
// don't accidentally feed an ElevenLabs voice_id (which would fail with 401
// downstream and confuse the failure mode).
function assertTypecastVoiceId(voiceId, label) {
  if (!voiceId.startsWith('tc_')) {
    throw new Error(
      `${label} voice_id "${voiceId}" is not a Typecast ID (expected "tc_..."). ` +
      `The bundled dialogue script is Typecast-only — ElevenLabs voice IDs are ` +
      `not supported here.`
    );
  }
}

// === narration mode ===
async function runNarration(apiKey, narrationPath, outDir, voiceId) {
  assertTypecastVoiceId(voiceId, 'narration');
  fs.mkdirSync(outDir, { recursive: true });
  const raw = fs.readFileSync(narrationPath, 'utf8');
  // Typecast text limit is 2000 chars; use 1800 for safety margin.
  const segments = splitNarration(raw, 1800);
  const existing = new Set(fs.readdirSync(outDir));
  const index = [];
  for (const seg of segments) {
    const name = `seg_${String(seg.index).padStart(3, '0')}`;
    const mp3 = path.join(outDir, `${name}.mp3`);
    const json = path.join(outDir, `${name}.json`);
    if (existing.has(`${name}.mp3`) && existing.has(`${name}.json`)) {
      index.push({ index: seg.index, text: seg.text, mp3: `${name}.mp3`, json: `${name}.json`, paragraph_idx: seg.paragraph_idx, skipped: true });
      continue;
    }
    let attempt = 0;
    const maxAttempts = 4;
    while (true) {
      try {
        process.stderr.write(`[${seg.index + 1}/${segments.length}] (${seg.text.length} chars) ... `);
        const t0 = Date.now();
        const r = await callTypecast(apiKey, { voiceId, text: seg.text, emotion: 'normal' });
        fs.writeFileSync(mp3, r.audioMp3);
        fs.writeFileSync(json, JSON.stringify({
          text_original: seg.text,
          text_tts: seg.text,
          alignment: r.alignment,
          normalized_alignment: null,
          provider: 'typecast',
          duration: r.duration,
        }, null, 2));
        const t = ((Date.now() - t0) / 1000).toFixed(1);
        process.stderr.write(`ok ${t}s ${r.duration.toFixed(1)}s audio\n`);
        break;
      } catch (e) {
        attempt += 1;
        process.stderr.write(`FAIL: ${e.message}\n`);
        if (attempt >= maxAttempts) throw e;
        await sleep(2000 * attempt);
      }
    }
    index.push({ index: seg.index, text: seg.text, mp3: `${name}.mp3`, json: `${name}.json`, paragraph_idx: seg.paragraph_idx });
    await sleep(200);
  }
  fs.writeFileSync(path.join(outDir, 'index.json'), JSON.stringify(index, null, 2));
  console.log(`Generated ${segments.length} segments -> ${outDir}`);
}

// === dialogue mode ===
async function runDialogue(apiKey, dialogsPath, outDir, ttsSettingsPath, segmentsDir) {
  fs.mkdirSync(outDir, { recursive: true });
  const voiceMap = parseTtsSettings(ttsSettingsPath);

  const raw = JSON.parse(fs.readFileSync(dialogsPath, 'utf8'));
  const dialogs = Array.isArray(raw) ? raw : (raw.dialogs || []);

  // Preflight: every character that appears in dialogs.json MUST have a
  // tc_* voice mapping in tts_settings.md. Per W5-0 design — "unmapped
  // characters must STOP before any TTS call" — we enforce this here so
  // the run never silently skips dialogues. Narrator and unused entries
  // are intentionally not validated (narrator can legitimately be EL).
  const charactersUsed = new Set(dialogs.map((d) => d.character).filter(Boolean));
  const missingVoices = [];
  for (const char of charactersUsed) {
    const vid = voiceMap[char];
    if (!vid) {
      missingVoices.push(char);
      continue;
    }
    if (!vid.startsWith('tc_')) {
      throw new Error(
        `tts_settings.md: character "${char}" → "${vid}" is not a Typecast ID. ` +
        `The dialogue script is Typecast-only; replace with a tc_... voice_id ` +
        `from /v1/voices. (Narrator and unused entries are not validated here.)`
      );
    }
  }
  if (missingVoices.length > 0) {
    throw new Error(
      `tts_settings.md is missing voice mappings for: ${missingVoices.join(', ')}. ` +
      `Run W5-0 voice assignment to add tc_... voice_ids before invoking this script.`
    );
  }

  // If segmentsDir is provided, build a paragraph_idx → cumulative-end-seconds
  // table so we can derive each dialog's start from `after_paragraph`.
  let paragraphEndSec = null;
  if (segmentsDir) {
    const indexPath = path.join(segmentsDir, 'index.json');
    if (!fs.existsSync(indexPath)) {
      throw new Error(`segmentsDir "${segmentsDir}" has no index.json`);
    }
    const segIndex = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
    const cumulative = [];
    let acc = 0;
    for (const seg of segIndex) {
      const dur = ffprobeDuration(path.join(segmentsDir, seg.mp3));
      acc += dur;
      cumulative.push({ paragraph_idx: seg.paragraph_idx, end: acc });
    }
    // For each paragraph, take the END of its LAST segment.
    paragraphEndSec = new Map();
    for (const c of cumulative) {
      if (c.paragraph_idx == null) continue;
      paragraphEndSec.set(c.paragraph_idx, c.end);
    }
  }

  // Constants for timing math.
  const NARRATION_GAP = 0.3;  // gap from end of preceding narration to first dialog
  const DIALOG_GAP = 0.2;     // gap between consecutive dialogs in the same group

  // Derive part name once and use it for both mp3 filename prefixes and the
  // result_<part>.json filename so that running the script for 4 parts into
  // the same outDir cannot collide (an `001_김씨_000023.mp3` from setup and
  // rising would otherwise share a filename, causing the second run to skip
  // TTS and reuse the first part's audio + duration — see line ~325 fast-path).
  const partName = derivePartFromDialogsPath(dialogsPath);

  // groupEnd[after_paragraph] = end time (sec, on part timeline) of the LAST
  // dialog already placed in that group. Used to push subsequent dialogs forward
  // so they don't collide with each other on the timeline.
  const groupEnd = new Map();

  // Process dialogs in `order` to make group accumulation deterministic.
  const sortedDialogs = [...dialogs].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

  const result = [];
  let success = 0, fail = 0;
  for (const d of sortedDialogs) {
    const { character, line, order } = d;
    if (!character || !line || order == null) {
      console.error(`SKIP: malformed dialog: ${JSON.stringify(d)}`);
      fail += 1;
      continue;
    }
    const voiceId = voiceMap[character];
    if (!voiceId) {
      // Should be unreachable — preflight already throws on missing mappings.
      throw new Error(
        `dialog ${order} (${character}): voice mapping not found mid-run ` +
        `(preflight should have caught this). Re-run W5-0 voice assignment.`
      );
    }

    // Resolve dialog start IN SECONDS first, then format.
    // Priority: explicit `start` > derived from after_paragraph (with group accumulation) > throw.
    let startSec;
    if (d.start) {
      startSec = parseSrtTimeToSec(d.start);
    } else if (paragraphEndSec && d.after_paragraph != null) {
      const baseEnd = paragraphEndSec.get(d.after_paragraph);
      if (baseEnd == null) {
        throw new Error(
          `dialog ${order} (${character}): after_paragraph=${d.after_paragraph} not found in segments index. ` +
          `Re-run W5-1a so segments_{part}/index.json reflects the current narration.`
        );
      }
      const baseStart = baseEnd + NARRATION_GAP;
      const lastEnd = groupEnd.get(d.after_paragraph);
      // If a previous dialog already occupies this group, push past its end.
      // Otherwise place right after the narration paragraph end.
      startSec = lastEnd != null ? Math.max(baseStart, lastEnd + DIALOG_GAP) : baseStart;
    } else {
      throw new Error(
        `dialog ${order} (${character}): no start time. Provide either "start" (SRT-format) ` +
        `in ${path.basename(dialogsPath)} OR "after_paragraph" + the segmentsDir CLI arg.`
      );
    }

    const startStr = fmtTimestamp(startSec);
    const tcEmotion = EMOTION_MAP[d.emotion] || 'normal';
    const tc = tcFromSrtTime(startStr);
    const fname = `${partName}_${String(order).padStart(3, '0')}_${character}_${tc}.mp3`;
    const mp3Path = path.join(outDir, fname);

    // Skip if already generated; still measure duration so groupEnd stays accurate.
    if (fs.existsSync(mp3Path)) {
      const dur = ffprobeDuration(mp3Path);
      if (d.after_paragraph != null) groupEnd.set(d.after_paragraph, startSec + dur);
      result.push({ order, character, line, emotion: d.emotion || 'normal', file: fname, duration: Number(dur.toFixed(3)), start: startStr, skipped: true });
      success += 1;
      continue;
    }
    let attempt = 0;
    const maxAttempts = 3;
    let generated = false;
    while (true) {
      try {
        process.stderr.write(`[${String(order).padStart(3, '0')}] ${character} (${tcEmotion}) ${line.slice(0, 30)}... `);
        const r = await callTypecast(apiKey, { voiceId, text: line, emotion: tcEmotion });
        fs.writeFileSync(mp3Path, r.audioMp3);
        process.stderr.write(`ok ${r.duration.toFixed(1)}s\n`);
        if (d.after_paragraph != null) groupEnd.set(d.after_paragraph, startSec + r.duration);
        result.push({ order, character, line, emotion: d.emotion || 'normal', file: fname, duration: Number(r.duration.toFixed(3)), start: startStr });
        success += 1;
        generated = true;
        break;
      } catch (e) {
        attempt += 1;
        process.stderr.write(`FAIL: ${e.message}\n`);
        if (attempt >= maxAttempts) { fail += 1; break; }
        await sleep(2000 * attempt);
      }
    }
    if (generated) await sleep(300);
  }
  fs.writeFileSync(path.join(outDir, `result_${partName}.json`), JSON.stringify(result, null, 2));
  console.log(`Generated ${success} (failed ${fail}) -> ${outDir}`);
  if (fail > 0) {
    // Don't pretend success — downstream (W5 merge / W8 import) would silently
    // miss the absent dialogue mp3s otherwise.
    throw new Error(`Dialogue generation finished with ${fail} failure(s). See errors above; fix and re-run (existing mp3s are skipped).`);
  }
}

async function main() {
  const [, , mode, ...rest] = process.argv;
  if (mode === 'narration') {
    const [narrationPath, outDir, voiceId] = rest;
    if (!narrationPath || !outDir || !voiceId) {
      console.error('usage: node generate_tts_typecast.cjs narration <narrationPath> <outDir> <voiceId>');
      process.exit(2);
    }
    const apiKey = readApiKey("typecast");
    await runNarration(apiKey, narrationPath, outDir, voiceId);
    return;
  }
  if (mode === 'dialogue') {
    const [dialogsPath, outDir, ttsSettingsPath, segmentsDir] = rest;
    if (!dialogsPath || !outDir || !ttsSettingsPath) {
      console.error('usage: node generate_tts_typecast.cjs dialogue <dialogsJson> <outDir> <ttsSettings> [<segmentsDir>]');
      process.exit(2);
    }
    const apiKey = readApiKey("typecast");
    await runDialogue(apiKey, dialogsPath, outDir, ttsSettingsPath, segmentsDir);
    return;
  }
  console.error('usage:');
  console.error('  node generate_tts_typecast.cjs narration <narrationPath> <outDir> <voiceId>');
  console.error('  node generate_tts_typecast.cjs dialogue <dialogsJson> <outDir> <ttsSettings> [<segmentsDir>]');
  process.exit(2);
}

main().catch((e) => { console.error(e.stack || e.message); process.exit(1); });
