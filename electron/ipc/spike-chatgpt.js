import { isSpikeEnabled } from '../spike-devgate.js'
import { ensureChatgptView, ensureVisibleAndFocused } from '../spike-chatgpt-view.js'
import { CHATGPT_DUMPER } from '../spike-chatgpt-dumper.js'
import { saveDump } from '../spike-chatgpt-storage.js'
import { ensureLoggedIn, whenLoaded } from '../spike-chatgpt-authprobe.js'
import { runGenerateStateMachine, SPIKE_PROMPT } from '../spike-chatgpt-automate.js'
import { saveImage } from '../spike-chatgpt-image.js'

// dev 전용. 게이트 통과 시에만 L/D/T/F 등록. 전부 무게이트(로그인/셀렉터 전에도 덤프 가능).
// register()가 false면 조용한 미등록 방지 위해 로그.
export function registerSpikeShortcuts(deps) {
  const {
    app, env, globalShortcut, getMainWindow, makeView, disposeView, state,
    executeInView, fs, log, generateOptions = {}, probeOptions = {},
  } = deps
  if (!isSpikeEnabled(app, env)) return

  const reg = (accel, cb) => {
    let ok = false
    try { ok = globalShortcut.register(accel, cb) } catch (e) { log.error('[spike] register threw', accel, e?.message) }
    if (!ok) log.error('[spike] shortcut register failed (occupied?):', accel)
  }

  const ensure = () => ensureChatgptView(state, { makeView, disposeView })

  const dump = (name) => async () => {
    try {
      const view = ensure()
      const result = await executeInView(view, CHATGPT_DUMPER)
      const p = saveDump(app, name, result, fs)
      log.info('[spike] dump saved:', p)
    } catch (e) {
      log.error('[spike] dump failed:', name, e?.message || e)
    }
  }

  reg('Cmd+Alt+Shift+L', () => { const v = ensure(); ensureVisibleAndFocused(v, getMainWindow()) })
  reg('Cmd+Alt+Shift+D', dump('composer-empty'))
  reg('Cmd+Alt+Shift+T', dump('composer-filled'))
  reg('Cmd+Alt+Shift+F', dump('result'))

  // G: 하드코딩 프롬프트로 이미지 1장 생성·저장(스파이크 종료 조건). G만 로그인 게이트.
  reg('Cmd+Alt+Shift+G', async () => {
    try {
      const view = ensure()
      ensureVisibleAndFocused(view, getMainWindow())
      await whenLoaded(view)                     // 첫 G(로드 직후) 거짓 미로그인 방지
      const authed = await ensureLoggedIn(view, { executeInView, log, ...probeOptions })
      if (!authed) return                        // ensureLoggedIn 이 이미 태그드 로그를 남김
      const r = await runGenerateStateMachine(view, SPIKE_PROMPT, {
        executeInView,
        log,
        reprobe: () => ensureLoggedIn(view, { executeInView, attempts: 1, probeTimeoutMs: 5000, log, ...probeOptions }),
        ...generateOptions,
      })
      if (!r.ok) {
        log.error('[spike] generate failed:', r.stage, r.detail || '')
        return
      }
      const p = await saveImage(app, view, r.src, fs)
      log.info('[spike] image saved:', p)
    } catch (e) {
      log.error('[spike] generate threw:', e?.message || e)
    }
  })
}
