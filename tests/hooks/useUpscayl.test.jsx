import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useUpscayl } from '../../src/hooks/useUpscayl.js'

const OPTIONS = { model: 'ultrasharp-4x', scale: 4 }

function deferred() {
  let resolve
  const promise = new Promise((done) => { resolve = done })
  return { promise, resolve }
}

function scene(id, extra = {}) {
  return {
    id,
    status: 'done',
    imagePath: `/project/scenes/${id}.png`,
    ...extra,
  }
}

function setup({
  scenes = [scene('scene_1')],
  projectNameRef = { current: 'project-a' },
  run = vi.fn().mockResolvedValue({ ok: true, base64: 'UPSCALED', width: 400, height: 300 }),
  cancel = vi.fn().mockResolvedValue({ ok: true }),
  saveImage = vi.fn().mockResolvedValue({ success: true, path: '/saved/scene.png' }),
  updateScene = vi.fn(),
} = {}) {
  const upscaylAPI = { run, cancel }
  const hook = renderHook(() => useUpscayl({
    scenes,
    updateScene,
    projectNameRef,
    saveImage,
    upscaylAPI,
    options: OPTIONS,
  }))
  return { ...hook, projectNameRef, upscaylAPI, saveImage, updateScene }
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('useUpscayl 대상 선정과 성공', () => {
  it('완료+파일경로+미업스케일 씬만 처리하고 나머지는 skipped로 센다', async () => {
    const harness = setup({
      scenes: [
        scene('eligible'),
        scene('base64-only', { imagePath: null, image: 'BASE64' }),
        scene('already', { upscaledAt: 100 }),
        scene('pending', { status: 'pending' }),
      ],
    })

    await act(async () => { await harness.result.current.startBatch() })

    expect(harness.upscaylAPI.run).toHaveBeenCalledTimes(1)
    expect(harness.upscaylAPI.run).toHaveBeenCalledWith({
      inputPath: '/project/scenes/eligible.png',
      model: 'ultrasharp-4x',
      scale: 4,
    })
    expect(harness.result.current).toMatchObject({
      running: false,
      current: 1,
      total: 1,
      completed: 1,
      failures: [],
      skipped: 3,
    })
  })

  it('targetSceneIds가 있으면 선택한 적격 씬만 처리한다', async () => {
    const harness = setup({ scenes: [scene('scene_1'), scene('scene_2')] })

    await act(async () => { await harness.result.current.startBatch(['scene_2']) })

    expect(harness.upscaylAPI.run).toHaveBeenCalledTimes(1)
    expect(harness.upscaylAPI.run).toHaveBeenCalledWith(expect.objectContaining({
      inputPath: '/project/scenes/scene_2.png',
    }))
    expect(harness.result.current).toMatchObject({ total: 1, skipped: 0 })
  })

  it('startBatch 옵션 override를 해당 배치 실행에 사용한다', async () => {
    const harness = setup()

    await act(async () => {
      await harness.result.current.startBatch(null, { model: 'remacri-4x', scale: 2 })
    })

    expect(harness.upscaylAPI.run).toHaveBeenCalledWith(expect.objectContaining({
      model: 'remacri-4x',
      scale: 2,
    }))
  })

  it('각 씬을 run→saveImage→updateScene 순서로 완전히 끝낸 뒤 다음 씬으로 간다', async () => {
    const order = []
    const run = vi.fn(async ({ inputPath }) => {
      order.push(`run:${inputPath}`)
      return { ok: true, base64: `B64:${inputPath}`, width: 800, height: 600 }
    })
    const saveImage = vi.fn(async (_project, sceneId) => {
      order.push(`save:${sceneId}`)
      return { success: true, path: `/saved/${sceneId}.png` }
    })
    const updateScene = vi.fn((sceneId) => { order.push(`update:${sceneId}`) })
    const harness = setup({ scenes: [scene('one'), scene('two')], run, saveImage, updateScene })

    await act(async () => { await harness.result.current.startBatch() })

    expect(order).toEqual([
      'run:/project/scenes/one.png',
      'save:one',
      'update:one',
      'run:/project/scenes/two.png',
      'save:two',
      'update:two',
    ])
  })

  it('저장 성공 시 capturedProject와 upscayl metadata를 쓰고 이미지 상태를 교체한다', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(1700000000000)
    const harness = setup()

    await act(async () => { await harness.result.current.startBatch() })

    expect(harness.saveImage).toHaveBeenCalledWith(
      'project-a',
      'scene_1',
      'UPSCALED',
      'upscayl',
      { upscaleModel: 'ultrasharp-4x', scale: 4, timestamp: 1700000000000 },
    )
    expect(harness.updateScene).toHaveBeenCalledWith('scene_1', {
      upscaledAt: 1700000000000,
      upscaled_size: null,
      imagePath: '/saved/scene.png',
      image: null,
      image_size: { width: 400, height: 300 },
      generatedAt: 1700000000000,
    })
  })
})

