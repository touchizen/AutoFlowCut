// @vitest-environment jsdom
//
// 🔴 **raw JSON 만으로는 사용자가 무엇을 승인하는지 모른다.**
//    `{"speakers":[{"id":"narrator","voice":{...}}]}` 를 보고 뭘 하는 건지 알 수 없다면,
//    "인자를 보여줬다"는 건 알리바이일 뿐이다.
//
// 🔴 **그렇다고 요약이 원본을 *대체* 하면 안 된다.** grant 는 인자 전체에 묶인다 — 요약만 보여주면
//    "사람이 승인한 것"과 "실제 실행되는 것"이 갈릴 수 있다. **둘 다** 보여준다:
//      - 사람 말로 무엇을 하는지 (**앱이** 만든다 — 모델이 아니라)
//      - 정확히 무엇이 실행되는지 (원본 그대로)
import React from 'react'
import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { I18nProvider } from '../../../src/hooks/useI18n'
import { __resetFlowHiddenForTests } from '../../../src/hooks/useModalVisibility'
import ApprovalDialog from '../../../src/components/agent/ApprovalDialog.jsx'

let fire
beforeEach(() => {
  __resetFlowHiddenForTests()
  window.electronAPI = {
    onAgentPermissionRequest: (cb) => { fire = cb; return () => {} },
    respondAgentPermission: vi.fn(),
    setModalVisible: vi.fn(),
  }
})
afterEach(() => { cleanup(); localStorage.clear(); delete window.electronAPI })

function open(lang, tool, args) {
  localStorage.setItem('autoflowcut_lang', lang)
  const view = render(<I18nProvider><ApprovalDialog /></I18nProvider>)
  act(() => fire({
    requestId: 'r1', tool, sessionId: 's1',
    message: `${tool}\n\n${JSON.stringify(args, null, 2)}`,
  }))
  return view
}

describe('승인 창은 무엇을 하는지 사람 말로 알려준다', () => {
  it('화자 설정: 몇 명을 저장하는지 이름과 함께 말한다', () => {
    open('ko', 'story_set_speakers', {
      speakers: [{ id: 'narrator', name: '나레이션' }, { id: 'kim', name: '김철수' }],
    })

    const summary = screen.getByTestId('approval-summary').textContent
    expect(summary, '무엇을 하는지 사람 말로 설명하지 않는다').toMatch(/화자/)
    expect(summary, '몇 명인지 안 알려준다').toMatch(/2/)
    expect(summary, '누구인지 안 알려준다').toMatch(/나레이션/)
  })

  it('스텝 시작: 어떤 단계를 시작하는지 말한다', () => {
    open('ko', 'story_start_step', { step: 'audio', params: {} })

    expect(screen.getByTestId('approval-summary').textContent).toMatch(/audio/)
  })

  it('요약이 원본 인자를 **대체하지 않는다** — 실제 실행되는 값은 그대로 보인다', () => {
    open('ko', 'story_set_speakers', { speakers: [{ id: 'narrator', name: '나레이션' }] })

    // 요약만 보여주면 "승인한 것"과 "실행되는 것"이 갈린다. 원본이 반드시 함께 있어야 한다.
    expect(screen.getByText(/"speakers"/), '원본 인자가 사라졌다').toBeTruthy()
  })

  it('모르는 툴이면 지어내지 않고 툴 이름을 그대로 보여준다', () => {
    open('ko', 'some_future_tool', { x: 1 })

    const summary = screen.queryByTestId('approval-summary')
    // 모르는 것을 아는 척 요약하면 사람이 잘못된 것을 승인한다. 요약이 없는 게 낫다.
    expect(summary).toBeNull()
    expect(screen.getByText('some_future_tool')).toBeTruthy()
  })
})
