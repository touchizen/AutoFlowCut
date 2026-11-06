// @vitest-environment node
import { describe, it, expect, vi } from 'vitest'
import { typeFlowText } from '../../electron/flow-native-input.js'

function page({ focused = true, readback = 'hello', beforeText = '', aborted = () => false } = {}) {
  const wc = {
    isDestroyed: () => false, isFocused: () => true,
    executeJavaScriptInIsolatedWorld: vi.fn().mockResolvedValueOnce([{ focused, text: beforeText }]).mockResolvedValue([{ focused: true, text: readback }]),
    executeJavaScript: vi.fn(), selectAll: vi.fn(), sendInputEvent: vi.fn(), insertText: vi.fn().mockResolvedValue(undefined),
  }
  return { wc, opts: { isAborted: aborted } }
}

describe('native Flow prompt input', () => {
  it('selects text natively and sends trusted char input without page mutation', async () => {
    const { wc, opts } = page()
    expect(await typeFlowText(wc, 'hello', opts)).toMatchObject({ ok: true })
    expect(wc.selectAll).toHaveBeenCalledOnce()
    expect(wc.sendInputEvent.mock.calls.map(([e]) => e)).toEqual([... 'hello'].map(keyCode => ({ type: 'char', keyCode })))
    expect(wc.executeJavaScript).not.toHaveBeenCalled()
    for (const [world, scripts] of wc.executeJavaScriptInIsolatedWorld.mock.calls) {
      expect(world).toBe(997)
      expect(scripts[0].code).not.toMatch(/execCommand|dispatchEvent|\.value\s*=|window\.\w+\s*=/)
    }
  })
  it('uses native IME insertion for Korean, emoji and line breaks, never Enter', async () => {
    const text = '한글🙂\n다음 줄'
    const { wc, opts } = page({ readback: text })
    expect(await typeFlowText(wc, text, opts)).toMatchObject({ ok: true })
    expect(wc.insertText.mock.calls.map(([s]) => s).join('')).toBe(text)
    expect(wc.sendInputEvent).not.toHaveBeenCalled()
  })
  it('does not type into another focus target', async () => {
    const { wc, opts } = page({ focused: false })
    expect(await typeFlowText(wc, 'hello', opts)).toMatchObject({ ok: false })
    expect(wc.selectAll).not.toHaveBeenCalled()
    expect(wc.sendInputEvent).not.toHaveBeenCalled()
  })
  it('refuses cancelled work before any input', async () => {
    const { wc, opts } = page({ aborted: () => true })
    expect(await typeFlowText(wc, 'hello', opts)).toMatchObject({ ok: false })
    expect(wc.executeJavaScriptInIsolatedWorld).not.toHaveBeenCalled()
    expect(wc.selectAll).not.toHaveBeenCalled()
  })
  it('does not retry or fall back to DOM mutation on a readback mismatch', async () => {
    const { wc, opts } = page({ readback: 'changed by user' })
    expect(await typeFlowText(wc, 'hello', opts)).toMatchObject({ ok: false, reason: 'text-mismatch' })
    expect(wc.selectAll).toHaveBeenCalledOnce()
    expect(wc.executeJavaScript).not.toHaveBeenCalled()
  })
  it('rejects append readback if existing text was lost', async () => {
    const { wc } = page({ beforeText: 'prefix ', readback: 'hello' })
    expect(await typeFlowText(wc, 'hello', { append: true })).toMatchObject({ ok: false, reason: 'text-mismatch' })
  })
  it('refuses navigation during the initial isolated read', async () => {
    let url = 'https://flow.google.com/project/one'
    const { wc, opts } = page()
    wc.getURL = () => url
    wc.executeJavaScriptInIsolatedWorld.mockReset().mockImplementationOnce(async () => {
      url = 'https://flow.google.com/project/two'
      return { focused: true, text: '' }
    })
    expect(await typeFlowText(wc, 'hello', opts)).toMatchObject({ ok: false })
    expect(wc.selectAll).not.toHaveBeenCalled()
    expect(wc.sendInputEvent).not.toHaveBeenCalled()
  })
  it('appends without selecting existing mention chips', async () => {
    const { wc } = page({ beforeText: 'prefix ', readback: 'prefix hello' })
    expect(await typeFlowText(wc, 'hello', { append: true })).toMatchObject({ ok: true })
    expect(wc.selectAll).not.toHaveBeenCalled()
  })
})
