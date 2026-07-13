/**
 * electron/flow-diag.js
 *
 * One sink for every Flow DOM automation failure.
 *
 * Flow automation is DOM reverse-engineering: Google ships a UI change, a selector stops
 * matching, and the user gets a generic error while we get nothing. That is not a bug we
 * fix once — it is a standing condition of the approach, so the failures have to report
 * themselves. The Agent toggle was simply the one a user happened to report.
 *
 * Sentry carries the structured step + page context, and node.consoleIntegration() attaches
 * the recent [Flow API]/[TrustedClick] console trail as breadcrumbs — that trail is the log
 * we would otherwise have to ask a user for. Page CONTENT never goes to Sentry (see
 * sentry-init beforeBreadcrumb); the local file is the copy a user can choose to send.
 */

import { buildFlowDiagFilename } from './flow-dom-dump.js'

const DEFAULT_MAX_STEPS = 8

// Sentry 로 나가면 안 되는 필드 — 페이지/사용자 콘텐츠를 담을 수 있는 키. 로컬 파일에는 남지만
//   (사용자가 보낼지 스스로 정한다) 자동 전송에는 절대 싣지 않는다. 지금은 아무 호출부도 안 넘기나,
//   싱크가 ...detail 을 그대로 펼치므로 나중에 누가 넘기는 순간 조용히 새어나간다. 여기서 막는다.
const CONTENT_KEYS = /prompt|html|content|srt|script|caption|narration|body/i

export function sanitizeForSentry(entry) {
  const out = {}
  for (const [k, v] of Object.entries(entry)) {
    if (!CONTENT_KEYS.test(k)) out[k] = v
  }
  return out
}

/**
 * @param {object} deps
 * @param {Function|null} deps.captureMessage  Sentry.captureMessage, or null when disabled
 * @param {Function} deps.writeFile            (path, contents) => void — throws if not writable
 * @param {string} deps.desktopDir
 * @param {string} deps.userDataDir
 * @param {Function} [deps.now]
 * @param {number} [deps.maxSteps]             distinct steps reported per session
 * @returns {(step: string, detail: object) => Promise<void>}
 */
export function createFlowDiagSink({
  captureMessage,
  writeFile,
  desktopDir,
  userDataDir,
  now = () => new Date(),
  maxSteps = DEFAULT_MAX_STEPS,
}) {
  const seen = new Set()
  const entries = []
  let filePath = null

  return async function reportFlowFailure(step, detail = {}) {
    // 스텝별 dedupe — 전역 1회로 하면 먼저 터진 실패가 뒤의 다른 실패를 가려버린다(토글이 깨지면
    //   제출 버튼이 깨진 걸 영영 못 본다). 대신 distinct 스텝 수에 상한을 걸어 쿼터를 지킨다.
    if (seen.has(step) || seen.size >= maxSteps) return

    const entry = { step, ...detail }
    let delivered = false

    try {
      captureMessage?.(`flow: DOM step failed — ${step}`, {
        level: 'warning',
        // 스텝별 fingerprint — 하나로 묶으면 "Flow DOM 실패" 이슈 한 개에 전부 뭉개져 어느 셀렉터가
        //   깨졌는지를 알 수 없다. 스텝별로 나눠야 이슈 하나 = 깨진 셀렉터 하나 + 전 사용자 집계.
        fingerprint: ['flow-dom-failure', step],
        extra: sanitizeForSentry(entry),
      })
      if (captureMessage) delivered = true
    } catch {
      // 진단 보고 실패가 생성을 죽여선 안 된다.
    }

    // 파일은 세션당 하나에 누적한다 — 실패마다 새 파일을 쓰면 배치가 깨졌을 때 바탕화면이
    //   뒤덮이고, 정작 사용자는 뭘 보내야 할지 모른다.
    const body = JSON.stringify([...entries, entry], null, 2)
    const targets = filePath ? [filePath] : [`${desktopDir}/${buildFlowDiagFilename(now())}`, `${userDataDir}/${buildFlowDiagFilename(now())}`]
    for (const target of targets) {
      if (!target) continue
      try {
        await writeFile(target, body)
        filePath = target
        delivered = true
        break
      } catch {
        // Desktop 이 못 쓰는 경우(AppX 는 AppContainer 라 리다이렉트/거부) userData 로 폴백.
      }
    }

    // ⚠️ dedupe 는 "전달에 성공했을 때"만 소비한다. Sentry 도 파일도 전부 실패했는데 seen 에 넣으면
    //   그 스텝은 세션 내내 완전한 침묵이 된다 — 진단을 붙여놓고도 눈이 머는, 오늘 이미 한 번 겪은 실패.
    if (delivered) {
      seen.add(step)
      entries.push(entry)
    }
  }
}
