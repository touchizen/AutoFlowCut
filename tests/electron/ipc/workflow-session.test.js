// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdir, mkdtemp, rename, writeFile } from 'node:fs/promises'
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
  let sent

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
    sent = []
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
      getWindow: () => ({
        isDestroyed: () => false,
        webContents: { send: (channel, payload) => sent.push({ channel, payload }) },
      }),
      getActiveWorkFolder: () => workFolder,
      llm: {},
      listClaudeModels: async () => [],
      listCodexModels: async () => [],
      workflowSessions: coordinator,
    })
    registerShoppingIPC(ipc, {
      fetchProduct: vi.fn(),
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

  it('story:abort는 현재 operation만 취소하고 같은 session/token으로 재시작할 수 있다', async () => {
    const { projectToken } = await ipc.invoke('story:open', { projectPath: storyDir })

    await expect(ipc.invoke('story:abort', { projectToken })).resolves.toEqual({ ok: true })
    const restarted = await ipc.invoke('story:start', { projectToken, step: 'script', params: {} })

    expect(restarted).toEqual({ operationId: 'story-operation' })
    expect(storyMachine.abort).toHaveBeenCalledTimes(1)
    expect(storyMachine.start).toHaveBeenCalledTimes(1)
  })

  it('shopping:abort는 현재 operation만 취소하고 같은 session/token으로 재시작할 수 있다', async () => {
    const { projectToken } = await ipc.invoke('shopping:open', { projectPath: shoppingDir })

    await expect(ipc.invoke('shopping:abort', { projectToken })).resolves.toEqual({ ok: true })
    const restarted = await ipc.invoke('shopping:submit-product', {
      projectToken,
      url: 'https://www.coupang.com/vp/products/1',
    })

    expect(restarted).toEqual({ ok: true, operationId: 'shopping-operation' })
    expect(shoppingMachine.abort).toHaveBeenCalledTimes(1)
    expect(shoppingMachine.submitProduct).toHaveBeenCalledTimes(1)
  })

  it('Story→Shopping 전환 후 옛 Story machine emit은 current-session gate에서 차단한다', async () => {
    const opened = await ipc.invoke('story:open', { projectPath: storyDir })
    const oldEmit = stepMachineMocks.createStepMachine.mock.calls[0][0].emit

    await ipc.invoke('shopping:open', { projectPath: shoppingDir })
    oldEmit('story:state', { projectToken: opened.projectToken, state: { leaked: true } })

    expect(sent).toEqual([])
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

  it('validate snapshot을 previous abort 뒤 create 직전에 revalidate하고 오류면 create하지 않는다', async () => {
    const local = createWorkflowSessionCoordinator()
    const create = vi.fn()
    const revalidate = vi.fn(async () => ({ error: 'invalid-project-path' }))

    const result = await local.open('story', {
      validate: async () => ({ projectPath: storyDir, projectIdentity: { dev: 1, ino: 1 } }),
      revalidate,
      create,
    })

    expect(result).toEqual({ error: 'invalid-project-path' })
    expect(revalidate).toHaveBeenCalledWith(expect.objectContaining({ projectPath: storyDir }))
    expect(create).not.toHaveBeenCalled()
  })

  it('story:open validation 뒤 project directory를 재바인드하면 machine을 생성하지 않는다', async () => {
    await ipc.invoke('story:open', { projectPath: storyDir })
    const abortGate = deferred()
    storyMachine.abort.mockImplementationOnce(async () => {
      await abortGate.promise
      return { ok: true }
    })
    const reopening = ipc.invoke('story:open', { projectPath: storyDir })
    await vi.waitFor(() => expect(storyMachine.abort).toHaveBeenCalledTimes(1))

    const moved = path.join(workFolder, 'story-project-original')
    await rename(storyDir, moved)
    await mkdir(storyDir)
    await writeFile(path.join(storyDir, 'project.json'), JSON.stringify({ workflowType: 'story' }))
    abortGate.resolve()

    await expect(reopening).resolves.toEqual({ error: 'invalid-project-path' })
    expect(stepMachineMocks.createStepMachine).toHaveBeenCalledTimes(1)
  })

  it('story:open validation 뒤 project workflow marker가 바뀌면 machine을 생성하지 않는다', async () => {
    await ipc.invoke('story:open', { projectPath: storyDir })
    const abortGate = deferred()
    storyMachine.abort.mockImplementationOnce(async () => {
      await abortGate.promise
      return { ok: true }
    })
    const reopening = ipc.invoke('story:open', { projectPath: storyDir })
    await vi.waitFor(() => expect(storyMachine.abort).toHaveBeenCalledTimes(1))

    await writeFile(path.join(storyDir, 'project.json'), JSON.stringify({ workflowType: 'shopping-short' }))
    abortGate.resolve()

    await expect(reopening).resolves.toEqual({ error: 'shopping-workflow-requires-plan-machine' })
    expect(stepMachineMocks.createStepMachine).toHaveBeenCalledTimes(1)
  })

  it('hung abort는 bounded deadline 뒤 다음 workflow open을 막지 않는다', async () => {
    const local = createWorkflowSessionCoordinator({ abortTimeoutMs: 5 })
    await local.open('story', {
      validate: async () => ({ projectPath: storyDir }),
      create: async () => ({
        machine: {},
        token: 'story-token',
        abort: () => new Promise(() => {}),
        result: { projectToken: 'story-token' },
      }),
    })

    const opening = local.open('shopping', {
      validate: async () => ({ projectPath: shoppingDir }),
      create: async () => ({
        machine: {},
        token: 'shopping-token',
        abort: vi.fn(),
        result: { projectToken: 'shopping-token' },
      }),
    })
    const outcome = await Promise.race([
      opening,
      new Promise((resolve) => setTimeout(() => resolve('test-timeout'), 50)),
    ])

    expect(outcome).toEqual({ projectToken: 'shopping-token' })
  })

  it('validate 대기 중 invalidate되면 candidate를 만들거나 publish하지 않는다', async () => {
    const local = createWorkflowSessionCoordinator()
    const validateGate = deferred()
    const createCandidate = vi.fn(async () => ({
      machine: {}, token: 'shopping-token', abort: vi.fn(),
      result: { projectToken: 'shopping-token' },
    }))
    await local.open('story', {
      validate: async () => ({ projectPath: storyDir }),
      create: async () => ({
        machine: {}, token: 'story-token', abort: vi.fn(), result: { projectToken: 'story-token' },
      }),
    })
    const opening = local.open('shopping', {
      validate: () => validateGate.promise,
      create: createCandidate,
    })
    await Promise.resolve()

    const invalidating = local.invalidate()
    expect(local.capture('story', 'story-token')).toBeNull()

    validateGate.resolve({ projectPath: shoppingDir })
    await expect(opening).resolves.toEqual({ error: 'stale-token' })
    await invalidating
    expect(createCandidate).not.toHaveBeenCalled()
    expect(local.current('shopping')).toBeNull()
  })

  it('create 중 invalidate로 epoch가 바뀌면 candidate를 publish하지 않는다', async () => {
    const local = createWorkflowSessionCoordinator()
    const createGate = deferred()
    const createStarted = deferred()
    const candidateAbort = vi.fn(async () => ({ ok: true }))
    const opening = local.open('story', {
      validate: async () => ({ projectPath: storyDir }),
      create: async () => {
        createStarted.resolve()
        await createGate.promise
        return {
          machine: {}, token: 'candidate-token', abort: candidateAbort,
          result: { projectToken: 'candidate-token' },
        }
      },
    })
    await createStarted.promise

    const invalidating = local.invalidate()
    createGate.resolve()

    await expect(opening).resolves.toEqual({ error: 'stale-token' })
    await invalidating
    expect(candidateAbort).toHaveBeenCalledTimes(1)
    expect(local.capture('story', 'candidate-token')).toBeNull()
  })

  it('previous abort 대기 중 invalidate되면 stale context로 candidate를 생성하지 않는다', async () => {
    const local = createWorkflowSessionCoordinator()
    const abortGate = deferred()
    const previousAbort = vi.fn(async () => {
      await abortGate.promise
      return { ok: true }
    })
    await local.open('story', {
      validate: async () => ({ projectPath: storyDir }),
      create: async () => ({
        machine: {}, token: 'story-token', abort: previousAbort,
        result: { projectToken: 'story-token' },
      }),
    })
    const createCandidate = vi.fn(async () => ({
      machine: {}, token: 'shopping-token', abort: vi.fn(),
      result: { projectToken: 'shopping-token' },
    }))
    const opening = local.open('shopping', {
      validate: async () => ({ projectPath: shoppingDir }),
      create: createCandidate,
    })
    await vi.waitFor(() => expect(previousAbort).toHaveBeenCalledTimes(1))

    const invalidating = local.invalidate()
    abortGate.resolve()

    await expect(opening).resolves.toEqual({ error: 'stale-token' })
    await invalidating
    expect(createCandidate).not.toHaveBeenCalled()
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
