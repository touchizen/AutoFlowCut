// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdir, mkdtemp, realpath, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { registerShoppingIPC } from '../../../electron/ipc/shopping-api.js'

function fakeIpcMain() {
  const handlers = new Map()
  return {
    handle: (channel, handler) => handlers.set(channel, handler),
    invoke: (channel, payload) => handlers.get(channel)(null, payload),
    handlers,
  }
}

function productSnapshot() {
  return {
    status: 'ok',
    snapshotId: 'snapshot-1',
    product: { name: '테스트 상품', priceKrw: 19900 },
    sourceFacts: [{ id: 'fact-1', field: 'name', value: '테스트 상품' }],
    images: [{ id: 'image-1', sourceUrl: 'https://image.coupangcdn.com/image.jpg' }],
    selectedImageIds: ['image-1'],
  }
}

let ipc
let workFolder
let projectDir
let fetchProduct

beforeEach(async () => {
  workFolder = await mkdtemp(path.join(tmpdir(), 'shopping-ipc-'))
  projectDir = path.join(workFolder, 'project')
  await mkdir(projectDir)
  await writeFile(path.join(projectDir, 'project.json'), JSON.stringify({ workflowType: 'shopping-short' }))
  ipc = fakeIpcMain()
  fetchProduct = vi.fn(async () => productSnapshot())
  registerShoppingIPC(ipc, {
    fetchProduct,
    getActiveWorkFolder: () => workFolder,
    now: () => '2026-07-23T09:00:00.000Z',
  })
})

