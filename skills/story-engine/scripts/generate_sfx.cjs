// generate_sfx.cjs — ElevenLabs sound-generation API for the SFX manifest.
// Usage: node generate_sfx.cjs <sfxManifest.json> <outDir>
// sfxManifest.json schema: [{num, part, filename, prompt, duration}]
'use strict';

const fs = require('fs');
const path = require('path');
const { readApiKey, httpsRequest, sleep } = require('./lib_afc.cjs');

async function generateOne(apiKey, prompt, duration, outMp3) {
  const body = JSON.stringify({
    text: prompt,
    duration_seconds: Math.max(1, Math.min(22, duration || 4)),
    prompt_influence: 0.6,
  });
  const res = await httpsRequest({
    method: 'POST',
    pathUrl: '/v1/sound-generation',
    headers: {
      'xi-api-key': apiKey,
      'Content-Type': 'application/json',
      'Accept': 'audio/mpeg',
    },
    body,
    timeoutMs: 180000,
  });
  if (res.statusCode !== 200) {
    const snippet = res.buffer.toString('utf8').slice(0, 300);
    throw new Error(`SFX ${res.statusCode}: ${snippet}`);
  }
  fs.writeFileSync(outMp3, res.buffer);
}

async function main() {
  const [, , manifestPath, outDir] = process.argv;
  if (!manifestPath || !outDir) {
    console.error('usage: node generate_sfx.cjs <manifest.json> <outDir>');
    process.exit(2);
  }
  fs.mkdirSync(outDir, { recursive: true });
  const apiKey = readApiKey();
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const existing = new Set(fs.readdirSync(outDir));
  let done = 0;
  for (const cue of manifest) {
    const out = path.join(outDir, `${cue.filename}.mp3`);
    if (existing.has(`${cue.filename}.mp3`)) { done += 1; continue; }
    let attempt = 0;
    while (true) {
      try {
        process.stderr.write(`[${cue.num}] ${cue.filename} (${cue.duration}s) ... `);
        await generateOne(apiKey, cue.prompt, cue.duration, out);
        process.stderr.write('ok\n');
        break;
      } catch (e) {
        attempt += 1;
        process.stderr.write(`FAIL ${e.message}\n`);
        if (attempt >= 3) throw e;
        await sleep(2000 * attempt);
      }
    }
    done += 1;
    await sleep(300);
  }
  console.log(`Generated ${done}/${manifest.length} SFX -> ${outDir}`);
}

main().catch((e) => { console.error(e.stack || e.message); process.exit(1); });
