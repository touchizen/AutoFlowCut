// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdir, mkdtemp } from 'node:fs/promises'
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
let projectDir
let fetchProduct

beforeEach(async () => {
  const workFolder = await mkdtemp(path.join(tmpdir(), 'shopping-ipc-'))
  projectDir = path.join(workFolder, 'project')
  await mkdir(projectDir)
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

  it('submit-product는 URL을 fetchProduct에 전달하고 fact_review 상태를 저장한다', async () => {
    const { projectToken } = await ipc.invoke('shopping:open', { projectPath: projectDir })

    const submitted = await ipc.invoke('shopping:submit-product', {
      projectToken,
      url: 'https://www.coupang.com/vp/products/1',
    })
    const state = await ipc.invoke('shopping:get-state', { projectToken })

    expect(submitted).toMatchObject({ ok: true, operationId: expect.any(String) })
    expect(fetchProduct).toHaveBeenCalledWith(
      'https://www.coupang.com/vp/products/1',
      expect.objectContaining({
        projectPath: projectDir,
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
})
