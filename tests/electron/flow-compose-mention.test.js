// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  EDITOR_SELECTOR,
  injectComposeSegments,
  insertSceneMention,
} from '../../electron/flow-compose-mention.js'
import {
  CLICK_CHARACTER_TAB,
  MENTION_PROBE,
  chipCheck,
  dispatchMentionOption,
  hasMentionOption,
} from '../../electron/flow-mention-dom.js'

const NAME = 'Zed2'
const DIALOG_QUERY = `!!document.querySelector("div[role='dialog']")`

function makeFlowView({
  pickerOpened = true,
  probeHasDialog = pickerOpened,
  tabClicked = true,
  searchEntered = true,
  optionFound = true,
  optionCheckThrows = false,
  probeThrows = false,
  dispatched = true,
  dialogClosed = true,
  chipFound = true,
  textAppendOk = true,
} = {}) {
  let dialogChecks = 0
  const executeJavaScript = vi.fn(async (source) => {
    if (source === DIALOG_QUERY) {
      dialogChecks += 1
      if (!pickerOpened) return false
      return dialogChecks === 1 ? true : !dialogClosed
    }
    if (source === CLICK_CHARACTER_TAB) return tabClicked
    if (source.includes("Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')")) return searchEntered
    if (source === hasMentionOption(NAME)) {
      if (optionCheckThrows) throw new Error('renderer evaluation failed')
      return optionFound
    }
    if (source === dispatchMentionOption(NAME)) return dispatched
    if (source === chipCheck(EDITOR_SELECTOR, NAME)) {
      return { editorTextLen: NAME.length, hasMentionChip: chipFound, stillHasDialog: !dialogClosed }
    }
    if (source === MENTION_PROBE) {
      if (probeThrows) throw new Error('diagnostic probe failed')
      return {
        hasDialog: probeHasDialog,
        documentLang: 'en-US',
        tabCount: tabClicked ? 3 : 1,
        charTabFound: tabClicked,
        optionCount: optionFound ? 1 : 0,
        optionNameLens: optionFound ? [NAME.length] : [],
      }
    }
    if (source.includes("document.execCommand('insertText'")) return textAppendOk
    return true
  })

  return {
    webContents: {
      executeJavaScript,
      focus: vi.fn(),
      sendInputEvent: vi.fn(),
    },
  }
}

async function settle(promise) {
  await vi.runAllTimersAsync()
  return promise
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
})

