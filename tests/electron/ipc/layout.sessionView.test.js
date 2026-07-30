// tests/electron/ipc/layout.sessionView.test.js
// @vitest-environment node
import { it, expect, vi } from 'vitest'

vi.mock('electron', () => ({
  powerSaveBlocker: { start: vi.fn(), stop: vi.fn(), isStarted: vi.fn(() => false) },
  shell: { openExternal: vi.fn(), showItemInFolder: vi.fn() },
}))

import { registerLayoutIPC } from '../../../electron/ipc/layout.js'

it('layout handlers always resolve the active session view', async () => {
  const handlers = {}
  const active = { setBounds: vi.fn(), webContents: { capturePage: vi.fn().mockResolvedValue({ toDataURL: () => 'data:x' }) } }
  const getActiveSessionView = vi.fn(() => active)
  const win = { getContentBounds: () => ({ width: 1000, height: 600 }), webContents: { send: vi.fn(), focus: vi.fn() } }
  registerLayoutIPC({ handle: (ch, fn) => { handlers[ch] = fn } }, () => win, getActiveSessionView)
  await handlers['app:set-layout']({}, { mode: 'split-left', ratio: 0.5 })
  await handlers['app:flow-drag-start']()
  await handlers['app:flow-drag-end']()
  await handlers['app:set-modal-visible']({}, { visible: true })
  expect(getActiveSessionView).toHaveBeenCalled()
  expect(active.setBounds).toHaveBeenCalled()
})
