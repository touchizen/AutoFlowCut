import { describe, it, expect, vi } from 'vitest'
import { registerRenderIPC } from '../../../electron/ipc/render.js'

function fakeIpc() {
  const h = {}
  return { handle: (c, fn) => { h[c] = fn }, _h: h }
}

const baseRequest = () => ({
  jobId: 'job_1',
  options: { renderMode: 'final', renderBurnSubtitle: false },
  prepared: { cloudRequest: {
    format: 'portrait', scaleMode: 'fill', subtitleFontSize: 8,
    kenBurns: { enabled: false },
    scenes: [{ id: 'scene_1', duration: 3 }],
    audioTracks: [], sfxItems: [], srtEntries: null,
  }, mediaFiles: [], sfxFiles: [], audioFiles: [], pathMap: {},
  renderVideoSegments: [{ sceneId: 'scene_1', source: 'i2v', inSec: 0, outSec: 3 }],
  renderSceneMeta: { scene_1: { hasVideo: true } } },
})

function okDeps(overrides = {}) {
  return {
    getMainWindow: () => ({ webContents: { send: vi.fn() } }),
    validate: () => ({ ok: true }),
    pickOutPath: async () => '/out.mp4',
    resolve: async () => ({ images: new Map(), sfx: new Map(), audio: new Map(), narrationDurationMs: async () => 0 }),
    adapt: async () => [],
    build: () => ({ stages: [{ kind: 'final', output: 'OUT.mp4' }], totalDurationMs: 3000, sceneCount: 1, audioClipCount: 0 }),
    run: async () => ({ outPath: '/out.mp4' }),
    ...overrides,
  }
}

