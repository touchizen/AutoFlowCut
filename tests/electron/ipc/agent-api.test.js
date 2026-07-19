// @vitest-environment node
//
// D14/V1 — ChatPanel 전용 command 6개 중 session 5개와 agent event 6개를 소유한다.
// permission request/response 한 쌍은 app-scoped approvalPrompt가 이미 한 번만 소유하므로 여기서
// 다시 등록하지 않는다. 이 테스트는 handler 모양이 아니라 renderer까지 도달하는 효과를 검증한다.
import { beforeEach, describe, expect, it, vi } from 'vitest'

// RED 단계의 구 구현이 새 DI 이름을 무시해도 실제 provider 프로세스를 띄우지 못하게 막는다.
const providerSourceDoubles = vi.hoisted(() => ({
  codex: vi.fn(async () => []),
  claude: vi.fn(async () => []),
}))

vi.mock('../../../electron/api/llm/codexAppServer.js', () => ({
  listCodexModels: providerSourceDoubles.codex,
}))
vi.mock('../../../electron/api/llm/llmClaude.js', () => ({
  listClaudeModels: providerSourceDoubles.claude,
}))

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
  const rows = [{ id: 'gpt-visible', displayName: 'GPT Visible', hidden: false }]
  return {
    list: vi.fn(async () => rows.map((row) => ({ ...row }))),
    snapshot: vi.fn(() => ({
      cacheReady: true,
      rows: rows.map((row) => ({ ...row })),
      defaultId: 'codex:gpt-5.5',
    })),
    // production catalog의 cache-only lookup 계약을 재현한다. send 생략의 authority는
    // sessionManager의 open snapshot/defaultPin이라 registerAgentIPC는 이 메서드를 호출하지 않는다.
    defaultModelId: vi.fn(() => 'codex:gpt-5.5'),
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
    const modelCatalog = fullModelCatalogDouble()
    sessionManager.send.mockImplementationOnce(async (text) => {
      events.onDelta(`응답:${text}`)
      return { turn: { id: 'turn-1' } }
    })
    subject.registerAgentIPC(ipcMain, { sessionManager, modelCatalog, getWindow: () => win })

    const result = await ipcMain.invoke('agent:send', { text: '계속해' })

    expect(sessionManager.send).toHaveBeenCalledWith('계속해')
    expect(modelCatalog.defaultModelId).not.toHaveBeenCalled()
    expect(result).toEqual({ turn: { id: 'turn-1' } })
    expect(win.webContents.send).toHaveBeenCalledWith('agent:delta', { delta: '응답:계속해' })
  })

  it('명시 model은 sessionManager send의 두 번째 인자로 보존한다', async () => {
    const { registerAgentIPC } = await loadSubject()
    registerAgentIPC(ipcMain, { sessionManager, getWindow: () => win })

    await ipcMain.invoke('agent:send', { text: '모델 지정', model: 'claude:opus[1m]' })

    expect(sessionManager.send).toHaveBeenCalledWith('모델 지정', 'claude:opus[1m]')
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
  it('두 provider를 별도로 재시도하고 정규화한 성공 결과를 앱 수명 동안 캐시한다', async () => {
    const { createAgentModelCatalog } = await loadSubject()
    const listCodexModels = vi.fn()
      .mockRejectedValueOnce(new Error('auth not ready'))
      .mockResolvedValueOnce([
        { id: 'gpt-hidden', displayName: 'Hidden', hidden: true },
        { id: 'gpt-visible', displayName: 'Visible', hidden: false },
      ])
    const listClaudeModels = vi.fn().mockResolvedValue([
      { value: 'sonnet-edge', resolvedModel: 'claude-sonnet-edge', displayName: 'Sonnet Edge' },
    ])
    const catalog = createAgentModelCatalog({ listCodexModels, listClaudeModels })

    const first = await catalog.list()
    const second = await catalog.list()

    expect(first).toEqual(second)
    expect(first).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'codex:gpt-hidden', provider: 'codex', hidden: true }),
      expect.objectContaining({ id: 'codex:gpt-visible', provider: 'codex', hidden: false }),
      expect.objectContaining({ id: 'claude:sonnet-edge', provider: 'claude', hidden: false }),
    ]))
    expect(listCodexModels).toHaveBeenCalledTimes(2)
    expect(listClaudeModels).toHaveBeenCalledOnce()
  })

  it('provider:sourceKey id와 sdkModel을 보존하고 앱 기본은 두 번째가 아닌 built-in fallback 하나로 고정한다', async () => {
    const { createAgentModelCatalog } = await loadSubject()
    const listCodexModels = vi.fn().mockResolvedValue([
      { id: 'vendor-alpha', displayName: 'Alpha', isDefault: false },
      {
        id: 'vendor-beta',
        displayName: 'Beta',
        description: 'provider default in the second slot',
        isDefault: true,
        supportedReasoningEfforts: [{ reasoningEffort: 'xhigh' }],
      },
      {
        id: 'gpt-5.5',
        displayName: 'Fetched GPT',
        hidden: true,
        contextWindow: 272000,
      },
      { id: 'vendor-beta', displayName: 'duplicate must be dropped' },
      { id: 'unknown-provider', provider: 'mystery' },
      { id: '' },
      null,
    ])
    const listClaudeModels = vi.fn().mockResolvedValue([
      { value: 'sonnet-edge', resolvedModel: 'claude-sonnet-edge', displayName: 'Sonnet Edge' },
    ])
    const catalog = createAgentModelCatalog({ listCodexModels, listClaudeModels })

    const rows = await catalog.list()
    const beta = rows.find(({ id }) => id === 'codex:vendor-beta')
    const fallback = rows.find(({ id }) => id === 'codex:gpt-5.5')

    expect(beta).toMatchObject({
      sourceKey: 'vendor-beta',
      provider: 'codex',
      sdkModel: 'vendor-beta',
      providerDefault: true,
      isDefault: false,
      description: 'provider default in the second slot',
      supportedReasoningEfforts: [{ reasoningEffort: 'xhigh' }],
    })
    expect(fallback).toMatchObject({
      provider: 'codex',
      sourceKey: 'gpt-5.5',
      sdkModel: 'gpt-5.5',
      displayName: 'Fetched GPT',
      contextWindow: 272000,
      hidden: false,
      isDefault: true,
      defaultFallbackFrom: 'claude-opus-4-8',
    })
    expect(rows.filter(({ isDefault }) => isDefault)).toEqual([fallback])
    expect(rows.filter(({ id }) => id === 'codex:vendor-beta')).toHaveLength(1)
    expect(rows.some(({ id }) => id === 'codex:unknown-provider')).toBe(false)
    expect(catalog.defaultModelId()).toBe('codex:gpt-5.5')
  })

  /**
   * 🔴 `defaultModelId()` 는 **진짜 카탈로그**로 재야 한다.
   *
   * 배선 통합 테스트(agentModelWiring.integration)는 카탈로그를 **가짜로 주입**하므로
   * 이 함수의 본체를 **한 줄도 지나가지 않는다**. 실제로 뮤테이션으로 실증했다:
   * `models[0]` 로 바꾼 뮤턴트와 `'gpt-5.5'` 하드코딩 뮤턴트가 **둘 다 살아남았다**
   * (배선 테스트는 전부 green). 그래서 여기 좁은 단위 테스트가 따로 필요하다.
   */
  it('registerAgentIPC는 미사용 defaultModelId를 요구하지 않고 send 생략을 manager pin에 위임한다', async () => {
    const { registerAgentIPC } = await loadSubject()
    const localIpcMain = fakeIpcMain()
    const localSessionManager = fullSessionManagerDouble()

    registerAgentIPC(localIpcMain, {
      sessionManager: localSessionManager,
      modelCatalog: { list: vi.fn(async () => []) },
      getWindow: () => fakeWindow(),
    })

    await localIpcMain.invoke('agent:send', { text: '세션 pin 사용' })
    expect(localSessionManager.send).toHaveBeenCalledWith('세션 pin 사용')
  })

  it('Claude default candidate는 두 번째 raw value로 식별하고 sdkModel:null과 [1m] resolvedModel을 그대로 보존한다', async () => {
    const { createAgentModelCatalog } = await loadSubject()
    const listCodexModels = vi.fn().mockResolvedValue([{ id: 'vendor-alpha' }])
    // ⚠️ candidate를 첫 번째가 아닌 자리 + non-Codex sourceKey에 둔다.
    // `models[0]` / Codex id 하드코딩 / value↔resolvedModel 교환 뮤턴트를 같이 죽인다.
    const listClaudeModels = vi.fn().mockResolvedValue([
      {
        value: 'opus[1m]',
        resolvedModel: 'claude-opus-4-8[1m]',
        displayName: 'Opus 1M',
        supportsAdaptiveThinking: true,
      },
      {
        value: 'default',
        resolvedModel: 'claude-opus-4-8[1m]',
        displayName: 'Default',
        description: 'Provider default alias',
      },
    ])
    const catalog = createAgentModelCatalog({ listCodexModels, listClaudeModels })

    const rows = await catalog.list()
    expect(rows.find(({ id }) => id === 'claude:opus[1m]')).toMatchObject({
      sourceKey: 'opus[1m]',
      provider: 'claude',
      sdkModel: 'opus[1m]',
      resolvedModel: 'claude-opus-4-8[1m]',
      hidden: false,
      isDefault: false,
      supportsAdaptiveThinking: true,
    })
    expect(rows.find(({ id }) => id === 'claude:default')).toMatchObject({
      sourceKey: 'default',
      provider: 'claude',
      sdkModel: null,
      resolvedModel: 'claude-opus-4-8[1m]',
      providerDefault: true,
      defaultCandidate: true,
      hidden: true,
      isDefault: false,
    })
    expect(catalog.defaultModelId()).toBe('codex:gpt-5.5')
  })

  it('실측 상수가 채워진 분기에서만 Claude candidate를 승격하고 Codex fallback 신호를 비운다', async () => {
    vi.resetModules()
    vi.doMock('../../../electron/agent/constants.js', () => ({
      COLD_DEFAULT_MODEL_ID: 'codex:gpt-5.5',
      CLAUDE_AGENT_DEFAULT_SDK_MODEL: 'measured-opus-sdk-value',
    }))
    try {
      const { createAgentModelCatalog } = await import('../../../electron/ipc/agent-api.js?promoted-claude-default')
      const listCodexModels = vi.fn().mockResolvedValue([
        { id: 'vendor-alpha' },
        { id: 'gpt-5.5', displayName: 'Fetched GPT', isDefault: true },
      ])
      const listClaudeModels = vi.fn().mockResolvedValue([
        { value: 'sonnet-edge', resolvedModel: 'claude-sonnet-edge' },
        { value: 'default', resolvedModel: 'claude-opus-4-8[1m]' },
      ])
      const catalog = createAgentModelCatalog({ listCodexModels, listClaudeModels })

      const rows = await catalog.list()
      const candidate = rows.find(({ id }) => id === 'claude:default')
      const fallback = rows.find(({ id }) => id === 'codex:gpt-5.5')

      expect(candidate).toMatchObject({
        provider: 'claude',
        sdkModel: 'measured-opus-sdk-value',
        resolvedModel: 'claude-opus-4-8[1m]',
        isDefault: true,
      })
      expect(fallback).toMatchObject({ provider: 'codex', sdkModel: 'gpt-5.5', isDefault: false })
      expect(fallback).not.toHaveProperty('defaultFallbackFrom')
      expect(rows.filter(({ isDefault }) => isDefault)).toEqual([candidate])
      expect(catalog.defaultModelId()).toBe('claude:default')
    } finally {
      vi.doUnmock('../../../electron/agent/constants.js')
      vi.resetModules()
    }
  })

  it('defaultModelId는 cold cache에서도 항상 id 문자열이고 두 provider fetch를 유발하지 않는다', async () => {
    const { createAgentModelCatalog } = await loadSubject()
    const listCodexModels = vi.fn(async () => { throw new Error('must stay cold') })
    const listClaudeModels = vi.fn(async () => { throw new Error('must stay cold') })
    const catalog = createAgentModelCatalog({ listCodexModels, listClaudeModels })

    expect(catalog.defaultModelId()).toBe('codex:gpt-5.5')
    expect(typeof catalog.defaultModelId()).toBe('string')
    expect(listCodexModels).not.toHaveBeenCalled()
    expect(listClaudeModels).not.toHaveBeenCalled()

    const rows = await catalog.list()
    expect(rows.filter(({ isDefault }) => isDefault)).toEqual([
      expect.objectContaining({
        id: 'codex:gpt-5.5',
        provider: 'codex',
        sdkModel: 'gpt-5.5',
        defaultFallbackFrom: 'claude-opus-4-8',
      }),
    ])
    expect(listCodexModels).toHaveBeenCalledTimes(2)
    expect(listClaudeModels).toHaveBeenCalledTimes(2)
  })

  it('snapshot은 cold cache에서 fetch 없이 built-in 기본 행과 readiness를 동기로 반환한다', async () => {
    const { createAgentModelCatalog } = await loadSubject()
    const listCodexModels = vi.fn(async () => { throw new Error('must stay cold') })
    const listClaudeModels = vi.fn(async () => { throw new Error('must stay cold') })
    const catalog = createAgentModelCatalog({ listCodexModels, listClaudeModels })

    expect(catalog.snapshot()).toEqual({
      cacheReady: false,
      rows: [expect.objectContaining({
        id: 'codex:gpt-5.5',
        provider: 'codex',
        sdkModel: 'gpt-5.5',
        isDefault: true,
        defaultFallbackFrom: 'claude-opus-4-8',
      })],
      defaultId: 'codex:gpt-5.5',
    })
    expect(listCodexModels).not.toHaveBeenCalled()
    expect(listClaudeModels).not.toHaveBeenCalled()
  })

  it('snapshot은 warm cache에서 fetched 행과 현재 기본 id를 cache-only로 반환한다', async () => {
    const { createAgentModelCatalog } = await loadSubject()
    const listCodexModels = vi.fn(async () => [{ id: 'warm-codex', displayName: 'Warm Codex' }])
    const listClaudeModels = vi.fn(async () => [{ value: 'warm-claude', displayName: 'Warm Claude' }])
    const catalog = createAgentModelCatalog({ listCodexModels, listClaudeModels })
    await catalog.list()
    listCodexModels.mockClear()
    listClaudeModels.mockClear()

    const snapshot = catalog.snapshot()

    expect(snapshot.cacheReady).toBe(true)
    expect(snapshot.defaultId).toBe('codex:gpt-5.5')
    expect(snapshot.rows).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'codex:warm-codex', provider: 'codex', sdkModel: 'warm-codex' }),
      expect.objectContaining({ id: 'claude:warm-claude', provider: 'claude', sdkModel: 'warm-claude' }),
    ]))
    expect(listCodexModels).not.toHaveBeenCalled()
    expect(listClaudeModels).not.toHaveBeenCalled()
  })

  it('snapshot 반환 행을 호출자가 바꿔도 catalog 내부 cache는 변하지 않는다', async () => {
    const { createAgentModelCatalog } = await loadSubject()
    const catalog = createAgentModelCatalog({
      listCodexModels: vi.fn(async () => [{ id: 'immutable-model', displayName: 'Immutable' }]),
      listClaudeModels: vi.fn(async () => [{ value: 'sonnet', displayName: 'Sonnet' }]),
    })
    await catalog.list()

    const first = catalog.snapshot()
    const target = first.rows.find((row) => row.id === 'codex:immutable-model')
    target.sdkModel = 'tampered'
    target.isDefault = true
    first.rows.push({ id: 'caller-only' })

    const second = catalog.snapshot()
    expect(second.rows.find((row) => row.id === 'codex:immutable-model')).toMatchObject({
      sdkModel: 'immutable-model',
      isDefault: false,
    })
    expect(second.rows.some((row) => row.id === 'caller-only')).toBe(false)
    expect(second.defaultId).toBe('codex:gpt-5.5')
  })

  it('기본 상수는 cold fallback id를 핀하고 Claude 승격 문자열은 미확정 null이다', async () => {
    const constants = await import('../../../electron/agent/constants.js')
    expect(constants.COLD_DEFAULT_MODEL_ID).toBe('codex:gpt-5.5')
    expect(constants.CLAUDE_AGENT_DEFAULT_SDK_MODEL).toBeNull()
  })

  it('agent:list-models handler가 내부 default resolve 뒤 renderer 반환 경계에서만 hidden을 거른다', async () => {
    const { registerAgentIPC } = await loadSubject()
    const ipcMain = fakeIpcMain()
    const win = fakeWindow()
    const sessionManager = fullSessionManagerDouble()
    const modelCatalog = fullModelCatalogDouble()
    modelCatalog.list.mockResolvedValue([
      { id: 'claude:default', provider: 'claude', sdkModel: null, isDefault: false, hidden: true },
      { id: 'codex:gpt-visible', provider: 'codex', sdkModel: 'gpt-visible', isDefault: true, hidden: false },
    ])
    registerAgentIPC(ipcMain, { sessionManager, modelCatalog, getWindow: () => win })

    await expect(ipcMain.invoke('agent:list-models')).resolves.toEqual([
      { id: 'codex:gpt-visible', provider: 'codex', sdkModel: 'gpt-visible', isDefault: true, hidden: false },
    ])
    expect(modelCatalog.list).toHaveBeenCalledOnce()
  })
})

