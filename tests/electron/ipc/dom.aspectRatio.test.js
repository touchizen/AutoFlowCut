// @vitest-environment node

/**
 * flow:dom-set-aspect-ratio — Radix Tabs aspect ratio selection
 *
 * Regression 1 (selector): a *contains* matcher (id*='-trigger-PORTRAIT')
 * also matched -trigger-PORTRAIT_3_4 (the 3:4 tab); picking 9:16 clicked 3:4.
 * The handler now targets the exact id suffix ([id$=...]).
 *
 * Regression 2 (no verification): the handler clicked the tab and reported
 * success without checking the click took effect. The first click of a batch
 * could silently fail → that scene generated at Flow's default 16:9, while
 * scenes 2+ (re-click / already-set) came out correct. The handler now
 * verifies aria-selected flipped and retries.
 */

import { describe, it, expect, vi } from 'vitest'
import { registerDomIPC } from '../../../electron/ipc/dom.js'

/**
 * @param tabStates - readTab() results returned in call order; the last
 *   entry repeats for any further calls.
 */
function setup({ tabStates, clickResult = { success: true } }) {
  const handlers = {}
  const ipcMain = { handle: vi.fn((ch, fn) => { handlers[ch] = fn }) }
  let call = 0
  const executeJavaScript = vi.fn(() => {
    const v = tabStates[Math.min(call, tabStates.length - 1)]
    call += 1
    return Promise.resolve(v)
  })
  const flowView = { webContents: { executeJavaScript } }
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

const NOT_ACTIVE = { found: true, active: false }
const ACTIVE = { found: true, active: true }

describe('flow:dom-set-aspect-ratio', () => {
  it('clicks the exact 9:16 (PORTRAIT) tab — never the 3:4 (PORTRAIT_3_4) tab', async () => {
    const { invoke, trustedClickOnFlowView } = setup({ tabStates: [NOT_ACTIVE, ACTIVE] })

    const res = await invoke({}, { aspectRatio: '9:16' })

    expect(res).toMatchObject({ success: true, method: 'tab' })
    const selector = trustedClickOnFlowView.mock.calls[0][0]
    expect(selector).toContain("[id$='-trigger-PORTRAIT']")
    expect(selector).not.toContain('id*=')
    expect(selector).not.toContain('-trigger-PORTRAIT_3_4')
  })

  it('clicks the 16:9 (LANDSCAPE) tab via the exact suffix', async () => {
    const { invoke, trustedClickOnFlowView } = setup({ tabStates: [NOT_ACTIVE, ACTIVE] })

    const res = await invoke({}, { aspectRatio: '16:9' })

    expect(res).toMatchObject({ success: true, method: 'tab' })
    const selector = trustedClickOnFlowView.mock.calls[0][0]
    expect(selector).toContain("[id$='-trigger-LANDSCAPE']")
    expect(selector).not.toContain('-trigger-LANDSCAPE_4_3')
  })

  it('skips the click when the target ratio is already active', async () => {
    const { invoke, trustedClickOnFlowView } = setup({ tabStates: [ACTIVE] })

    const res = await invoke({}, { aspectRatio: '9:16' })

    expect(res).toMatchObject({ success: true, alreadySet: true })
    expect(trustedClickOnFlowView).not.toHaveBeenCalled()
  })

  it('verifies the click took effect — succeeds on the first attempt', async () => {
    const { invoke, trustedClickOnFlowView } = setup({ tabStates: [NOT_ACTIVE, ACTIVE] })

    const res = await invoke({}, { aspectRatio: '9:16' })

    expect(res).toMatchObject({ success: true, attempts: 1 })
    expect(trustedClickOnFlowView).toHaveBeenCalledTimes(1)
  })

  it('retries when the first click did not switch the tab', async () => {
    // poll: NOT_ACTIVE → click → still NOT_ACTIVE → retry → ACTIVE
    const { invoke, trustedClickOnFlowView } = setup({
      tabStates: [NOT_ACTIVE, NOT_ACTIVE, ACTIVE],
    })

    const res = await invoke({}, { aspectRatio: '9:16' })

    expect(res).toMatchObject({ success: true, attempts: 2 })
    expect(trustedClickOnFlowView).toHaveBeenCalledTimes(2)
  })

  it('fails (controlFound:true) after 3 attempts when the tab never switches', async () => {
    const { invoke, trustedClickOnFlowView } = setup({ tabStates: [NOT_ACTIVE] })

    const res = await invoke({}, { aspectRatio: '9:16' })

    // control IS there, just won't switch → caller should abort
    expect(res).toMatchObject({ success: false, controlFound: true })
    expect(trustedClickOnFlowView).toHaveBeenCalledTimes(3)
  })

  it('reports controlFound:false when neither the tab nor the legacy combobox exists', async () => {
    const { invoke, trustedClickOnFlowView } = setup({
      tabStates: [{ found: false }],
      clickResult: { success: false },
    })

    const res = await invoke({}, { aspectRatio: '9:16' })

    // control is genuinely absent → caller should NOT block generation
    expect(res).toMatchObject({ success: false, controlFound: false })
    expect(trustedClickOnFlowView).toHaveBeenCalled() // legacy combobox was attempted
  })
})
