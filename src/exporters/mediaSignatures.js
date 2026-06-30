/**
 * 원시 base64 미디어 시그니처 — 공통 검출기
 *
 * data: prefix 없는 인라인 base64 미디어(이미지/비디오/오디오)를 파일 경로·파일명과
 * 구분하고 적절한 확장자를 부여한다. getFilename / isFilePath / Vrew 패킹이 공유해
 * 시그니처 목록이 모듈마다 drift 하지 않도록 한 곳에 둔다.
 *
 * 주의: 실제 미디어는 보통 파일 경로 또는 data: URL 로 도착하므로, raw base64 분기는
 * fallback 엣지케이스다. MP3 frame-sync('//u','//s')는 흔한 접두만 다룬다 — '//' 로
 * 시작하는 모든 값을 mp3 로 보면 '//server/share' 같은 경로를 오분류할 수 있어 의도적으로
 * 확장하지 않는다.
 */

const SIGNATURES = [
  ['/9j/', 'jpg'],
  ['iVBOR', 'png'],
  ['R0lGOD', 'gif'],
  ['AAAA', 'mp4'],     // MP4 ftyp box
  ['SUQ', 'mp3'],      // ID3 ('ID3')
  ['//u', 'mp3'],      // MPEG frame sync
  ['//s', 'mp3'],
]

function stripDataUrl(value) {
  return value.startsWith('data:') ? value.replace(/^data:[^;]+;base64,/, '') : value
}

// '//host/share' 또는 '\\host\share' 같은 UNC/네트워크 경로는 원시 미디어가 아니다.
// '//u','//s' MP3 시그니처와 충돌하므로(예: '//server/...') 경로를 우선 인식한다.
function looksLikeUncPath(s) {
  return /^(\/\/|\\\\)[^/\\]+[/\\]/.test(s)
}

// RIFF(UklGR)는 WebP/WAV 둘 다 — 헤더 8~11바이트(format tag)를 디코드해 구분.
function riffExtension(s) {
  try {
    const bytes = atob(s.slice(0, 16))  // 16 b64 chars → 12 bytes (tag at 8..11)
    const tag = bytes.slice(8, 12)
    if (tag === 'WEBP') return 'webp'
    if (tag === 'WAVE') return 'wav'
  } catch { /* 디코드 실패 시 폴백 */ }
  return 'webp'  // tag 미확인 시 기존 동작(이미지) 유지
}

/**
 * 원시 base64 미디어면 확장자, 아니면 null.
 * @param {string} value - base64 페이로드 또는 data: URL (파일 경로면 null)
 */
export function rawMediaExtension(value) {
  if (!value || typeof value !== 'string') return null
  const s = stripDataUrl(value)
  if (looksLikeUncPath(s)) return null
  if (s.startsWith('UklGR')) return riffExtension(s)
  for (const [prefix, ext] of SIGNATURES) {
    if (s.startsWith(prefix)) return ext
  }
  return null
}

/**
 * data: URL 또는 알려진 원시 base64 시그니처인가 (= 파일 경로가 아닌 인라인 미디어).
 */
export function isRawBase64Media(value) {
  if (!value || typeof value !== 'string') return false
  if (value.startsWith('data:')) return true
  return rawMediaExtension(value) != null
}

export default {
  rawMediaExtension,
  isRawBase64Media,
}
