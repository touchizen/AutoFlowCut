// @vitest-environment jsdom
// D14 persistent ChatPanel + 실제 batch.status renderer seam.
import React from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ChatPanel from '../../../src/components/agent/ChatPanel.jsx'

function createFullAgentApi() {
  const eventListeners = new Map()
  let bridgeListener = null
  const api = {
    // ChatPanel이 호출할 수 있는 command/listener/tool-bridge surface를 빠짐없이 둔다.
    agentSessionOpen: vi.fn(async () => ({ sessionId: 'session-1' })),
    agentSend: vi.fn(async () => ({ turn: { id: 'turn-1' } })),
    agentSteer: vi.fn(async () => ({ turnId: 'turn-1' })),
    agentAbort: vi.fn(async () => ({ aborted: true })),
    agentSessionClose: vi.fn(async () => ({ sessionId: 'session-1' })),
    agentListModels: vi.fn(async () => [
      { id: 'gpt-a', displayName: 'GPT A', hidden: false },
      { id: 'gpt-b', displayName: 'GPT B', hidden: false },
    ]),
    onAgentEvent: vi.fn((channel, callback) => {
      eventListeners.set(channel, callback)
      return () => eventListeners.delete(channel)
    }),
    onToolBridgeRequest: vi.fn((callback) => {
      bridgeListener = callback
      return () => { bridgeListener = null }
    }),
    respondToolBridge: vi.fn(),
    emitToolBridgeEvent: vi.fn(),
    emitAgent(channel, payload) {
      act(() => eventListeners.get(channel)?.(payload))
    },
    async requestToolBridge(payload) {
      await act(async () => { await bridgeListener?.(payload) })
    },
  }
  return api
}

function batchSources(overrides = {}) {
  return {
    automation: { isRunning: false, status: 'done' },
    scenes: [],
    references: [],
    generatingRefs: [],
    refBatchRunning: false,
    ...overrides,
  }
}

const largeAppRect = {
  left: 0,
  top: 0,
  width: 1000,
  height: 800,
  right: 1000,
  bottom: 800,
}
let currentAppRect
let originalResizeObserver

beforeEach(() => {
  currentAppRect = largeAppRect
  originalResizeObserver = globalThis.ResizeObserver
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function rect() {
    if (this.classList.contains('app')) return currentAppRect
    return { left: 0, top: 0, width: 0, height: 0, right: 0, bottom: 0 }
  })
  window.electronAPI = createFullAgentApi()
})

afterEach(() => {
  vi.useRealTimers()
  cleanup()
  vi.restoreAllMocks()
  if (originalResizeObserver === undefined) delete globalThis.ResizeObserver
  else globalThis.ResizeObserver = originalResizeObserver
  delete window.electronAPI
})

