// 순수 .ass 생성. 스펙 §4.4. offsetMs 차감(세그먼트 리베이스) + [0) clamp.
export function msToAssTime(ms) {
  const totalCs = Math.round(ms / 10)
  const cs = totalCs % 100
  const totalSec = Math.floor(totalCs / 100)
  const s = totalSec % 60
  const m = Math.floor(totalSec / 60) % 60
  const h = Math.floor(totalSec / 3600)
  const p2 = (n) => String(n).padStart(2, '0')
  return `${h}:${p2(m)}:${p2(s)}.${p2(cs)}`
}

export function escapeAssText(s) {
  return String(s)
    .replace(/\\/g, '\\\\')
    .replace(/\{/g, '\\{')
    .replace(/\}/g, '\\}')
    .replace(/\r?\n/g, '\\N')
}

export function assFontsize({ subtitleFontSize = 8, outputHeight = 1080 }) {
  return Math.round(subtitleFontSize * outputHeight / 100)
}

function assHeader({ outputWidth, outputHeight, subtitleFontSize }) {
  const fs = assFontsize({ subtitleFontSize, outputHeight })
  return [
    '[Script Info]',
    'ScriptType: v4.00+',
    `PlayResX: ${outputWidth}`,
    `PlayResY: ${outputHeight}`,
    '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, OutlineColour, BackColour, Bold, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    `Style: Default,Noto Sans KR,${fs},&H00FFFFFF,&H00000000,&H80000000,0,2,1,2,40,40,60,1`,
    '',
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
  ].join('\n')
}

export function buildAss(entries, { subtitleFontSize = 8, outputWidth = 1080, outputHeight = 1920, offsetMs = 0 } = {}) {
  const lines = [assHeader({ outputWidth, outputHeight, subtitleFontSize })]
  for (const e of (entries || [])) {
    const start = Number(e.startMs)
    const end = Number(e.endMs)
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) continue
    const rebasedStart = start - offsetMs
    const rebasedEnd = end - offsetMs
    if (rebasedEnd <= 0) continue                 // fully before window
    const clampedStart = Math.max(0, rebasedStart)
    lines.push(
      `Dialogue: 0,${msToAssTime(clampedStart)},${msToAssTime(rebasedEnd)},Default,,0,0,0,,${escapeAssText(e.text)}`
    )
  }
  return lines.join('\n') + '\n'
}