describe('insertSceneMention failure contract', () => {
  it('discriminates a picker that never opened', async () => {
    const result = await settle(insertSceneMention(makeFlowView({ pickerOpened: false }), NAME))
    expect(result).toEqual({ ok: false, reason: 'picker-not-opened' })
  })

  it('hard-fails before matching a same-name All-tab image when the Characters tab does not activate', async () => {
    // optionFound=true models an image row whose caption/alt exactly equals NAME on the All tab.
    const flowView = makeFlowView({ tabClicked: false, optionFound: true })
    const result = await settle(insertSceneMention(flowView, NAME))

    expect(result).toEqual({ ok: false, reason: 'character-tab-not-found' })
    expect(flowView.webContents.executeJavaScript).toHaveBeenCalledWith(MENTION_PROBE)
    expect(flowView.webContents.executeJavaScript).not.toHaveBeenCalledWith(hasMentionOption(NAME))
    expect(flowView.webContents.executeJavaScript).not.toHaveBeenCalledWith(dispatchMentionOption(NAME))
  })

  it('discriminates an option that is absent after the Characters tab filter', async () => {
    const result = await settle(insertSceneMention(makeFlowView({ optionFound: false }), NAME))
    expect(result).toEqual({ ok: false, reason: 'option-not-found' })
  })

  it('does not classify renderer errors during option checks as option-not-found', async () => {
    const result = await settle(insertSceneMention(makeFlowView({ optionCheckThrows: true }), NAME))
    expect(result).toEqual({ ok: false, reason: 'option-check-failed' })
  })

  it('does not classify a picker that vanished during polling as option-not-found', async () => {
    const result = await settle(insertSceneMention(makeFlowView({ optionFound: false, probeHasDialog: false }), NAME))
    expect(result).toEqual({ ok: false, reason: 'picker-closed-before-selection' })
  })

  it('keeps option-not-found when only its diagnostic probe throws', async () => {
    const result = await settle(insertSceneMention(makeFlowView({ optionFound: false, probeThrows: true }), NAME))
    expect(result).toEqual({ ok: false, reason: 'option-not-found' })
  })

  it('does not treat a missing picker search input as stale registration evidence', async () => {
    const result = await settle(insertSceneMention(makeFlowView({ searchEntered: false }), NAME))
    expect(result).toEqual({ ok: false, reason: 'search-input-not-found' })
  })

  it('discriminates a picker that remains open after dispatch and Enter fallback', async () => {
    const result = await settle(insertSceneMention(makeFlowView({ dialogClosed: false }), NAME))
    expect(result).toEqual({ ok: false, reason: 'dialog-not-closed' })
  })

  it('keeps chip verification and discriminates its failure', async () => {
    const result = await settle(insertSceneMention(makeFlowView({ chipFound: false }), NAME))
    expect(result).toEqual({ ok: false, reason: 'chip-verification-failed' })
  })

  it('returns a successful discriminant only after the dialog closes and the chip is present', async () => {
    const result = await settle(insertSceneMention(makeFlowView(), NAME))
    expect(result).toEqual({ ok: true })
  })
})

describe('injectComposeSegments staleMention routing', () => {
  it.each([
    ['picker-not-opened', { pickerOpened: false }],
    ['character-tab-not-found', { tabClicked: false }],
    ['search-input-not-found', { searchEntered: false }],
    ['option-check-failed', { optionCheckThrows: true }],
    ['picker-closed-before-selection', { optionFound: false, probeHasDialog: false }],
    ['dialog-not-closed', { dialogClosed: false }],
    ['chip-verification-failed', { chipFound: false }],
  ])('does not mark %s as stale registration evidence', async (reason, flowOptions) => {
    const result = await settle(injectComposeSegments(makeFlowView(flowOptions), [
      { type: 'mention', name: NAME },
    ]))

    expect(result).toMatchObject({
      ok: false,
      errorKind: reason,
      error: 'Mention selection failed',
      mentionFailure: reason,
    })
    expect(result.error).not.toContain(NAME)
    expect(result).not.toHaveProperty('staleMention')
  })

  it('marks only option-not-found as stale registration evidence', async () => {
    const result = await settle(injectComposeSegments(makeFlowView({ optionFound: false }), [
      { type: 'mention', name: NAME },
    ]))

    expect(result).toMatchObject({
      ok: false,
      errorKind: 'option-not-found',
      error: 'Mention selection failed',
      mentionFailure: 'option-not-found',
      staleMention: NAME,
    })
    expect(result.error).not.toContain(NAME)
  })

  it('keeps stale registration evidence when the option-not-found diagnostic probe throws', async () => {
    const result = await settle(injectComposeSegments(makeFlowView({ optionFound: false, probeThrows: true }), [
      { type: 'mention', name: NAME },
    ]))

    expect(result).toMatchObject({
      ok: false,
      errorKind: 'option-not-found',
      error: 'Mention selection failed',
      mentionFailure: 'option-not-found',
      staleMention: NAME,
    })
    expect(result.error).not.toContain(NAME)
  })

  it('returns a coded, content-free error when text injection fails', async () => {
    const result = await settle(injectComposeSegments(makeFlowView({ textAppendOk: false }), [
      { type: 'text', text: 'private prompt text' },
    ]))

    expect(result).toEqual({
      ok: false,
      errorKind: 'text-injection-failed',
      error: 'Text injection failed',
    })
    expect(result.error).not.toContain('private prompt text')
  })
})
