/**
 * Formatters - 날짜/시간/숫자 포맷 유틸리티
 * 
 * flow-studio format.js와 병합
 */

// ============================================================
// 시간 포맷
// ============================================================

/**
 * 초 → mm:ss 포맷
 * @param {number} seconds - 초
 * @returns {string} "m:ss" 형식
 */
export function formatTime(seconds) {
  if (!seconds) return '0:00'
  const mins = Math.floor(seconds / 60)
  const secs = Math.floor(seconds % 60)
  return `${mins}:${String(secs).padStart(2, '0')}`
}

/**
 * 초 → 스마트 duration (시간 있으면 h:mm:ss, 없으면 m:ss)
 * @param {number} seconds - 초
 * @returns {string} "1:30:45" 또는 "1:30" 형식
 */
export function formatDuration(seconds) {
  if (!seconds) return '0:00'
  const hrs = Math.floor(seconds / 3600)
  const mins = Math.floor((seconds % 3600) / 60)
  const secs = Math.floor(seconds % 60)
  
  if (hrs > 0) {
    return `${hrs}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`
  }
  return `${mins}:${String(secs).padStart(2, '0')}`
}

/**
 * 초 → HH:mm:ss 포맷 (항상 시간 포함)
 * @param {number} seconds - 초
 * @returns {string} "HH:mm:ss" 형식
 */
export function formatTimeLong(seconds) {
  const hours = Math.floor(seconds / 3600)
  const mins = Math.floor((seconds % 3600) / 60)
  const secs = Math.floor(seconds % 60)
  return `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`
}

/**
 * 밀리초 → SRT 시간 포맷 (00:00:00,000)
 * @param {number} ms - 밀리초
 * @returns {string} "HH:MM:SS,mmm" 형식
 */
export function formatSRTTime(ms) {
  const hours = Math.floor(ms / 3600000)
  const minutes = Math.floor((ms % 3600000) / 60000)
  const seconds = Math.floor((ms % 60000) / 1000)
  const milliseconds = Math.floor(ms % 1000)
  
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')},${String(milliseconds).padStart(3, '0')}`
}

// ============================================================
// 날짜 포맷
// ============================================================

/**
 * 안전한 Date 변환 (Invalid Date 체크)
 * @param {Date|string|number} input
 * @returns {Date|null}
 */
function toSafeDate(input) {
  if (!input) return null
  const date = input instanceof Date ? input : new Date(input)
  return isNaN(date.getTime()) ? null : date
}

/**
 * 타임스탬프를 로케일 형식으로 포맷 (월.일 시:분)
 * @param {string|number|Date} timestamp
 * @param {string} locale - 로케일 (기본: 'ko-KR')
 * @returns {string} "01. 19. 오전 06:20" 형식
 */
export function formatTimestamp(timestamp, locale = 'ko-KR') {
  const date = toSafeDate(timestamp)
  if (!date) return ''
  return date.toLocaleString(locale, {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  })
}

/**
 * 타임스탬프를 날짜만 포맷
 * @param {string|number|Date} timestamp
 * @param {string} locale - 로케일 (기본: 'ko-KR')
 * @returns {string} "2024. 1. 19." 형식
 */
export function formatDate(timestamp, locale = 'ko-KR') {
  const date = toSafeDate(timestamp)
  if (!date) return ''
  return date.toLocaleDateString(locale)
}

/**
 * 타임스탬프를 전체 형식으로 포맷
 * @param {string|number|Date} timestamp
 * @param {string} locale - 로케일 (기본: 'ko-KR')
 * @returns {string} "2024. 1. 19. 오전 6:20:30" 형식
 */
export function formatDateTimeFull(timestamp, locale = 'ko-KR') {
  const date = toSafeDate(timestamp)
  if (!date) return ''
  return date.toLocaleString(locale)
}

/**
 * Date → M/D HH:MM 포맷 (심플)
 * @param {Date|string} date - Date 객체 또는 ISO 문자열
 * @returns {string} "M/D HH:MM" 형식
 */
