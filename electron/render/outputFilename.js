// self-render 저장 다이얼로그의 기본 파일명 — 프로젝트명 기반.
// OS 파일명 금지 문자만 '_' 로 치환한다. \W 로 뭉개면 "원더풀스" 같은 한글 프로젝트명이
// 통째로 사라지므로(resolveInputs 의 sanitizeName 과 목적이 다름) 금지 문자만 좁게 친다.
const FORBIDDEN = /[/\\:*?"<>|\x00-\x1f]/g

export function sanitizeOutputName(projectName) {
  const base = String(projectName ?? '')
    .replace(FORBIDDEN, '_')
    .replace(/\s+/g, ' ')
    .trim()
  return `${base || 'render'}.mp4`
}
