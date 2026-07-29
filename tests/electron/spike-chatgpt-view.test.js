import { describe, it, expect, vi } from 'vitest'
import { ensureChatgptView, isAliveAndOnOrigin, ensureVisibleAndFocused, CHATGPT_URL } from '../../electron/spike-chatgpt-view.js'

function fakeView(url, destroyed = false) {
  return { webContents: { getURL: () => url, isDestroyed: () => destroyed, focus: vi.fn(), loadURL: vi.fn() }, setBounds: vi.fn() }
}

describe('ensureChatgptView idempotence', () => {
  it('reuses view when alive and on chatgpt.com origin (no makeView, no reload)', () => {
    const existing = fakeView('https://chatgpt.com/c/abc')
    const makeView = vi.fn()
    const disposeView = vi.fn()
    const state = { view: existing }
    const v = ensureChatgptView(state, { makeView, isAliveAndOnOrigin, disposeView })
    expect(v).toBe(existing)
    expect(makeView).not.toHaveBeenCalled()
    expect(existing.webContents.loadURL).not.toHaveBeenCalled()
    expect(disposeView).not.toHaveBeenCalled()
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
  it('disposes the previous view before recreating it', () => {
    const offOrigin = fakeView('https://auth.openai.com/login')
    const created = fakeView(CHATGPT_URL)
    const disposeView = vi.fn()
    const makeView = vi.fn(() => created)
    ensureChatgptView({ view: offOrigin }, { makeView, isAliveAndOnOrigin, disposeView })
    expect(disposeView).toHaveBeenCalledWith(offOrigin)
    expect(disposeView.mock.invocationCallOrder[0]).toBeLessThan(makeView.mock.invocationCallOrder[0])
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
  it('attaches using content bounds and focuses window and view', () => {
    const view = fakeView(CHATGPT_URL)
    const getContentBounds = vi.fn(() => ({ x: 0, y: 0, width: 1200, height: 800 }))
    const mainWindow = { contentView: { addChildView: vi.fn() }, focus: vi.fn(), getContentBounds }
    ensureVisibleAndFocused(view, mainWindow, {})
    expect(mainWindow.contentView.addChildView).toHaveBeenCalledWith(view)
    const bounds = view.setBounds.mock.calls[0][0]
    expect(getContentBounds).toHaveBeenCalledOnce()
    expect(bounds).toEqual({ x: 0, y: 0, width: 1200, height: 800 })
    expect(mainWindow.focus).toHaveBeenCalled()
    expect(view.webContents.focus).toHaveBeenCalled()
  })
})
