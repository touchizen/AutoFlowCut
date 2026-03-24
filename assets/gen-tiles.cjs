const sharp = require('../docs/ms-store/screenshots/en/node_modules/sharp');
const path = require('path');

const sizes = [300, 150, 71];
const src = path.join(__dirname, 'icon.png');

async function main() {
  for (const s of sizes) {
    const out = path.join(__dirname, `icon_${s}x${s}.png`);
    await sharp(src)
      .resize(s, s, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png()
      .toFile(out);
    console.log(`✓ icon_${s}x${s}.png`);
  }
}

main().catch(console.error);
