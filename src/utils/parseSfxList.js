/**
 * parseSfxList - W4-3 산출물 `08_sfx_list.md` / `08_sfx_목록.md` markdown table 파서
 *
 * 입력: markdown 문자열
 * 출력: Map<filename_stem, metadata>
 *   - filename_stem: `Filename` 컬럼 값 그대로 (e.g. "01_bell_toll", "01_주판_구슬_튕기기")
 *     디스크의 `media/sfx/<stem>_<MMSS>.mp3`에서 마지막 `_NNNN` 제거한 stem과 일치
 *   - metadata: { cueNo, partName, anchor, placement, offsetSec, prompt, durationSec }
 *
 * 컬럼 순서 (W4-3 spec 고정, 한/영 동일):
 *   # | Part/파트 | Filename/파일명 | Anchor/앵커 | Placement/배치 |
 *   Offset/오프셋 | English prompt/영문 프롬프트 | Duration/길이
 *
 * 관용성 (tolerance):
 *   - header separator row (`|---|---|`) 스킵
 *   - header row 자체 스킵 (cueNo가 NaN이고 filename이 "Filename" 등 라벨이면)
 *   - 빈 줄 / 표 외부 prose 스킵
 *   - Filename 셀이 빈 row 스킵 (warning 로깅)
 *   - offset/duration NaN → 0
 *   - 절대 throw 하지 않음 — 파싱 실패는 빈 Map / 부분 Map 반환
 */

/**
 * 한 줄이 markdown 표 row인지 (`|` 로 시작/끝) 검사 후 셀로 분리
 * @param {string} line
 * @returns {string[] | null} trim된 셀 배열, 표 row 아니면 null
 */
function splitRow(line) {
  const trimmed = line.trim()
  if (!trimmed.startsWith('|') || !trimmed.endsWith('|')) return null
  // 양쪽 끝 `|`를 떼어내고 `|`로 split, 각 셀 trim
  const inner = trimmed.slice(1, -1)
  return inner.split('|').map(c => c.trim())
}

/**
 * 셀이 separator 패턴인지 (e.g. `---`, `:---:`, `:--`, `--:`) 검사
 * @param {string} cell
 */
function isSeparatorCell(cell) {
  return /^:?-{3,}:?$/.test(cell)
}

/**
 * 앵커 셀에서 양 끝 따옴표 제거 (직따옴표/스마트따옴표)
 * @param {string} s
 */
function stripQuotes(s) {
  if (!s) return ''
  // 짝 잘 맞는 경우만 제거 — 짝 안맞으면 그대로
  const pairs = [
    ['"', '"'],
    ["'", "'"],
    ['“', '”'], // smart double
    ['‘', '’'], // smart single
  ]
  for (const [open, close] of pairs) {
    if (s.length >= 2 && s.startsWith(open) && s.endsWith(close)) {
      return s.slice(1, -1)
    }
  }
  return s
}

/**
 * 숫자 파싱 — NaN 시 fallback (default 0)
 * @param {string} s
 * @param {number} fallback
 */
function toNumber(s, fallback = 0) {
  if (s == null || s === '') return fallback
  const n = Number(s)
  return Number.isFinite(n) ? n : fallback
}

/**
 * W4-3 `08_sfx_list.md` / `08_sfx_목록.md` 파싱
 * @param {string | null | undefined} mdText
 * @returns {Map<string, {cueNo: number|null, partName: string, anchor: string,
 *                       placement: string, offsetSec: number, prompt: string,
 *                       durationSec: number}>}
 */
export function parseSfxList(mdText) {
  const result = new Map()
  if (!mdText || typeof mdText !== 'string') return result

  const lines = mdText.split(/\r?\n/)
  for (const line of lines) {
    const cells = splitRow(line)
    if (!cells) continue
    // separator row: 모든 셀이 `---` 패턴
    if (cells.every(isSeparatorCell)) continue
    // 컬럼 수가 8개 미만이면 W4-3 스펙 행 아님 → skip
    if (cells.length < 8) continue

    const [cueRaw, partRaw, fileRaw, anchorRaw, placementRaw,
      offsetRaw, promptRaw, durationRaw] = cells

    const filename = (fileRaw || '').trim()
    if (!filename) {
      // Filename 셀이 비어있는 row → 정보 없으므로 skip + 경고
      console.warn('[parseSfxList] row skipped — missing Filename cell:', line.trim())
      continue
    }

    // Header row 탐지: cueNo가 NaN이고 filename이 "Filename" 또는 "파일명" 같은 라벨
    const cueNoNum = Number(cueRaw)
    const isHeaderLike = !Number.isFinite(cueNoNum) &&
      /^(#|filename|파일명)$/i.test(filename)
    if (isHeaderLike) continue

    result.set(filename, {
      cueNo: Number.isFinite(cueNoNum) ? cueNoNum : null,
      partName: (partRaw || '').trim(),
      anchor: stripQuotes((anchorRaw || '').trim()),
      placement: (placementRaw || '').trim(),
      offsetSec: toNumber(offsetRaw, 0),
      prompt: (promptRaw || '').trim(),
      durationSec: toNumber(durationRaw, 0),
    })
  }

  return result
}
