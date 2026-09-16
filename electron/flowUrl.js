/**
 * Flow URL 판정 — 두 가지 배치를 한 곳에서 안다.
 *
 * Google 이 Flow 를 옮겼다(2026-09 실측, 301):
 *   https://labs.google/fx/tools/flow            → https://flow.google.com/
 *   https://labs.google/fx/tools/flow/project/X  → https://flow.google.com/project/X
 *
 * 옛 배치(`/tools/flow/project/<id>`)만 인식하면 리다이렉트 후 착지한 페이지를
 * "대상 아님"으로 오판한다. 그러면 open 이 실패로 끝나고, 폴링이 mode-entry 를
 * 다시 돌려 같은 시도를 무한히 반복한다.
 *
 * 판정이 여러 곳에 복제돼 있던 것이 이 버그의 확산 반경이었다 — 한 곳에 모은다.
 */

/** 새 도메인. 옛 도메인은 여기로 리다이렉트되므로 폴백 기본값이기도 하다. */
const FLOW_HOST = 'flow.google.com'
const LEGACY_HOST = 'labs.google'
export const FLOW_BASE = `https://${FLOW_HOST}`

/** Flow 컴포저로 인정하는 하위 경로. 그 외(/characters, /edit/*, /settings)는 컴포저가 아니다. */
const COMPOSER_SUBPATHS = new Set(['', '/', '/all-media'])

/** projectId 는 **한 경로 세그먼트** 여야 한다. 저장값에 '/' 가 섞이면 하위 페이지를 승인해버린다. */
function isValidProjectId(projectId) {
  return /^[A-Za-z0-9._~-]+$/.test(String(projectId ?? ''))
}

/**
 * 현재 URL 에서 프로젝트 URL 을 만들 base 를 뽑는다.
 * 옛 도메인은 로케일이 섞일 수 있어(`/ko/fx/tools/flow`) 그 부분을 보존한다.
 */
export function flowBaseFromUrl(url) {
  const s = String(url ?? '')
  const legacy = s.match(/^(https?:\/\/[^/]*labs\.google(?:\/[^/]+)*?\/fx\/tools\/flow)(\/|$|\?|#)/)
  if (legacy) return legacy[1]
  try {
    const u = new URL(s)
    if (u.hostname.toLowerCase() === FLOW_HOST) return `${u.protocol}//${u.host}`
  } catch { /* 빈 문자열·상대경로 등 */ }
  return FLOW_BASE
}

/** base 뒤에 프로젝트 경로를 붙인다. */
export function flowProjectUrl(base, projectId) {
  return `${String(base).replace(/\/$/, '')}/project/${projectId}`
}

/**
 * 이 URL 이 **대상 프로젝트의 컴포저** 인가.
 *
 * substring 으로 보면 안 된다 — `?next=/project/<id>`(쿼리), `/archive/project/<id>`(다른 라우트),
 * `/project/<id>-suffix`(다른 id), 다른 오리진이 전부 통과한다(전부 실측된 함정).
 * origin 과 pathname 을 나눠서 본다.
 */
export function onProjectComposerUrl(url, projectId) {
  if (!isValidProjectId(projectId)) return false
  let u
  try { u = new URL(String(url ?? '')) } catch { return false }

  const host = u.hostname.toLowerCase()
  // 새 도메인은 `/project/<id>`, 옛 도메인은 `/…/tools/flow/project/<id>`.
  const prefix = host === FLOW_HOST ? '' : host === LEGACY_HOST ? '.*/tools/flow' : null
  if (prefix === null) return false

  // id 를 정규식에 그대로 넣으면 '[' 같은 값에서 SyntaxError 로 **던진다** — 이스케이프한다.
  const esc = String(projectId).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const m = u.pathname.match(new RegExp(`^${prefix}/project/${esc}(/[^/]*)?$`))
  if (!m) return false
  return COMPOSER_SUBPATHS.has(m[1] || '')
}
