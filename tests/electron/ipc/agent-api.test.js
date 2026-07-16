// @vitest-environment node
//
// D14/V1 — ChatPanel 전용 command 6개 중 session 5개와 agent event 6개를 소유한다.
// permission request/response 한 쌍은 app-scoped approvalPrompt가 이미 한 번만 소유하므로 여기서
// 다시 등록하지 않는다. 이 테스트는 handler 모양이 아니라 renderer까지 도달하는 효과를 검증한다.
import { beforeEach, describe, expect, it, vi } from 'vitest'

async function loadSubject() {
  return import('../../../electron/ipc/agent-api.js').catch(() => ({}))
}

function fakeIpcMain() {
  const handlers = new Map()
  return {
    handle: vi.fn((channel, handler) => handlers.set(channel, handler)),
    on: vi.fn(),
    removeHandler: vi.fn((channel) => handlers.delete(channel)),
    invoke(channel, payload) {
      const handler = handlers.get(channel)
      if (!handler) throw new Error(`missing handler: ${channel}`)
      return handler({}, payload)
    },
  }
}

function fakeWindow() {
  return {
    isDestroyed: vi.fn(() => false),
    webContents: {
      isDestroyed: vi.fn(() => false),
      send: vi.fn(),
    },
  }
}

function fullSessionManagerDouble() {
  // 🔴 코드가 호출 가능한 전 surface를 모두 둔다. 빠진 optional method 때문에 위험 경로가
  // 조용한 no-op이 되는 mock을 다시 만들지 않는다.
  return {
    open: vi.fn(async () => ({ sessionId: 'session-1' })),
    send: vi.fn(async () => ({ turn: { id: 'turn-1' } })),
    steer: vi.fn(async () => ({ turnId: 'turn-1' })),
    abort: vi.fn(async () => ({ aborted: true })),
    close: vi.fn(async () => ({ sessionId: 'session-1' })),
    status: vi.fn(() => ({ state: 'open', sessionId: 'session-1' })),
  }
}

function fullModelCatalogDouble() {
  return {
    list: vi.fn(async () => [{ id: 'gpt-visible', displayName: 'GPT Visible', hidden: false }]),
    // `agent:send` 계약이 이걸 요구한다 (registerAgentIPC 가 가드한다).
    // 기본은 "아직 캐시 없음" = null → 생략 폴백. 개별 테스트가 필요하면 덮어쓴다.
    defaultModelId: vi.fn(() => null),
  }
}

describe('registerAgentIPC — session command 효과', () => {
  let ipcMain, win, sessionManager

  beforeEach(() => {
    ipcMain = fakeIpcMain()
    win = fakeWindow()
    sessionManager = fullSessionManagerDouble()
  })

  it('send가 sessionManager에 도달하고 같은 작업의 delta가 renderer agent:delta로 간다', async () => {
    const subject = await loadSubject()
    expect(subject.registerAgentIPC).toBeTypeOf('function')
    expect(subject.createAgentEventForwarder).toBeTypeOf('function')
    const events = subject.createAgentEventForwarder({ getWindow: () => win })
    sessionManager.send.mockImplementationOnce(async (text) => {
      events.onDelta(`응답:${text}`)
      return { turn: { id: 'turn-1' } }
    })
    subject.registerAgentIPC(ipcMain, { sessionManager, getWindow: () => win })

    const result = await ipcMain.invoke('agent:send', { text: '계속해' })

    expect(sessionManager.send).toHaveBeenCalledWith('계속해')
    expect(result).toEqual({ turn: { id: 'turn-1' } })
    expect(win.webContents.send).toHaveBeenCalledWith('agent:delta', { delta: '응답:계속해' })
  })

  it('open/steer/abort/close가 각 manager method를 실제 호출하고 값을 보존한다', async () => {
    const { registerAgentIPC } = await loadSubject()
    expect(registerAgentIPC).toBeTypeOf('function')
    registerAgentIPC(ipcMain, { sessionManager, getWindow: () => win })

    await expect(ipcMain.invoke('agent:session-open', { engine: 'codex' }))
      .resolves.toEqual({ sessionId: 'session-1' })
    await expect(ipcMain.invoke('agent:steer', { text: '영상은 빼' }))
      .resolves.toEqual({ turnId: 'turn-1' })
    await expect(ipcMain.invoke('agent:abort')).resolves.toEqual({ aborted: true })
    await expect(ipcMain.invoke('agent:session-close')).resolves.toEqual({ sessionId: 'session-1' })

    expect(sessionManager.open).toHaveBeenCalledOnce()
    expect(sessionManager.steer).toHaveBeenCalledWith('영상은 빼')
    expect(sessionManager.abort).toHaveBeenCalledOnce()
    expect(sessionManager.close).toHaveBeenCalledOnce()
    expect(ipcMain.on, 'permission-response를 session IPC가 중복 등록했다').not.toHaveBeenCalled()
  })

  it('manager throw를 rejection으로 새지 않고 agent:error 값과 renderer event로 만든다', async () => {
    const { registerAgentIPC } = await loadSubject()
    expect(registerAgentIPC).toBeTypeOf('function')
    sessionManager.send.mockRejectedValueOnce(new Error('app-server died'))
    registerAgentIPC(ipcMain, { sessionManager, getWindow: () => win })

    const result = await ipcMain.invoke('agent:send', { text: '계속' })

    expect(result).toMatchObject({ error: 'agent-command-failed', command: 'agent:send', message: 'app-server died' })
    expect(win.webContents.send).toHaveBeenCalledWith('agent:error', result)
  })
})

