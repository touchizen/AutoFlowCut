// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

const stepMachineMocks = vi.hoisted(() => ({
  createStepMachine: vi.fn(),
  readAudioPackage: vi.fn(),
}))

vi.mock('../../../electron/story/stepMachine.js', () => stepMachineMocks)

import { registerShoppingIPC } from '../../../electron/ipc/shopping-api.js'
import { registerStoryIPC } from '../../../electron/ipc/story-api.js'
import { createWorkflowSessionCoordinator } from '../../../electron/ipc/workflowSessionCoordinator.js'
import { createWorkFolderAuthority } from '../../../electron/main/workFolderAuthority.js'

function fakeIpcMain() {
  const handlers = new Map()
  return {
    handle: (channel, handler) => handlers.set(channel, handler),
    invoke: (channel, payload) => handlers.get(channel)(null, payload),
  }
}

function deferred() {
  let resolve
  const promise = new Promise((done) => { resolve = done })
  return { promise, resolve }
}

describe('main-owned workflow session coordinator', () => {
  let ipc
  let workFolder
  let storyDir
  let shoppingDir
  let coordinator
  let storyMachine
  let shoppingMachine

  beforeEach(async () => {
    vi.resetAllMocks()
    ipc = fakeIpcMain()
    workFolder = await mkdtemp(path.join(tmpdir(), 'workflow-session-'))
    storyDir = path.join(workFolder, 'story-project')
    shoppingDir = path.join(workFolder, 'shopping-project')
    await mkdir(storyDir)
    await mkdir(shoppingDir)
    await writeFile(path.join(storyDir, 'project.json'), JSON.stringify({ workflowType: 'story' }))
    await writeFile(path.join(shoppingDir, 'project.json'), JSON.stringify({ workflowType: 'shopping-short' }))

    coordinator = createWorkflowSessionCoordinator()
    storyMachine = {
      projectToken: 'story-token',
      open: vi.fn(async () => ({ projectToken: 'story-token', state: {} })),
      abort: vi.fn(async () => ({ ok: true })),
      start: vi.fn(async () => ({ operationId: 'story-operation' })),
      getState: vi.fn(async () => ({ state: {} })),
    }
    shoppingMachine = {
      open: vi.fn(async () => ({ projectToken: 'shopping-token', state: { state: 'empty' } })),
      abort: vi.fn(async () => ({ ok: true })),
      submitProduct: vi.fn(async () => ({ ok: true, operationId: 'shopping-operation' })),
      getState: vi.fn(async () => ({ state: 'empty' })),
    }
    stepMachineMocks.createStepMachine.mockReturnValue(storyMachine)

    registerStoryIPC(ipc, {
      keyStore: { getKey: () => 'key' },
      getWindow: () => null,
      getActiveWorkFolder: () => workFolder,
      llm: {},
      listClaudeModels: async () => [],
      listCodexModels: async () => [],
      workflowSessions: coordinator,
    })
    registerShoppingIPC(ipc, {
      getWindow: () => null,
      getActiveWorkFolder: () => workFolder,
      createMachine: () => shoppingMachine,
      workflowSessions: coordinator,
    })
  })

  it('Story→Shopping 전환은 Story를 await abort하고 옛 token을 side effect 전에 막는다', async () => {
    const openedStory = await ipc.invoke('story:open', { projectPath: storyDir })

    await ipc.invoke('shopping:open', { projectPath: shoppingDir })
    const stale = await ipc.invoke('story:start', {
      projectToken: openedStory.projectToken,
      step: 'script',
      params: {},
    })

    expect(storyMachine.abort).toHaveBeenCalledTimes(1)
    expect(stale).toEqual({ error: 'stale-token' })
    expect(storyMachine.start).not.toHaveBeenCalled()
  })

  it('Shopping→Story 전환은 Shopping을 await abort하고 옛 token을 side effect 전에 막는다', async () => {
    const openedShopping = await ipc.invoke('shopping:open', { projectPath: shoppingDir })

    await ipc.invoke('story:open', { projectPath: storyDir })
    const stale = await ipc.invoke('shopping:submit-product', {
      projectToken: openedShopping.projectToken,
      url: 'https://www.coupang.com/vp/products/1',
    })

    expect(shoppingMachine.abort).toHaveBeenCalledWith(openedShopping.projectToken)
    expect(stale).toEqual({ error: 'stale-token' })
    expect(shoppingMachine.submitProduct).not.toHaveBeenCalled()
  })

  it('story:abort는 active session을 폐기해 같은 token의 늦은 명령을 막는다', async () => {
    const { projectToken } = await ipc.invoke('story:open', { projectPath: storyDir })

    await expect(ipc.invoke('story:abort', { projectToken })).resolves.toEqual({ ok: true })
    const stale = await ipc.invoke('story:start', { projectToken, step: 'script', params: {} })

    expect(stale).toEqual({ error: 'stale-token' })
    expect(storyMachine.start).not.toHaveBeenCalled()
  })

  it('shopping:abort는 active session을 폐기해 같은 token의 늦은 명령을 막는다', async () => {
    const { projectToken } = await ipc.invoke('shopping:open', { projectPath: shoppingDir })

    await expect(ipc.invoke('shopping:abort', { projectToken })).resolves.toEqual({ ok: true })
    const stale = await ipc.invoke('shopping:submit-product', {
      projectToken,
      url: 'https://www.coupang.com/vp/products/1',
    })

    expect(stale).toEqual({ error: 'stale-token' })
    expect(shoppingMachine.submitProduct).not.toHaveBeenCalled()
  })

  it('서로 다른 workflow open도 하나의 lock에서 직렬화하고 후보는 open 완료 전 publish하지 않는다', async () => {
    const local = createWorkflowSessionCoordinator()
    const storyGate = deferred()
    const abortGate = deferred()
    const order = []
    const story = {
      abort: vi.fn(async () => {
        order.push('story-abort')
        await abortGate.promise
      }),
    }
    const shoppingCreate = vi.fn(async () => {
      order.push('shopping-open')
      return {
        machine: { abort: vi.fn() },
        token: 'shopping-token',
        abort: vi.fn(),
        result: { projectToken: 'shopping-token' },
      }
    })

    const openingStory = local.open('story', {
      validate: async () => ({ projectPath: storyDir }),
      create: async () => {
        order.push('story-open')
        expect(local.capture('story', 'story-token')).toBeNull()
        await storyGate.promise
        return {
          machine: story,
          token: 'story-token',
          abort: () => story.abort(),
          result: { projectToken: 'story-token' },
        }
      },
    })
    const openingShopping = local.open('shopping', {
      validate: async () => ({ projectPath: shoppingDir }),
      create: shoppingCreate,
    })

    await vi.waitFor(() => expect(order).toEqual(['story-open']))
    expect(shoppingCreate).not.toHaveBeenCalled()
    storyGate.resolve()

    await vi.waitFor(() => expect(order).toEqual(['story-open', 'story-abort']))
    expect(shoppingCreate).not.toHaveBeenCalled()
    abortGate.resolve()

    await Promise.all([openingStory, openingShopping])
    expect(order).toEqual(['story-open', 'story-abort', 'shopping-open'])
    expect(local.capture('story', 'story-token')).toBeNull()
    expect(local.capture('shopping', 'shopping-token')).toMatchObject({
      workflowType: 'shopping',
      token: 'shopping-token',
    })
  })

  it('work-folder authority가 바뀌면 이전 폴더 session을 폐기해 옛 token을 막는다', async () => {
    const authority = createWorkFolderAuthority({
      onChange: () => coordinator.invalidate(),
    })
    await authority.confirm(workFolder)

    const isolatedIpc = fakeIpcMain()
    registerStoryIPC(isolatedIpc, {
      keyStore: { getKey: () => 'key' },
      getWindow: () => null,
      getActiveWorkFolder: () => authority.getCanonicalPath(),
      llm: {},
      listClaudeModels: async () => [],
      listCodexModels: async () => [],
      workflowSessions: coordinator,
    })
    const { projectToken } = await isolatedIpc.invoke('story:open', { projectPath: storyDir })
    const nextWorkFolder = await mkdtemp(path.join(tmpdir(), 'workflow-session-next-'))

    await authority.confirm(nextWorkFolder)
    const stale = await isolatedIpc.invoke('story:start', {
      projectToken,
      step: 'script',
      params: {},
    })

    expect(storyMachine.abort).toHaveBeenCalledTimes(1)
    expect(stale).toEqual({ error: 'stale-token' })
    expect(storyMachine.start).not.toHaveBeenCalled()
  })
})
