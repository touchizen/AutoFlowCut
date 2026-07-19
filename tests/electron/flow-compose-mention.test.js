// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  EDITOR_SELECTOR,
  injectComposeSegments,
  insertSceneMention,
} from '../../electron/flow-compose-mention.js'
import {
  CLICK_CHARACTER_TAB,
  FILTER_TRIGGER_EXPR,
  CHAR_MENUITEM_EXPR,
  CHAR_FILTER_ACTIVE_EXPR,
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
  filterExists = true,
  charMenuItemExists = true,
  // 캐릭터 필터 적용 상태(트리거 아이콘 accessibility_new). ref 로 넘기면 trustedClick 이 선택 후 flip.
  charFilterActiveRef = { value: false },
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
    if (source === CHAR_FILTER_ACTIVE_EXPR) return charFilterActiveRef.value
    if (source === `!!(${FILTER_TRIGGER_EXPR})`) return filterExists
    if (source === `!!(${CHAR_MENUITEM_EXPR})`) return charMenuItemExists
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

  // 좁은 창: 탭이 타입 필터 드롭다운으로 접힘. Radix 트리거는 synthetic click(isTrusted:false)을
  //   무시하므로 trustedClick(sendInputEvent)으로 필터를 열고 캐릭터 항목을 골라야 한다.
  //   선택 후엔 트리거 아이콘(accessibility_new)로 "실제 적용"을 확정한다(클릭 전달 != 적용).
  it('좁은 레이아웃: 탭 없음 → 필터 열고 캐릭터 선택 → 적용 확정 후 진행', async () => {
    const charRef = { value: false }
    const trustedClick = vi.fn(async (expr) => {
      if (expr === CHAR_MENUITEM_EXPR) charRef.value = true // 선택하면 캐릭터 필터가 적용된다
      return { success: true }
    })
    const flowView = makeFlowView({ tabClicked: false, charFilterActiveRef: charRef })
    const result = await settle(insertSceneMention(flowView, NAME, trustedClick))

    expect(trustedClick).toHaveBeenNthCalledWith(1, FILTER_TRIGGER_EXPR, expect.objectContaining({ step: 'mention-filter-open' }))
    expect(trustedClick).toHaveBeenNthCalledWith(2, CHAR_MENUITEM_EXPR, expect.objectContaining({ step: 'mention-filter-character' }))
    expect(result).toEqual({ ok: true })
  })

  it('좁은 레이아웃: 이미 캐릭터 필터면 재선택 없이 바로 진행(trustedClick 미호출)', async () => {
    const trustedClick = vi.fn(async () => ({ success: true }))
    const flowView = makeFlowView({ tabClicked: false, charFilterActiveRef: { value: true } })
    const result = await settle(insertSceneMention(flowView, NAME, trustedClick))
    expect(trustedClick).not.toHaveBeenCalled()
    expect(result).toEqual({ ok: true })
  })

  it('좁은 레이아웃: 클릭은 됐지만 캐릭터 필터가 끝내 적용 안 되면 character-tab-not-found + 메뉴 Escape로 정리', async () => {
    // charRef 가 계속 false → 적용 확정 실패(동명 이미지 오선택 방지). 열린 메뉴는 Escape 로 닫는다.
    const trustedClick = vi.fn(async () => ({ success: true }))
    const flowView = makeFlowView({ tabClicked: false, charFilterActiveRef: { value: false } })
    const result = await settle(insertSceneMention(flowView, NAME, trustedClick))
    expect(result).toEqual({ ok: false, reason: 'character-tab-not-found' })
    // 실패 출구에서 Escape(trusted) 전송
    const escKeys = flowView.webContents.sendInputEvent.mock.calls.map((c) => c[0]?.keyCode)
    expect(escKeys).toContain('Escape')
  })

  it('좁은 레이아웃: filter 트리거가 없으면 character-tab-not-found', async () => {
    const trustedClick = vi.fn(async () => ({ success: true }))
    const flowView = makeFlowView({ tabClicked: false, filterExists: false })
    const result = await settle(insertSceneMention(flowView, NAME, trustedClick))
    expect(trustedClick).not.toHaveBeenCalled()
    expect(result).toEqual({ ok: false, reason: 'character-tab-not-found' })
  })

  it('좁은 레이아웃: 필터는 열렸지만 캐릭터 menuitem 이 안 뜨면 character-tab-not-found + Escape', async () => {
    const trustedClick = vi.fn(async () => ({ success: true }))
    const flowView = makeFlowView({ tabClicked: false, charMenuItemExists: false })
    const result = await settle(insertSceneMention(flowView, NAME, trustedClick))
    expect(trustedClick).toHaveBeenCalledWith(FILTER_TRIGGER_EXPR, expect.objectContaining({ step: 'mention-filter-open' }))
    expect(trustedClick).not.toHaveBeenCalledWith(CHAR_MENUITEM_EXPR, expect.anything())
    expect(result).toEqual({ ok: false, reason: 'character-tab-not-found' })
    const escKeys = flowView.webContents.sendInputEvent.mock.calls.map((c) => c[0]?.keyCode)
    expect(escKeys).toContain('Escape')
  })

  it('좁은 레이아웃: trustedClick 이 없으면(레거시 호출) character-tab-not-found (오선택 방지)', async () => {
    const result = await settle(insertSceneMention(makeFlowView({ tabClicked: false }), NAME))
    expect(result).toEqual({ ok: false, reason: 'character-tab-not-found' })
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
