// @vitest-environment jsdom
// D14 persistent ChatPanel + 실제 batch.status renderer seam.
import React from 'react'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
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

beforeEach(() => {
  window.electronAPI = createFullAgentApi()
})

afterEach(() => {
  cleanup()
  delete window.electronAPI
})

describe('ChatPanel — 명령과 event의 사용자 효과', () => {
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
    const user = userEvent.setup()
    render(<ChatPanel projectKey="project-a" batchStatusSources={batchSources()} />)

    const input = screen.getByRole('textbox', { name: 'Message to the agent' })
    await user.type(input, '시작해')
    await user.click(screen.getByRole('button', { name: 'Send' }))
    await user.type(input, '영상은 제외해')
    await user.click(screen.getByRole('button', { name: 'Steer' }))
    await user.click(screen.getByRole('button', { name: 'Stop' }))

    expect(window.electronAPI.agentSteer).toHaveBeenCalledWith({ text: '영상은 제외해' })
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
})

describe('ChatPanel — 접기/펼치기 아이콘 버튼', () => {
  // 🔴 텍스트를 아이콘으로 바꾸는 순간 **버튼의 접근 가능한 이름이 사라진다** — 스크린리더는
  //    "button" 이라고만 읽고, 테스트도 버튼을 못 찾는다. 그래서 이름을 aria-label 로 남긴다.
  //    (아이콘만 남기고 이름을 안 주는 건 이 프로젝트가 반복해서 밟은 "눈으로만 확인되는 UI" 다.)
  it('아이콘 버튼이지만 접근 가능한 이름과 툴팁이 상태를 그대로 말한다', async () => {
    const user = userEvent.setup()
    render(<ChatPanel projectKey="p" batchStatusSources={batchSources()} />)

    const collapse = screen.getByRole('button', { name: 'Collapse' })
    expect(collapse.getAttribute('title'), '툴팁이 없으면 아이콘이 무엇인지 알 길이 없다').toBe('Collapse')
    // 아이콘이어야 한다 — 라벨 문자열이 버튼 안에 **보이면** 아이콘으로 바꾼 의미가 없다.
    expect(collapse.querySelector('svg'), '아이콘(svg)이 없다').toBeTruthy()
    expect(collapse.textContent.trim()).toBe('')

    await user.click(collapse)

    // 접힌 뒤에는 같은 버튼이 **펼치기**를 뜻해야 한다. 이름이 안 바뀌면 사용자는 상태를 못 읽는다.
    const expand = screen.getByRole('button', { name: 'Expand' })
    expect(expand.getAttribute('title')).toBe('Expand')
    expect(expand.querySelector('svg')).toBeTruthy()
  })

  it('접으면 대화 로그가 사라지고 펼치면 그대로 돌아온다 — 세션은 유지된다', async () => {
    const user = userEvent.setup()
    render(<ChatPanel projectKey="p" batchStatusSources={batchSources()} />)
    window.electronAPI.emitAgent('agent:delta', { delta: '접어도 살아있어야 함' })

    await user.click(screen.getByRole('button', { name: 'Collapse' }))
    expect(screen.queryByText('접어도 살아있어야 함')).toBeNull()

    await user.click(screen.getByRole('button', { name: 'Expand' }))
    // 접기는 표시만 바꾼다. 메시지가 사라졌다면 세션 상태를 날린 것이다.
    expect(screen.getByText('접어도 살아있어야 함')).toBeTruthy()
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

describe('ChatPanel — 접었을 때 드래그로 옮기기', () => {
  function drag(el, from, to) {
    act(() => {
      el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: from.x, clientY: from.y, button: 0 }))
      window.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: to.x, clientY: to.y }))
      window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }))
    })
  }

  it('접힌 패널은 헤더를 끌면 그만큼 움직인다', async () => {
    const user = userEvent.setup()
    const { container } = render(<ChatPanel projectKey="p" batchStatusSources={batchSources()} />)
    await user.click(screen.getByRole('button', { name: 'Collapse' }))

    const panel = container.querySelector('.agent-chat-panel')
    const header = container.querySelector('.agent-chat-header')
    drag(header, { x: 500, y: 700 }, { x: 400, y: 300 })

    // 위치가 실제로 인라인 스타일로 반영돼야 한다 — class 만 바뀌면 화면에선 안 움직인다.
    expect(panel.style.left, '드래그해도 패널이 움직이지 않았다').not.toBe('')
    expect(panel.style.top).not.toBe('')
  })

  it('화면 밖으로는 못 나간다 — 잡을 수 없는 패널이 되면 안 된다', async () => {
    const user = userEvent.setup()
    const { container } = render(<ChatPanel projectKey="p" batchStatusSources={batchSources()} />)
    await user.click(screen.getByRole('button', { name: 'Collapse' }))

    const panel = container.querySelector('.agent-chat-panel')
    const header = container.querySelector('.agent-chat-header')
    drag(header, { x: 500, y: 700 }, { x: -9999, y: -9999 })

    expect(parseFloat(panel.style.left)).toBeGreaterThanOrEqual(0)
    expect(parseFloat(panel.style.top)).toBeGreaterThanOrEqual(0)
  })

  it('펼친 상태에서는 헤더를 끌어도 움직이지 않는다', async () => {
    const { container } = render(<ChatPanel projectKey="p" batchStatusSources={batchSources()} />)
    const panel = container.querySelector('.agent-chat-panel')
    const header = container.querySelector('.agent-chat-header')

    drag(header, { x: 500, y: 700 }, { x: 100, y: 100 })

    expect(panel.style.left, '펼친 패널이 드래그로 움직였다').toBe('')
  })

  it('옮긴 뒤 펼치면 기본 자리로 돌아온다 — 큰 패널이 화면 밖에 걸리지 않게', async () => {
    const user = userEvent.setup()
    const { container } = render(<ChatPanel projectKey="p" batchStatusSources={batchSources()} />)
    const panel = container.querySelector('.agent-chat-panel')

    await user.click(screen.getByRole('button', { name: 'Collapse' }))
    drag(container.querySelector('.agent-chat-header'), { x: 500, y: 700 }, { x: 120, y: 90 })
    expect(panel.style.left).not.toBe('')

    await user.click(screen.getByRole('button', { name: 'Expand' }))

    // 접힌 칩 자리에 640px 짜리 패널을 그대로 펼치면 화면 밖으로 넘칠 수 있다. 앵커로 되돌린다.
    expect(panel.style.left, '펼쳤는데 드래그 위치가 남아 패널이 화면 밖에 걸릴 수 있다').toBe('')
  })

  it('접기 버튼을 누른 채 손이 미세하게 움직여도 패널이 튀지 않는다', async () => {
    const user = userEvent.setup()
    const { container } = render(<ChatPanel projectKey="p" batchStatusSources={batchSources()} />)
    await user.click(screen.getByRole('button', { name: 'Collapse' }))

    const panel = container.querySelector('.agent-chat-panel')
    const button = screen.getByRole('button', { name: 'Expand' })

    // 🔴 실제 클릭은 **거의 항상 1~2px 움직인다.** 버튼 위 pointerdown 을 드래그로 삼으면
    //    접기/펼치기를 누를 때마다 패널이 손끝으로 순간이동한다.
    act(() => {
      button.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: 600, clientY: 700, button: 0 }))
      window.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: 602, clientY: 701 }))
      window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }))
    })

    expect(panel.style.left, '버튼을 눌렀는데 드래그로 오해해 패널이 움직였다').toBe('')
  })
})

describe('ChatPanel — persistent 수명과 batch.status', () => {
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
