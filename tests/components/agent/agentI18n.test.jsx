// @vitest-environment jsdom
//
// D14: *"UI 문자열/응답 언어는 앱 locale 을 따른다"*.
//
// 🔴 **승인 창을 못 읽으면 눈 감고 승인하는 것이다.** 기본 언어는 `en` 인데(useI18n.jsx DEFAULT_LANG)
//    ApprovalDialog / ChatPanel 은 한글이 하드코딩돼 있었다 — 영어 사용자는 **자기 돈이 나가는 작업의
//    승인 문구를 읽을 수 없었다.** commit c18ff32("사람에게 무엇을 승인하는지 보여준다")의 목적이
//    locale 하나로 무너진다.
//
// 🔴 **문자열을 하나씩 세지 않는다.** 그건 빠뜨리기 쉽고, 빠뜨려도 초록이다.
//    대신 **효과**를 단언한다: `lang=en` 에서 렌더된 DOM 에 **한글이 한 글자라도 남아 있으면 실패**.
//    새 문자열을 추가하고 locale 에 안 넣으면 이 테스트가 즉시 잡는다.
import React from 'react'
import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { I18nProvider } from '../../../src/hooks/useI18n'
import { __resetFlowHiddenForTests } from '../../../src/hooks/useModalVisibility'
import ChatPanel from '../../../src/components/agent/ChatPanel.jsx'
import ApprovalDialog from '../../../src/components/agent/ApprovalDialog.jsx'
import en from '../../../src/locales/en.js'
import ko from '../../../src/locales/ko.js'

const HANGUL = /[가-힣]/

const REDESIGN_KEYS = [
  'openPanel', 'dismissPanel', 'modelLabel', 'modelDefault', 'codexProvider',
  'claudeProvider', 'comingSoon', 'slideMode', 'floatingMode', 'modeToggle',
  'switchToSlide', 'switchToFloating', 'flowFloatingOnly', 'sendTooltip',
  'steerTooltip', 'stopTooltip', 'closeSessionTooltip',
]

function agentApi() {
  const listeners = new Map()
  return {
    agentSessionOpen: vi.fn(async () => ({ sessionId: 's1' })),
    agentSend: vi.fn(async () => ({ turn: { id: 't1' } })),
    agentSteer: vi.fn(async () => ({})),
    agentAbort: vi.fn(async () => ({})),
    agentSessionClose: vi.fn(async () => ({})),
    agentListModels: vi.fn(async () => []),
    onAgentEvent: vi.fn((channel, cb) => { listeners.set(channel, cb); return () => listeners.delete(channel) }),
    onToolBridgeRequest: vi.fn(() => () => {}),
    respondToolBridge: vi.fn(),
    emitToolBridgeEvent: vi.fn(),
    onAgentPermissionRequest: vi.fn((cb) => { listeners.set('perm', cb); return () => listeners.delete('perm') }),
    respondAgentPermission: vi.fn(),
    setModalVisible: vi.fn(),
    fire: (channel, payload) => listeners.get(channel)?.(payload),
  }
}

const batchSources = () => ({
  automation: { isRunning: false, status: 'done' },
  scenes: [], references: [], generatingRefs: [], refBatchRunning: false,
})

function renderIn(lang, ui) {
  localStorage.setItem('autoflowcut_lang', lang)
  return render(<I18nProvider>{ui}</I18nProvider>)
}

beforeEach(() => { window.electronAPI = agentApi(); __resetFlowHiddenForTests() })
afterEach(() => { cleanup(); localStorage.clear(); delete window.electronAPI })

describe('승인 창은 Flow 네이티브 뷰 위로 올라온다', () => {
  // 🔴 Flow 는 Electron `WebContentsView` — **네이티브 레이어라 CSS z-index 로는 절대 못 가린다.**
  //    (`useModalVisibility` 주석이 이미 그렇게 적어뒀고, 설정 모달은 그 훅을 쓴다.)
  //    승인 창만 안 쓰고 있었다 → Flow UI 가 승인 문구를 덮어서 **무엇을 승인하는지 안 보였다** (실앱 실측).
  //    z-index 를 올리는 건 이 문제를 못 고친다 — 다른 레이어이기 때문이다.
  it('승인 요청이 뜨면 Flow 뷰를 접고, 답하면 되돌린다', () => {
    render(<ApprovalDialog />)
    const setModalVisible = window.electronAPI.setModalVisible

    expect(setModalVisible, '창이 없을 땐 Flow 를 건드리지 않는다').not.toHaveBeenCalled()

    act(() => window.electronAPI.fire('perm', {
      requestId: 'r1', tool: 'story_set_speakers',
      args: { speakers: [{ id: 'narrator', name: 'Narrator', voice: null }] },
      sessionId: 's1',
    }))
    expect(setModalVisible, 'Flow 를 안 접었다 — 네이티브 뷰가 승인 창을 덮는다')
      .toHaveBeenCalledWith({ visible: true })

    setModalVisible.mockClear()
    act(() => screen.getByRole('button', { name: 'Approve' }).click())

    // 답했으면 Flow 를 되돌려야 한다. 안 그러면 Flow 화면이 영영 접힌 채로 남는다.
    expect(setModalVisible, '답했는데 Flow 가 접힌 채로 남는다').toHaveBeenCalledWith({ visible: false })
  })
})