describe('createAgentEventForwarder — D14 event 효과', () => {
  it('Codex 문자열 delta는 유지하고 Claude 객체 delta는 provenance와 함께 언팩한다', async () => {
    const { createAgentEventForwarder } = await loadSubject()
    const win = fakeWindow()
    const events = createAgentEventForwarder({ getWindow: () => win })

    events.onDelta('Codex 조각')
    events.onDelta({ text: 'Claude 조각', turnId: 'turn-claude', sourceUuid: 'source-1' })

    expect(win.webContents.send).toHaveBeenNthCalledWith(1, 'agent:delta', {
      delta: 'Codex 조각',
    })
    expect(win.webContents.send).toHaveBeenNthCalledWith(2, 'agent:delta', {
      delta: 'Claude 조각',
      turnId: 'turn-claude',
      sourceUuid: 'source-1',
    })
  })

  it('item/retracted를 turn과 source UUID가 보존된 전용 renderer event로 전달한다', async () => {
    const { createAgentEventForwarder } = await loadSubject()
    const win = fakeWindow()
    const events = createAgentEventForwarder({ getWindow: () => win })

    events.onEvent({
      method: 'item/retracted',
      params: { turnId: 'turn-1', sourceUuids: ['source-1', 'source-2'] },
    })

    expect(win.webContents.send).toHaveBeenCalledWith('agent:item-retracted', {
      turnId: 'turn-1',
      sourceUuids: ['source-1', 'source-2'],
    })
  })

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

  it('onExit의 sessionClosed를 agent:error로 통과시켜 renderer가 local session ref를 내리게 한다', async () => {
    const { createAgentEventForwarder } = await loadSubject()
    const win = fakeWindow()
    const events = createAgentEventForwarder({ getWindow: () => win })
    events.onExit({ code: null, signal: null, error: null, reason: 'agent-orphan-drain-timeout', sessionClosed: true })
    expect(win.webContents.send).toHaveBeenCalledWith('agent:error', expect.objectContaining({
      error: 'agent-exit',
      sessionClosed: true,
    }))
  })

  it('sessionClosed 없는 onExit은 sessionClosed:false로 내보내 세션을 유지하게 한다', async () => {
    const { createAgentEventForwarder } = await loadSubject()
    const win = fakeWindow()
    const events = createAgentEventForwarder({ getWindow: () => win })
    events.onExit({ code: 1, signal: null, error: new Error('boom') })
    const call = win.webContents.send.mock.calls.find(([channel]) => channel === 'agent:error')
    expect(call[1].sessionClosed).toBe(false)
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