export function formatDateShort(date) {
  const d = toSafeDate(date)
  if (!d) return ''
  const month = d.getMonth() + 1
  const day = d.getDate()
  const hours = d.getHours()
  const mins = String(d.getMinutes()).padStart(2, '0')
  return `${month}/${day} ${hours}:${mins}`
}

/**
 * 구독 만료일 포맷 (연도 포함, 짧은 형식)
 * @param {Date|string|number} date - Date 객체 또는 타임스탬프
 * @param {string} lang - 언어 코드 ('ko' 또는 'en')
 * @returns {string} "2025년 12월 25일" (ko) 또는 "Dec 25, 2025" (en)
 */
export function formatExpiryDate(date, lang = 'ko') {
  const d = toSafeDate(date)
  if (!d) return ''
  const locale = lang === 'ko' ? 'ko-KR' : 'en-US'
  return d.toLocaleDateString(locale, { year: 'numeric', month: 'short', day: 'numeric' })
}

/**
 * Date → YYYY-MM-DD 포맷
 * @param {Date|string} date - Date 객체 또는 ISO 문자열
 * @returns {string} "YYYY-MM-DD" 형식
 */
export function formatDateISO(date) {
  const d = toSafeDate(date)
  if (!d) return ''
  const year = d.getFullYear()
  const month = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

/**
 * Date → YYYY-MM-DD_HH-MM-SS 포맷 (파일명용)
 * @param {Date|string} date - Date 객체 또는 ISO 문자열
 * @returns {string} "YYYY-MM-DD_HH-MM-SS" 형식
 */
export function formatDateForFilename(date) {
  const d = toSafeDate(date)
  if (!d) return ''
  return d.toISOString().replace(/[:.]/g, '-').slice(0, 19).replace('T', '_')
}

/**
 * 현재 타임스탬프 (파일명용)
 * @returns {string} "YYYY-MM-DD_HH-MM-SS" 형식
 */
export function getTimestamp() {
  return formatDateForFilename(new Date())
}

// ============================================================
// 숫자 포맷
// ============================================================

/**
 * 숫자 → 천단위 콤마
 * @param {number} num - 숫자
 * @returns {string} "1,234,567" 형식
 */
export function formatNumber(num) {
  return num.toLocaleString()
}

/**
 * 바이트 → 읽기 쉬운 크기
 * @param {number} bytes - 바이트
 * @param {number} decimals - 소수점 자릿수
 * @returns {string} "1.5 MB" 형식
 */
export function formatFileSize(bytes, decimals = 1) {
  if (!bytes) return '0 B'
  
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let unitIndex = 0
  let size = bytes
  
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024
    unitIndex++
  }
  
  return `${size.toFixed(unitIndex > 0 ? decimals : 0)} ${units[unitIndex]}`
}

/**
 * 퍼센트 포맷
 * @param {number} value - 값 (0~1 또는 0~100)
 * @param {number} decimals - 소수점 자릿수
 * @returns {string} "75.5%" 형식
 */
export function formatPercent(value, decimals = 0) {
  const percent = value > 1 ? value : value * 100
  return `${percent.toFixed(decimals)}%`
}

// ============================================================
// 프로젝트 관련
// ============================================================

/**
 * 기본 프로젝트명 생성
 * @param {string} prefix - 접두사 (기본: 'flow2capcut')
 * @returns {string} "flow2capcut_1706348400000" 형식
 */
export function generateProjectName(prefix = 'flow2capcut') {
  return `${prefix}_${Date.now()}`
}

/**
 * 파일명 생성 (씬용)
 * @param {string} sceneId - 씬 ID
 * @param {string} projectName - 프로젝트명
 * @param {string} ext - 확장자 (기본: 'png')
 * @returns {string} "scene_1_2024-01-27_12-30-45.png" 형식
 */
