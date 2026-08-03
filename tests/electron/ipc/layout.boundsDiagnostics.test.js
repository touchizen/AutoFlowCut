// tests/electron/ipc/layout.boundsDiagnostics.test.js
// @vitest-environment node
//
// A blank ChatGPT view can be a blocked navigation, a failed load, OR a bounds problem
// (view sized to nothing / positioned off-screen). The first two log in
// sessionViewSecurity; this pins the third: when the session-target strip inset is in
// effect, the computed bounds are logged once per change (numbers only) so a single dev
// run can tell the three causes apart.
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  powerSaveBlocker: { start: vi.fn(), stop: vi.fn(), isStarted: vi.fn(() => false) },
  shell: { openExternal: vi.fn(), showItemInFolder: vi.fn() },
}))

import {
  setLayoutMode,
  setModalVisible,
  setSplitRatio,
  updateBounds,
} from '../../../electron/ipc/layout.js'
import { SESSION_TARGET_STRIP_HEIGHT } from '../../../src/utils/appLayout.js'

const windowOf = (width, height) => ({ getContentBounds: () => ({ width, height }) })

const boundsLogs = (spy) =>
  spy.mock.calls.filter(([msg]) => String(msg).includes('[SessionView] bounds'))

let log
beforeEach(() => {
  log = vi.spyOn(console, 'log').mockImplementation(() => {})
  setLayoutMode('split-left')
  setSplitRatio(0.5)
  setModalVisible(false)
})
afterEach(() => { log.mockRestore() })

describe('session view bounds diagnostics', () => {
  it('logs the computed bounds once when the strip inset is applied, and not again for the same bounds', () => {
    const view = { setBounds: vi.fn() }
    const mw = windowOf(1000, 600)

    updateBounds(mw, view, { sessionTargetStripEnabled: true })
    updateBounds(mw, view, { sessionTargetStripEnabled: true })

    const logs = boundsLogs(log)
    expect(logs).toHaveLength(1)
    // Numbers only, matching exactly what was applied to the native view.
    expect(logs[0][1]).toEqual({
      x: 0, y: SESSION_TARGET_STRIP_HEIGHT, width: 497, height: 600 - SESSION_TARGET_STRIP_HEIGHT,
    })
    expect(view.setBounds).toHaveBeenLastCalledWith(logs[0][1])
  })

  it('logs again when the bounds actually change', () => {
    const view = { setBounds: vi.fn() }

    updateBounds(windowOf(1200, 700), view, { sessionTargetStripEnabled: true })
    setSplitRatio(0.3)
    updateBounds(windowOf(1200, 700), view, { sessionTargetStripEnabled: true })

    const logs = boundsLogs(log)
    expect(logs).toHaveLength(2)
    expect(logs[0][1]).not.toEqual(logs[1][1])
  })

  it('logs the 0x0 collapse (modal open) so "view sized to nothing" is observable', () => {
    const view = { setBounds: vi.fn() }
    setModalVisible(true)

    updateBounds(windowOf(1400, 800), view, { sessionTargetStripEnabled: true })

    const logs = boundsLogs(log)
    expect(logs).toHaveLength(1)
    expect(logs[0][1]).toEqual({ x: 0, y: 0, width: 0, height: 0 })
  })

  it('POSITIVE CONTROL: with the strip disabled nothing is logged and bounds are unchanged', () => {
    const view = { setBounds: vi.fn() }

    updateBounds(windowOf(1600, 900), view, { sessionTargetStripEnabled: false })

    expect(boundsLogs(log)).toHaveLength(0)
    expect(view.setBounds).toHaveBeenLastCalledWith({ x: 0, y: 0, width: 797, height: 900 })
  })
})
