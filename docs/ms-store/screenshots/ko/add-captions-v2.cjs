const sharp = require('../en/node_modules/sharp');
const path = require('path');
const fs = require('fs');

const FONT_SIZE = 64;
const CAPTION_HEIGHT = 120;

const screenshots = [
  { file: '스크린샷 2026-06-06 200125.png', caption: '긴 영상도 장면, 음성, 자막을 한 타임라인에서 확인' },
  { file: '스크린샷 2026-06-06 200142.png', caption: 'AI 장면 생성부터 영상 편집 준비까지 한 번에' },
  { file: '스크린샷 2026-06-06 200205.png', caption: '프로젝트 전체의 프롬프트, 미디어, 생성 상태를 한눈에 관리' },
  { file: '스크린샷 2026-06-06 200217.png', caption: '이미지 100장도 2~5분 안에 빠르게 대량 생성' },
  { file: '스크린샷 2026-06-06 200302.png', caption: '생성 결과와 타임코드를 보며 장면별 품질을 검토' },
  { file: '스크린샷 2026-06-06 200318.png', caption: '대본, CSV, 레퍼런스, 자막, 오디오 패키지를 손쉽게 가져오기' },
  { file: '스크린샷 2026-06-06 200337.png', caption: '자막과 Ken Burns 효과가 포함된 CapCut 프로젝트로 내보내기' },
  { file: '스크린샷 2026-06-06 200413.png', caption: '장면 목록에서 스토리 흐름과 생성 결과를 빠르게 점검' },
  { file: '스크린샷 2026-06-09 121016.png', caption: '이미지 프롬프트에서 @멘션으로 캐릭터 레퍼런스 삽입' },
  { file: '스크린샷 2026-06-06 201227.png', caption: '내보낸 프로젝트를 CapCut에서 열어 바로 최종 편집' },
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