export function generateSceneFilename(sceneId, projectName, ext = 'png') {
  const timestamp = getTimestamp()
  return `${sceneId}_${timestamp}.${ext}`
}

// ============================================================
// 이미지 유틸리티
// ============================================================

/**
 * Base64 이미지 데이터에서 크기 추출
 * @param {string} base64Data - base64 이미지 데이터 (data:image/... 형식 가능)
 * @returns {Promise<{width: number, height: number}>}
 */
export function getImageSizeFromBase64(base64Data) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => {
      resolve({ width: img.naturalWidth, height: img.naturalHeight })
    }
    img.onerror = (err) => {
      reject(err)
    }
    // data: 프리픽스가 없으면 추가
    if (!base64Data.startsWith('data:')) {
      base64Data = `data:image/png;base64,${base64Data}`
    }
    img.src = base64Data
  })
}

// ============================================================
// 해상도 태그
// ============================================================

/**
 * 해상도 태그 반환 (SD, HD, 4K, 8K)
 * @param {number} width - 너비
 * @param {number} height - 높이
 * @returns {string} 해상도 태그
 */
export function getResolutionTag(width, height) {
  const maxDimension = Math.max(width || 0, height || 0)
  
  if (maxDimension >= 14000) return '8K'
  if (maxDimension >= 7000) return '4K'
  if (maxDimension >= 5000) return 'QHD'
  if (maxDimension >= 3500) return 'HD+'
  if (maxDimension >= 2000) return 'HD'
  
  return 'SD'
}

// ============================================================
// UI 유틸리티
// ============================================================

/**
 * 종횡비 → CSS 클래스 반환
 * @param {string} aspectRatio - '16:9' | '9:16' | '1:1'
 * @returns {string} 'ratio-landscape' | 'ratio-portrait' | 'ratio-square'
 */
export function getRatioClass(aspectRatio) {
  return aspectRatio === '16:9' ? 'ratio-landscape'
    : aspectRatio === '9:16' ? 'ratio-portrait'
    : 'ratio-square'
}

// ============================================================
// 이미지 소스 해결
// ============================================================

/**
 * scene/reference에서 표시할 이미지 src 반환
 * 파일 경로(imagePath/filePath)가 있으면 file:// 프로토콜, 없으면 base64 fallback
 * scene: { image, imagePath }, reference: { data, filePath }
 */
export function resolveImageSrc(item) {
  if (!item) return null
  // 파일 경로 우선 (scene.imagePath 또는 reference.filePath) — 절대 경로만
  const filePath = item.imagePath || item.filePath
  if (filePath && filePath.startsWith('/')) {
    return `file://${filePath}?t=${Date.now()}`
  }
  // Windows 절대 경로 (C:\...)
  if (filePath && /^[A-Z]:\\/i.test(filePath)) {
    return `file:///${filePath.replace(/\\/g, '/')}?t=${Date.now()}`
  }
  // fallback: 메모리 base64 (scene.image 또는 reference.data)
  return item.image || item.data || null
}

/**
 * 이미지 데이터가 있는지 확인 (파일 경로 또는 메모리 데이터)
 */
export function hasImageData(item) {
  if (!item) return false
  return !!(item.imagePath || item.filePath || item.image || item.data)
}

// ============================================================
// 랜덤 생성
// ============================================================

/**
 * 랜덤 시드 생성 (Flow API용)
 * @returns {string} 0 ~ 2147483646 범위의 문자열
 */
export function generateRandomSeed() {
  return String(Math.floor(Math.random() * 2147483647))
}

/**
 * 경과 시간 포맷 (초 → "mm:ss" 또는 "hh:mm:ss")
 */
export function formatElapsed(seconds) {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = seconds % 60
  if (h > 0) return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

/**
 * 경과 시간 포맷 (밀리초 → "mm:ss" 또는 "hh:mm:ss")
 */
export function formatElapsedMs(ms) {
  return formatElapsed(Math.floor(ms / 1000))
}
