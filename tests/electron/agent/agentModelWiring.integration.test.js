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

function createHarness() {
  const sent = []
  const client = {
    request: vi.fn(async (method, params) => {
      sent.push({ method, params })
      if (method === 'initialize') return {}
      if (method === 'thread/start') return { thread: { id: 'thread-model-wire' } }
      if (method === 'turn/start') return { turn: { id: 'turn-model-wire', status: 'inProgress' } }
      throw new Error(`unexpected method: ${method}`)
    }),
    respond: vi.fn(),
  }
  const ipcMain = fakeIpcMain()
  const manager = createAgentSessionManager({
    grantLedger: { closeSession: vi.fn() },
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
      appServerFactory: () => ({ client, close: vi.fn(async () => {}) }),
    },
  })
  registerAgentIPC(ipcMain, {
    sessionManager: manager,
    getWindow: () => null,
  })
  electronDouble.ipcRenderer.invoke.mockImplementation((channel, payload) => ipcMain.invoke(channel, payload))
  return { manager, sent }
}

beforeAll(async () => {
  await import('../../../electron/preload.js?agent-model-wiring-runtime')
})

describe('agent model runtime wiring', () => {
  it('preload open/send model이 실제 thread/start와 turn/start에 도달한다', async () => {
    const { manager, sent } = createHarness()

    await electronDouble.exposed.agentSessionOpen({ model: 'gpt-thread' })
    await electronDouble.exposed.agentSend({ text: '다음 턴', model: 'gpt-turn' })

    expect(sent.find(({ method }) => method === 'thread/start')?.params.model).toBe('gpt-thread')
    expect(sent.find(({ method }) => method === 'turn/start')?.params).toMatchObject({
      threadId: 'thread-model-wire',
      model: 'gpt-turn',
      input: [{ type: 'text', text: '다음 턴' }],
    })
    await manager.close()
  })

  it('선택 모델이 없으면 thread/start와 turn/start에서 model 필드를 생략한다', async () => {
    const { manager, sent } = createHarness()

    await electronDouble.exposed.agentSessionOpen()
    await electronDouble.exposed.agentSend({ text: '기본 모델' })

    expect(sent.find(({ method }) => method === 'thread/start')?.params).not.toHaveProperty('model')
    expect(sent.find(({ method }) => method === 'turn/start')?.params).not.toHaveProperty('model')
    await manager.close()
  })
})
