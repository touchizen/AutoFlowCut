// Generate multi-size .ico from assets/icon.png
// Sizes: 16, 24, 32, 48, 64, 128, 256 (standard Windows icon sizes)
// Run: node scripts/make-ico.cjs
const sharp = require('sharp');
const pngToIco = require('png-to-ico').default || require('png-to-ico');
const fs = require('fs');
const path = require('path');

const srcPng = path.join(__dirname, '..', 'assets', 'icon.png');
const outIco = path.join(__dirname, '..', 'assets', 'icon.ico');
const sizes = [16, 24, 32, 48, 64, 128, 256];

(async () => {
  console.log(`Source: ${srcPng}`);
  console.log(`Target: ${outIco}`);
  console.log(`Sizes:  ${sizes.join(', ')}`);

  const buffers = await Promise.all(
    sizes.map((size) =>
      sharp(srcPng)
        .resize(size, size, { kernel: 'lanczos3', fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
        .png()
        .toBuffer()
    )
  );

  const icoBuf = await pngToIco(buffers);
  fs.writeFileSync(outIco, icoBuf);
  console.log(`✓ Wrote ${icoBuf.length} bytes to ${outIco}`);
})();
