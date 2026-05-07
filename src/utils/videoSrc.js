/**
 * Video source resolver — `<video src={...}>` 에 넣을 URL 을 단일 지점에서 결정.
 *
 * VideoDetailModal / SceneList / ResultsTable 에 흩어져 있던 동일 로직을 통합.
 * cache busting / Windows 경로 / data URL 판정 등 세부가 한 곳에서 관리되도록.
 *
 * 우선순위:
 *   1. base64Data 가 있으면 그것을 우선 (메모리상 데이터, 가장 안정적)
 *   2. filePath 가 있으면 file:// 변환
 *   3. 둘 다 없으면 null
 *
 * @param {string|null} base64Data - data URL 또는 raw base64 (mp4 가정)
 * @param {string|null} filePath   - 절대 경로 (Windows: C:\... / POSIX: /...)
 * @returns {string|null}          - <video src> 에 직접 넣을 URL
 */
export function resolveVideoSrc(base64Data, filePath) {
  // 1. base64 데이터 우선
  if (typeof base64Data === 'string' && base64Data.length > 0) {
    if (base64Data.startsWith('data:')) return base64Data
    // file path 형태가 잘못 들어온 경우 (예: 호출부 실수) — file:// 변환으로 폴백
    if (base64Data.startsWith('/')) return `file://${base64Data}`
    if (/^[A-Z]:\\/i.test(base64Data)) return `file:///${base64Data.replace(/\\/g, '/')}`
    // 진짜 raw base64 (data: prefix 없음) → mp4 로 가정
    return `data:video/mp4;base64,${base64Data}`
  }

  // 2. filePath
  if (typeof filePath === 'string' && filePath.length > 0) {
    if (filePath.startsWith('data:')) return filePath  // 이미 data URL 인 경우
    if (filePath.startsWith('/')) return `file://${filePath}`
    if (/^[A-Z]:\\/i.test(filePath)) return `file:///${filePath.replace(/\\/g, '/')}`
    return filePath  // http(s)/ 상대경로 등은 그대로
  }

  return null
}

/**
 * data: 또는 raw base64 → data URL 보정 (file path 분기 없음).
 *
 * 호출부가 base64 데이터만 다루고 file path 케이스가 없을 때 사용.
 * (예: history thumbnail 미리보기 — base64 만 있음)
 */
export function ensureBase64DataUrl(data, mime = 'video/mp4') {
  if (typeof data !== 'string' || data.length === 0) return null
  if (data.startsWith('data:')) return data
  return `data:${mime};base64,${data}`
}
