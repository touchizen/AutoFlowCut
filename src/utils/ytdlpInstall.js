/**
 * src/utils/ytdlpInstall.js
 *
 * yt-dlp 미설치(binary-not-found) 안내를 OS별로 맞는 설치 명령으로 보여주기 위한 순수 유틸
 * (2026-07-08). mac은 brew, Windows(ms-store 배포 포함)는 winget, 그 외는 pip.
 * 검색·자막·상세조회 세 경로 공통으로 쓴다.
 */

/** navigator 유사 객체(platform/userAgent)로 OS 판정 → 'mac' | 'windows' | 'other'. */
export function detectOS(nav = (typeof navigator !== 'undefined' ? navigator : { platform: '', userAgent: '' })) {
  const s = `${nav?.platform || ''} ${nav?.userAgent || ''}`.toUpperCase()
  if (s.includes('MAC')) return 'mac'
  if (s.includes('WIN')) return 'windows'
  return 'other'
}

/** OS → yt-dlp 설치 명령. 알 수 없으면 크로스플랫폼 pip 폴백. */
export function ytDlpInstallCommand(os) {
  if (os === 'mac') return 'brew install yt-dlp'
  if (os === 'windows') return 'winget install yt-dlp'
  return 'pip install -U yt-dlp'
}
