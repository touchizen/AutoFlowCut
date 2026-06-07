const sharp = require('sharp');
const path = require('path');
const fs = require('fs');

const FONT_SIZE = 64;
const CAPTION_HEIGHT = 120;

const screenshots = [
  { file: '스크린샷 2026-06-06 202752.png', caption: 'Build a full video timeline from AI-generated scenes, audio, and subtitles' },
  { file: '스크린샷 2026-06-06 203328.png', caption: 'Generate every scene in sequence with one guided workflow' },
  { file: '스크린샷 2026-06-06 203345.png', caption: 'Review prompts, media, and status across the entire project' },
  { file: '스크린샷 2026-06-06 203401.png', caption: 'Select only the scenes you need and start batch generation instantly' },
  { file: '스크린샷 2026-06-06 203415.png', caption: 'Keep characters consistent with reusable reference images' },
  { file: '스크린샷 2026-06-06 203424.png', caption: 'Import scripts, scene CSV files, references, subtitles, and audio packages' },
  { file: '스크린샷 2026-06-06 203438.png', caption: 'Export ready-to-edit CapCut projects with subtitles and Ken Burns motion' },
  { file: '스크린샷 2026-06-06 203531.png', caption: 'Preview long-form stories with synchronized timeline tracks' },
  { file: '스크린샷 2026-06-06 203550.png', caption: 'Scale production with many scenes, references, and generated media' },
  { file: '스크린샷 2026-06-06 203713.png', caption: 'Open the exported project directly in CapCut for final editing' },
];

function splitToLines(text, fontSize, maxWidth) {
  const charW = (ch) => /[\u3000-\u9fff\uac00-\ud7af]/.test(ch) ? fontSize * 0.9 : fontSize * 0.55;
  const totalW = [...text].reduce((sum, ch) => sum + charW(ch), 0);
  if (totalW <= maxWidth) return [text];

  const mid = Math.floor(text.length / 2);
  let splitAt = mid;
  for (let d = 0; d < mid; d++) {
    if (text[mid + d] === ' ') { splitAt = mid + d; break; }
    if (text[mid - d] === ' ') { splitAt = mid - d; break; }
  }
  return [text.slice(0, splitAt).trim(), text.slice(splitAt).trim()];
}

async function addCaption(inputFile, caption, outputFile) {
  const meta = await sharp(inputFile).metadata();
  let imgWidth = meta.width;
  let imgHeight = meta.height;

  if (imgWidth === 3839) imgWidth = 3840;
  if (imgHeight === 2159) imgHeight = 2160;

  const imgBuffer = await sharp(inputFile).resize(imgWidth, imgHeight, { fit: 'fill' }).png().toBuffer();
  const escaped = caption.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  const scale = imgWidth > 2500 ? 2 : 1;
  const fontSize = FONT_SIZE * scale;
  const maxTextWidth = imgWidth - 80 * scale;
  const lines = splitToLines(escaped, fontSize, maxTextWidth);
  const lineCount = lines.length;

  const lineHeight = fontSize * 1.4;
  const captionH = Math.max(CAPTION_HEIGHT, (lineCount * lineHeight + fontSize * 0.8)) | 0;
  const strokeW = Math.max(2, (fontSize / 16) | 0);
  const shadowStd = Math.max(2, (fontSize / 16) | 0);
  const shadowDx = Math.max(2, (fontSize / 20) | 0);

  const textElements = lines.map((line, i) => {
    const y = captionH / 2 + (i - (lineCount - 1) / 2) * lineHeight;
    return `<text x="50%" y="${y}"
            font-family="Pretendard, Segoe UI, Arial, sans-serif"
            font-size="${fontSize}"
            font-weight="800"
            text-anchor="middle"
            dominant-baseline="central"
            filter="url(#shadow)"
            stroke="black"
            stroke-width="${strokeW}"
            stroke-linejoin="round"
            paint-order="stroke"
            fill="#FFD700">${line}</text>`;
  }).join('\n      ');

  const overlaySvg = `
    <svg width="${imgWidth}" height="${captionH}">
      <defs>
        <filter id="shadow" x="-10%" y="-10%" width="120%" height="120%">
          <feDropShadow dx="${shadowDx}" dy="${shadowDx}" stdDeviation="${shadowStd}" flood-color="black" flood-opacity="0.8"/>
        </filter>
      </defs>
      <rect width="100%" height="100%" fill="rgba(0,0,0,0.6)"/>
      ${textElements}
    </svg>`;

  await sharp(imgBuffer)
    .composite([{ input: Buffer.from(overlaySvg), top: imgHeight - captionH, left: 0 }])
    .png()
    .toFile(outputFile);

  const lineLabel = lineCount > 1 ? ` (${lineCount} lines)` : '';
  console.log(`${path.basename(outputFile)} (${imgWidth}x${imgHeight})${lineLabel}`);
}

async function main() {
  const dir = __dirname;
  const outDir = path.join(dir, 'captioned');
  fs.mkdirSync(outDir, { recursive: true });

  for (const f of fs.readdirSync(outDir)) {
    if (/^\d{2}_.+\.png$/i.test(f)) {
      fs.unlinkSync(path.join(outDir, f));
    }
  }

  for (let i = 0; i < screenshots.length; i++) {
    const s = screenshots[i];
    const inputFile = path.join(dir, s.file);
    const outputFile = path.join(outDir, `${String(i + 1).padStart(2, '0')}_${s.file}`);
    await addCaption(inputFile, s.caption, outputFile);
  }

  console.log(`\nDone! ${screenshots.length} captioned screenshots saved to: ${outDir}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