describe('registerRenderIPC', () => {
  it('registers export and cancel channels', () => {
    const ipc = fakeIpc()
    registerRenderIPC(ipc, okDeps())
    expect(typeof ipc._h['render:export-mp4']).toBe('function')
    expect(typeof ipc._h['render:cancel']).toBe('function')
  })

  it('runs the pipeline and returns ok with outPath', async () => {
    const ipc = fakeIpc()
    registerRenderIPC(ipc, okDeps())
    const res = await ipc._h['render:export-mp4']({}, baseRequest())
    expect(res).toMatchObject({ ok: true, outPath: '/out.mp4', width: 1080, height: 1920 })
  })

  it('passes self-render video segments and scene metadata into the render plan builder', async () => {
    const ipc = fakeIpc()
    const build = vi.fn(() => ({
      stages: [{ kind: 'final', output: 'OUT.mp4' }],
      totalDurationMs: 3000,
      sceneCount: 1,
      audioClipCount: 0,
    }))
    registerRenderIPC(ipc, okDeps({ build }))

    const request = baseRequest()
    await ipc._h['render:export-mp4']({}, request)

    expect(build).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      renderVideoSegments: request.prepared.renderVideoSegments,
      renderSceneMeta: request.prepared.renderSceneMeta,
    }))
  })

  it('passes bundled ffmpeg, job signal, and selected video segments to audio adaptation', async () => {
    const ipc = fakeIpc()
    const adapt = vi.fn(async () => [])
    registerRenderIPC(ipc, okDeps({ adapt, ffmpegPath: '/bundled/ffmpeg' }))

    const request = baseRequest()
    await ipc._h['render:export-mp4']({}, request)

    expect(adapt).toHaveBeenCalledWith(
      request.prepared.cloudRequest,
      expect.anything(),
      { scene_1: 0 },
      {
        ffmpegPath: '/bundled/ffmpeg',
        signal: expect.any(AbortSignal),
        renderVideoSegments: request.prepared.renderVideoSegments,
      },
    )
  })

  it('uses the project name as the save-dialog default filename', async () => {
    const ipc = fakeIpc()
    const pickOutPath = vi.fn(async () => '/out.mp4')
    registerRenderIPC(ipc, okDeps({ pickOutPath }))

    const request = baseRequest()
    request.prepared.cloudRequest.projectName = '원더풀스'
    await ipc._h['render:export-mp4']({}, request)

    expect(pickOutPath).toHaveBeenCalledWith('원더풀스.mp4')
  })

  it('falls back to render.mp4 when the project has no name', async () => {
    const ipc = fakeIpc()
    const pickOutPath = vi.fn(async () => '/out.mp4')
    registerRenderIPC(ipc, okDeps({ pickOutPath }))

    await ipc._h['render:export-mp4']({}, baseRequest())  // projectName 없음

    expect(pickOutPath).toHaveBeenCalledWith('render.mp4')
  })

  it('returns validation error without running', async () => {
    const ipc = fakeIpc()
    const run = vi.fn()
    registerRenderIPC(ipc, okDeps({ validate: () => ({ ok: false, error: 'bad' }), run }))
    const res = await ipc._h['render:export-mp4']({}, baseRequest())
    expect(res).toMatchObject({ ok: false, error: 'bad' })
    expect(run).not.toHaveBeenCalled()
  })

  it('returns cancelled when the save dialog is dismissed', async () => {
    const ipc = fakeIpc()
    const run = vi.fn()
    registerRenderIPC(ipc, okDeps({ pickOutPath: async () => null, run }))
    const res = await ipc._h['render:export-mp4']({}, baseRequest())
    expect(res).toMatchObject({ ok: false, cancelled: true })
    expect(run).not.toHaveBeenCalled()
  })

  it('rejects a duplicate jobId already running', async () => {
    const ipc = fakeIpc()
    registerRenderIPC(ipc, okDeps({ run: () => new Promise(() => {}) })) // never resolves
    const first = ipc._h['render:export-mp4']({}, baseRequest()) // stays running
    const second = await ipc._h['render:export-mp4']({}, baseRequest())
    expect(second).toMatchObject({ ok: false })
    expect(String(second.error)).toMatch(/already running|duplicate/i)
    void first
  })

  it('cancel sets the jobCtx cancelled flag for a running job', async () => {
    const ipc = fakeIpc()
    let captured = null
    registerRenderIPC(ipc, okDeps({
      run: (plan, jobCtx) => { captured = jobCtx; return new Promise(() => {}) },
    }))
    ipc._h['render:export-mp4']({}, baseRequest())
    await vi.waitFor(() => expect(captured).not.toBeNull())
    const res = await ipc._h['render:cancel']({}, { jobId: 'job_1' })
    expect(res).toMatchObject({ ok: true })
    expect(captured.cancelled).toBe(true)
  })

  it('forwards run progress to webContents as render:progress', async () => {
    const ipc = fakeIpc()
    const send = vi.fn()
    registerRenderIPC(ipc, okDeps({
      getMainWindow: () => ({ webContents: { send } }),
      run: async (plan, jobCtx, onProgress) => { onProgress({ percent: 42, stage: 'final' }); return { outPath: '/out.mp4' } },
    }))
    await ipc._h['render:export-mp4']({}, baseRequest())
    expect(send).toHaveBeenCalledWith('render:progress', expect.objectContaining({ jobId: 'job_1', percent: 42 }))
  })

  it('stamps the correct jobId even when the runner emits jobId:undefined (regression)', async () => {
    // Real bug: runner emits { jobId: jobCtx.jobId } which was undefined, and a
    // `{ jobId, ...p }` relay let it overwrite the valid id → UI dropped every event.
    const ipc = fakeIpc()
    const send = vi.fn()
    registerRenderIPC(ipc, okDeps({
      getMainWindow: () => ({ webContents: { send } }),
      run: async (plan, jobCtx, onProgress) => { onProgress({ jobId: undefined, percent: 55 }); return { outPath: '/out.mp4' } },
    }))
    await ipc._h['render:export-mp4']({}, baseRequest())
    const call = send.mock.calls.find(c => c[0] === 'render:progress')
    expect(call[1].jobId).toBe('job_1')
    expect(call[1].percent).toBe(55)
  })

  it('passes a jobId and an AbortSignal to the runner, and cancel aborts it', async () => {
    const ipc = fakeIpc()
    let captured = null
    registerRenderIPC(ipc, okDeps({
      run: (plan, jobCtx) => { captured = jobCtx; return new Promise(() => {}) },
    }))
    ipc._h['render:export-mp4']({}, baseRequest())
    await vi.waitFor(() => expect(captured).not.toBeNull())
    expect(captured.jobId).toBe('job_1')
    expect(captured.signal).toBeInstanceOf(AbortSignal)
    expect(captured.signal.aborted).toBe(false)
    await ipc._h['render:cancel']({}, { jobId: 'job_1' })
    expect(captured.cancelled).toBe(true)
    expect(captured.signal.aborted).toBe(true)
  })
})