describe('useUpscayl 프로젝트 전환과 실패 처리', () => {
  it('run await 뒤 프로젝트가 바뀌면 현재 결과와 남은 씬을 버린다', async () => {
    const projectNameRef = { current: 'project-a' }
    const run = vi.fn(async () => {
      projectNameRef.current = 'project-b'
      return { ok: true, base64: 'UPSCALED', width: 400, height: 300 }
    })
    const harness = setup({ scenes: [scene('one'), scene('two')], projectNameRef, run })

    await act(async () => { await harness.result.current.startBatch() })

    expect(run).toHaveBeenCalledTimes(1)
    expect(harness.saveImage).not.toHaveBeenCalled()
    expect(harness.updateScene).not.toHaveBeenCalled()
  })

  it('save await 뒤 프로젝트가 바뀌면 patch하지 않고 남은 씬도 중단한다', async () => {
    const projectNameRef = { current: 'project-a' }
    const saveImage = vi.fn(async () => {
      projectNameRef.current = 'project-b'
      return { success: true, path: '/project-a/scenes/one.png' }
    })
    const harness = setup({ scenes: [scene('one'), scene('two')], projectNameRef, saveImage })

    await act(async () => { await harness.result.current.startBatch() })

    expect(harness.upscaylAPI.run).toHaveBeenCalledTimes(1)
    expect(saveImage).toHaveBeenCalledWith(
      'project-a',
      'one',
      'UPSCALED',
      'upscayl',
      expect.any(Object),
    )
    expect(harness.updateScene).not.toHaveBeenCalled()
  })

  it('run 실패를 기록하고 다음 씬은 계속 처리한다', async () => {
    const run = vi.fn()
      .mockResolvedValueOnce({ ok: false, error: 'GPU failed' })
      .mockResolvedValueOnce({ ok: true, base64: 'SECOND', width: 200, height: 100 })
    const harness = setup({ scenes: [scene('one'), scene('two')], run })

    await act(async () => { await harness.result.current.startBatch() })

    expect(run).toHaveBeenCalledTimes(2)
    expect(harness.saveImage).toHaveBeenCalledTimes(1)
    expect(harness.updateScene).toHaveBeenCalledWith('two', expect.any(Object))
    expect(harness.result.current.failures).toEqual([{ sceneId: 'one', error: 'GPU failed' }])
  })

  it('save 실패를 기록하고 다음 씬은 계속 처리한다', async () => {
    const saveImage = vi.fn()
      .mockResolvedValueOnce({ success: false, error: 'Disk full' })
      .mockResolvedValueOnce({ success: true, path: '/saved/two.png' })
    const harness = setup({ scenes: [scene('one'), scene('two')], saveImage })

    await act(async () => { await harness.result.current.startBatch() })

    expect(harness.upscaylAPI.run).toHaveBeenCalledTimes(2)
    expect(harness.updateScene).toHaveBeenCalledTimes(1)
    expect(harness.updateScene).toHaveBeenCalledWith('two', expect.any(Object))
    expect(harness.result.current.failures).toEqual([{ sceneId: 'one', error: 'Disk full' }])
  })
})

describe('useUpscayl 취소', () => {
  it('cancel이 IPC 취소를 호출하고 현재 결과 저장 및 다음 반복을 막는다', async () => {
    const pendingRun = deferred()
    const run = vi.fn(() => pendingRun.promise)
    const harness = setup({ scenes: [scene('one'), scene('two')], run })
    let batchPromise

    act(() => { batchPromise = harness.result.current.startBatch() })
    await waitFor(() => expect(run).toHaveBeenCalledTimes(1))
    expect(harness.result.current.running).toBe(true)

    await act(async () => { await harness.result.current.cancel() })
    pendingRun.resolve({ ok: true, base64: 'LATE', width: 100, height: 100 })
    await act(async () => { await batchPromise })

    expect(harness.upscaylAPI.cancel).toHaveBeenCalledTimes(1)
    expect(run).toHaveBeenCalledTimes(1)
    expect(harness.saveImage).not.toHaveBeenCalled()
    expect(harness.updateScene).not.toHaveBeenCalled()
    expect(harness.result.current.running).toBe(false)
  })

  it('N개 중 1개 patch 후 취소하면 completed는 실제 완료한 1개만 센다', async () => {
    const secondRun = deferred()
    const run = vi.fn()
      .mockResolvedValueOnce({ ok: true, base64: 'FIRST', width: 100, height: 100 })
      .mockImplementationOnce(() => secondRun.promise)
    const harness = setup({ scenes: [scene('one'), scene('two'), scene('three')], run })
    let batchPromise

    act(() => { batchPromise = harness.result.current.startBatch() })
    await waitFor(() => {
      expect(harness.updateScene).toHaveBeenCalledTimes(1)
      expect(run).toHaveBeenCalledTimes(2)
    })

    await act(async () => { await harness.result.current.cancel() })
    secondRun.resolve({ ok: false, error: 'cancelled' })
    await act(async () => { await batchPromise })

    expect(harness.result.current).toMatchObject({
      running: false,
      total: 3,
      completed: 1,
      cancelled: true,
      stopped: false,
    })
  })

  it('실행 중 unmount하면 IPC 취소를 호출한다', async () => {
    const pendingRun = deferred()
    const run = vi.fn(() => pendingRun.promise)
    const harness = setup({ run })
    let batchPromise

    act(() => { batchPromise = harness.result.current.startBatch() })
    await waitFor(() => expect(run).toHaveBeenCalledTimes(1))
    harness.unmount()

    expect(harness.upscaylAPI.cancel).toHaveBeenCalledTimes(1)
    pendingRun.resolve({ ok: false, error: 'cancelled' })
    await batchPromise
  })
})