describe('agent:list-models catalog', () => {
  it('첫 실패를 한 번 재시도하고 hidden을 제외한 성공 결과를 앱 수명 동안 캐시한다', async () => {
    const { createAgentModelCatalog } = await loadSubject()
    const listModels = vi.fn()
      .mockRejectedValueOnce(new Error('auth not ready'))
      .mockResolvedValueOnce([
        { id: 'gpt-hidden', displayName: 'Hidden', hidden: true },
        { id: 'gpt-visible', displayName: 'Visible', hidden: false },
      ])
    const catalog = createAgentModelCatalog({ listModels })

    await expect(catalog.list()).resolves.toEqual([
      { id: 'gpt-visible', displayName: 'Visible', hidden: false },
    ])
    await expect(catalog.list()).resolves.toEqual([
      { id: 'gpt-visible', displayName: 'Visible', hidden: false },
    ])
    expect(listModels).toHaveBeenCalledTimes(2)
  })

  it('두 시도 모두 실패하거나 visible 결과가 없으면 []를 반환하고 실패를 캐시하지 않는다', async () => {
    const { createAgentModelCatalog } = await loadSubject()
    const listModels = vi.fn()
      .mockResolvedValueOnce([{ id: 'hidden-a', hidden: true }])
      .mockRejectedValueOnce(new Error('spawn failed'))
      .mockResolvedValueOnce([{ id: 'visible-b', displayName: 'Visible B' }])
    const catalog = createAgentModelCatalog({ listModels })

    await expect(catalog.list()).resolves.toEqual([])
    await expect(catalog.list()).resolves.toEqual([{ id: 'visible-b', displayName: 'Visible B' }])
    expect(listModels).toHaveBeenCalledTimes(3)
  })

  /**
   * 🔴 `defaultModelId()` 는 **진짜 카탈로그**로 재야 한다.
   *
   * 배선 통합 테스트(agentModelWiring.integration)는 카탈로그를 **가짜로 주입**하므로
   * 이 함수의 본체를 **한 줄도 지나가지 않는다**. 실제로 뮤테이션으로 실증했다:
   * `models[0]` 로 바꾼 뮤턴트와 `'gpt-5.5'` 하드코딩 뮤턴트가 **둘 다 살아남았다**
   * (배선 테스트는 전부 green). 그래서 여기 좁은 단위 테스트가 따로 필요하다.
   */
  /**
   * 가드가 없으면 `defaultModelId?.()` 옵셔널 호출이 **조용히 생략 폴백**으로 무너진다 = sticky 버그 부활.
   * (뮤테이션으로 실증: 가드를 지워도 아무 테스트도 안 죽었다 → 이 테스트를 추가했다.)
   */
  it('defaultModelId 없는 catalog를 주입하면 registerAgentIPC가 거부한다 (조용한 폴백 금지)', async () => {
    const { registerAgentIPC } = await loadSubject()
    expect(() => registerAgentIPC(fakeIpcMain(), {
      sessionManager: fullSessionManagerDouble(),
      modelCatalog: { list: async () => [] },   // ← list 만 있는 옛 계약
      getWindow: () => fakeWindow(),
    })).toThrow(/defaultModelId/)
  })

  it('defaultModelId가 isDefault 모델을 고른다 (첫 번째도, 하드코딩도 아니다)', async () => {
    const { createAgentModelCatalog } = await loadSubject()
    // ⚠️ 기본을 **첫 번째가 아닌 자리**에 두고 id 도 실제 codex id 를 안 쓴다 →
    //    `models[0]` / `'gpt-5.5'` 하드코딩 뮤턴트가 여기서 죽는다.
    const listModels = vi.fn().mockResolvedValue([
      { id: 'alpha-not-default' },
      { id: 'beta-is-default', isDefault: true },
    ])
    const catalog = createAgentModelCatalog({ listModels })

    // 캐시되기 전에는 null 이어야 한다 — fetch 를 유발하면 cold send 가 블로킹된다.
    expect(catalog.defaultModelId()).toBeNull()
    await catalog.list()
    expect(catalog.defaultModelId()).toBe('beta-is-default')
  })

  it('defaultModelId는 fetch를 유발하지 않는다 (cold send를 블로킹하면 안 된다)', async () => {
    const { createAgentModelCatalog } = await loadSubject()
    const listModels = vi.fn().mockResolvedValue([{ id: 'x', isDefault: true }])
    const catalog = createAgentModelCatalog({ listModels })

    expect(catalog.defaultModelId()).toBeNull()
    expect(listModels).not.toHaveBeenCalled()   // ← 급소: list() 를 몰래 부르면 20s×2 로 Send 가 멈춘다
  })

  it('isDefault가 하나도 없으면(서버 이상) null → 호출측이 생략으로 폴백한다', async () => {
    const { createAgentModelCatalog } = await loadSubject()
    const listModels = vi.fn().mockResolvedValue([{ id: 'a' }, { id: 'b' }])
    const catalog = createAgentModelCatalog({ listModels })

    await catalog.list()
    expect(catalog.defaultModelId()).toBeNull()
  })

  /**
   * 🔴 이 테스트는 **뒤집힌 것**이다. 원래 나는 "hidden 모델은 기본이 될 수 없다" 를 의도로 핀했는데,
   *    적대 리뷰가 그게 **구멍**임을 보였다: `hidden` 은 *"선택지에 안 보인다"* 이지
   *    *"서버 기본이 아니다"* 가 아니다. 기본이 hidden 이면 카탈로그는 **안 비어 있는데**
   *    defaultModelId 만 null → 사용자는 다른 모델을 고를 수 **있고** → '기본' → 생략 →
   *    **sticky 버그 부활**. ("카탈로그 없으면 sticky 불가" 불변식이 이 부분집합을 커버 못 했다.)
   */
  it('기본 모델이 hidden 이어도 기본으로 쓴다 (선택지에서 감춘 것 ≠ 서버 기본이 아닌 것)', async () => {
    const { createAgentModelCatalog } = await loadSubject()
    const listModels = vi.fn().mockResolvedValue([
      { id: 'hidden-default', isDefault: true, hidden: true },
      { id: 'visible', isDefault: false },
    ])
    const catalog = createAgentModelCatalog({ listModels })

    await catalog.list()
    // 목록(선택지)에는 안 나오지만
    await expect(catalog.list()).resolves.toEqual([{ id: 'visible', isDefault: false }])
    // 와이어에는 명시된다 → 생략으로 떨어지지 않는다
    expect(catalog.defaultModelId()).toBe('hidden-default')
  })

  it('agent:list-models handler가 catalog 값을 그대로 renderer에 돌려준다', async () => {
    const { registerAgentIPC } = await loadSubject()
    const ipcMain = fakeIpcMain()
    const win = fakeWindow()
    const sessionManager = fullSessionManagerDouble()
    const modelCatalog = fullModelCatalogDouble()
    registerAgentIPC(ipcMain, { sessionManager, modelCatalog, getWindow: () => win })

    await expect(ipcMain.invoke('agent:list-models')).resolves.toEqual([
      { id: 'gpt-visible', displayName: 'GPT Visible', hidden: false },
    ])
    expect(modelCatalog.list).toHaveBeenCalledOnce()
  })
})

