import { isSpikeEnabled } from '../spike-devgate.js'
import { ensureChatgptView, ensureVisibleAndFocused } from '../spike-chatgpt-view.js'
import { CHATGPT_DUMPER } from '../spike-chatgpt-dumper.js'
import { saveDump } from '../spike-chatgpt-storage.js'

// dev 전용. 게이트 통과 시에만 L/D/T/F 등록. 전부 무게이트(로그인/셀렉터 전에도 덤프 가능).
// register()가 false면 조용한 미등록 방지 위해 로그.
export function registerSpikeShortcuts(deps) {
  const { app, env, globalShortcut, getMainWindow, makeView, state, executeInView, fs, log } = deps
  if (!isSpikeEnabled(app, env)) return

  const reg = (accel, cb) => {
    let ok = false
    try { ok = globalShortcut.register(accel, cb) } catch (e) { log.error('[spike] register threw', accel, e?.message) }
    if (!ok) log.error('[spike] shortcut register failed (occupied?):', accel)
  }

  const ensure = () => ensureChatgptView(state, { makeView })

  const dump = (name) => async () => {
    const view = ensure()
    const result = await executeInView(view, CHATGPT_DUMPER)
    const p = saveDump(app, name, result, fs)
    log.info('[spike] dump saved:', p)
  }

  reg('Cmd+Alt+Shift+L', () => { const v = ensure(); ensureVisibleAndFocused(v, getMainWindow()) })
  reg('Cmd+Alt+Shift+D', dump('composer-empty'))
  reg('Cmd+Alt+Shift+T', dump('composer-filled'))
  reg('Cmd+Alt+Shift+F', dump('result'))
}
