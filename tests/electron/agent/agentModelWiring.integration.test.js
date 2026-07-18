// @vitest-environment node
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { createAgentSessionManager } from '../../../electron/agent/sessionManager.js'
import { registerAgentIPC } from '../../../electron/ipc/agent-api.js'

const electronDouble = vi.hoisted(() => ({
  exposed: null,
  contextBridge: {
    exposeInMainWorld: vi.fn((_name, api) => { electronDouble.exposed = api }),
  },
  ipcRenderer: {
    invoke: vi.fn(),
    on: vi.fn(),
    removeListener: vi.fn(),
    send: vi.fn(),
  },
  webUtils: { getPathForFile: vi.fn((file) => file?.path) },
}))

vi.mock('electron', () => ({
  contextBridge: electronDouble.contextBridge,
  ipcRenderer: electronDouble.ipcRenderer,
  webUtils: electronDouble.webUtils,
}))

function fakeIpcMain() {
  const handlers = new Map()
  return {
    handle: vi.fn((channel, handler) => handlers.set(channel, handler)),
    removeHandler: vi.fn((channel) => handlers.delete(channel)),
    invoke(channel, payload) {
      const handler = handlers.get(channel)
      if (!handler) throw new Error(`missing handler: ${channel}`)
      return handler({}, payload)
    },
  }
}

/**
 * @param models 카탈로그가 **이미 캐시하고 있는** 모델들. `null` 이면 카탈로그가 비었다(auth 실패/codex 부재).
 *
 * ⚠️ 기본 모델을 **배열 첫 번째가 아닌 자리**에 두고, id 도 실제 codex id 를 안 쓴다.
 *    안 그러면 `models[0]` 이나 `'gpt-5.5'` 하드코딩 뮤턴트가 살아남는다.
 */
function createHarness({
  models = [
    { id: 'codex:alt-model', provider: 'codex', sdkModel: 'alt-model' },
    { id: 'codex:the-default', provider: 'codex', sdkModel: 'the-default', isDefault: true },
    { id: 'codex:gpt-thread', provider: 'codex', sdkModel: 'gpt-thread' },
    { id: 'codex:gpt-turn', provider: 'codex', sdkModel: 'gpt-turn' },
  ],
} = {}) {
  const sent = []
  let onNotification = () => {}
  const client = {
    request: vi.fn(async (method, params) => {
      sent.push({ method, params })
      if (method === 'initialize') return {}
      if (method === 'thread/start') return { thread: { id: 'thread-model-wire' } }
      if (method === 'turn/start') {
        const turn = { id: `turn-model-wire-${sent.length}`, status: 'inProgress' }
        onNotification({ method: 'turn/completed', params: { turn: { ...turn, status: 'completed' } } })
        return { turn }
      }
      throw new Error(`unexpected method: ${method}`)
    }),
    respond: vi.fn(),
  }
  const ipcMain = fakeIpcMain()
  const cached = models
  const modelCatalog = {
    list: vi.fn(async () => (cached ? cached.map((m) => ({ ...m })) : [])),
    defaultModelId: vi.fn(() => cached?.find((m) => m?.isDefault === true)?.id ?? 'codex:gpt-5.5'),
    snapshot: vi.fn(() => {
      const rows = cached
        ? cached.map((model) => ({ ...model }))
        : [{
            id: 'codex:gpt-5.5',
            provider: 'codex',
            sdkModel: 'gpt-5.5',
            isDefault: true,
            defaultFallbackFrom: 'claude-opus-4-8',
          }]
      return {
        cacheReady: cached !== null,
        rows,
        defaultId: rows.find((model) => model.isDefault === true)?.id ?? 'codex:gpt-5.5',
      }
    }),
  }
  const manager = createAgentSessionManager({
    grantLedger: { closeSession: vi.fn() },
    modelCatalog,
    approvalPrompt: { ask: vi.fn(), closeSession: vi.fn() },
    toolBridge: { clearOperations: vi.fn() },
    storyCommands: { projectToken: 'project-model-wire' },
    createToolCoreImpl: vi.fn(() => ({ use: vi.fn(), list: vi.fn(() => []) })),
    createPrivateRpcImpl: vi.fn(() => ({
      start: vi.fn(async () => ({ host: '127.0.0.1', port: 43123, token: 'token' })),
      close: vi.fn(async () => {}),
    })),
    createElicitationResponderImpl: vi.fn(() => ({ handle: vi.fn(async () => ({ action: 'decline' })) })),
    orchestratorOptions: {
      adapterPath: '/fake/codex-adapter.mjs',
      existsSyncImpl: () => true,
      env: {},
      authCheck: async () => 'Logged in using ChatGPT',
      runtimeHomeFactory: async () => ({ env: {}, cleanup: vi.fn(async () => {}) }),
      workingDirectoryFactory: async () => ({ workingDirectory: '/tmp/work', cleanup: vi.fn(async () => {}) }),
      appServerFactory: (options) => {
        onNotification = options.onNotification
        return { client, close: vi.fn(async () => {}) }
      },
    },
  })
  // 🔴 manager와 IPC가 같은 catalog instance를 공유해야 id→sdkModel 변환과 default 선택이 어긋나지 않는다.
  registerAgentIPC(ipcMain, {
    sessionManager: manager,
    modelCatalog,
    getWindow: () => null,
  })
  electronDouble.ipcRenderer.invoke.mockImplementation((channel, payload) => ipcMain.invoke(channel, payload))
  return { manager, modelCatalog, sent }
}

