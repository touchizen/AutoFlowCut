const sharp = require('sharp');
const path = require('path');
const fs = require('fs');

const BG_COLOR = { r: 24, g: 24, b: 32, alpha: 1 };
const FONT_SIZE = 64;
const CAPTION_HEIGHT = 120;
const STROKE_WIDTH = 4;

const screenshots = [
  { file: '스크린샷 2026-03-23 213908.png', caption: 'One-click export to CapCut — your scenes become a ready-to-edit video project' },
  { file: '스크린샷 2026-03-24 101534.png', caption: 'Built-in audio & video preview with timeline for precise editing' },
  { file: '스크린샷 2026-03-23 232121.png', caption: 'Manage scenes with subtitles, timecodes, and media in one unified view' },
  { file: '스크린샷 2026-03-23 232156.png', caption: 'AI-powered batch video generation — bring every scene to life with F2V' },
  { file: '스크린샷 2026-03-23 232229.png', caption: 'Reference image system for consistent character visuals across scenes' },
  { file: '스크린샷 2026-03-23 232246.png', caption: 'All generated images and videos are auto-saved to your PC' },
  { file: '스크린샷 2026-03-23 232825.png', caption: 'Full scene overview with AI-generated images and detailed prompts' },
  { file: '스크린샷 2026-03-24 094442.png', caption: 'MCP server integration — connect Claude AI for automated workflows' },
  { file: '스크린샷 2026-03-24 095609.png', caption: 'Claude AI assistant automates scene creation and CapCut export' },
  { file: '스크린샷 2026-03-24 095828.png', caption: '80+ art style presets — from animation to cinematic photography' },
];

function splitToLines(text, fontSize, maxWidth) {
  const charW = fontSize * 0.55;
  const totalW = text.length * charW;
  if (totalW <= maxWidth) return [text];

  // Split at — or nearest space to midpoint
  const dashIdx = text.indexOf(' — ');
  if (dashIdx > 0) {
    return [text.slice(0, dashIdx), text.slice(dashIdx + 3)];
  }
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

  // Resize 3839 → 3840, 2159 → 2160 (fix odd pixels)
  if (imgWidth === 3839) imgWidth = 3840;
  if (imgHeight === 2159) imgHeight = 2160;

  const imgBuffer = await sharp(inputFile).resize(imgWidth, imgHeight, { fit: 'fill' }).png().toBuffer();
  const escaped = caption.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  // Scale font for high-res images (2x for ~3840 width)
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
  const shadowDy = shadowDx;

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

  // Semi-transparent overlay band
  const overlaySvg = `
    <svg width="${imgWidth}" height="${captionH}">
      <defs>
        <filter id="shadow" x="-10%" y="-10%" width="120%" height="120%">
          <feDropShadow dx="${shadowDx}" dy="${shadowDy}" stdDeviation="${shadowStd}" flood-color="black" flood-opacity="0.8"/>
        </filter>
      </defs>
      <rect width="100%" height="100%" fill="rgba(0,0,0,0.6)"/>
      ${textElements}
    </svg>`;

  const overlayBuffer = Buffer.from(overlaySvg);

  // Same size as original, overlay on bottom
  await sharp(imgBuffer)
    .composite([
      { input: overlayBuffer, top: imgHeight - captionH, left: 0 },
    ])
    .png()
    .toFile(outputFile);

  const lineLabel = lineCount > 1 ? ` (${lineCount} lines)` : '';
  console.log(`✓ ${path.basename(outputFile)} (${imgWidth}x${imgHeight})${lineLabel}`);
}

async function main() {
  const dir = __dirname;
  const outDir = path.join(dir, 'captioned');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir);

  for (let i = 0; i < screenshots.length; i++) {
    const s = screenshots[i];
    const inputFile = path.join(dir, s.file);
    const outputFile = path.join(outDir, `${String(i + 1).padStart(2, '0')}_${s.file}`);
    await addCaption(inputFile, s.caption, outputFile);
  }

  console.log(`\nDone! ${screenshots.length} captioned screenshots saved to: ${outDir}`);
}

main().catch(console.error);
