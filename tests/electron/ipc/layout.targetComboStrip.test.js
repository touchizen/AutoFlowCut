// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

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

const mainWindow = {
  getContentBounds: () => ({ width: 1000, height: 600 }),
}

beforeEach(() => {
  setSplitRatio(0.5)
  setModalVisible(false)
})

describe('session target strip bounds', () => {
  it('preserves exact old bounds with the flag off and reserves strip height with an on positive control', () => {
    const view = { setBounds: vi.fn() }
    setLayoutMode('split-left')

    updateBounds(mainWindow, view, { sessionTargetStripEnabled: false })
    expect(view.setBounds).toHaveBeenLastCalledWith({ x: 0, y: 0, width: 497, height: 600 })

    updateBounds(mainWindow, view, { sessionTargetStripEnabled: true })
    expect(view.setBounds).toHaveBeenLastCalledWith({
      x: 0,
      y: SESSION_TARGET_STRIP_HEIGHT,
      width: 497,
      height: 600 - SESSION_TARGET_STRIP_HEIGHT,
    })
  })

  it.each([
    ['split-left', { x: 0, y: SESSION_TARGET_STRIP_HEIGHT, width: 497, height: 600 - SESSION_TARGET_STRIP_HEIGHT }],
    ['split-right', { x: 503, y: SESSION_TARGET_STRIP_HEIGHT, width: 497, height: 600 - SESSION_TARGET_STRIP_HEIGHT }],
    ['split-top', { x: 0, y: SESSION_TARGET_STRIP_HEIGHT, width: 1000, height: 297 - SESSION_TARGET_STRIP_HEIGHT }],
    ['split-bottom', { x: 0, y: 303 + SESSION_TARGET_STRIP_HEIGHT, width: 1000, height: 297 - SESSION_TARGET_STRIP_HEIGHT }],
  ])('places the native view below the renderer strip in %s', (mode, expected) => {
    const view = { setBounds: vi.fn() }
    setLayoutMode(mode)
    updateBounds(mainWindow, view, { sessionTargetStripEnabled: true })
    expect(view.setBounds).toHaveBeenLastCalledWith(expected)
  })
})