beforeAll(async () => {
  await import('../../../electron/preload.js?agent-model-wiring-runtime')
})

describe('agent model runtime wiring', () => {
  it('preload open/send model이 실제 thread/start와 turn/start에 도달한다', async () => {
    const { manager, sent } = createHarness()

    await electronDouble.exposed.agentSessionOpen({ model: 'codex:gpt-thread' })
    await electronDouble.exposed.agentSend({ text: '다음 턴', model: 'codex:gpt-turn' })

    expect(sent.find(({ method }) => method === 'thread/start')?.params.model).toBe('gpt-thread')
    expect(sent.find(({ method }) => method === 'turn/start')?.params).toMatchObject({
      threadId: 'thread-model-wire',
      model: 'gpt-turn',
      input: [{ type: 'text', text: '다음 턴' }],
    })
    await manager.close()
  })

  /**
   * 🔴 **이 자리에 있던 테스트가 버그를 계약으로 박아놨다.**
   *
   * 옛 테스트: "선택 모델이 없으면 thread/start 와 turn/start 에서 model 필드를 **생략한다**".
   * 그 생략이 바로 버그다 — 실측(m0-14, codex 0.144.5)에서 `turn/start.model` 은 **sticky inheritance** 였다:
   *   turn1 gpt-5.5(명시) → turn2 gpt-5.6-sol(명시) → turn3 **생략** → **gpt-5.6-sol 로 돌았다.**
   *   (메커니즘: 턴 사이에 `thread/settings/updated` 가 뜬다 = turn 파라미터가 thread 설정을 갱신한다.)
   * 즉 생략은 "기본으로 돌아가라"가 아니라 "직전 모델을 물려받아라"다.
   * → 사용자가 '기본' 을 골라도 안 돌아온다. **라벨이 거짓말을 한다.**
   *
   * 그래서 계약을 뒤집는다: open row를 resolve한 **thread/start**와 각 **turn/start**에는
   * 항상 SDK model 문자열이 명시돼야 한다.
   */
  it('🔴 회귀: 다른 모델을 쓴 뒤 기본으로 돌아오면 turn/start에 **session pin sdkModel이 명시**된다', async () => {
    const { manager, modelCatalog, sent } = createHarness()

    await electronDouble.exposed.agentSessionOpen()
    await electronDouble.exposed.agentSend({ text: '먼저 다른 모델', model: 'codex:alt-model' })
    await electronDouble.exposed.agentSend({ text: '이제 기본으로' })   // ← 사용자가 '기본' 선택

    const turns = sent.filter(({ method }) => method === 'turn/start')
    expect(turns).toHaveLength(2)
    // 같은 thread 여야 한다 (모델 바꾸려고 reopen 하면 대화가 날아간다)
    expect(sent.filter(({ method }) => method === 'thread/start')).toHaveLength(1)
    expect(turns[0].params).toMatchObject({ model: 'alt-model', input: [{ type: 'text', text: '먼저 다른 모델' }] })
    // 🎯 급소: 생략이면 서버가 alt-model 을 물려준다. 명시돼야만 진짜로 기본으로 돌아온다.
    expect(turns[1].params).toHaveProperty('model', 'the-default')
    expect(turns[1].params.input).toEqual([{ type: 'text', text: '이제 기본으로' }])
    expect(modelCatalog.list).toHaveBeenCalledOnce() // 첫 explicit send만 resolve한다.
    expect(modelCatalog.defaultModelId).not.toHaveBeenCalled()
    await manager.close()
  })

  it('처음부터 기본 선택이어도 catalog 재조회 없이 session pin sdkModel을 명시한다', async () => {
    const { manager, modelCatalog, sent } = createHarness()

    await electronDouble.exposed.agentSessionOpen()
    await electronDouble.exposed.agentSend({ text: '기본 모델' })

    expect(sent.find(({ method }) => method === 'thread/start')?.params).toHaveProperty('model', 'the-default')
    expect(sent.find(({ method }) => method === 'turn/start')?.params).toHaveProperty('model', 'the-default')
    expect(modelCatalog.list).not.toHaveBeenCalled()
    expect(modelCatalog.defaultModelId).not.toHaveBeenCalled()
    await manager.close()
  })

  it('cold catalog는 재조회 없이 built-in defaultPin sdkModel로 전송한다', async () => {
    const { manager, modelCatalog, sent } = createHarness({ models: null })

    await electronDouble.exposed.agentSessionOpen()
    await electronDouble.exposed.agentSend({ text: 'cold 기본' })

    expect(sent.find(({ method }) => method === 'thread/start')?.params).toHaveProperty('model', 'gpt-5.5')
    expect(sent.find(({ method }) => method === 'turn/start')?.params).toMatchObject({
      model: 'gpt-5.5',
      input: [{ type: 'text', text: 'cold 기본' }],
    })
    expect(modelCatalog.list).not.toHaveBeenCalled()
    expect(modelCatalog.defaultModelId).not.toHaveBeenCalled()
    await manager.close()
  })
})
