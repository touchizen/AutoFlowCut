// Convert captioned PNGs to JPG (resized) and copy to a landing destination.
//
// Usage:
//   node docs/ms-store/screenshots/convert-to-landing.cjs [outDir]
//
// Resolution order for output dir:
//   1. CLI arg (process.argv[2])
//   2. LANDING_SCREENSHOT_DIR env var
//   3. ../../../../touchizen.github.io/landing/public/images/autoflowcut/screenshots (default — original local layout)
//
// Resolution order for sharp:
//   1. require('sharp') from project (root or screenshots/en/node_modules)
//   2. throws if not installed
//
// Behavior changes vs prior one-shot version:
//   - Throws (not warns) if locale dir doesn't have exactly EXPECTED_FILES files.
//   - Cleans matching ss_NN.jpg files in outDir before writing to avoid stale outputs.
const path = require('path');
const fs = require('fs');

let sharp;
try {
  sharp = require('sharp');
} catch {
  // Fallback: local install in this script's en/node_modules (legacy layout).
  sharp = require('./en/node_modules/sharp');
}

const TARGET_WIDTH = 1920;
const JPG_QUALITY = 85;
const EXPECTED_FILES = 10;

const here = __dirname;
const defaultLandingDest = path.join(here, '..', '..', '..', '..', 'touchizen.github.io', 'landing', 'public', 'images', 'autoflowcut', 'screenshots');
const landingDest = process.argv[2] || process.env.LANDING_SCREENSHOT_DIR || defaultLandingDest;

function listOrdered(dir) {
  return fs.readdirSync(dir)
    .filter(f => /^\d{2}_/.test(f) && f.toLowerCase().endsWith('.png'))
    .sort(); // already prefixed 01_ ~ 10_ → sorts lexically into correct order
}

function cleanStaleOutputs(outDir) {
  if (!fs.existsSync(outDir)) return;
  for (const f of fs.readdirSync(outDir)) {
    if (/^ss_\d{2}\.jpg$/i.test(f)) {
      fs.unlinkSync(path.join(outDir, f));
    }
  }
}

async function convert(srcDir, outDir, label) {
  if (!fs.existsSync(srcDir)) {
    throw new Error(`[${label}] source dir not found: ${srcDir}`);
  }
  // Validate source FIRST — throwing must not have already deleted prior outputs.
  const files = listOrdered(srcDir);
  if (files.length !== EXPECTED_FILES) {
    throw new Error(`[${label}] expected ${EXPECTED_FILES} files, got ${files.length} in ${srcDir}`);
  }
  // Now safe to mutate destination.
  fs.mkdirSync(outDir, { recursive: true });
  cleanStaleOutputs(outDir);
  for (let i = 0; i < files.length; i++) {
    const src = path.join(srcDir, files[i]);
    const out = path.join(outDir, `ss_${String(i + 1).padStart(2, '0')}.jpg`);
    const meta = await sharp(src).metadata();
    const resizeWidth = meta.width > TARGET_WIDTH ? TARGET_WIDTH : meta.width;
    await sharp(src)
      .resize({ width: resizeWidth, withoutEnlargement: true })
      .jpeg({ quality: JPG_QUALITY, mozjpeg: true })
      .toFile(out);
    const { size } = fs.statSync(out);
    console.log(`[${label}] ss_${String(i + 1).padStart(2, '0')}.jpg  (${(size / 1024).toFixed(0)}KB)  <- ${files[i]}`);
  }
}

async function main() {
  console.log(`Output dir: ${landingDest}`);
  await convert(
    path.join(here, 'en', 'captioned'),
    path.join(landingDest, 'en'),
    'EN'
  );
  await convert(
    path.join(here, 'ko', 'captioned'),
    path.join(landingDest, 'ko'),
    'KO'
  );
  console.log('\nDone.');
}

main().catch(e => { console.error(e); process.exit(1); });
