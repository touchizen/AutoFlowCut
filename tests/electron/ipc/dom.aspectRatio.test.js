// @vitest-environment node

/**
 * flow:dom-set-aspect-ratio — Radix Tabs aspect ratio selection
 *
 * Regression: the previous fallback selector used a *contains* matcher
 * (id*='-trigger-PORTRAIT'), which ALSO matched -trigger-PORTRAIT_3_4 (the
 * 3:4 tab). querySelector returns the first match in DOM order and 3:4 comes
 * before 9:16 — so picking 9:16 actually clicked 3:4. It also used an
 * untrusted btn.click() that Flow ignores. The handler now targets the exact
 * id suffix ([id$=...]) and clicks via the trusted-click helper.
 */

import { describe, it, expect, vi } from 'vitest'
import { registerDomIPC } from '../../../electron/ipc/dom.js'

function setup({ tabState, clickResult = { success: true } }) {
  const handlers = {}
  const ipcMain = { handle: vi.fn((ch, fn) => { handlers[ch] = fn }) }
  const flowView = {
    webContents: { executeJavaScript: vi.fn().mockResolvedValue(tabState) },
  }
  const trustedClickOnFlowView = vi.fn().mockResolvedValue(clickResult)
  registerDomIPC(ipcMain, {
    getFlowView: () => flowView,
    getMainWindow: () => ({}),
    trustedClickOnFlowView,
    FLOW_URL: 'https://flow',
    setEnterToolClicked: vi.fn(),
  })
  return { invoke: handlers['flow:dom-set-aspect-ratio'], trustedClickOnFlowView }
}

describe('flow:dom-set-aspect-ratio', () => {
  it('clicks the exact 9:16 (PORTRAIT) tab — never the 3:4 (PORTRAIT_3_4) tab', async () => {
    const { invoke, trustedClickOnFlowView } = setup({ tabState: { found: true, active: false } })

    const res = await invoke({}, { aspectRatio: '9:16' })

    expect(res).toMatchObject({ success: true, method: 'tab' })
    const selector = trustedClickOnFlowView.mock.calls[0][0]
    expect(selector).toContain("[id$='-trigger-PORTRAIT']") // exact-suffix matcher
    expect(selector).not.toContain('id*=')                  // not a contains matcher
    expect(selector).not.toContain('-trigger-PORTRAIT_3_4') // never targets the 3:4 tab
  })

  it('clicks the 16:9 (LANDSCAPE) tab via the exact suffix', async () => {
    const { invoke, trustedClickOnFlowView } = setup({ tabState: { found: true, active: false } })

    const res = await invoke({}, { aspectRatio: '16:9' })

    expect(res).toMatchObject({ success: true, method: 'tab' })
    const selector = trustedClickOnFlowView.mock.calls[0][0]
    expect(selector).toContain("[id$='-trigger-LANDSCAPE']")
    expect(selector).not.toContain('-trigger-LANDSCAPE_4_3')
  })

  it('skips the click when the target ratio is already active', async () => {
    const { invoke, trustedClickOnFlowView } = setup({ tabState: { found: true, active: true } })

    const res = await invoke({}, { aspectRatio: '9:16' })

    expect(res).toMatchObject({ success: true, alreadySet: true })
    expect(trustedClickOnFlowView).not.toHaveBeenCalled()
  })

  it('reports failure when the tab is missing and the legacy combobox is absent', async () => {
    const { invoke, trustedClickOnFlowView } = setup({
      tabState: { found: false },
      clickResult: { success: false },
    })

    const res = await invoke({}, { aspectRatio: '9:16' })

    expect(res.success).toBe(false)
    expect(trustedClickOnFlowView).toHaveBeenCalled() // legacy combobox was attempted
  })
})
