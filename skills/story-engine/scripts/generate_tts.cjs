// generate_tts.js — ElevenLabs with-timestamps TTS for one narration part.
// Usage: node generate_tts.js <narrationPath> <outDir> <voiceId>
// Produces: outDir/seg_NNN.mp3, outDir/seg_NNN.json (alignment), outDir/index.json
'use strict';

const fs = require('fs');
const path = require('path');
const { readApiKey, httpsRequest, splitNarration, applyPronunciationHints, sleep } = require('./lib_afc.cjs');

async function generateOne(voiceId, apiKey, text, outMp3, outJson) {
  const ttsText = applyPronunciationHints(text);
  const body = JSON.stringify({
    text: ttsText,
    model_id: 'eleven_multilingual_v2',
    voice_settings: { stability: 0.5, similarity_boost: 0.75, style: 0.15, use_speaker_boost: true },
    output_format: 'mp3_44100_128',
  });
  const res = await httpsRequest({
    method: 'POST',
    pathUrl: `/v1/text-to-speech/${voiceId}/with-timestamps`,
    headers: {
      'xi-api-key': apiKey,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    },
    body,
    timeoutMs: 240000,
  });
  if (res.statusCode !== 200) {
    const snippet = res.buffer.toString('utf8').slice(0, 400);
    throw new Error(`TTS ${res.statusCode}: ${snippet}`);
  }
  const payload = JSON.parse(res.buffer.toString('utf8'));
  const audio = Buffer.from(payload.audio_base64, 'base64');
  fs.writeFileSync(outMp3, audio);
  // alignment: character-level timestamps
  const meta = {
    text_original: text,
    text_tts: ttsText,
    alignment: payload.alignment || null,
    normalized_alignment: payload.normalized_alignment || null,
  };
  fs.writeFileSync(outJson, JSON.stringify(meta, null, 2));
}

async function main() {
  const [, , narrationPath, outDir, voiceId] = process.argv;
  if (!narrationPath || !outDir || !voiceId) {
    console.error('usage: node generate_tts.js <narrationPath> <outDir> <voiceId>');
    process.exit(2);
  }
  fs.mkdirSync(outDir, { recursive: true });
  const apiKey = readApiKey();
  const raw = fs.readFileSync(narrationPath, 'utf8');
  const segments = splitNarration(raw, 2500);

  // Resume support: skip segments whose mp3+json already exist.
  const existing = new Set(fs.readdirSync(outDir));
  const index = [];
  for (const seg of segments) {
    const name = `seg_${String(seg.index).padStart(3, '0')}`;
    const mp3 = path.join(outDir, `${name}.mp3`);
    const json = path.join(outDir, `${name}.json`);
    if (existing.has(`${name}.mp3`) && existing.has(`${name}.json`)) {
      index.push({ index: seg.index, text: seg.text, mp3: `${name}.mp3`, json: `${name}.json`, skipped: true });
      continue;
    }
    let attempt = 0;
    const maxAttempts = 4;
    while (true) {
      try {
        process.stderr.write(`[${seg.index + 1}/${segments.length}] (${seg.text.length} chars) ... `);
        const t0 = Date.now();
        await generateOne(voiceId, apiKey, seg.text, mp3, json);
        const t = ((Date.now() - t0) / 1000).toFixed(1);
        process.stderr.write(`ok ${t}s\n`);
        break;
      } catch (e) {
        attempt += 1;
        process.stderr.write(`FAIL: ${e.message}\n`);
        if (attempt >= maxAttempts) throw e;
        const backoff = 2000 * attempt;
        process.stderr.write(`retrying in ${backoff}ms (attempt ${attempt + 1}/${maxAttempts})\n`);
        await sleep(backoff);
      }
    }
    index.push({ index: seg.index, text: seg.text, mp3: `${name}.mp3`, json: `${name}.json` });
    await sleep(200);
  }
  fs.writeFileSync(path.join(outDir, 'index.json'), JSON.stringify(index, null, 2));
  console.log(`Generated ${segments.length} segments -> ${outDir}`);
}

main().catch((e) => { console.error(e.stack || e.message); process.exit(1); });
