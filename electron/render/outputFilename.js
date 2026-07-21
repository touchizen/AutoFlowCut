// self-render 저장 다이얼로그의 기본 파일명 — 프로젝트명 기반.
// OS 파일명 금지 문자만 '_' 로 치환한다. \W 로 뭉개면 "원더풀스" 같은 한글 프로젝트명이
// 통째로 사라지므로(resolveInputs 의 sanitizeName 과 목적이 다름) 금지 문자만 좁게 친다.
const FORBIDDEN = /[/\\:*?"<>|\x00-\x1f]/g
// Windows 예약 장치명 — 확장자를 붙여도 장치로 취급되어(CON.mp4) 저장이 깨진다.
const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i

export function sanitizeOutputName(projectName) {
  const base = String(projectName ?? '')
    .replace(FORBIDDEN, '_')
    .replace(/\s+/g, ' ')
    .trim()
  // 예약 장치명이면 '_' 접두로 회피(Windows). 그 외엔 그대로.
  const safe = RESERVED.test(base) ? `_${base}` : base
  return `${safe || 'render'}.mp4`
}
