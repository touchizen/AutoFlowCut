/**
 * electron/api/youtube/transcriptParse.js
 *
 * yt-dlp가 취득한 자막 파일(srv3 XML / WebVTT)을 파싱하는 순수 함수 (spec §3.2).
 * DOM·Electron·yt-dlp 의존 0 — 문자열 입력만. Node 단위테스트로 회귀 고정.
 *
 * yt-dlp 자막 포맷:
 *  - srv3(`<timedtext format="3">`): 수동은 `<p t d>텍스트</p>`, 자동생성은
 *    `<p t d><s ac>단어</s><s t>단어</s></p>` + 빈 append `<p t d a="1">\n</p>`.
 *  - vtt(WebVTT): `HH:MM:SS.mmm --> HH:MM:SS.mmm` cue 블록.
 *
 * 공통 세그먼트 계약: { start:<ms>, dur:<ms>, text:<string> }.
 */

/** XML/HTML 엔티티 디코드 (&#39; &amp; 등). */
function decodeEntities(text) {
  return String(text)
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
}

const collapse = (s) => decodeEntities(s).replace(/\s+/g, ' ').trim()

/** srv3(`<timedtext format="3">`) → 세그먼트. */
export function parseSrv3(xml) {
  if (typeof xml !== 'string' || xml.indexOf('<timedtext') === -1) return []
  const segments = []
  const pRe = /<p\b([^>]*)>([\s\S]*?)<\/p>/g
  let m
  while ((m = pRe.exec(xml))) {
    const attrs = m[1]
    const inner = m[2]
    const tMatch = attrs.match(/\bt="(-?\d+)"/)
    const dMatch = attrs.match(/\bd="(\d+)"/)
    const start = tMatch ? Number(tMatch[1]) : 0
    const dur = dMatch ? Number(dMatch[1]) : 0
    // <s> 조각이 있으면 join, 없으면 p 직접 텍스트
    let text
    if (inner.indexOf('<s') !== -1) {
      const segTexts = []
      const sRe = /<s\b[^>]*>([\s\S]*?)<\/s>/g
      let sm
      while ((sm = sRe.exec(inner))) segTexts.push(sm[1])
      text = collapse(segTexts.join(''))
    } else {
      text = collapse(inner)
    }
    if (text) segments.push({ start, dur, text })
  }
  return segments
}

/** `HH:MM:SS.mmm` → ms. */
function vttTimeToMs(ts) {
  const m = String(ts).trim().match(/(?:(\d+):)?(\d{1,2}):(\d{2})[.,](\d{1,3})/)
  if (!m) return null
  const h = Number(m[1] || 0)
  const min = Number(m[2])
  const s = Number(m[3])
  const ms = Number(m[4].padEnd(3, '0'))
  return ((h * 60 + min) * 60 + s) * 1000 + ms
}

/** WebVTT → 세그먼트. */
export function parseVtt(vtt) {
  if (typeof vtt !== 'string' || vtt.indexOf('WEBVTT') === -1) return []
  const segments = []
  const blocks = vtt.replace(/\r/g, '').split(/\n\n+/)
  for (const block of blocks) {
    const lines = block.split('\n')
    const cueLine = lines.find((l) => l.indexOf('-->') !== -1)
    if (!cueLine) continue
    const [rawStart, rawEnd] = cueLine.split('-->')
    const start = vttTimeToMs(rawStart)
    const end = vttTimeToMs(rawEnd)
    if (start == null || end == null) continue
    const textLines = lines.slice(lines.indexOf(cueLine) + 1)
    const text = collapse(textLines.join(' ').replace(/<[^>]+>/g, '')) // inline 타이밍 태그 제거
    if (text) segments.push({ start, dur: Math.max(0, end - start), text })
  }
  return segments
}

/**
 * 포맷 자동 분기: 명시 hint(srv3/json3/vtt) 또는 내용 스니핑.
 * (json3는 yt-dlp가 srv3 우선이라 이번 슬라이스 미지원 — 필요 시 추가)
 */
export function parseSubtitle(content, formatHint) {
  if (typeof content !== 'string' || !content.trim()) return []
  const hint = (formatHint || '').toLowerCase()
  if (hint === 'srv3' || hint === 'srv1' || hint === 'xml') return parseSrv3(content)
  if (hint === 'vtt' || hint === 'webvtt') return parseVtt(content)
  if (content.indexOf('WEBVTT') !== -1) return parseVtt(content)
  if (content.indexOf('<timedtext') !== -1) return parseSrv3(content)
  return []
}

/** 초 → `HH:MM:SS,mmm` (SRT 콤마 소수점). */
export function msToSrtTime(ms) {
  const clamped = Math.max(0, Math.round(ms))
  const pad = (n, w = 2) => String(n).padStart(w, '0')
  const h = Math.floor(clamped / 3600000)
  const m = Math.floor((clamped % 3600000) / 60000)
  const s = Math.floor((clamped % 60000) / 1000)
  return `${pad(h)}:${pad(m)}:${pad(s)},${pad(clamped % 1000, 3)}`
}

/** 세그먼트 → SRT. dur 없으면 다음 시작(마지막 +3초)으로 보정. */
export function segmentsToSrt(segments) {
  if (!Array.isArray(segments) || segments.length === 0) return ''
  return segments
    .map((seg, i) => {
      const end =
        seg.dur != null && seg.dur > 0
          ? seg.start + seg.dur
          : segments[i + 1]
            ? segments[i + 1].start
            : seg.start + 3000
      return `${i + 1}\n${msToSrtTime(seg.start)} --> ${msToSrtTime(end)}\n${seg.text}\n`
    })
    .join('\n')
}

/** 세그먼트 → 평문. */
export function segmentsToPlainText(segments) {
  if (!Array.isArray(segments)) return ''
  return segments
    .map((s) => (s.text || '').trim())
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
}