describe('ChatPanel — 명령과 event의 사용자 효과', () => {
  it('FAB가 calibrated inline perspective 아래 layered RobotIcon을 활성 상태와 함께 렌더한다', () => {
    const { container, rerender } = render(
      <ChatPanel open={false} projectKey="project-a" batchStatusSources={batchSources()} />,
    )
    const fab = container.querySelector('.agent-chat-fab')

    expect(fab.querySelector('.robot-icon')).toBeTruthy()
    expect(fab.querySelector('img')).toBeNull()
    expect(fab.style.perspective).toBe('150px')
    expect(fab.style.perspectiveOrigin).toBe('50% 50%')
    expect(fab.querySelector('.robot-icon').dataset.active).toBe('true')

    rerender(<ChatPanel open projectKey="project-a" batchStatusSources={batchSources()} />)
    expect(fab.querySelector('.robot-icon').dataset.active).toBe('false')
    expect(fab.querySelector('.robot-icon').dataset.motionState).toBe('idle')
  })

  it('send를 sessionManager IPC까지 보내고 delta/tool/usage/limit를 모두 화면에 남긴다', async () => {
    const user = userEvent.setup()
    render(<ChatPanel projectKey="project-a" batchStatusSources={batchSources()} />)

    await user.type(screen.getByRole('textbox', { name: 'Message to the agent' }), '배치 상태를 확인해줘')
    await user.click(screen.getByRole('button', { name: 'Send' }))

    expect(window.electronAPI.agentSessionOpen).toHaveBeenCalledOnce()
    expect(window.electronAPI.agentSend).toHaveBeenCalledWith({ text: '배치 상태를 확인해줘' })

    window.electronAPI.emitAgent('agent:delta', { delta: '확인하고 있어요.' })
    window.electronAPI.emitAgent('agent:tool-call', {
      phase: 'completed',
      item: { id: 'tool-1', type: 'mcpToolCall', tool: 'wait_batch', arguments: { type: 'scene' } },
    })
    window.electronAPI.emitAgent('agent:usage', { turns: 1, toolCalls: 1, elapsedMs: 20 })
    window.electronAPI.emitAgent('agent:error', { error: 'agent-limit', limit: 64, used: 64 })

    expect(screen.getByText('확인하고 있어요.')).toBeTruthy()
    expect(screen.getByText(/wait_batch/)).toBeTruthy()
    expect(screen.getByText(/Turns 1.*Tools 1/)).toBeTruthy()
    expect(screen.getByRole('alert')).toHaveTextContent('Agent usage limit reached. Used 64 / limit 64')
  })

  it('active turn에서는 steer와 abort가 실제 command IPC에 도달한다', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(0)
    const user = userEvent.setup()
    render(<ChatPanel projectKey="project-a" batchStatusSources={batchSources()} />)

    const input = screen.getByRole('textbox', { name: 'Message to the agent' })
    await user.type(input, '시작해')
    await user.click(screen.getByRole('button', { name: 'Send' }))
    await user.type(input, '영상은 제외해')
    await user.click(screen.getByRole('button', { name: 'Steer' }))
    vi.advanceTimersByTime(400)
    await user.click(screen.getByRole('button', { name: 'Stop' }))

    expect(window.electronAPI.agentSteer).toHaveBeenCalledWith({ text: '영상은 제외해' })
    expect(window.electronAPI.agentAbort).toHaveBeenCalledOnce()
  })

  it('single primary가 idle Send로 submit하고 running Stop으로 바뀌어 abort한다', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(0)
    const user = userEvent.setup()
    render(<ChatPanel projectKey="project-a" batchStatusSources={batchSources()} />)

    const input = screen.getByRole('textbox', { name: 'Message to the agent' })
    expect(screen.queryByRole('button', { name: 'Stop' })).toBeNull()
    await user.type(input, 'primary 전환 확인')

    const send = screen.getByRole('button', { name: 'Send' })
    expect(send).toBeEnabled()
    await user.click(send)

    expect(window.electronAPI.agentSend).toHaveBeenCalledWith({ text: 'primary 전환 확인' })
    expect(screen.queryByRole('button', { name: 'Send' })).toBeNull()
    const stop = screen.getByRole('button', { name: 'Stop' })
    expect(stop).toBeEnabled()
    vi.advanceTimersByTime(400)
    await user.click(stop)

    expect(window.electronAPI.agentAbort).toHaveBeenCalledOnce()
  })

  it('cold session의 Send→Stop 즉시 재클릭은 abort하지 않고 원래 message를 보낸다', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(0)
    let resolveOpen
    window.electronAPI.agentSessionOpen.mockReturnValueOnce(new Promise((resolve) => { resolveOpen = resolve }))
    render(<ChatPanel projectKey="project-a" batchStatusSources={batchSources()} />)

    fireEvent.change(screen.getByRole('textbox', { name: 'Message to the agent' }), {
      target: { value: 'double click 보존' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    fireEvent.click(screen.getByRole('button', { name: 'Stop' }))

    expect(window.electronAPI.agentAbort).not.toHaveBeenCalled()

    await act(async () => resolveOpen({ sessionId: 'session-1' }))

    expect(window.electronAPI.agentSend).toHaveBeenCalledWith({ text: 'double click 보존' })
  })

  it('warm session의 Stop은 arm delay가 지난 뒤 deliberate abort를 수행한다', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(0)
    render(<ChatPanel projectKey="project-a" batchStatusSources={batchSources()} />)

    const input = screen.getByRole('textbox', { name: 'Message to the agent' })
    fireEvent.change(input, { target: { value: 'session 준비' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    await act(async () => {})
    window.electronAPI.emitAgent('agent:done', { turnId: 'turn-1', status: 'completed' })

    fireEvent.change(input, { target: { value: '중단할 warm turn' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    await act(async () => {})
    expect(window.electronAPI.agentSessionOpen).toHaveBeenCalledOnce()
    expect(window.electronAPI.agentSend).toHaveBeenLastCalledWith({ text: '중단할 warm turn' })

    vi.advanceTimersByTime(400)
    fireEvent.click(screen.getByRole('button', { name: 'Stop' }))
    await act(async () => {})

    expect(window.electronAPI.agentAbort).toHaveBeenCalledOnce()
  })

  it('command가 error 값을 반환해도 조용히 삼키지 않고 화면에 표시한다', async () => {
    window.electronAPI.agentSend.mockResolvedValueOnce({
      error: 'agent-command-failed', message: 'app-server died', command: 'agent:send',
    })
    const user = userEvent.setup()
    render(<ChatPanel projectKey="project-a" batchStatusSources={batchSources()} />)

    await user.type(screen.getByRole('textbox', { name: 'Message to the agent' }), '계속')
    await user.click(screen.getByRole('button', { name: 'Send' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('app-server died')
  })

  it('icon action bar가 기존 accessible names를 보존하고 tooltip은 panel overflow 밖 body에 뜬다', async () => {
    const user = userEvent.setup()
    const { container } = render(<ChatPanel projectKey="p" batchStatusSources={batchSources()} />)
    const input = screen.getByRole('textbox', { name: 'Message to the agent' })
    await user.type(input, '툴팁 확인')

    const header = container.querySelector('.agent-chat-header')
    const toolbar = container.querySelector('.agent-chat-toolbar')
    const modelSelector = screen.getByRole('combobox', { name: 'Agent model' })
    expect(header).toContainElement(screen.getByRole('button', { name: 'Close session' }))
    expect(toolbar).toContainElement(modelSelector)
    expect(screen.queryByRole('button', { name: 'Stop' })).toBeNull()

    for (const name of ['Send', 'Steer', 'Close session']) {
      const button = screen.getByRole('button', { name })
      expect(button.querySelector('svg'), `${name} icon`).toBeTruthy()
      expect(button.textContent.trim()).toBe('')
    }

    fireEvent.mouseEnter(screen.getByRole('button', { name: 'Send' }))
    const tooltip = await screen.findByRole('tooltip')
    expect(tooltip).toHaveTextContent('Send a new turn')
    expect(tooltip.parentElement).toBe(document.body)
    expect(container.querySelector('.agent-chat-panel')?.contains(tooltip)).toBe(false)
  })
})

describe('ChatPanel — model 적용 시점 계약', () => {
  it('session open 전 모델을 로드하고 선택값을 초기 thread와 새 turn에 함께 보낸다', async () => {
    const user = userEvent.setup()
    render(<ChatPanel projectKey="p" batchStatusSources={batchSources()} />)

    await waitFor(() => expect(window.electronAPI.agentListModels).toHaveBeenCalledOnce())
    expect(window.electronAPI.agentSessionOpen).not.toHaveBeenCalled()
    await user.click(screen.getByRole('combobox', { name: 'Agent model' }))
    await user.click(screen.getByRole('option', { name: 'GPT A' }))
    await user.type(screen.getByRole('textbox', { name: 'Message to the agent' }), '첫 요청')
    await user.click(screen.getByRole('button', { name: 'Send' }))

    expect(window.electronAPI.agentSessionOpen).toHaveBeenCalledWith({ model: 'gpt-a' })
    expect(window.electronAPI.agentSend).toHaveBeenCalledWith({ text: '첫 요청', model: 'gpt-a' })
  })

  it('ensureSession await 중 selector가 바뀌어도 submit 순간 model을 쓰고 다음 turn부터 새 model을 쓴다', async () => {
    let resolveOpen
    window.electronAPI.agentSessionOpen.mockReturnValueOnce(new Promise((resolve) => { resolveOpen = resolve }))
    const user = userEvent.setup()
    render(<ChatPanel projectKey="p" batchStatusSources={batchSources()} />)
    await waitFor(() => expect(window.electronAPI.agentListModels).toHaveBeenCalledOnce())

    await user.click(screen.getByRole('combobox', { name: 'Agent model' }))
    await user.click(screen.getByRole('option', { name: 'GPT A' }))
    await user.type(screen.getByRole('textbox', { name: 'Message to the agent' }), 'A snapshot')
    await user.click(screen.getByRole('button', { name: 'Send' }))
    await waitFor(() => expect(window.electronAPI.agentSessionOpen).toHaveBeenCalledWith({ model: 'gpt-a' }))

    await user.click(screen.getByRole('combobox', { name: 'Agent model' }))
    await user.click(screen.getByRole('option', { name: 'GPT B' }))
    await act(async () => resolveOpen({ sessionId: 'session-1' }))
    await waitFor(() => expect(window.electronAPI.agentSend)
      .toHaveBeenNthCalledWith(1, { text: 'A snapshot', model: 'gpt-a' }))

    window.electronAPI.emitAgent('agent:done', { turnId: 'turn-1', status: 'completed' })
    await user.type(screen.getByRole('textbox', { name: 'Message to the agent' }), 'B next turn')
    await user.click(screen.getByRole('button', { name: 'Send' }))
    expect(window.electronAPI.agentSend)
      .toHaveBeenNthCalledWith(2, { text: 'B next turn', model: 'gpt-b' })
  })

  it('session open 대기 중 Stop하면 pending send를 취소하고 다음 Send를 다시 허용한다', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(0)
    let resolveOpen
    window.electronAPI.agentSessionOpen.mockReturnValueOnce(new Promise((resolve) => { resolveOpen = resolve }))
    const user = userEvent.setup()
    render(<ChatPanel projectKey="p" batchStatusSources={batchSources()} />)
    await waitFor(() => expect(window.electronAPI.agentListModels).toHaveBeenCalledOnce())

    const input = screen.getByRole('textbox', { name: 'Message to the agent' })
    await user.type(input, 'open 중 취소할 요청')
    await user.click(screen.getByRole('button', { name: 'Send' }))
    await waitFor(() => expect(window.electronAPI.agentSessionOpen).toHaveBeenCalledOnce())

    vi.advanceTimersByTime(400)
    await user.click(screen.getByRole('button', { name: 'Stop' }))
    expect(window.electronAPI.agentAbort).toHaveBeenCalledOnce()
    await user.type(input, '다음 요청')

    await act(async () => resolveOpen({ sessionId: 'session-1' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Send' })).toBeEnabled())
    expect(window.electronAPI.agentSend).not.toHaveBeenCalled()
  })

  it('session open이 abort보다 먼저 끝나도 Stop한 pending send를 보내지 않는다', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(0)
    let resolveOpen
    let resolveAbort
    window.electronAPI.agentSessionOpen.mockReturnValueOnce(new Promise((resolve) => { resolveOpen = resolve }))
    window.electronAPI.agentAbort.mockReturnValueOnce(new Promise((resolve) => { resolveAbort = resolve }))
    const user = userEvent.setup()
    render(<ChatPanel projectKey="p" batchStatusSources={batchSources()} />)
    await waitFor(() => expect(window.electronAPI.agentListModels).toHaveBeenCalledOnce())

    await user.type(screen.getByRole('textbox', { name: 'Message to the agent' }), 'abort 전에 open될 요청')
    await user.click(screen.getByRole('button', { name: 'Send' }))
    vi.advanceTimersByTime(400)
    await user.click(screen.getByRole('button', { name: 'Stop' }))
    expect(window.electronAPI.agentAbort).toHaveBeenCalledOnce()

    await act(async () => resolveOpen({ sessionId: 'session-1' }))
    await act(async () => resolveAbort({ aborted: true }))

    expect(window.electronAPI.agentSend).not.toHaveBeenCalled()
  })

  it('session open 실패 뒤 running을 해제해 다음 Send를 다시 허용한다', async () => {
    window.electronAPI.agentSessionOpen.mockRejectedValueOnce(new Error('spawn failed'))
    const user = userEvent.setup()
    render(<ChatPanel projectKey="p" batchStatusSources={batchSources()} />)
    await waitFor(() => expect(window.electronAPI.agentListModels).toHaveBeenCalledOnce())

    const input = screen.getByRole('textbox', { name: 'Message to the agent' })
    await user.type(input, '실패할 요청')
    await user.click(screen.getByRole('button', { name: 'Send' }))

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('spawn failed'))
    expect(window.electronAPI.agentSend).not.toHaveBeenCalled()
    await user.type(input, '재시도')
    expect(screen.getByRole('button', { name: 'Send' })).toBeEnabled()
  })

  it('running 중 primary는 enabled Stop이고 Send는 없으며 Steer는 model을 싣지 않는다', async () => {
    const user = userEvent.setup()
    render(<ChatPanel projectKey="p" batchStatusSources={batchSources()} />)
    const input = screen.getByRole('textbox', { name: 'Message to the agent' })

    await user.type(input, '새 turn')
    await user.click(screen.getByRole('button', { name: 'Send' }))
    expect(screen.queryByRole('button', { name: 'Send' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Stop' })).toBeEnabled()

    await user.click(screen.getByRole('combobox', { name: 'Agent model' }))
    await user.click(screen.getByRole('option', { name: 'GPT B' }))
    await user.type(input, '진행 방향 수정')
    expect(screen.queryByRole('button', { name: 'Send' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Stop' })).toBeEnabled()
    const steer = screen.getByRole('button', { name: 'Steer' })
    expect(steer).toBeEnabled()
    await user.click(steer)
    expect(window.electronAPI.agentSteer).toHaveBeenCalledWith({ text: '진행 방향 수정' })
  })

  it('목록 실패 fallback []에서는 Default로 보내며 model을 생략하고 Send를 막지 않는다', async () => {
    window.electronAPI.agentListModels.mockResolvedValueOnce([])
    const user = userEvent.setup()
    render(<ChatPanel projectKey="p" batchStatusSources={batchSources()} />)

    await waitFor(() => expect(window.electronAPI.agentListModels).toHaveBeenCalledOnce())
    expect(screen.getByRole('combobox', { name: 'Agent model' })).toHaveTextContent('Default')
    await user.type(screen.getByRole('textbox', { name: 'Message to the agent' }), '기본으로 실행')
    await user.click(screen.getByRole('button', { name: 'Send' }))

    expect(window.electronAPI.agentSessionOpen).toHaveBeenCalledWith({})
    expect(window.electronAPI.agentSend).toHaveBeenCalledWith({ text: '기본으로 실행' })
  })
})

describe('ChatPanel — agentMessage completion reconciliation', () => {
  it('delta와 completed가 다르면 같은 bubble을 completed text로 덮어쓴다', () => {
    const { container } = render(<ChatPanel projectKey="project-a" batchStatusSources={batchSources()} />)

    window.electronAPI.emitAgent('agent:delta', { delta: '안녕' })
    window.electronAPI.emitAgent('agent:message', {
      turnId: 'turn-1',
      item: { id: 'message-1', type: 'agentMessage', text: '수정된 답' },
    })

    const bubbles = container.querySelectorAll('.agent-chat-message.agent')
    expect(bubbles).toHaveLength(1)
    expect(bubbles[0].textContent).toBe('수정된 답')
    expect(screen.queryByText('안녕')).toBeNull()
  })

  it('completed text가 빈 문자열이면 delta를 되살리지 않고 bubble을 비운다', () => {
    const { container } = render(<ChatPanel projectKey="project-a" batchStatusSources={batchSources()} />)

    window.electronAPI.emitAgent('agent:delta', { delta: '철회될 초안' })
    window.electronAPI.emitAgent('agent:message', {
      turnId: 'turn-1',
      item: { id: 'message-1', type: 'agentMessage', text: '' },
    })

    const bubbles = container.querySelectorAll('.agent-chat-message.agent')
    expect(bubbles).toHaveLength(1)
    expect(bubbles[0]).toBeEmptyDOMElement()
    expect(screen.queryByText('철회될 초안')).toBeNull()
  })

  it('delta가 없어도 completed text로 확정 bubble을 만든다', () => {
    const { container } = render(<ChatPanel projectKey="project-a" batchStatusSources={batchSources()} />)

    window.electronAPI.emitAgent('agent:message', {
      turnId: 'turn-1',
      item: { id: 'message-1', type: 'agentMessage', text: '델타 없이 온 답' },
    })

    const bubbles = container.querySelectorAll('.agent-chat-message.agent')
    expect(bubbles).toHaveLength(1)
    expect(bubbles[0]).toHaveTextContent('델타 없이 온 답')
  })

  it('각 completed가 현재 bubble을 확정하고 다음 delta는 새 item bubble을 연다', () => {
    const { container } = render(<ChatPanel projectKey="project-a" batchStatusSources={batchSources()} />)

    window.electronAPI.emitAgent('agent:delta', { delta: '첫 초안' })
    window.electronAPI.emitAgent('agent:message', {
      turnId: 'turn-1',
      item: { id: 'message-1', type: 'agentMessage', text: '첫 확정' },
    })
    window.electronAPI.emitAgent('agent:delta', { delta: '둘째 초안' })
    window.electronAPI.emitAgent('agent:message', {
      turnId: 'turn-1',
      item: { id: 'message-2', type: 'agentMessage', text: '둘째 확정' },
    })

    const bubbles = [...container.querySelectorAll('.agent-chat-message.agent')]
    expect(bubbles).toHaveLength(2)
    expect(bubbles.map((bubble) => bubble.textContent)).toEqual(['첫 확정', '둘째 확정'])
  })

  it('item/completed가 없는 item은 turn 완료 뒤에도 흘린 delta를 보존한다', () => {
    const { container } = render(<ChatPanel projectKey="project-a" batchStatusSources={batchSources()} />)

    window.electronAPI.emitAgent('agent:delta', { delta: 'completion 없이 끝난 답' })
    window.electronAPI.emitAgent('agent:done', { turnId: 'turn-1', status: 'completed' })

    const bubbles = container.querySelectorAll('.agent-chat-message.agent')
    expect(bubbles).toHaveLength(1)
    expect(bubbles[0]).toHaveTextContent('completion 없이 끝난 답')
  })

  it('retraction은 같은 turn과 source UUID가 겹치는 message/tool만 제거한다', () => {
    const { container } = render(<ChatPanel projectKey="project-a" batchStatusSources={batchSources()} />)

    window.electronAPI.emitAgent('agent:delta', {
      delta: '지울 ', turnId: 'turn-1', sourceUuid: 'source-delta-1',
    })
    window.electronAPI.emitAgent('agent:delta', {
      delta: '답', turnId: 'turn-1', sourceUuid: 'source-delta-2',
    })
    window.electronAPI.emitAgent('agent:message', {
      turnId: 'turn-1',
      item: {
        id: 'message-target', type: 'agentMessage', text: '지울 답', sourceUuid: 'source-final',
      },
    })
    window.electronAPI.emitAgent('agent:delta', {
      delta: '최종 source로 지울 초안', turnId: 'turn-1', sourceUuid: 'source-delta-3',
    })
    window.electronAPI.emitAgent('agent:message', {
      turnId: 'turn-1',
      item: {
        id: 'message-final-source', type: 'agentMessage', text: '최종 source로 지울 답', sourceUuid: 'source-final-2',
      },
    })
    window.electronAPI.emitAgent('agent:message', {
      turnId: 'turn-2',
      item: {
        id: 'message-other-turn', type: 'agentMessage', text: '다른 turn 보존', sourceUuid: 'source-delta-1',
      },
    })
    window.electronAPI.emitAgent('agent:message', {
      turnId: 'turn-1',
      item: {
        id: 'message-other-source', type: 'agentMessage', text: '다른 source 보존', sourceUuid: 'source-other',
      },
    })
    window.electronAPI.emitAgent('agent:message', {
      item: { id: 'message-codex', type: 'agentMessage', text: 'Codex 보존' },
    })
    window.electronAPI.emitAgent('agent:tool-call', {
      turnId: 'turn-1',
      phase: 'completed',
      item: {
        id: 'tool-target', type: 'mcpToolCall', tool: 'target_tool', sourceUuids: ['source-tool'],
      },
    })
    window.electronAPI.emitAgent('agent:tool-call', {
      turnId: 'turn-2',
      phase: 'completed',
      item: {
        id: 'tool-other-turn', type: 'mcpToolCall', tool: 'other_turn_tool', sourceUuids: ['source-tool'],
      },
    })
    window.electronAPI.emitAgent('agent:tool-call', {
      phase: 'completed',
      item: { id: 'tool-codex', type: 'mcpToolCall', tool: 'codex_tool' },
    })

    window.electronAPI.emitAgent('agent:item-retracted', {
      turnId: 'turn-1', sourceUuids: ['source-delta-1', 'source-final-2', 'source-tool'],
    })

    expect(screen.queryByText('지울 답')).toBeNull()
    expect(screen.queryByText('최종 source로 지울 답')).toBeNull()
    expect(screen.queryByText(/target_tool/)).toBeNull()
    expect(screen.getByText('다른 turn 보존')).toBeTruthy()
    expect(screen.getByText('다른 source 보존')).toBeTruthy()
    expect(screen.getByText('Codex 보존')).toBeTruthy()
    expect(screen.getByText(/other_turn_tool/)).toBeTruthy()
    expect(screen.getByText(/codex_tool/)).toBeTruthy()
    expect(container.querySelectorAll('.agent-chat-message.agent')).toHaveLength(3)
  })

  it('null turn이나 빈 source UUID retraction은 Claude/Codex 엔트리를 지우지 않는다', () => {
    render(<ChatPanel projectKey="project-a" batchStatusSources={batchSources()} />)
    window.electronAPI.emitAgent('agent:message', {
      turnId: 'turn-1',
      item: { id: 'message-claude', type: 'agentMessage', text: 'Claude 답', sourceUuid: 'source-1' },
    })
    window.electronAPI.emitAgent('agent:tool-call', {
      turnId: 'turn-1',
      phase: 'completed',
      item: {
        id: 'tool-claude', type: 'mcpToolCall', tool: 'claude_tool', sourceUuids: ['source-1'],
      },
    })
    window.electronAPI.emitAgent('agent:message', {
      item: { id: 'message-codex', type: 'agentMessage', text: 'Codex 답' },
    })
    window.electronAPI.emitAgent('agent:tool-call', {
      phase: 'completed',
      item: { id: 'tool-codex', type: 'mcpToolCall', tool: 'codex_tool' },
    })

    window.electronAPI.emitAgent('agent:item-retracted', { turnId: null, sourceUuids: ['source-1'] })
    window.electronAPI.emitAgent('agent:item-retracted', { turnId: 'turn-1', sourceUuids: [] })

    expect(screen.getByText('Claude 답')).toBeTruthy()
    expect(screen.getByText(/claude_tool/)).toBeTruthy()
    expect(screen.getByText('Codex 답')).toBeTruthy()
    expect(screen.getByText(/codex_tool/)).toBeTruthy()
  })

  it('agent:error가 partial bubble을 닫아 다음 delta를 새 bubble에 둔다', () => {
    const { container } = render(<ChatPanel projectKey="project-a" batchStatusSources={batchSources()} />)

    window.electronAPI.emitAgent('agent:delta', {
      delta: '절단된 답', turnId: 'turn-1', sourceUuid: 'source-1',
    })
    window.electronAPI.emitAgent('agent:error', { error: 'agent-turn-failed', message: '실패' })
    // 같은 turnId로 이어지는 delta다: agent:error가 partial의 streaming을 닫았을 때만 새 bubble이 된다.
    // (turnId가 달랐다면 appendDelta의 turnId 분리만으로 새 bubble이 돼 streaming close를 검증하지 못한다.)
    window.electronAPI.emitAgent('agent:delta', {
      delta: '다음 답', turnId: 'turn-1', sourceUuid: 'source-2',
    })

    const bubbles = [...container.querySelectorAll('.agent-chat-message.agent')]
    expect(bubbles.map((bubble) => bubble.textContent)).toEqual(['절단된 답', '다음 답'])
  })

  it('다른 turnId의 연속 delta는 이전 streaming bubble에 병합하지 않고 새 bubble을 만든다', () => {
    // §5.3 provenance: turn 경계는 turnId로 갈린다. 이 분리가 없으면 다른 turn delta가 이전 bubble에
    // 병합돼 sourceUuids가 오염되고 turn별 retraction이 엉뚱한 텍스트를 지우거나 놓친다.
    const { container } = render(<ChatPanel projectKey="project-a" batchStatusSources={batchSources()} />)

    window.electronAPI.emitAgent('agent:delta', { delta: 'A답', turnId: 'turn-1', sourceUuid: 'a' })
    window.electronAPI.emitAgent('agent:delta', { delta: 'B답', turnId: 'turn-2', sourceUuid: 'b' })

    const bubbles = [...container.querySelectorAll('.agent-chat-message.agent')]
    expect(bubbles.map((bubble) => bubble.textContent)).toEqual(['A답', 'B답'])
  })
})

describe('ChatPanel — abort session settlement', () => {
  async function openTurnAndStop(abortResult) {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(0)
    window.electronAPI.agentAbort.mockResolvedValueOnce(abortResult)
    render(<ChatPanel projectKey="project-a" batchStatusSources={batchSources()} />)

    fireEvent.change(screen.getByRole('textbox', { name: 'Message to the agent' }), {
      target: { value: '중단할 작업' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    await act(async () => {})
    window.electronAPI.emitAgent('agent:delta', {
      delta: '작업 중', turnId: 'turn-1', sourceUuid: 'source-1',
    })
    expect(screen.getByRole('button', { name: 'Close session' })).toBeEnabled()

    vi.advanceTimersByTime(400)
    fireEvent.click(screen.getByRole('button', { name: 'Stop' }))
    await act(async () => {})
  }

  it('sessionClosed:true면 local session을 내리고 status message를 한 번 남긴다', async () => {
    await openTurnAndStop({
      aborted: true,
      error: 'agent-abort-timeout',
      message: 'abort timed out',
      contextPreserved: false,
      sessionClosed: true,
      reason: 'abort-timeout',
    })

    expect(screen.getByRole('button', { name: 'Close session' })).toBeDisabled()
    expect(screen.getAllByText('The agent session was closed after stopping.')).toHaveLength(1)
    expect(screen.getByRole('alert')).toHaveTextContent('abort timed out')
  })

  it('contextPreserved:true면 같은 local session을 유지하고 close status를 만들지 않는다', async () => {
    await openTurnAndStop({
      aborted: true,
      contextPreserved: true,
      sessionClosed: false,
    })

    expect(screen.getByRole('button', { name: 'Close session' })).toBeEnabled()
    expect(screen.queryByText('The agent session was closed after stopping.')).toBeNull()
  })

  it('같은 sessionClosed settlement를 Stop 재클릭이 함께 받아도 status는 한 번만 남긴다', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(0)
    let resolveAbort
    window.electronAPI.agentAbort.mockReturnValue(
      new Promise((resolve) => { resolveAbort = resolve }),
    )
    render(<ChatPanel projectKey="project-a" batchStatusSources={batchSources()} />)

    fireEvent.change(screen.getByRole('textbox', { name: 'Message to the agent' }), {
      target: { value: '중복 중단할 작업' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    await act(async () => {})
    window.electronAPI.emitAgent('agent:delta', {
      delta: '작업 중', turnId: 'turn-1', sourceUuid: 'source-1',
    })
    vi.advanceTimersByTime(400)

    const stop = screen.getByRole('button', { name: 'Stop' })
    fireEvent.click(stop)
    fireEvent.click(stop)
    expect(window.electronAPI.agentAbort).toHaveBeenCalledTimes(2)
    await act(async () => resolveAbort({ aborted: true, sessionClosed: true }))

    expect(screen.getAllByText('The agent session was closed after stopping.')).toHaveLength(1)
  })

  it('agent:error의 sessionClosed:true는 local session ref를 내린다 (orphan-drain/exit)', async () => {
    render(<ChatPanel projectKey="project-a" batchStatusSources={batchSources()} />)
    fireEvent.change(screen.getByRole('textbox', { name: 'Message to the agent' }), {
      target: { value: '작업 시작' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    await act(async () => {})
    expect(screen.getByRole('button', { name: 'Close session' })).toBeEnabled()

    // main이 orphan-drain timeout으로 세션을 닫으면 exit가 sessionClosed:true로 온다.
    window.electronAPI.emitAgent('agent:error', {
      error: 'agent-exit', message: 'orphan drain timed out', sessionClosed: true,
    })

    // ref가 내려가 Close session이 비활성(다음 Send는 재open한다). error 메시지는 alert로 보인다.
    expect(screen.getByRole('button', { name: 'Close session' })).toBeDisabled()
    expect(screen.getByRole('alert')).toHaveTextContent('orphan drain timed out')
  })

  it('sessionClosed 없는 agent:error는 local session을 유지한다', async () => {
    render(<ChatPanel projectKey="project-a" batchStatusSources={batchSources()} />)
    fireEvent.change(screen.getByRole('textbox', { name: 'Message to the agent' }), {
      target: { value: '작업 시작' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    await act(async () => {})

    window.electronAPI.emitAgent('agent:error', { error: 'agent-turn-failed', message: '턴 실패' })

    expect(screen.getByRole('button', { name: 'Close session' })).toBeEnabled()
  })
})

describe('ChatPanel — effective panel mode', () => {
  it('충분한 App에서는 Flow도 docked를 유지하고 toggle이 활성화되며 옛 notice가 없다', () => {
    const onAgentPanelModeChange = vi.fn()
    const onEffectiveModeChange = vi.fn()
    const { container, rerender } = render(
      <div className="app">
        <ChatPanel
          open
          appMode="api"
          agentPanelMode="docked"
          onAgentPanelModeChange={onAgentPanelModeChange}
          onEffectiveModeChange={onEffectiveModeChange}
          projectKey="p"
          batchStatusSources={batchSources()}
        />
      </div>,
    )
    const panel = container.querySelector('.agent-chat-panel')
    const toggle = screen.getByRole('button', { name: 'Dock panel mode' })
    expect(panel).toHaveClass('mode-docked')
    expect(toggle).toHaveAttribute('aria-pressed', 'true')

    rerender(
      <div className="app">
        <ChatPanel
          open
          appMode="flow"
          agentPanelMode="docked"
          onAgentPanelModeChange={onAgentPanelModeChange}
          onEffectiveModeChange={onEffectiveModeChange}
          projectKey="p"
          batchStatusSources={batchSources()}
        />
      </div>,
    )
    expect(panel).toHaveClass('mode-docked')
    expect(toggle).toBeEnabled()
    expect(toggle).toHaveAttribute('aria-pressed', 'true')
    expect(screen.queryByText('The agent stays floating while Flow is active.')).toBeNull()
    expect(onAgentPanelModeChange).not.toHaveBeenCalled()
    expect(onEffectiveModeChange).toHaveBeenLastCalledWith('docked')
  })

  it('작은 App에서는 저장 docked를 건드리지 않고 floating으로 파생하며 resize 뒤 자동 복귀한다', async () => {
    const resizeCallbacks = []
    globalThis.ResizeObserver = class ResizeObserver {
      constructor(callback) { resizeCallbacks.push(callback) }
      observe() {}
      disconnect() {}
    }
    currentAppRect = {
      left: 600,
      top: 0,
      width: 599,
      height: 419,
      right: 1199,
      bottom: 419,
    }
    const onAgentPanelModeChange = vi.fn()
    const onEffectiveModeChange = vi.fn()
    const { container } = render(
      <div className="app">
        <ChatPanel
          open
          appMode="flow"
          agentPanelMode="docked"
          onAgentPanelModeChange={onAgentPanelModeChange}
          onEffectiveModeChange={onEffectiveModeChange}
          projectKey="p"
          batchStatusSources={batchSources()}
        />
      </div>,
    )
    const panel = container.querySelector('.agent-chat-panel')

    await waitFor(() => expect(panel).toHaveClass('mode-floating'))
    expect(screen.queryByRole('separator', { name: 'Resize agent dock' })).toBeNull()
    expect(onAgentPanelModeChange).not.toHaveBeenCalled()
    expect(onEffectiveModeChange).toHaveBeenLastCalledWith('floating')

    currentAppRect = {
      left: 600,
      top: 0,
      width: 600,
      height: 420,
      right: 1200,
      bottom: 420,
    }
    act(() => resizeCallbacks.forEach((callback) => callback()))

    await waitFor(() => expect(panel).toHaveClass('mode-docked'))
    expect(onEffectiveModeChange).toHaveBeenLastCalledWith('docked')
  })

  it('API mode toggle은 floating에서 docked preference를 전달한다', async () => {
    const user = userEvent.setup()
    const onAgentPanelModeChange = vi.fn()
    render(
      <ChatPanel
        open
        appMode="api"
        agentPanelMode="floating"
        onAgentPanelModeChange={onAgentPanelModeChange}
        projectKey="p"
        batchStatusSources={batchSources()}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'Dock panel mode' }))
    expect(onAgentPanelModeChange).toHaveBeenCalledWith('docked')
  })

  it('API mode toggle은 docked에서 floating preference를 전달한다', async () => {
    const user = userEvent.setup()
    const onAgentPanelModeChange = vi.fn()
    render(
      <div className="app">
        <ChatPanel
          open
          appMode="api"
          agentPanelMode="docked"
          onAgentPanelModeChange={onAgentPanelModeChange}
          projectKey="p"
          batchStatusSources={batchSources()}
        />
      </div>,
    )

    const toggle = screen.getByRole('button', { name: 'Dock panel mode' })
    expect(toggle).toHaveAttribute('aria-pressed', 'true')
    await user.click(toggle)
    expect(onAgentPanelModeChange).toHaveBeenCalledWith('floating')
  })
})

describe('ChatPanel — 진행 표시', () => {
  // 🔴 첫 delta 가 오기까지 **수십 초** 걸린다 (실측: 실앱에서 turn/start → 첫 tool call 까지 16초).
  //    그동안 화면이 완전히 비어 있으면 사용자는 **앱이 죽었다고 생각한다.**
  it('보낸 직후부터 첫 응답이 오기 전까지 진행 중임을 보여준다', async () => {
    const user = userEvent.setup()
    render(<ChatPanel projectKey="p" batchStatusSources={batchSources()} />)

    await user.type(screen.getByRole('textbox', { name: 'Message to the agent' }), '뭐든 해줘')
    await user.click(screen.getByRole('button', { name: 'Send' }))

    // 아직 delta 도 tool-call 도 오지 않았다 — 그래도 뭔가 돌고 있다는 게 보여야 한다.
    expect(screen.getByRole('status'), '보냈는데 화면에 아무 표시가 없다 — 앱이 멈춘 것처럼 보인다').toBeTruthy()
  })

  it('턴이 끝나면 진행 표시가 사라진다', async () => {
    const user = userEvent.setup()
    render(<ChatPanel projectKey="p" batchStatusSources={batchSources()} />)

    await user.type(screen.getByRole('textbox', { name: 'Message to the agent' }), '뭐든 해줘')
    await user.click(screen.getByRole('button', { name: 'Send' }))
    window.electronAPI.emitAgent('agent:done', { turnId: 'turn-1', status: 'completed' })

    expect(screen.queryByRole('status'), '턴이 끝났는데 계속 돌고 있는 것처럼 보인다').toBeNull()
  })

  it('에러로 끝나도 진행 표시가 남지 않는다 — 영원히 도는 것처럼 보이면 안 된다', async () => {
    const user = userEvent.setup()
    render(<ChatPanel projectKey="p" batchStatusSources={batchSources()} />)

    await user.type(screen.getByRole('textbox', { name: 'Message to the agent' }), '뭐든 해줘')
    await user.click(screen.getByRole('button', { name: 'Send' }))
    window.electronAPI.emitAgent('agent:error', { error: 'agent-limit', limit: 64, used: 64 })

    expect(screen.queryByRole('status')).toBeNull()
    expect(screen.getByRole('alert')).toBeTruthy()
  })
})

describe('ChatPanel — open floating container drag', () => {
  function drag(el, from, to) {
    act(() => {
      el.dispatchEvent(new PointerEvent('pointerdown', {
        bubbles: true, clientX: from.x, clientY: from.y, button: 0,
      }))
      window.dispatchEvent(new PointerEvent('pointermove', {
        bubbles: true, clientX: to.x, clientY: to.y,
      }))
      window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }))
    })
  }

  it('open+floating만 drag되고 offset container의 우하단 bounds에서 clamp된다', () => {
    const { container } = render(
      <div className="app">
        <ChatPanel open appMode="api" agentPanelMode="floating" projectKey="p" batchStatusSources={batchSources()} />
      </div>,
    )
    const app = container.querySelector('.app')
    const panel = container.querySelector('.agent-chat-panel')
    const header = container.querySelector('.agent-chat-header')
    app.getBoundingClientRect = () => ({ left: 100, top: 50, width: 300, height: 200, right: 400, bottom: 250 })
    panel.getBoundingClientRect = () => ({ left: 118, top: 68, width: 252, height: 140, right: 370, bottom: 208 })

    drag(header, { x: 130, y: 78 }, { x: 999, y: 999 })

    expect(panel.style.left).toBe('48px')
    expect(panel.style.top).toBe('60px')
  })

  it('appMode 전환으로 container가 줄면 저장 위치를 새 bounds로 다시 clamp한다', async () => {
    const { container, rerender } = render(
      <div className="app">
        <ChatPanel open appMode="api" agentPanelMode="floating" projectKey="p" batchStatusSources={batchSources()} />
      </div>,
    )
    const app = container.querySelector('.app')
    const panel = container.querySelector('.agent-chat-panel')
    const header = container.querySelector('.agent-chat-header')
    app.getBoundingClientRect = () => ({
      left: 100, top: 50, width: 300, height: 200, right: 400, bottom: 250,
    })
    panel.getBoundingClientRect = () => ({
      left: 118, top: 68, width: 252, height: 140, right: 370, bottom: 208,
    })

    drag(header, { x: 130, y: 78 }, { x: 999, y: 999 })
    expect(panel.style.left).toBe('48px')
    expect(panel.style.top).toBe('60px')

    app.getBoundingClientRect = () => ({
      left: 100, top: 50, width: 120, height: 90, right: 220, bottom: 140,
    })
    panel.getBoundingClientRect = () => ({
      left: 148, top: 110, width: 100, height: 80, right: 248, bottom: 190,
    })
    rerender(
      <div className="app">
        <ChatPanel open appMode="flow" agentPanelMode="floating" projectKey="p" batchStatusSources={batchSources()} />
      </div>,
    )

    await waitFor(() => {
      expect(Number.parseFloat(panel.style.left)).toBeLessThanOrEqual(20)
      expect(Number.parseFloat(panel.style.top)).toBeLessThanOrEqual(10)
    })
  })

  it('header button에서 시작한 pointer drag는 panel을 옮기지 않는다', () => {
    const { container } = render(
      <div className="app">
        <ChatPanel open appMode="api" agentPanelMode="floating" projectKey="p" batchStatusSources={batchSources()} />
      </div>,
    )
    const panel = container.querySelector('.agent-chat-panel')

    drag(screen.getByRole('button', { name: 'Dismiss agent' }), { x: 260, y: 78 }, { x: 264, y: 82 })

    expect(panel.style.left).toBe('')
  })

  it('floating drag도 pointercancel 뒤 hover pointermove를 무시한다', () => {
    const { container } = render(
      <div className="app">
        <ChatPanel open appMode="api" agentPanelMode="floating" projectKey="p" batchStatusSources={batchSources()} />
      </div>,
    )
    const app = container.querySelector('.app')
    const panel = container.querySelector('.agent-chat-panel')
    const header = container.querySelector('.agent-chat-header')
    app.getBoundingClientRect = () => ({
      left: 0, top: 0, width: 500, height: 400, right: 500, bottom: 400,
    })
    panel.getBoundingClientRect = () => ({
      left: 20, top: 20, width: 300, height: 200, right: 320, bottom: 220,
    })

    fireEvent.pointerDown(header, { button: 0, clientX: 40, clientY: 40 })
    fireEvent.pointerMove(window, { clientX: 80, clientY: 80 })
    expect(panel.style.left).toBe('60px')
    expect(panel.style.top).toBe('60px')

    fireEvent.pointerCancel(window)
    fireEvent.pointerMove(window, { clientX: 160, clientY: 160 })

    expect(panel.style.left).toBe('60px')
    expect(panel.style.top).toBe('60px')
  })

  it.each([
    { open: false, mode: 'floating' },
    { open: true, mode: 'docked' },
  ])('open=$open mode=$mode에서는 drag position을 쓰지 않는다', ({ open, mode }) => {
    const { container } = render(
      <div className="app">
        <ChatPanel open={open} appMode="api" agentPanelMode={mode} projectKey="p" batchStatusSources={batchSources()} />
      </div>,
    )
    const header = container.querySelector('.agent-chat-header')
    drag(header, { x: 130, y: 78 }, { x: 220, y: 150 })
    expect(container.querySelector('.agent-chat-panel').style.left).toBe('')
  })
})

describe('ChatPanel — dock resize', () => {
  function DockResizeHarness({
    open = true,
    mode = 'docked',
    initialPreference = 400,
    onCommit = () => {},
    onLayout = () => {},
  }) {
    const [preference, setPreference] = React.useState(initialPreference)
    const appRef = React.useRef(null)
    React.useLayoutEffect(() => {
      onLayout(appRef.current)
    })
    const commit = (width) => {
      onCommit(width)
      setPreference(width)
    }
    return (
      <div ref={appRef} className="app" data-agent-dock-preference={preference}>
        <ChatPanel
          open={open}
          appMode="api"
          agentPanelMode={mode}
          agentDockWidth={preference}
          onAgentDockWidthCommit={commit}
          projectKey="p"
          batchStatusSources={batchSources()}
        />
      </div>
    )
  }

  it('저장 preference를 건드리지 않고 좁은 container에 적용한 뒤 container가 커지면 preference 폭으로 복귀한다', () => {
    const resizeCallbacks = []
    globalThis.ResizeObserver = class ResizeObserver {
      constructor(callback) { resizeCallbacks.push(callback) }
      observe() {}
      disconnect() {}
    }
    currentAppRect = {
      left: 0, top: 0, width: 800, height: 800, right: 800, bottom: 800,
    }
    const { container } = render(<DockResizeHarness initialPreference={700} />)
    const app = container.querySelector('.app')

    expect(app.style.getPropertyValue('--agent-dock-w')).toBe('480px')
    expect(app.dataset.agentDockPreference).toBe('700')

    currentAppRect = {
      left: 0, top: 0, width: 1400, height: 800, right: 1400, bottom: 800,
    }
    act(() => resizeCallbacks.forEach((callback) => callback()))

    expect(app.style.getPropertyValue('--agent-dock-w')).toBe('700px')
    expect(app.dataset.agentDockPreference).toBe('700')
  })

  it('첫 layout commit에서 persisted preference를 container 폭으로 clamp하고 유효한 ARIA를 노출한다', () => {
    currentAppRect = {
      left: 0, top: 0, width: 800, height: 800, right: 800, bottom: 800,
    }
    const layoutWidths = []
    const { container } = render(
      <DockResizeHarness
        initialPreference={700}
        onLayout={(app) => layoutWidths.push(app.style.getPropertyValue('--agent-dock-w'))}
      />,
    )
    const app = container.querySelector('.app')
    const handle = screen.getByRole('separator', { name: 'Resize agent dock' })

    expect(layoutWidths[0]).toBe('480px')
    expect(app.style.getPropertyValue('--agent-dock-w')).toBe('480px')
    expect(Number(handle.getAttribute('aria-valuenow')))
      .toBeLessThanOrEqual(Number(handle.getAttribute('aria-valuemax')))
  })

  it('docked+open에서 App state를 거치지 않고 live 폭을 바꾸며 pointerup에 한 번 commit한다', () => {
    const onCommit = vi.fn()
    const { container } = render(<DockResizeHarness onCommit={onCommit} />)
    const app = container.querySelector('.app')
    const handle = screen.getByRole('separator', { name: 'Resize agent dock' })
    app.getBoundingClientRect = () => ({
      left: 100, top: 0, width: 1000, height: 800, right: 1100, bottom: 800,
    })

    act(() => {
      handle.dispatchEvent(new PointerEvent('pointerdown', {
        bubbles: true, clientX: 700, clientY: 100, button: 0,
      }))
      window.dispatchEvent(new PointerEvent('pointermove', {
        bubbles: true, clientX: 600, clientY: 100,
      }))
      window.dispatchEvent(new PointerEvent('pointermove', {
        bubbles: true, clientX: 580, clientY: 100,
      }))
    })

    expect(app.style.getPropertyValue('--agent-dock-w')).toBe('520px')
    expect(app.dataset.agentDockPreference).toBe('400')
    expect(onCommit).not.toHaveBeenCalled()

    act(() => {
      window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }))
    })
    expect(onCommit).toHaveBeenCalledOnce()
    expect(onCommit).toHaveBeenCalledWith(520)
    expect(app.dataset.agentDockPreference).toBe('520')
  })

  it('pointercancel 뒤 hover pointermove가 resize를 재개하지 않는다', () => {
    const onCommit = vi.fn()
    const { container } = render(<DockResizeHarness onCommit={onCommit} />)
    const app = container.querySelector('.app')
    const handle = screen.getByRole('separator', { name: 'Resize agent dock' })
    app.getBoundingClientRect = () => ({
      left: 0, top: 0, width: 1000, height: 800, right: 1000, bottom: 800,
    })

    fireEvent.pointerDown(handle, { button: 0, clientX: 700, clientY: 100 })
    fireEvent.pointerMove(window, { clientX: 650, clientY: 100 })
    expect(app.style.getPropertyValue('--agent-dock-w')).toBe('450px')

    fireEvent.pointerCancel(window)
    const cancelledWidth = app.style.getPropertyValue('--agent-dock-w')
    fireEvent.pointerMove(window, { clientX: 500, clientY: 100 })

    expect(app.style.getPropertyValue('--agent-dock-w')).toBe(cancelledWidth)
    expect(onCommit).toHaveBeenCalledOnce()
    expect(onCommit).toHaveBeenCalledWith(450)
  })

  it('separator keyboard auto-repeat은 live만 바꾸고 keyup에 한 번 commit한다', () => {
    const onCommit = vi.fn()
    const { container } = render(<DockResizeHarness onCommit={onCommit} />)
    const app = container.querySelector('.app')
    const handle = screen.getByRole('separator', { name: 'Resize agent dock' })
    app.getBoundingClientRect = () => ({
      left: 0, top: 0, width: 1000, height: 800, right: 1000, bottom: 800,
    })

    fireEvent.keyDown(handle, { key: 'ArrowLeft' })
    fireEvent.keyDown(handle, { key: 'ArrowLeft', repeat: true })
    fireEvent.keyDown(handle, { key: 'ArrowLeft', repeat: true })

    expect(app.style.getPropertyValue('--agent-dock-w')).toBe('448px')
    expect(onCommit).not.toHaveBeenCalled()
    expect(handle).toHaveAttribute('aria-valuenow', '448')
    expect(handle).toHaveAttribute('aria-valuemin', '280')
    expect(handle).toHaveAttribute('aria-valuemax', '600')

    fireEvent.keyUp(handle, { key: 'ArrowLeft' })
    expect(onCommit).toHaveBeenCalledOnce()
    expect(onCommit).toHaveBeenCalledWith(448)
  })

  it('commit 전 resize 중 panel이 비활성화되면 transient 폭을 버리고 preference 폭으로 복귀한다', () => {
    const onCommit = vi.fn()
    const { container, rerender } = render(<DockResizeHarness onCommit={onCommit} />)
    const app = container.querySelector('.app')
    const handle = screen.getByRole('separator', { name: 'Resize agent dock' })
    app.getBoundingClientRect = () => ({
      left: 0, top: 0, width: 1000, height: 800, right: 1000, bottom: 800,
    })

    fireEvent.keyDown(handle, { key: 'ArrowLeft' })
    expect(app.style.getPropertyValue('--agent-dock-w')).toBe('416px')
    expect(onCommit).not.toHaveBeenCalled()

    rerender(<DockResizeHarness open={false} onCommit={onCommit} />)

    expect(app.style.getPropertyValue('--agent-dock-w')).toBe('400px')
    expect(app.dataset.agentDockPreference).toBe('400')
    expect(onCommit).not.toHaveBeenCalled()
  })

  it('좁은 container에서도 separator의 폭과 ARIA 범위가 280px 아래로 역전되지 않는다', () => {
    const { container } = render(<DockResizeHarness />)
    const app = container.querySelector('.app')
    const handle = screen.getByRole('separator', { name: 'Resize agent dock' })
    app.getBoundingClientRect = () => ({
      left: 0, top: 0, width: 400, height: 800, right: 400, bottom: 800,
    })

    fireEvent.keyDown(handle, { key: 'ArrowRight' })

    expect(app.style.getPropertyValue('--agent-dock-w')).toBe('280px')
    expect(handle).toHaveAttribute('aria-valuemin', '280')
    expect(handle).toHaveAttribute('aria-valuemax', '280')
    expect(handle).toHaveAttribute('aria-valuenow', '280')
  })

  it.each([
    { open: false, mode: 'docked' },
    { open: true, mode: 'floating' },
  ])('open=$open mode=$mode에서는 resize handle을 렌더하지 않는다', ({ open, mode }) => {
    render(<DockResizeHarness open={open} mode={mode} />)
    expect(screen.queryByRole('separator', { name: 'Resize agent dock' })).toBeNull()
  })
})

describe('ChatPanel — persistent 수명과 batch.status', () => {
  function VisibilityHarness() {
    const [open, setOpen] = React.useState(false)
    return (
      <ChatPanel
        open={open}
        onOpen={() => setOpen(true)}
        onDismiss={() => setOpen(false)}
        projectKey="same-project"
        batchStatusSources={batchSources()}
      />
    )
  }

  it('FAB로 panel을 열면 message textarea로 focus를 옮긴다', async () => {
    const user = userEvent.setup()
    render(<VisibilityHarness />)

    await user.click(screen.getByRole('button', { name: 'Open agent' }))

    await waitFor(() => {
      expect(document.activeElement).toBe(
        screen.getByRole('textbox', { name: 'Message to the agent' }),
      )
    })
  })

  it('panel을 dismiss하면 FAB로 focus를 옮긴다', async () => {
    const user = userEvent.setup()
    render(<VisibilityHarness />)

    await user.click(screen.getByRole('button', { name: 'Open agent' }))
    await user.click(screen.getByRole('button', { name: 'Dismiss agent' }))

    await waitFor(() => {
      expect(document.activeElement).toBe(
        screen.getByRole('button', { name: 'Open agent' }),
      )
    })
  })

  it('dismiss/FAB 왕복은 같은 panel과 bridge를 유지하고 session close를 호출하지 않는다', async () => {
    const user = userEvent.setup()
    const { container } = render(<VisibilityHarness />)
    const panel = container.querySelector('.agent-chat-panel')
    expect(panel).toHaveClass('is-dismissed')
    expect(screen.getByRole('button', { name: 'Open agent' })).toBeTruthy()

    await user.click(screen.getByRole('button', { name: 'Open agent' }))
    expect(panel).toHaveClass('is-open')
    window.electronAPI.emitAgent('agent:delta', { delta: '숨겨도 보존할 메시지' })
    await user.click(screen.getByRole('button', { name: 'Dismiss agent' }))

    expect(container.querySelector('.agent-chat-panel')).toBe(panel)
    expect(panel).toHaveClass('is-dismissed')
    expect(panel).toHaveTextContent('숨겨도 보존할 메시지')
    expect(window.electronAPI.agentSessionClose).not.toHaveBeenCalled()
    expect(window.electronAPI.onToolBridgeRequest).toHaveBeenCalledOnce()

    await window.electronAPI.requestToolBridge({
      requestId: 'hidden-bridge', name: 'batch.status', args: { type: 'scene' },
    })
    expect(window.electronAPI.respondToolBridge).toHaveBeenCalledWith({
      requestId: 'hidden-bridge',
      result: { type: 'scene', status: 'complete', done: 0, total: 0, error: 0 },
    })

    await user.click(screen.getByRole('button', { name: 'Open agent' }))
    expect(container.querySelector('.agent-chat-panel')).toBe(panel)
    expect(screen.getByText('숨겨도 보존할 메시지')).toBeTruthy()
  })

  it('view만 바뀌는 global sibling rerender에서는 stream 메시지가 사라지지 않는다', () => {
    function GlobalShell({ activeView }) {
      return <div><main>{activeView}</main><ChatPanel projectKey="same-project" batchStatusSources={batchSources()} /></div>
    }
    const { rerender } = render(<GlobalShell activeView="generate" />)
    window.electronAPI.emitAgent('agent:delta', { delta: '뷰를 넘어 남아야 함' })

    rerender(<GlobalShell activeView="story" />)

    expect(screen.getByText('뷰를 넘어 남아야 함')).toBeTruthy()
  })

  it('프로젝트가 바뀌면 열린 session을 abort→close하고 이전 메시지를 격리해 보고한다', async () => {
    const user = userEvent.setup()
    const { rerender } = render(<ChatPanel projectKey="project-a" batchStatusSources={batchSources()} />)
    await user.type(screen.getByRole('textbox', { name: 'Message to the agent' }), 'A 프로젝트 작업')
    await user.click(screen.getByRole('button', { name: 'Send' }))
    window.electronAPI.emitAgent('agent:delta', { delta: 'A 응답' })

    rerender(<ChatPanel projectKey="project-b" batchStatusSources={batchSources()} />)

    await waitFor(() => expect(window.electronAPI.agentAbort).toHaveBeenCalledOnce())
    expect(window.electronAPI.agentSessionClose).toHaveBeenCalledOnce()
    expect(screen.queryByText('A 응답')).toBeNull()
    expect(screen.getByText('The project changed, so the previous agent session was closed.')).toBeTruthy()
  })

  it('session-open 대기 중 프로젝트가 바뀌어도 old 입력을 새 프로젝트 session에 send하지 않는다', async () => {
    let resolveOpen
    window.electronAPI.agentSessionOpen.mockReturnValueOnce(new Promise((resolve) => { resolveOpen = resolve }))
    const user = userEvent.setup()
    const { rerender } = render(<ChatPanel projectKey="project-a" batchStatusSources={batchSources()} />)
    await user.type(screen.getByRole('textbox', { name: 'Message to the agent' }), 'A에서만 실행')
    await user.click(screen.getByRole('button', { name: 'Send' }))

    rerender(<ChatPanel projectKey="project-b" batchStatusSources={batchSources()} />)
    await act(async () => { resolveOpen({ sessionId: 'old-session' }) })

    await waitFor(() => expect(window.electronAPI.agentSessionClose).toHaveBeenCalledOnce())
    expect(window.electronAPI.agentSend, 'old project 입력이 새 project에서 실행됐다').not.toHaveBeenCalled()
  })

  it('wait_batch의 batch.status가 현재 renderer 배치 상태를 계산해 같은 requestId로 응답한다', async () => {
    render(<ChatPanel
      projectKey="project-a"
      batchStatusSources={batchSources({
        automation: { isRunning: true, status: 'generating' },
        scenes: [
          { status: 'done', image: 'done.png' },
          { status: 'generating' },
          { status: 'error' },
        ],
      })}
    />)

    await window.electronAPI.requestToolBridge({
      requestId: 'bridge-1', name: 'batch.status', args: { type: 'scene' },
    })

    expect(window.electronAPI.respondToolBridge).toHaveBeenCalledWith({
      requestId: 'bridge-1',
      result: { type: 'scene', status: 'running', done: 1, total: 3, error: 1 },
    })
  })

  it('video.admit은 items만 strict-agent source에 넘기고 isRetry를 만들지 않는다', async () => {
    const admit = vi.fn(async () => ({ accepted: true, operationId: 'video-op-1' }))
    render(<ChatPanel
      projectKey="project-a"
      batchStatusSources={batchSources()}
      videoAdmissionSources={{ admit }}
    />)

    const items = [{ ordinal: 2, rendererSceneId: 'renderer-id-from-resolver' }]
    await window.electronAPI.requestToolBridge({
      requestId: 'video-admit-1', name: 'video.admit', args: { items },
    })

    expect(admit).toHaveBeenCalledOnce()
    expect(admit).toHaveBeenCalledWith(items)
    expect(admit.mock.calls[0]).toHaveLength(1)
    expect(window.electronAPI.respondToolBridge).toHaveBeenCalledWith({
      requestId: 'video-admit-1',
      result: { accepted: true, operationId: 'video-op-1' },
    })
  })

  it('video.status는 operationId를 같은 status store에 조회한다', async () => {
    const getStatus = vi.fn(() => ({
      operationId: 'video-op-1',
      status: 'running',
      progress: { done: 1, total: 2, failed: 0, phase: 'downloading' },
    }))
    render(<ChatPanel
      projectKey="project-a"
      batchStatusSources={batchSources()}
      videoAdmissionSources={{ getStatus }}
    />)

    await window.electronAPI.requestToolBridge({
      requestId: 'video-status-1', name: 'video.status', args: { operationId: 'video-op-1' },
    })

    expect(getStatus).toHaveBeenCalledWith('video-op-1')
    expect(window.electronAPI.respondToolBridge).toHaveBeenCalledWith({
      requestId: 'video-status-1',
      result: {
        operationId: 'video-op-1',
        status: 'running',
        progress: { done: 1, total: 2, failed: 0, phase: 'downloading' },
      },
    })
  })

  it('video snapshot 구독의 phase/terminal 값을 bridge event로 그대로 올린다', () => {
    let statusListener = null
    const unsubscribe = vi.fn()
    const subscribe = vi.fn((listener) => {
      statusListener = listener
      return unsubscribe
    })
    const { unmount } = render(<ChatPanel
      projectKey="project-a"
      batchStatusSources={batchSources()}
      videoAdmissionSources={{ subscribe }}
    />)

    const running = {
      operationId: 'video-op-1', status: 'running',
      progress: { done: 1, total: 2, failed: 0, phase: 'downloading' },
    }
    const terminal = {
      operationId: 'video-op-1', status: 'error', error: 'paywall',
      progress: { done: 2, total: 2, failed: 1, phase: 'error' },
    }
    act(() => {
      statusListener(running)
      statusListener(terminal)
    })

    expect(window.electronAPI.emitToolBridgeEvent).toHaveBeenNthCalledWith(1, running)
    expect(window.electronAPI.emitToolBridgeEvent).toHaveBeenNthCalledWith(2, terminal)
    unmount()
    expect(unsubscribe).toHaveBeenCalledOnce()
  })

  it('프로젝트 전환은 detached video pipeline을 abort하고 operation store를 정리한다', async () => {
    const abortAndClear = vi.fn()
    const sources = { abortAndClear }
    const { rerender } = render(<ChatPanel
      projectKey="project-a"
      batchStatusSources={batchSources()}
      videoAdmissionSources={sources}
    />)

    rerender(<ChatPanel
      projectKey="project-b"
      batchStatusSources={batchSources()}
      videoAdmissionSources={sources}
    />)

    await waitFor(() => expect(abortAndClear).toHaveBeenCalledOnce())
  })
})