describe('createAgentEventForwarder — D14 event 효과', () => {
  it('item/completed(agentMessage)를 확정 text가 든 agent:message로 전달한다', async () => {
    const { createAgentEventForwarder } = await loadSubject()
    const win = fakeWindow()
    const events = createAgentEventForwarder({ getWindow: () => win })
    const item = { id: 'message-1', type: 'agentMessage', text: '수정된 답' }

    events.onEvent({ method: 'item/completed', params: { turnId: 'turn-1', item } })

    expect(win.webContents.send).toHaveBeenCalledWith('agent:message', {
      turnId: 'turn-1',
      item,
    })
  })

  it('tool-call/usage/done/error/exit를 story stream이 아닌 agent 채널로만 보낸다', async () => {
    const { createAgentEventForwarder } = await loadSubject()
    expect(createAgentEventForwarder).toBeTypeOf('function')
    const win = fakeWindow()
    const events = createAgentEventForwarder({ getWindow: () => win })
    const tool = { id: 'tool-1', type: 'mcpToolCall', tool: 'wait_batch', status: 'completed' }

    events.onEvent({ method: 'item/completed', params: { turnId: 'turn-1', item: tool } })
    events.onUsage({ sessionId: 's1', turns: 1, toolCalls: 1, elapsedMs: 10 })
    events.onEvent({ method: 'turn/completed', params: { turn: { id: 'turn-1', status: 'completed' } } })
    events.onError({ error: 'agent-limit', limit: 64, used: 64 })
    events.onExit({ code: 23, signal: 'SIGKILL', error: new Error('crashed') })

    expect(win.webContents.send).toHaveBeenCalledWith('agent:tool-call', {
      turnId: 'turn-1', phase: 'completed', item: tool,
    })
    expect(win.webContents.send).toHaveBeenCalledWith('agent:usage', {
      sessionId: 's1', turns: 1, toolCalls: 1, elapsedMs: 10,
    })
    expect(win.webContents.send).toHaveBeenCalledWith('agent:done', {
      turnId: 'turn-1', status: 'completed', turn: { id: 'turn-1', status: 'completed' },
    })
    expect(win.webContents.send).toHaveBeenCalledWith('agent:error', {
      error: 'agent-limit', limit: 64, used: 64,
    })
    expect(win.webContents.send).toHaveBeenCalledWith('agent:error', expect.objectContaining({
      error: 'agent-exit', message: 'crashed', code: 23, signal: 'SIGKILL',
    }))
    expect(win.webContents.send.mock.calls.every(([channel]) => channel.startsWith('agent:'))).toBe(true)
  })

  it('failed turn은 done으로 위장하지 않고 구조화 agent:error로 보낸다', async () => {
    const { createAgentEventForwarder } = await loadSubject()
    expect(createAgentEventForwarder).toBeTypeOf('function')
    const win = fakeWindow()
    const events = createAgentEventForwarder({ getWindow: () => win })

    events.onEvent({
      method: 'turn/completed',
      params: { turn: { id: 'turn-bad', status: 'failed', error: { message: 'tool failed' } } },
    })

    expect(win.webContents.send).toHaveBeenCalledWith('agent:error', expect.objectContaining({
      error: 'agent-turn-failed', message: 'tool failed', turnId: 'turn-bad',
    }))
    expect(win.webContents.send).not.toHaveBeenCalledWith('agent:done', expect.anything())
  })
})
