const sharp = require('../en/node_modules/sharp');
const path = require('path');
const fs = require('fs');

const BG_COLOR = { r: 24, g: 24, b: 32, alpha: 1 };
const FONT_SIZE = 64;
const CAPTION_HEIGHT = 120;

const screenshots = [
  { file: '스크린샷 2026-03-23 213908.png', caption: '원클릭 CapCut 내보내기 — 씬이 바로 편집 가능한 영상 프로젝트로' },
  { file: '스크린샷 2026-03-24 101534.png', caption: '타임라인 기반 오디오 & 비디오 미리보기' },
  { file: '스크린샷 2026-03-23 232121.png', caption: '자막, 타임코드, 미디어를 한 화면에서 씬 관리' },
  { file: '스크린샷 2026-03-23 232156.png', caption: 'AI 기반 배치 영상 생성 — F2V로 모든 씬을 영상으로' },
  { file: '스크린샷 2026-03-23 232229.png', caption: '레퍼런스 이미지로 캐릭터 비주얼 일관성 유지' },
  { file: '스크린샷 2026-03-23 232246.png', caption: '생성된 모든 이미지와 영상이 내 PC에 자동 저장' },
  { file: '스크린샷 2026-03-23 232825.png', caption: 'AI 생성 이미지와 프롬프트를 한눈에 확인' },
  { file: '스크린샷 2026-03-24 094442.png', caption: 'MCP 서버 연동 — Claude AI로 워크플로우 자동화' },
  { file: '스크린샷 2026-03-24 095609.png', caption: 'Claude AI가 씬 생성부터 CapCut 내보내기까지 자동화' },
  { file: '스크린샷 2026-03-24 095828.png', caption: '80가지 이상의 아트 스타일 프리셋 제공' },
];

function splitToLines(text, fontSize, maxWidth) {
  // Korean chars are wider (~0.9 * fontSize)
  const charW = (ch) => /[\u3000-\u9fff\uac00-\ud7af]/.test(ch) ? fontSize * 0.9 : fontSize * 0.55;
  const totalW = [...text].reduce((sum, ch) => sum + charW(ch), 0);
  if (totalW <= maxWidth) return [text];

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
  const shadowDy = shadowDx;

  const textElements = lines.map((line, i) => {
    const y = captionH / 2 + (i - (lineCount - 1) / 2) * lineHeight;
    return `<text x="50%" y="${y}"
            font-family="Pretendard, Malgun Gothic, Segoe UI, Arial, sans-serif"
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
          <feDropShadow dx="${shadowDx}" dy="${shadowDy}" stdDeviation="${shadowStd}" flood-color="black" flood-opacity="0.8"/>
        </filter>
      </defs>
      <rect width="100%" height="100%" fill="rgba(0,0,0,0.6)"/>
      ${textElements}
    </svg>`;

  const overlayBuffer = Buffer.from(overlaySvg);

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
  const srcDir = path.join(__dirname, '..', 'en');
  const outDir = path.join(__dirname, 'captioned');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir);

  for (let i = 0; i < screenshots.length; i++) {
    const s = screenshots[i];
    const inputFile = path.join(srcDir, s.file);
    const outputFile = path.join(outDir, `${String(i + 1).padStart(2, '0')}_${s.file}`);
    await addCaption(inputFile, s.caption, outputFile);
  }

  console.log(`\nDone! ${screenshots.length} captioned screenshots saved to: ${outDir}`);
}

main().catch(console.error);
