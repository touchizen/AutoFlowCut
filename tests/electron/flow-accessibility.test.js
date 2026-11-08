// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { blockFlowPageScripts, hasAccessibleWarning } from '../../electron/flow-accessibility.js'

const node = (role, { name = '', value = '', selected, children = [] } = {}) => ({
  role,
  name,
  value,
  ...(selected === undefined ? {} : { selected }),
  children,
})

describe('Flow OS accessibility safety', () => {
  it('ignores warning text quoted inside the composer editor', () => {
    const root = node('WebArea', { children: [
      node('Group', { name: 'Image composer', children: [
        node('TextField', { name: 'Prompt', value: 'Flow says unusual activity detected; I want to depict the phrase.' }),
      ] }),
    ] })

    expect(hasAccessibleWarning(root)).toBe(false)
  })

  it('detects an actual service warning outside editable controls', () => {
    const root = node('WebArea', { children: [
      node('Alert', { name: 'unusual activity detected' }),
      node('Group', { name: 'Image composer', children: [node('TextField', { name: 'Prompt', value: 'A landscape' })] }),
    ] })

    expect(hasAccessibleWarning(root)).toBe(true)
  })

  it('blocks main-world and isolated-world page script execution', async () => {
    const mainWorld = vi.fn(async () => 'main result')
    const isolatedWorld = vi.fn(async () => 'isolated result')
    const wc = {
      executeJavaScript: mainWorld,
      executeJavaScriptInIsolatedWorld: isolatedWorld,
    }

    blockFlowPageScripts(wc)

    await expect(wc.executeJavaScript('return true')).rejects.toThrow('flow-page-script-disabled')
    await expect(wc.executeJavaScriptInIsolatedWorld(1, [{ code: 'return true' }])).rejects.toThrow('flow-page-script-disabled')
    expect(mainWorld).not.toHaveBeenCalled()
    expect(isolatedWorld).not.toHaveBeenCalled()
  })
})
