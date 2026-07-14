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
import ChatPanel from '../../../src/components/agent/ChatPanel.jsx'
import ApprovalDialog from '../../../src/components/agent/ApprovalDialog.jsx'

const HANGUL = /[가-힣]/

function agentApi() {
  const listeners = new Map()
  return {
    agentSessionOpen: vi.fn(async () => ({ sessionId: 's1' })),
    agentSend: vi.fn(async () => ({ turn: { id: 't1' } })),
    agentSteer: vi.fn(async () => ({})),
    agentAbort: vi.fn(async () => ({})),
    agentSessionClose: vi.fn(async () => ({})),
    onAgentEvent: vi.fn((channel, cb) => { listeners.set(channel, cb); return () => listeners.delete(channel) }),
    onToolBridgeRequest: vi.fn(() => () => {}),
    respondToolBridge: vi.fn(),
    emitToolBridgeEvent: vi.fn(),
    onAgentPermissionRequest: vi.fn((cb) => { listeners.set('perm', cb); return () => listeners.delete('perm') }),
    respondAgentPermission: vi.fn(),
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

beforeEach(() => { window.electronAPI = agentApi() })
afterEach(() => { cleanup(); localStorage.clear(); delete window.electronAPI })

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
      message: 'story_set_speakers\n\n{"speakers":[{"id":"narrator"}]}',
      sessionId: 's1',
    }))

    const leaked = [...container.querySelectorAll('*')]
      .flatMap((el) => [el.getAttribute('title'), el.getAttribute('aria-label')])
      // 🔴 인자(message)는 **번역하지 않는다** — 그건 앱이 만든 데이터고, 번역하면 사람이 승인한 것과
      //    실행되는 것이 갈린다. 그래서 UI chrome 만 검사한다.
      .filter((text) => text && HANGUL.test(text))
    const chrome = [...container.querySelectorAll('button, .approval-header')]
      .map((el) => el.textContent)
      .filter((text) => text && HANGUL.test(text))

    expect([...leaked, ...chrome], `영어 승인 창에 한글이 남았다: ${JSON.stringify([...leaked, ...chrome])}`).toHaveLength(0)
    expect(screen.getByRole('button', { name: 'Approve' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Deny' })).toBeTruthy()

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
})
