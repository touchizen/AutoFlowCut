/**
 * electron/flow-session.js
 *
 * Flow 세션(access_token) 주소 후보와 페이지 주입용 프로브.
 *
 * 2026-09-23 flow.google.com 이전 뒤에도 세션을 옛 절대주소(labs.google/fx/api/auth/session)로
 * 읽었다. 새 도메인 페이지에서 그 fetch 는 cross-origin 이라 쿠키가 안 실려 `{}` 만 돌아오고,
 * 로그인돼 있는 사용자에게 "Flow 로그인이 필요합니다"가 반복됐다.
 *
 * 해법: 페이지 origin 기준 same-origin 후보(/fx/api → /api)를 먼저, 옛 절대주소를 마지막에
 * 순서대로 시도해 **토큰이 든 첫 응답**을 고른다. `{}` 같은 빈 세션은 건너뛴다.
 * 순수 함수 — tests/electron/flow-session.test.js.
 *
 * ⚠️ 2026-09-24 실기: 새 flow.google.com 에선 세 후보 **모두 miss**(세션 API 자체가 없다 —
 *   same-origin 후보는 SPA HTML 폴백, 옛 주소는 cross-origin `{}`). 무해하지만 새 Flow 의 답이
 *   아니다. 진짜 수정은 batchexecute 재작업(docs/handoffs/2026-09-24-flow-batchexecute-migration-HANDOFF.md §3-B).
 */
import { isFlowPageUrl } from './flowUrl.js'

export const LEGACY_SESSION_URL = 'https://labs.google/fx/api/auth/session'

/**
 * @param {string} pageUrl - Flow 뷰의 현재 URL
 * @param {string} [legacyUrl] - 옛 절대주소(마지막 폴백)
 * @returns {string[]} 시도 순서대로의 세션 URL 후보 (중복 없음)
 */
export function sessionUrlCandidates(pageUrl, legacyUrl = LEGACY_SESSION_URL) {
  const out = []
  // Flow 호스트일 때만 same-origin 후보를 만든다 — 로그인 페이지 등 외부 origin 에 세션을 묻지 않는다.
  if (isFlowPageUrl(pageUrl)) {
    const origin = new URL(pageUrl).origin
    out.push(`${origin}/fx/api/auth/session`, `${origin}/api/auth/session`)
  }
  if (legacyUrl && !out.includes(legacyUrl)) out.push(legacyUrl)
  return out
}

/**
 * 후보를 순서대로 fetch 해 토큰(access_token | accessToken)이 든 첫 응답을 돌려주는 페이지 JS.
 * executeJavaScript 로 Flow 뷰에서 실행한다. 결과: { url, text } | { url: null, text: null }.
 * ⚠️ 본문에는 토큰·이메일이 있으므로 호출측은 text 를 절대 로그에 찍지 않는다.
 */
export function buildSessionProbeJs(candidates) {
  return `(async function (urls) {
    for (const url of urls) {
      try {
        const r = await fetch(url, { credentials: 'same-origin', cache: 'no-store' })
        if (!r.ok) continue
        const text = await r.text()
        if (!text) continue
        let j = null
        try { j = JSON.parse(text.replace(/^\\)\\]\\}'[^\\n]*\\n?/, '')) } catch { continue }
        if (j && (j.access_token || j.accessToken)) return { url: url, text: text }
      } catch (e) { /* 다음 후보 */ }
    }
    return { url: null, text: null }
  })(${JSON.stringify(candidates)})`
}
