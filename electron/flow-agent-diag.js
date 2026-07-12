/**
 * electron/flow-agent-diag.js
 *
 * Persist the Agent-toggle not_found diagnostic so a non-developer can hand us the
 * one file that explains the failure.
 *
 * Once per session: a failing batch fails EVERY scene, and a file per scene would bury
 * the Desktop and leave the reporter guessing which to send.
 *
 * Desktop first (a non-developer can find it), userData as fallback — the Windows Store
 * (AppX) build runs in an AppContainer where Desktop writes are redirected or denied.
 */

import { buildAgentDiagFilename } from './flow-dom-dump.js'

/**
 * Report the not_found diagnostic to Sentry.
 *
 * The failure returns { success:false } instead of throwing, so Sentry has never seen it —
 * we cannot tell whether one user is affected or five hundred. This closes that blind spot.
 *
 * Sends the STRUCTURED diagnostic only. The DOM dump's bodyHTML carries the user's prompts,
 * project names and media URLs; that goes in a file the user chooses to send us, never here.
 *
 * @param {object} deps
 * @param {Function|null} deps.captureMessage  Sentry.captureMessage, or null when disabled
 * @returns {(diag: object) => void}
 */
export function createAgentDiagReporter({ captureMessage }) {
  let reported = false

  return function reportAgentDiag(diag) {
    if (!captureMessage || reported) return
    reported = true

    const { caller, viewBounds, candidates, context } = diag
    try {
      captureMessage('flow: agent toggle not_found — generation blocked', {
        level: 'warning',
        // 고정 fingerprint — 안 박으면 bounds/lang/url 차이 때문에 사용자마다 별개 이슈로 흩어져
        //   전체 규모가 안 보인다. 이게 이 리포트의 핵심 가치인데.
        fingerprint: ['flow-agent-toggle-not-found'],
        extra: { caller, viewBounds, candidates, context },
      })
    } catch {
      // 진단 보고 실패가 생성 경로를 죽여선 안 된다.
    }
  }
}

/**
 * @param {object} deps
 * @param {Function} deps.writeFile   (path, contents) => void — throws if not writable
 * @param {string}   deps.desktopDir
 * @param {string}   deps.userDataDir
 * @param {Function} [deps.now]       () => Date
 * @returns {(diag: object) => Promise<string|null>}  path written, or null if nowhere is writable
 */
export function createAgentDiagWriter({ writeFile, desktopDir, userDataDir, now = () => new Date() }) {
  let written = null

  return async function writeAgentDiag(diag) {
    if (written) return written

    const name = buildAgentDiagFilename(now())
    const body = JSON.stringify(diag, null, 2)

    for (const dir of [desktopDir, userDataDir]) {
      if (!dir) continue
      const path = `${dir}/${name}`
      try {
        await writeFile(path, body)
        written = path
        return written
      } catch {
        // 다음 위치로 — 마지막까지 실패하면 null. 진단 저장 실패가 생성 경로를 죽여선 안 된다.
      }
    }
    return null
  }
}
