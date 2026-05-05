// One-shot: convert captioned PNGs to JPG (resized) and copy to landing repo.
// Run from project root:  node docs/ms-store/screenshots/convert-to-landing.cjs
const sharp = require('./en/node_modules/sharp');
const path = require('path');
const fs = require('fs');

const TARGET_WIDTH = 1920;
const JPG_QUALITY = 85;

const here = __dirname;
const landingDest = path.join(here, '..', '..', '..', '..', 'touchizen.github.io', 'landing', 'public', 'images', 'autoflowcut', 'screenshots');

function listOrdered(dir) {
  return fs.readdirSync(dir)
    .filter(f => /^\d{2}_/.test(f) && f.toLowerCase().endsWith('.png'))
    .sort(); // already prefixed 01_ ~ 10_ → sorts lexically into correct order
}

async function convert(srcDir, outDir, label) {
  fs.mkdirSync(outDir, { recursive: true });
  const files = listOrdered(srcDir);
  if (files.length !== 10) {
    console.warn(`[${label}] expected 10 files, got ${files.length}`);
  }
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
