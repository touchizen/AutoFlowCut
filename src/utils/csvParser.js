/**
 * Shared RFC-style CSV parser — review R7 fix.
 *
 * 기존 parsers.js 의 parseCSVLine 은 line-split 후 단순 quote toggle 만 해서
 *   - escaped double quote (`""`) 를 literal `"` 로 처리 못 함
 *   - quoted multiline field 가 line split 에서 깨짐
 *   - CRLF 도 line split 의존
 *
 * mcp-server/lib/csv.js 의 parseCSV 와 동등한 character-stream RFC parser 를
 * 공통화해서 renderer 의 새 형식 CSV 경로도 같은 동작 보장.
 */

/**
 * CSV 텍스트를 2차원 배열로 파싱 (RFC 4180 호환).
 *
 * @param {string} text — CSV 텍스트
 * @returns {string[][]} 행 × 열 배열
 */
export function parseCSVText(text) {
  if (!text) return []
  const rows = []
  let fields = []
  let current = ''
  let inQuotes = false

  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (ch === '"') {
      if (inQuotes && text[i + 1] === '"') {
        // escaped double quote → literal "
        current += '"'
        i++
      } else {
        inQuotes = !inQuotes
      }
    } else if (ch === ',' && !inQuotes) {
      fields.push(current)
      current = ''
    } else if ((ch === '\n' || ch === '\r') && !inQuotes) {
      if (ch === '\r' && text[i + 1] === '\n') i++ // CRLF
      fields.push(current)
      current = ''
      if (fields.length > 0) {
        rows.push(fields)
        fields = []
      }
    } else {
      current += ch
    }
  }
  // R23 review fix: 마지막 행 처리 일관성. 옛 로직 `fields.some(f => f.length > 0)`
  // 는 끝 행이 ',,' (모두 빈 컬럼) 일 때 drop 했지만, 동일 내용이 '\n' 으로 끝나면
  // 메인 루프가 push 함 — 뉴라인 유무로 행 수가 달라짐. 새 가드: 다중 컬럼 (>=2)
  // 이거나 단일 필드라도 내용 있으면 유효. 단일 빈 필드만 trailing newline 잔여로
  // drop.
  fields.push(current)
  if (fields.length > 1 || (fields.length === 1 && fields[0].length > 0)) {
    rows.push(fields)
  }
  return rows
}

/**
 * CSV 텍스트 → { headers, rows } (row objects, header → value).
 * BOM 제거.
 *
 * @param {string} text
 * @returns {{ headers: string[], rows: object[] }}
 */
export function parseCSVTextToRows(text) {
  if (!text) return { headers: [], rows: [] }
  // BOM 제거
  const stripped = text.charCodeAt(0) === 0xFEFF ? text.slice(1) : text
  const grid = parseCSVText(stripped)
  if (grid.length === 0) return { headers: [], rows: [] }
  const headers = grid[0].map(h => h.trim())
  const rows = grid.slice(1).map(row => {
    const obj = {}
    headers.forEach((h, i) => { obj[h] = (row[i] ?? '').trim() })
    return obj
  })
  return { headers, rows }
}
