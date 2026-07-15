import { act, renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { StrictMode } from 'react'
import {
  buildSrtPromptSourceFingerprint,
  splitPromptSceneChunks,
  stableHash,
  useSrtPrompts,
} from '../../src/hooks/useSrtPrompts.js'

function deferred() {
  let resolve
  let reject
  const promise = new Promise((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

const makeScene = (id, subtitle, overrides = {}) => ({
  id,
  subtitle,
  srtLineIds: [],
  prompt: '',
  videoT2VPrompt: '',
  ...overrides,
})

function responseFor(dtoScenes) {
  return dtoScenes.map(({ sceneNo }) => ({
    sceneNo,
    imagePrompt: `image-${sceneNo}`,
    videoPrompt: `video-${sceneNo}`,
  }))
}

function setup(overrides = {}) {
  const scenesRef = overrides.scenesRef || {
    current: [makeScene('s1', 'one'), makeScene('s2', 'two')],
  }
  const srtTrackRef = overrides.srtTrackRef || { current: [] }
  let identity = overrides.identity || { projectId: 'project-a', switchEpoch: 1 }
  const getProjectIdentity = overrides.getProjectIdentity || (() => identity)
  const writeChunk = overrides.writeChunk || vi.fn(async ({ dtoScenes }) => responseFor(dtoScenes))
  const applyPromptChunk = overrides.applyPromptChunk || vi.fn((prompts, meta) => {
    const bySceneId = new Map(prompts.map((prompt) => [meta.sceneNoToSceneId.get(prompt.sceneNo), prompt]))
    const nextScenes = scenesRef.current.map((scene) => {
      const prompt = bySceneId.get(scene.id)
      if (!prompt) return scene
      return {
        ...scene,
        prompt: meta.onlyEmpty && scene.prompt ? scene.prompt : prompt.imagePrompt,
        videoT2VPrompt: meta.onlyEmpty && scene.videoT2VPrompt ? scene.videoT2VPrompt : prompt.videoPrompt,
      }
    })
    scenesRef.current = nextScenes
    return { nextScenes }
  })
  const flushPromptChunk = overrides.flushPromptChunk || vi.fn(async () => ({ ok: true, persisted: true }))

  const config = {
    scenesRef,
    srtTrackRef,
    getProjectIdentity,
    writeChunk,
    applyPromptChunk,
    flushPromptChunk,
    isFolderProject: overrides.isFolderProject ?? true,
    maxScenesPerChunk: overrides.maxScenesPerChunk ?? 20,
    maxCharsPerChunk: overrides.maxCharsPerChunk ?? 12_000,
    maxTokensPerChunk: overrides.maxTokensPerChunk ?? 3_000,
  }
  const hook = renderHook(() => useSrtPrompts(config), { wrapper: overrides.wrapper })
  return {
    ...hook,
    scenesRef,
    srtTrackRef,
    writeChunk,
    applyPromptChunk,
    flushPromptChunk,
    setIdentity(next) { identity = next },
  }
}

describe('SRT prompt chunking', () => {
  it('enforces scene, character, and token budgets at the same time', () => {
    const scenes = [
      { sceneNo: 1, summary: '', text: '12345' },
      { sceneNo: 2, summary: '', text: '67890' },
      { sceneNo: 3, summary: '', text: 'abc' },
    ]

    expect(splitPromptSceneChunks(scenes, {
      maxScenes: 2,
      maxChars: 8,
      maxTokens: 100,
      estimateTokens: () => 1,
    }).map((chunk) => chunk.map((scene) => scene.sceneNo))).toEqual([[1], [2, 3]])

    expect(splitPromptSceneChunks(scenes, {
      maxScenes: 3,
      maxChars: 100,
      maxTokens: 2,
      estimateTokens: () => 1,
    }).map((chunk) => chunk.map((scene) => scene.sceneNo))).toEqual([[1, 2], [3]])
  })

  it('throws an explicit error when one cue alone exceeds a budget', () => {
    expect(() => splitPromptSceneChunks([
      { sceneNo: 1, summary: '', text: 'too long' },
    ], { maxScenes: 2, maxChars: 3, maxTokens: 100 })).toThrowError(
      expect.objectContaining({ code: 'SRT_PROMPT_SINGLE_CUE_TOO_LARGE' }),
    )
  })
})

describe('SRT prompt source fingerprint', () => {
  it('hashes exact target identity/text and referenced SRT id/text/start/end in reference order', () => {
    const targets = [
      { sceneId: 's1', sceneNo: 1, resolvedText: 'line one', srtLineIds: ['l2', 'l1'] },
      { sceneId: 's2', sceneNo: 2, resolvedText: 'fallback', srtLineIds: ['l1'] },
    ]
    const track = [
      { id: 'l1', text: 'one', startTime: 1, endTime: 2, ignored: true },
      { id: 'l2', text: 'two', startTime: 3, endTime: 4 },
      { id: 'unreferenced', text: 'x', startTime: 9, endTime: 10 },
    ]

    expect(buildSrtPromptSourceFingerprint(targets, track)).toBe(stableHash({
      scenes: [
        { sceneId: 's1', sceneNo: 1, resolvedText: 'line one' },
        { sceneId: 's2', sceneNo: 2, resolvedText: 'fallback' },
      ],
      srtLines: [
        { id: 'l2', text: 'two', startTime: 3, endTime: 4 },
        { id: 'l1', text: 'one', startTime: 1, endTime: 2 },
      ],
    }))

    const timingChanged = track.map((line) => line.id === 'l2' ? { ...line, endTime: 4.1 } : line)
    expect(buildSrtPromptSourceFingerprint(targets, timingChanged))
      .not.toBe(buildSrtPromptSourceFingerprint(targets, track))
    const unrelatedChanged = track.map((line) => line.id === 'unreferenced' ? { ...line, text: 'changed' } : line)
    expect(buildSrtPromptSourceFingerprint(targets, unrelatedChanged))
      .toBe(buildSrtPromptSourceFingerprint(targets, track))
  })
})

describe('useSrtPrompts — loop/apply/flush', () => {
  it('publishes setup errors and clears the active run when one cue exceeds the chunk budget', async () => {
    const ctx = setup({
      scenesRef: { current: [makeScene('s1', 'text longer than budget')] },
      maxCharsPerChunk: 4,
    })
    let rejection

    await act(async () => {
      try {
        await ctx.result.current.run({ engine: 'claude' })
      } catch (error) {
        rejection = error
      }
    })

    expect(rejection).toMatchObject({ code: 'SRT_PROMPT_SINGLE_CUE_TOO_LARGE' })
    expect(ctx.result.current).toMatchObject({
      status: 'error',
      error: 'SRT prompt cue 1 exceeds the per-chunk budget',
    })
    expect(ctx.result.current.cancel()).toBe(false)
    expect(ctx.writeChunk).not.toHaveBeenCalled()
  })

  it('remains mounted after the React StrictMode cleanup/setup cycle', async () => {
    const ctx = setup({ wrapper: StrictMode })

    let report
    await act(async () => { report = await ctx.result.current.run({ engine: 'claude' }) })

    expect(report.status).toBe('completed')
    expect(ctx.writeChunk).toHaveBeenCalledTimes(1)
  })

  it('assigns global sceneNo values before chunking and keeps timing/prompt keys out of DTOs', async () => {
    const ctx = setup({ maxScenesPerChunk: 1 })

    let report
    await act(async () => {
      report = await ctx.result.current.run({ engine: 'claude', context: { style: 'film' } })
    })

    expect(ctx.writeChunk).toHaveBeenCalledTimes(2)
    expect(ctx.writeChunk.mock.calls.map(([payload]) => payload.dtoScenes[0].sceneNo)).toEqual([1, 2])
    for (const [payload] of ctx.writeChunk.mock.calls) {
      expect(payload).not.toHaveProperty('apiKey')
      expect(payload.dtoScenes[0]).toEqual(expect.objectContaining({ summary: '', text: expect.any(String) }))
      expect(payload.dtoScenes[0]).not.toHaveProperty('startTime')
      expect(payload.dtoScenes[0]).not.toHaveProperty('endTime')
      expect(payload.dtoScenes[0]).not.toHaveProperty('imagePrompt')
      expect(payload.dtoScenes[0]).not.toHaveProperty('videoPrompt')
    }
    expect(report.status).toBe('completed')
  })

  it('awaits each explicit flush before starting the next chunk', async () => {
    const events = []
    const firstFlush = deferred()
    const ctx = setup({
      maxScenesPerChunk: 1,
      writeChunk: vi.fn(async ({ dtoScenes }) => {
        events.push(`write-${dtoScenes[0].sceneNo}`)
        return responseFor(dtoScenes)
      }),
      applyPromptChunk: vi.fn((prompts, meta) => {
        events.push(`apply-${prompts[0].sceneNo}`)
        const nextScenes = ctx.scenesRef.current.map((scene) => ({ ...scene }))
        ctx.scenesRef.current = nextScenes
        return { nextScenes }
      }),
      flushPromptChunk: vi.fn(async ({ chunkIndex }) => {
        events.push(`flush-${chunkIndex}`)
        if (chunkIndex === 0) await firstFlush.promise
        return { ok: true, persisted: true }
      }),
    })

    let pending
    act(() => { pending = ctx.result.current.run({ engine: 'codex' }) })
    await vi.waitFor(() => expect(events).toEqual(['write-1', 'apply-1', 'flush-0']))
    expect(ctx.writeChunk).toHaveBeenCalledTimes(1)

    firstFlush.resolve()
    await act(async () => { await pending })
    expect(events).toEqual(['write-1', 'apply-1', 'flush-0', 'write-2', 'apply-2', 'flush-1'])
  })

  it('short-circuits without IPC when there are no eligible targets', async () => {
    const scenesRef = { current: [makeScene('s1', '', { prompt: 'existing', videoT2VPrompt: 'existing' })] }
    const ctx = setup({ scenesRef })

    let report
    await act(async () => { report = await ctx.result.current.run({ engine: 'gemini', onlyEmpty: true }) })

    expect(report).toMatchObject({ status: 'empty', totalTargets: 0 })
    expect(ctx.writeChunk).not.toHaveBeenCalled()
    expect(ctx.applyPromptChunk).not.toHaveBeenCalled()
    expect(ctx.flushPromptChunk).not.toHaveBeenCalled()
  })

  it('continues after LLM chunk failures and retryFailed reruns only still-empty failed scenes', async () => {
    const writeChunk = vi.fn()
      .mockRejectedValueOnce(new Error('chunk one failed'))
      .mockImplementation(async ({ dtoScenes }) => responseFor(dtoScenes))
    const ctx = setup({ maxScenesPerChunk: 1, writeChunk })

    let firstReport
    await act(async () => { firstReport = await ctx.result.current.run({ engine: 'claude' }) })
    expect(firstReport.status).toBe('completed_with_failures')
    expect(firstReport.failures).toHaveLength(1)
    expect(ctx.scenesRef.current.find((scene) => scene.id === 's1').prompt).toBe('')
    expect(ctx.scenesRef.current.find((scene) => scene.id === 's2').prompt).toBe('image-2')

    writeChunk.mockClear()
    let retryReport
    await act(async () => { retryReport = await ctx.result.current.retryFailed() })
    expect(writeChunk).toHaveBeenCalledTimes(1)
    expect(writeChunk.mock.calls[0][0].dtoScenes).toEqual([
      { sceneNo: 1, summary: '', text: 'one' },
    ])
    expect(retryReport.status).toBe('completed')
  })
})

describe('useSrtPrompts — race guards', () => {
  it.each([
    ['projectId', () => ({ projectId: 'project-b', switchEpoch: 1 })],
    ['switchEpoch', () => ({ projectId: 'project-a', switchEpoch: 2 })],
  ])('discards an in-flight response when %s changes', async (_label, nextIdentity) => {
    const gate = deferred()
    const ctx = setup({ writeChunk: vi.fn(() => gate.promise) })

    let pending
    act(() => { pending = ctx.result.current.run({ engine: 'claude' }) })
    await vi.waitFor(() => expect(ctx.writeChunk).toHaveBeenCalledTimes(1))
    ctx.setIdentity(nextIdentity())
    gate.resolve(responseFor(ctx.writeChunk.mock.calls[0][0].dtoScenes))

    let report
    await act(async () => { report = await pending })
    expect(report.status).toBe('stale')
    expect(ctx.applyPromptChunk).not.toHaveBeenCalled()
    expect(ctx.flushPromptChunk).not.toHaveBeenCalled()
  })

  it('discards an in-flight response when resolved source text changes', async () => {
    const gate = deferred()
    const ctx = setup({ writeChunk: vi.fn(() => gate.promise) })

    let pending
    act(() => { pending = ctx.result.current.run({ engine: 'codex' }) })
    await vi.waitFor(() => expect(ctx.writeChunk).toHaveBeenCalledTimes(1))
    ctx.scenesRef.current = ctx.scenesRef.current.map((scene) => (
      scene.id === 's1' ? { ...scene, subtitle: 'changed while running' } : scene
    ))
    gate.resolve(responseFor(ctx.writeChunk.mock.calls[0][0].dtoScenes))

    let report
    await act(async () => { report = await pending })
    expect(report.status).toBe('stale')
    expect(ctx.applyPromptChunk).not.toHaveBeenCalled()
    expect(ctx.flushPromptChunk).not.toHaveBeenCalled()
  })

  it('rechecks the full snapshot immediately before flush', async () => {
    const scenesRef = { current: [makeScene('s1', '', { srtLineIds: ['l1'] })] }
    const srtTrackRef = {
      current: [{ id: 'l1', text: 'linked text', startTime: 1, endTime: 2 }],
    }
    const ctx = setup({
      scenesRef,
      srtTrackRef,
      applyPromptChunk: vi.fn((prompts, meta) => {
        srtTrackRef.current = [{ ...srtTrackRef.current[0], endTime: 2.5 }]
        return { nextScenes: ctx.scenesRef.current }
      }),
    })

    let report
    await act(async () => { report = await ctx.result.current.run({ engine: 'claude' }) })

    expect(ctx.applyPromptChunk).toHaveBeenCalledTimes(1)
    expect(ctx.flushPromptChunk).not.toHaveBeenCalled()
    expect(report.status).toBe('stale')
  })

  it('cancel marks the in-flight chunk for discard and never starts the next chunk', async () => {
    const gate = deferred()
    const ctx = setup({ maxScenesPerChunk: 1, writeChunk: vi.fn(() => gate.promise) })

    let pending
    act(() => { pending = ctx.result.current.run({ engine: 'gemini' }) })
    await vi.waitFor(() => expect(ctx.writeChunk).toHaveBeenCalledTimes(1))
    act(() => { ctx.result.current.cancel() })
    gate.resolve(responseFor(ctx.writeChunk.mock.calls[0][0].dtoScenes))

    let report
    await act(async () => { report = await pending })
    expect(report.status).toBe('cancelled')
    expect(ctx.writeChunk).toHaveBeenCalledTimes(1)
    expect(ctx.applyPromptChunk).not.toHaveBeenCalled()
    expect(ctx.flushPromptChunk).not.toHaveBeenCalled()
  })

  it('reports cancelled when cancel arrives during the final flush', async () => {
    const flushGate = deferred()
    const ctx = setup({
      flushPromptChunk: vi.fn(() => flushGate.promise),
    })

    let pending
    act(() => { pending = ctx.result.current.run({ engine: 'claude' }) })
    await vi.waitFor(() => expect(ctx.flushPromptChunk).toHaveBeenCalledTimes(1))
    act(() => { ctx.result.current.cancel() })
    flushGate.resolve({ ok: true, persisted: true })

    let report
    await act(async () => { report = await pending })
    expect(report.status).toBe('cancelled')
    expect(report.completedChunks).toBe(1)
  })
})

describe('useSrtPrompts — persisted result handling', () => {
  it('stops before the next chunk and marks unsaved for a folder persisted:false result', async () => {
    const ctx = setup({
      maxScenesPerChunk: 1,
      isFolderProject: true,
      flushPromptChunk: vi.fn(async () => ({ ok: true, persisted: false, error: 'folder missing' })),
    })

    let report
    await act(async () => { report = await ctx.result.current.run({ engine: 'claude' }) })

    expect(report).toMatchObject({ status: 'unsaved', unsaved: true, notPersisted: true })
    expect(ctx.writeChunk).toHaveBeenCalledTimes(1)
    expect(ctx.flushPromptChunk).toHaveBeenCalledTimes(1)
  })

  it('reports non-folder persisted:false but continues subsequent chunks', async () => {
    const ctx = setup({
      maxScenesPerChunk: 1,
      isFolderProject: false,
      flushPromptChunk: vi.fn(async () => ({ ok: true, persisted: false })),
    })

    let report
    await act(async () => { report = await ctx.result.current.run({ engine: 'codex' }) })

    expect(report).toMatchObject({
      status: 'completed',
      unsaved: true,
      notPersisted: true,
      completedChunks: 2,
    })
    expect(ctx.writeChunk).toHaveBeenCalledTimes(2)
    expect(ctx.flushPromptChunk).toHaveBeenCalledTimes(2)
  })

  it.each([
    ['throw', () => { throw new Error('disk full') }],
    ['ok:false', async () => ({ ok: false, persisted: false, error: 'denied' })],
  ])('treats flush %s as unsaved and stops', async (_label, flushImpl) => {
    const ctx = setup({ maxScenesPerChunk: 1, flushPromptChunk: vi.fn(flushImpl) })

    let report
    await act(async () => { report = await ctx.result.current.run({ engine: 'claude' }) })

    expect(report.status).toBe('unsaved')
    expect(report.unsaved).toBe(true)
    expect(ctx.writeChunk).toHaveBeenCalledTimes(1)
  })
})
