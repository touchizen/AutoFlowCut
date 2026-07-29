import { describe, it, expect, vi } from 'vitest'
import { ensureChatgptView, isAliveAndOnOrigin, ensureVisibleAndFocused, CHATGPT_URL } from '../../electron/spike-chatgpt-view.js'

function fakeView(url, destroyed = false) {
  return { webContents: { getURL: () => url, isDestroyed: () => destroyed, focus: vi.fn(), loadURL: vi.fn() }, setBounds: vi.fn() }
}

describe('ensureChatgptView idempotence', () => {
  it('reuses view when alive and on chatgpt.com origin (no makeView, no reload)', () => {
    const existing = fakeView('https://chatgpt.com/c/abc')
    const makeView = vi.fn()
    const state = { view: existing }
    const v = ensureChatgptView(state, { makeView, isAliveAndOnOrigin })
    expect(v).toBe(existing)
    expect(makeView).not.toHaveBeenCalled()
  })
  it('creates a new view when none exists', () => {
    const created = fakeView(CHATGPT_URL)
    const makeView = vi.fn(() => created)
    const state = { view: null }
    const v = ensureChatgptView(state, { makeView, isAliveAndOnOrigin })
    expect(makeView).toHaveBeenCalledOnce()
    expect(v).toBe(created)
    expect(state.view).toBe(created)
  })
  it('recreates when current doc is off-origin (login redirect / error)', () => {
    const offOrigin = fakeView('https://auth.openai.com/login')
    const created = fakeView(CHATGPT_URL)
    const makeView = vi.fn(() => created)
    const state = { view: offOrigin }
    ensureChatgptView(state, { makeView, isAliveAndOnOrigin })
    expect(makeView).toHaveBeenCalledOnce()
  })
  it('recreates when about:blank', () => {
    const blank = fakeView('about:blank')
    const makeView = vi.fn(() => fakeView(CHATGPT_URL))
    ensureChatgptView({ view: blank }, { makeView, isAliveAndOnOrigin })
    expect(makeView).toHaveBeenCalledOnce()
  })
  it('recreates when destroyed', () => {
    const dead = fakeView('https://chatgpt.com/', true)
    const makeView = vi.fn(() => fakeView(CHATGPT_URL))
    ensureChatgptView({ view: dead }, { makeView, isAliveAndOnOrigin })
    expect(makeView).toHaveBeenCalledOnce()
  })
})

describe('ensureVisibleAndFocused', () => {
  it('attaches, sets non-zero bounds, focuses window and view', () => {
    const view = fakeView(CHATGPT_URL)
    const mainWindow = { contentView: { addChildView: vi.fn() }, focus: vi.fn(), getBounds: () => ({ x: 0, y: 0, width: 1200, height: 800 }) }
    ensureVisibleAndFocused(view, mainWindow, {})
    expect(mainWindow.contentView.addChildView).toHaveBeenCalledWith(view)
    const bounds = view.setBounds.mock.calls[0][0]
    expect(bounds.width).toBeGreaterThan(0)
    expect(bounds.height).toBeGreaterThan(0)
    expect(mainWindow.focus).toHaveBeenCalled()
    expect(view.webContents.focus).toHaveBeenCalled()
  })
})
