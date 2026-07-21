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
    .slice(0, 96)
  // Windows 는 첫 확장자 앞 segment 가 장치명이면 확장자가 더 붙어도 예약명으로 취급한다.
  const safe = RESERVED.test(base.split('.')[0]) ? `_${base}` : base
  return `${safe || 'render'}.mp4`
}