describe('에이전트 UI 는 앱 locale 을 따른다 (D14)', () => {
  it('lang=en 이면 ChatPanel 에 한글이 남지 않는다', () => {
    const { container } = renderIn('en', <ChatPanel projectKey="p" batchStatusSources={batchSources()} />)

    const leaked = [...container.querySelectorAll('*')]
      .flatMap((el) => [el.textContent, el.getAttribute('title'), el.getAttribute('aria-label'), el.getAttribute('placeholder')])
      .filter((text) => text && HANGUL.test(text))

    expect(leaked, `영어 UI 에 한글이 남았다: ${JSON.stringify(leaked.slice(0, 3))}`).toHaveLength(0)
    expect(screen.getByRole('button', { name: 'Send' })).toBeTruthy()
  })

  it('lang=en 이면 승인 창 전체가 영어다 — 읽을 수 없는 승인은 동의가 아니다', () => {
    const { container } = renderIn('en', <ApprovalDialog />)
    // 승인 창은 요청이 와야 뜬다.
    act(() => window.electronAPI.fire('perm', {
      requestId: 'r1',
      tool: 'story_set_speakers',
      args: { speakers: [{ id: 'narrator', name: 'Narrator', voice: null }] },
      sessionId: 's1',
    }))

    const leaked = [...container.querySelectorAll('*')]
      .flatMap((el) => [el.getAttribute('title'), el.getAttribute('aria-label')])
      // 🔴 인자(message)는 **번역하지 않는다** — 그건 앱이 만든 데이터고, 번역하면 사람이 승인한 것과
      //    실행되는 것이 갈린다. 그래서 UI chrome 만 검사한다.
      .filter((text) => text && HANGUL.test(text))
    const chrome = [...container.querySelectorAll('button, .approval-header, .approval-description, .approval-section-label')]
      .map((el) => el.textContent)
      .filter((text) => text && HANGUL.test(text))

    expect([...leaked, ...chrome], `영어 승인 창에 한글이 남았다: ${JSON.stringify([...leaked, ...chrome])}`).toHaveLength(0)
    expect(screen.getByRole('button', { name: 'Approve' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Deny' })).toBeTruthy()
    expect(container.querySelector('.approval-description').textContent).toMatch(/merge/i)
    expect(container.querySelector('.approval-description').textContent).toMatch(/kept/i)

    // 🔴 `t()` 는 키를 못 찾으면 **키 문자열 자체를 반환한다** — 오타 하나로 승인 창에 `agent.approve`
    //    같은 raw key 가 뜨고, 사람은 무엇을 승인하는지 더더욱 알 수 없다. locale 누락과 오타는
    //    똑같이 치명적이므로 둘 다 여기서 막는다.
    const chromeText = [...container.querySelectorAll('button, .approval-header')].map((el) => el.textContent).join(' ')
    const dialogLabel = container.querySelector('[role="dialog"]')?.getAttribute('aria-label') ?? ''
    expect(`${chromeText} ${dialogLabel}`, '번역 키가 그대로 화면에 노출됐다').not.toMatch(/agent\.[a-zA-Z]/)
  })

  it('lang=ko 면 한국어로 보인다 — 번역 키가 통째로 새는지도 함께 잡는다', () => {
    renderIn('ko', <ChatPanel projectKey="p" batchStatusSources={batchSources()} />)

    expect(screen.getByRole('button', { name: '보내기' })).toBeTruthy()
    // `agent.send` 같은 **키 문자열이 그대로 화면에 뜨는** 흔한 실패를 막는다.
    expect(document.body.textContent).not.toMatch(/agent\.[a-zA-Z]/)
  })

  it('lang=ko 승인 문구는 명단 교체·제거·덮어쓰기를 실제 한국어로 말한다', () => {
    const { container } = renderIn('ko', <ApprovalDialog />)
    act(() => window.electronAPI.fire('perm', {
      requestId: 'r-ko',
      tool: 'story_confirm_synopsis',
      args: { synopsisMd: '새 시놉시스', characters: [{ name: '김철수' }] },
      sessionId: 's1',
    }))

    const text = container.querySelector('.approval-description').textContent
    expect(text).toMatch(/교체/)
    expect(text).toMatch(/제거/)
    expect(text).toMatch(/덮어/)
    expect(text).not.toMatch(/agent\.[a-zA-Z]/)
  })
})

describe('에이전트 UI 재설계 locale 계약', () => {
  it('ko/en에 같은 새 키가 있고 빈 문자열이나 raw key가 없다', () => {
    for (const key of REDESIGN_KEYS) {
      expect(en.agent[key], `en.agent.${key}`).toBeTypeOf('string')
      expect(ko.agent[key], `ko.agent.${key}`).toBeTypeOf('string')
      expect(en.agent[key].trim()).not.toBe('')
      expect(ko.agent[key].trim()).not.toBe('')
      expect(en.agent[key]).not.toBe(`agent.${key}`)
      expect(ko.agent[key]).not.toBe(`agent.${key}`)
    }
  })
})