describe('shopping IPC', () => {
  it('shopping:open은 새 projectToken과 empty 상태를 반환한다', async () => {
    const result = await ipc.invoke('shopping:open', { projectPath: projectDir })

    expect(result.projectToken).toBeTruthy()
    expect(result.state.state).toBe('empty')
  })

  it('shopping:open — 손상된 plan.json은 reject 대신 {error}로 fail-closed한다 (R5 F1-사촌)', async () => {
    // shoppingPlanStore.readState 는 ENOENT 만 default 로 흡수하고 손상 JSON 은 throw → planMachine.open →
    // coordinator create 경계로 새면 open reject → auto-open unhandled rejection + 침묵 죽은 뷰.
    await mkdir(path.join(projectDir, 'shopping'), { recursive: true })
    await writeFile(path.join(projectDir, 'shopping', 'plan.json'), '{ corrupt !!!')

    const result = await ipc.invoke('shopping:open', { projectPath: projectDir })

    expect(result).toEqual({ error: 'project-open-failed' })
  })

  it('shopping:open — plan.json 스키마 드리프트(snapshot 키 없음)도 {error}로 fail-closed한다 (R5 F1-사촌)', async () => {
    // 앱 버전 간 스키마 변화의 현실적 트리거: assertShoppingPlanStoreState 가 TypeError throw.
    await mkdir(path.join(projectDir, 'shopping'), { recursive: true })
    await writeFile(path.join(projectDir, 'shopping', 'plan.json'), JSON.stringify({ oldSchema: true }))

    const result = await ipc.invoke('shopping:open', { projectPath: projectDir })

    expect(result).toEqual({ error: 'project-open-failed' })
  })

  it('submit-product는 URL을 fetchProduct에 전달하고 fact_review 상태를 저장한다', async () => {
    const { projectToken } = await ipc.invoke('shopping:open', { projectPath: projectDir })
    const canonicalProjectDir = await realpath(projectDir)

    const submitted = await ipc.invoke('shopping:submit-product', {
      projectToken,
      url: 'https://www.coupang.com/vp/products/1',
    })
    const state = await ipc.invoke('shopping:get-state', { projectToken })

    expect(submitted).toMatchObject({ ok: true, operationId: expect.any(String) })
    expect(fetchProduct).toHaveBeenCalledWith(
      'https://www.coupang.com/vp/products/1',
      expect.objectContaining({
        projectPath: canonicalProjectDir,
        projectToken,
        operationId: expect.any(String),
        signal: expect.any(AbortSignal),
      }),
    )
    expect(state).toMatchObject({
      projectToken,
      state: 'fact_review',
      snapshot: productSnapshot(),
    })
  })

  it('default fetchProduct path는 CDP 추출 뒤 안전 이미지 staging으로 snapshot을 조립한다', async () => {
    const isolatedIpc = fakeIpcMain()
    const sourceUrl = 'https://www.coupang.com/vp/products/1'
    const imageUrl = 'https://thumbnail.coupangcdn.com/image/product.jpg'
    const cdpProductFetch = vi.fn(async () => ({
      status: 'ok',
      trust: 'untrusted-web-data',
      sourceUrl,
      product: { name: 'CDP 상품', priceKrw: 7200, currency: 'KRW' },
      sourceFacts: [{
        field: 'name',
        value: 'CDP 상품',
        sourceKind: 'dom',
        sourceUrl,
        verification: 'page-rendered',
        trust: 'untrusted-web-data',
      }],
      imageUrls: [imageUrl],
    }))
    const imageFetch = vi.fn(async () => ({
      body: Buffer.from('image bytes'),
      mimeType: 'image/jpeg',
      width: 800,
      height: 800,
      url: imageUrl,
    }))
    const staging = { stageImage: vi.fn(async () => ({ path: '/staged/image.jpg' })) }
    const legacyHttpFetch = vi.fn(async () => {
      throw new Error('legacy HTML path used')
    })
    registerShoppingIPC(isolatedIpc, {
      getActiveWorkFolder: () => workFolder,
      cdpProductFetch,
      httpFetch: legacyHttpFetch,
      imageFetch,
      staging,
      now: () => '2026-07-23T09:00:00.000Z',
    })
    const { projectToken } = await isolatedIpc.invoke('shopping:open', { projectPath: projectDir })

    const submitted = await isolatedIpc.invoke('shopping:submit-product', {
      projectToken,
      url: sourceUrl,
    })
    const state = await isolatedIpc.invoke('shopping:get-state', { projectToken })

    expect(submitted).toMatchObject({ ok: true })
    expect(cdpProductFetch).toHaveBeenCalledWith(sourceUrl, {
      signal: expect.any(AbortSignal),
    })
    expect(legacyHttpFetch).not.toHaveBeenCalled()
    expect(imageFetch).toHaveBeenCalledTimes(1)
    expect(staging.stageImage).toHaveBeenCalledTimes(1)
    expect(state).toMatchObject({
      state: 'fact_review',
      snapshot: {
        status: 'ok',
        product: { name: 'CDP 상품', priceKrw: 7200, currency: 'KRW' },
        images: [expect.objectContaining({ sourceUrl: imageUrl })],
      },
    })
  })

  it('stale token은 fetchProduct side effect 전에 거부한다', async () => {
    await ipc.invoke('shopping:open', { projectPath: projectDir })

    const result = await ipc.invoke('shopping:submit-product', {
      projectToken: 'stale-token',
      url: 'https://www.coupang.com/vp/products/1',
    })

    expect(result).toEqual({ error: 'stale-token' })
    expect(fetchProduct).not.toHaveBeenCalled()
  })

  it('active work folder 밖의 projectPath는 거부한다', async () => {
    const outside = await mkdtemp(path.join(tmpdir(), 'shopping-outside-'))

    const result = await ipc.invoke('shopping:open', { projectPath: outside })

    expect(result).toEqual({ error: 'invalid-project-path' })
  })

  it('disk workflowType이 story이면 caller 주장과 무관하게 shopping:open을 거부한다', async () => {
    await writeFile(path.join(projectDir, 'project.json'), JSON.stringify({ workflowType: 'story' }))

    const result = await ipc.invoke('shopping:open', {
      projectPath: projectDir,
      workflowType: 'shopping-short',
    })

    expect(result).toEqual({ error: 'story-workflow-requires-step-machine' })
    expect(fetchProduct).not.toHaveBeenCalled()
  })

  it('main work-folder context가 준비되지 않았으면 fail-closed한다', async () => {
    const isolatedIpc = fakeIpcMain()
    const createMachine = vi.fn()
    registerShoppingIPC(isolatedIpc, {
      fetchProduct: vi.fn(),
      getActiveWorkFolder: () => null,
      createMachine,
    })

    const result = await isolatedIpc.invoke('shopping:open', { projectPath: projectDir })

    expect(result).toEqual({ error: 'project-context-not-ready' })
    expect(createMachine).not.toHaveBeenCalled()
  })

  it('work folder 내부 symlink가 외부 directory를 가리키면 realpath containment로 거부한다', async () => {
    const outside = await mkdtemp(path.join(tmpdir(), 'shopping-symlink-outside-'))
    await writeFile(path.join(outside, 'project.json'), JSON.stringify({ workflowType: 'shopping-short' }))
    const linkedProject = path.join(workFolder, 'linked-project')
    await symlink(outside, linkedProject, 'dir')

    const result = await ipc.invoke('shopping:open', { projectPath: linkedProject })

    expect(result).toEqual({ error: 'invalid-project-path' })
  })

  it('A getState await 중 B open이 끼면 A state를 B token으로 emit하지 않는다', async () => {
    let resolveAState
    const aState = new Promise((resolve) => { resolveAState = resolve })
    const send = vi.fn()
    const projectB = path.join(workFolder, 'project-b')
    await mkdir(projectB)
    await writeFile(path.join(projectB, 'project.json'), JSON.stringify({ workflowType: 'shopping-short' }))
    const machineA = {
      open: vi.fn(async () => ({ projectToken: 'token-A', state: { state: 'empty' } })),
      abort: vi.fn(async () => ({ ok: true })),
      submitProduct: vi.fn(async () => ({ ok: true, operationId: 'operation-A' })),
      getState: vi.fn(() => aState),
    }
    const machineB = {
      open: vi.fn(async () => ({ projectToken: 'token-B', state: { state: 'empty' } })),
      abort: vi.fn(async () => ({ ok: true })),
      submitProduct: vi.fn(),
      getState: vi.fn(async () => ({ state: 'empty' })),
    }
    const createMachine = vi.fn()
      .mockReturnValueOnce(machineA)
      .mockReturnValueOnce(machineB)
    const raceIpc = fakeIpcMain()
    registerShoppingIPC(raceIpc, {
      fetchProduct: vi.fn(),
      getWindow: () => ({ isDestroyed: () => false, webContents: { send } }),
      getActiveWorkFolder: () => workFolder,
      createMachine,
    })
    await raceIpc.invoke('shopping:open', { projectPath: projectDir })

    const submittingA = raceIpc.invoke('shopping:submit-product', {
      projectToken: 'token-A',
      url: 'https://www.coupang.com/vp/products/1',
    })
    await vi.waitFor(() => expect(machineA.getState).toHaveBeenCalledTimes(1))
    await raceIpc.invoke('shopping:open', { projectPath: projectB })
    resolveAState({ state: 'fact_review', snapshot: { product: { name: 'A 상품' } } })
    await submittingA

    expect(send).not.toHaveBeenCalledWith('shopping:state', expect.objectContaining({
      projectToken: 'token-B',
      state: expect.objectContaining({ state: 'fact_review' }),
    }))
    expect(send).not.toHaveBeenCalled()
  })

  it('shopping:abort가 진행 중 CDP 추출 signal까지 전달된다', async () => {
    const cdpProductFetch = vi.fn((_url, { signal }) => new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(signal.reason), { once: true })
    }))
    const abortIpc = fakeIpcMain()
    registerShoppingIPC(abortIpc, {
      getActiveWorkFolder: () => workFolder,
      cdpProductFetch,
      imageFetch: vi.fn(),
      staging: { stageImage: vi.fn() },
    })
    const { projectToken } = await abortIpc.invoke('shopping:open', { projectPath: projectDir })

    const submitting = abortIpc.invoke('shopping:submit-product', {
      projectToken,
      url: 'https://www.coupang.com/vp/products/1',
    })
    await vi.waitFor(() => expect(cdpProductFetch).toHaveBeenCalledTimes(1))
    await expect(abortIpc.invoke('shopping:abort', { projectToken }))
      .resolves.toEqual({ ok: true })
    const outcome = await Promise.race([
      submitting,
      new Promise((resolve) => setImmediate(() => resolve({ error: 'abort-did-not-reach-cdp' }))),
    ])

    expect(outcome).toEqual({ error: 'aborted' })
  })

  it.each([
    {
      channel: 'shopping:set-fact-decisions',
      method: 'setFactDecisions',
      payload: {
        factDecisions: [{ sourceFactId: 'fact-1', decision: 'allowed', confirmedAt: '2026-07-30T06:00:00.000Z' }],
        prohibitedClaims: [{ id: 'ban-1', text: '과장 효능', reason: '사용자 B 확정' }],
      },
      expectedArgs: [
        'token-command',
        [{ sourceFactId: 'fact-1', decision: 'allowed', confirmedAt: '2026-07-30T06:00:00.000Z' }],
        [{ id: 'ban-1', text: '과장 효능', reason: '사용자 B 확정' }],
      ],
    },
    {
      channel: 'shopping:draft-plan',
      method: 'draftPlan',
      payload: { options: { targetHint: '30대 1인 가구', emphasis: '가격' } },
      expectedArgs: ['token-command', { targetHint: '30대 1인 가구', emphasis: '가격' }],
    },
    {
      channel: 'shopping:approve-plan',
      method: 'approvePlan',
      payload: { callerHash: 'renderer-must-not-control-this', expectedHash: 'also-forbidden' },
      expectedArgs: ['token-command'],
    },
  ])('$channel은 main token으로 $method을 호출하고 성공 state를 emit한다', async ({
    channel,
    method,
    payload,
    expectedArgs,
  }) => {
    const commandIpc = fakeIpcMain()
    const send = vi.fn()
    const command = vi.fn(async () => ({ ok: true, operationId: `operation-${method}` }))
    const machine = {
      open: vi.fn(async () => ({ projectToken: 'token-command', state: { state: 'fact_review' } })),
      abort: vi.fn(async () => ({ ok: true })),
      getState: vi.fn(async () => ({ state: 'plan_review', snapshot: { scenes: [] } })),
      submitProduct: vi.fn(),
      setFactDecisions: vi.fn(),
      draftPlan: vi.fn(),
      setPlanDraft: vi.fn(),
      approvePlan: vi.fn(),
      [method]: command,
    }
    registerShoppingIPC(commandIpc, {
      fetchProduct: vi.fn(),
      getWindow: () => ({ isDestroyed: () => false, webContents: { send } }),
      getActiveWorkFolder: () => workFolder,
      createMachine: vi.fn(() => machine),
    })
    await commandIpc.invoke('shopping:open', { projectPath: projectDir })

    const result = await commandIpc.invoke(channel, {
      projectToken: 'token-command',
      ...payload,
    })

    expect(result).toMatchObject({ ok: true })
    expect(command).toHaveBeenCalledOnce()
    expect(command).toHaveBeenCalledWith(...expectedArgs)
    expect(machine.getState).toHaveBeenCalledOnce()
    expect(send).toHaveBeenCalledWith('shopping:state', {
      projectToken: 'token-command',
      operationId: `operation-${method}`,
      state: { state: 'plan_review', snapshot: { scenes: [] } },
    })
  })

  it.each([
    ['shopping:set-fact-decisions', 'setFactDecisions', { factDecisions: [], prohibitedClaims: [] }],
    ['shopping:draft-plan', 'draftPlan', { options: {} }],
    ['shopping:approve-plan', 'approvePlan', {}],
  ])('%s는 stale token을 machine mutation과 state emit 전에 거부한다', async (channel, method, payload) => {
    const commandIpc = fakeIpcMain()
    const send = vi.fn()
    const machine = {
      open: vi.fn(async () => ({ projectToken: 'token-command', state: { state: 'fact_review' } })),
      abort: vi.fn(async () => ({ ok: true })),
      getState: vi.fn(async () => ({ state: 'fact_review' })),
      submitProduct: vi.fn(),
      setFactDecisions: vi.fn(),
      draftPlan: vi.fn(),
      setPlanDraft: vi.fn(),
      approvePlan: vi.fn(),
    }
    registerShoppingIPC(commandIpc, {
      fetchProduct: vi.fn(),
      getWindow: () => ({ isDestroyed: () => false, webContents: { send } }),
      getActiveWorkFolder: () => workFolder,
      createMachine: vi.fn(() => machine),
    })
    await commandIpc.invoke('shopping:open', { projectPath: projectDir })

    const result = await commandIpc.invoke(channel, { projectToken: 'stale-token', ...payload })

    expect(result).toEqual({ error: 'stale-token' })
    expect(machine[method]).not.toHaveBeenCalled()
    expect(machine.getState).not.toHaveBeenCalled()
    expect(send).not.toHaveBeenCalled()
  })

  it('read-only 씬표에서는 renderer draft 교체 IPC를 등록하지 않는다', () => {
    expect(ipc.handlers.has('shopping:set-plan-draft')).toBe(false)
  })
})
