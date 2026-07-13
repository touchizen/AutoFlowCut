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
import { scrubSentryString } from './sentry-scrub.js'
import { createMutex } from './asyncMutex.js'

const DEFAULT_MAX_STEPS = 8

// 자동 전송에 실으면 안 되는 키 — 로컬 파일에는 남지만(사용자가 보낼지 스스로 정한다) Sentry 로는
//   절대 안 싣는다. DOM 덤프가 이 싱크를 타게 되면 alt/title/placeholder/value/src 도
//   페이지·사용자 콘텐츠를 담는다 — 나중에 붙이는 사람이 이 목록을 다시 발견하게 두지 않는다.
const CONTENT_KEYS = /prompt|html|content|srt|script|caption|narration|body|ariaLabel|aria-label|placeholder|^text$|^url$|^alt$|^title$|^value$|^src$|^currentSrc$|^poster$|^label$|^name$/i

/**
 * 자동 전송(Sentry)에 실을 수 있게 콘텐츠 필드를 재귀적으로 벗긴다.
 *
 * ⚠️ 중첩까지 봐야 한다. 최상위 키만 걸렀더니 `candidates[].text` 와 `ariaLabel` 이 그대로 나갔다 —
 *    그건 Flow 페이지의 텍스트이고, 컴포즈 바에는 @멘션 칩(= 사용자가 만든 캐릭터 이름)이 들어간다.
 *    진단에 정작 필요한 건 텍스트가 아니라 **속성**(tag/role/aria-pressed/data-state/icons)이다.
 *    텍스트가 필요하면 로컬 파일에 있고, 그 파일은 사용자가 보낼지 스스로 정한다.
 */
export function sanitizeForSentry(value, seen = new WeakSet()) {
  if (typeof value === 'string') return scrubSentryString(value)   // "ENOENT /Users/alice/…" 같은 값
  if (value && typeof value === 'object') {
    if (seen.has(value)) return '[circular]'   // 진단 정리 중에 앱이 죽는 일은 없어야 한다
    seen.add(value)
    if (Array.isArray(value)) return value.map((v) => sanitizeForSentry(v, seen))
    const out = {}
    for (const [k, v] of Object.entries(value)) {
      if (CONTENT_KEYS.test(k)) continue
      out[k] = sanitizeForSentry(v, seen)
    }
    return out
  }
  return value
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
  // 보고를 직렬화한다 — 서로 다른 스텝의 동시 보고가 각각 빈 entries 를 스냅샷해 같은 파일에
  //   한 건짜리 본문을 쓰면서 서로를 지웠다(실측: ["b"] 쓴 뒤 ["a"] 로 덮여 b 가 사라짐).
  const mutex = createMutex()

  return async function reportFlowFailure(step, detail = {}) {
    const release = await mutex.acquire()
    try { await report(step, detail) } finally { release() }
  }

  async function report(step, detail) {
    // 스텝별 dedupe — 전역 1회로 하면 먼저 터진 실패가 뒤의 다른 실패를 가려버린다(토글이 깨지면
    //   제출 버튼이 깨진 걸 영영 못 본다). distinct 스텝 수에 상한을 걸어 쿼터를 지킨다.
    // 진입 즉시 예약한다 — 같은 스텝의 동시 보고 둘이 각각 통과해 Sentry 를 두 번 때리고 파일을
    //   서로 덮어쓰던 경쟁이 있었다. 전달에 실패하면 아래에서 되돌린다(그래야 다음에 다시 시도).
    if (seen.has(step) || seen.size >= maxSteps) return
    seen.add(step)

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
    // 진단을 정리하다가 앱이 죽는 일은 없어야 한다 — 순환 참조나 BigInt 가 섞이면 stringify 가 던진다.
    //   (fallback 도 던질 수 있다 — reason 이 BigInt 면 둘 다 실패한다. 최후엔 스텝 이름만 남긴다.)
    let body
    const safeStringify = (v, fallback) => { try { return JSON.stringify(v, null, 2) } catch { return fallback } }
    body = safeStringify([...entries, entry],
      safeStringify([...entries, { step, note: 'detail not serialisable' }],
        JSON.stringify([{ step, note: 'diagnostic not serialisable' }], null, 2)))
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

    // ⚠️ dedupe 는 "전달에 성공했을 때"만 유지한다. Sentry 도 파일도 전부 실패했는데 seen 에 남기면
    //   그 스텝은 세션 내내 완전한 침묵이 된다 — 진단을 붙여놓고도 눈이 머는, 오늘 이미 한 번 겪은 실패.
    if (delivered) {
      entries.push(entry)
    } else {
      seen.delete(step)
      console.warn(`[Flow Diag] ${step}: 어디에도 전달하지 못했다(Sentry·파일 모두 실패)`)
    }
  }
}
