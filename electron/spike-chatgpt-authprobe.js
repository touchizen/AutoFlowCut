// G 전용 게이트.
// (withEvalTimeout 은 spike-chatgpt-automate.js 의 것을 재사용 — 상한 정책이 한 곳에만 있게.) URL 이 아니라 DOM 으로 판정한다(#prompt-textarea 렌더 = 로그인 세션).
// L/D/T/F 는 Phase 1 계약대로 무게이트.
import { withEvalTimeout } from './spike-chatgpt-automate.js'

export const AUTH_PROBE = /* js */ `(() => {
  const composer = !!document.querySelector('#prompt-textarea');
  const loginCta = !!(document.querySelector('[data-testid="login-button"]') || document.querySelector('a[href*="/auth/login"]'));
  try { console.log('[autoflowcut CGPT GEN] authprobe', JSON.stringify({ composer: composer, loginCta: loginCta })); } catch (e) {}
  return { composer: composer, loginCta: loginCta };
})()`

export function isLoggedIn(probe) {
  return probe?.composer === true
}

// 첫 G(직전 L/D/T/F 없이)는 loadURL 직후라 프로브가 로드 중에 돌아 거짓 미로그인이 난다.
// 이미 로드된 뷰(idempotent 재사용)면 즉시 resolve. 절대 매달리지 않게 타임아웃 포함.
export function whenLoaded(view, { timeoutMs = 15000 } = {}) {
  const wc = view?.webContents
  if (!wc || typeof wc.isLoading !== 'function' || !wc.isLoading()) return Promise.resolve(false)
  return new Promise((resolve) => {
    let settled = false
    const finish = (v) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      try { wc.removeListener('did-finish-load', onFinish) } catch {}
      try { wc.removeListener('did-fail-load', onFail) } catch {}
      resolve(v)
    }
    const onFinish = () => finish(true)
    const onFail = () => finish(false)
    const timer = setTimeout(() => finish(false), timeoutMs)
    wc.on('did-finish-load', onFinish)
    wc.on('did-fail-load', onFail)
    // 확인과 구독 사이에 로드가 끝나면 이벤트를 영영 못 받는다 → 구독 후 한 번 더 확인.
    if (!wc.isLoading()) finish(false)
  })
}

export async function ensureLoggedIn(view, deps) {
  const {
    executeInView,
    attempts = 5,
    intervalMs = 500,
    sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
    probeTimeoutMs = 10000,
    log = console,
  } = deps
  let last = null
  for (let i = 0; i < attempts; i++) {
    try {
      // 프로브 eval 도 상한을 건다 — 매달리면 단축키(그리고 상태기계의 reprobe)가 안 끝난다.
      last = await withEvalTimeout(executeInView(view, AUTH_PROBE), probeTimeoutMs)
    } catch (e) {
      last = { error: e?.message || String(e) }
    }
    if (isLoggedIn(last)) return true
    if (i < attempts - 1) await sleep(intervalMs)
  }
  log.error?.('[spike] not logged in — press Cmd+Alt+Shift+L and sign in. probe:', JSON.stringify(last))
  return false
}
