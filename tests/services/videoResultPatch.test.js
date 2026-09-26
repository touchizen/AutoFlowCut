import { describe, expect, it, vi } from 'vitest'
import {
  buildVideoRetryFramePairPatch,
  buildVideoRetryScenePatch,
  buildVideoTextResultPatch,
  buildVideoI2VResultPatch,
} from '../../src/services/videoResultPatch'

const completeResult = {
  base64: 'data:video/mp4;base64,VIDEO',
  mediaId: 'media-1',
  generationId: 'generation-1',
  videoPath: '/videos/result.mp4',
  videoSaveId: 'save-1',
  duration: 8,
  seed: 0,
  generatedAt: 1234,
  model: 'video-model',
  appliedInputs: { provider: 'grok', resolution: '1080p' },
  error: null,
  errorKind: null,
}

const falsyResult = {
  base64: null,
  mediaId: '',
  generationId: '',
  videoPath: null,
  videoSaveId: '',
  duration: 0,
  seed: null,
  generatedAt: null,
  model: '',
  appliedInputs: null,
}

describe('buildVideoRetryFramePairPatch', () => {
  it('includes every persisted retry field and aliases base64 to video', () => {
    expect(buildVideoRetryFramePairPatch('complete', {
      ...completeResult,
      generatingEndedAt: 4321,
    })).toEqual({
      status: 'complete',
      generatingEndedAt: 4321,
      video: completeResult.base64,
      base64: completeResult.base64,
      mediaId: completeResult.mediaId,
      generationId: completeResult.generationId,
      videoPath: completeResult.videoPath,
      videoSaveId: completeResult.videoSaveId,
      duration: completeResult.duration,
      seed: completeResult.seed,
      generatedAt: completeResult.generatedAt,
      model: completeResult.model,
      appliedInputs: completeResult.appliedInputs,
      error: null,
      errorKind: null,
    })
  })

  // main 병합(M2-R3 H3): mediaId·generationId 는 presence 검사 — Regenerate 의 null 도 통과한다. 나머지는 truthy 그대로.
  it('uses retry truthy checks (ids by presence), preserves explicit null errors, and omits absent appliedInputs', () => {
    expect(buildVideoRetryFramePairPatch('pending', {
      ...falsyResult,
      error: null,
      errorKind: null,
    })).toEqual({
      status: 'pending',
      mediaId: '',
      generationId: '',
      error: null,
      errorKind: null,
    })
    expect(buildVideoRetryFramePairPatch('pending', {})).toEqual({ status: 'pending' })
  })

  it('uses result timestamps for retry updates and calls now only for a missing terminal timestamp', () => {
    const now = vi.fn(() => 9000)

    expect(buildVideoRetryFramePairPatch('generating', { generatingStartedAt: 1000 }, now)).toEqual({
      status: 'generating',
      generatingStartedAt: 1000,
      generatingEndedAt: null,
    })
    expect(buildVideoRetryFramePairPatch('error', { generatingEndedAt: 2000 }, now)).toEqual({
      status: 'error',
      generatingEndedAt: 2000,
    })
    expect(buildVideoRetryFramePairPatch('complete', {}, now)).toEqual({
      status: 'complete',
      generatingEndedAt: 9000,
    })
    expect(now).toHaveBeenCalledTimes(1)
  })
})

describe('buildVideoRetryScenePatch', () => {
  it('includes every persisted retry field without a base64 alias', () => {
    expect(buildVideoRetryScenePatch('complete', {
      ...completeResult,
      generatingEndedAt: 4321,
    })).toEqual({
      status: 'complete',
      generatingEndedAt: 4321,
      video: completeResult.base64,
      mediaId: completeResult.mediaId,
      generationId: completeResult.generationId,
      videoPath: completeResult.videoPath,
      videoSaveId: completeResult.videoSaveId,
      duration: completeResult.duration,
      seed: completeResult.seed,
      generatedAt: completeResult.generatedAt,
      model: completeResult.model,
      appliedInputs: completeResult.appliedInputs,
      error: null,
      errorKind: null,
    })
  })

  // main 병합(M2-R3 H3): mediaId·generationId 는 presence 검사(Regenerate 의 null 통과)
  it('skips falsy retry values (ids by presence) but passes null error clears through', () => {
    expect(buildVideoRetryScenePatch('pending', {
      ...falsyResult,
      error: null,
      errorKind: null,
    })).toEqual({
      status: 'pending',
      mediaId: '',
      generationId: '',
      error: null,
      errorKind: null,
    })
  })

  it('preserves retry timestamp policies when result is null or timestamps are falsy', () => {
    const now = vi.fn(() => 9000)

    expect(buildVideoRetryScenePatch('generating', null, now)).toEqual({ status: 'generating' })
    expect(buildVideoRetryScenePatch('error', { generatingEndedAt: 0 }, now)).toEqual({
      status: 'error',
      generatingEndedAt: 9000,
    })
    expect(now).toHaveBeenCalledTimes(1)
  })
})

describe('buildVideoTextResultPatch', () => {
  it('includes every persisted T2V batch field and does not add a base64 alias', () => {
    const now = vi.fn(() => 9000)

    expect(buildVideoTextResultPatch('complete', completeResult, now)).toEqual({
      status: 'complete',
      generatingEndedAt: 9000,
      video: completeResult.base64,
      mediaId: completeResult.mediaId,
      generationId: completeResult.generationId,
      videoPath: completeResult.videoPath,
      videoSaveId: completeResult.videoSaveId,
      duration: completeResult.duration,
      seed: completeResult.seed,
      generatedAt: completeResult.generatedAt,
      model: completeResult.model,
      appliedInputs: completeResult.appliedInputs,
      error: null,
      errorKind: null,
    })
    expect(now).toHaveBeenCalledTimes(1)
  })

  // main 병합(M2-R6 K1): generationId 도 presence 검사 — 훅이 fresh 항목의 옛 Flow 모양 id 를 null 로 지운다
  it('D5: uses presence checks to pass null clears while other truthy fields stay omitted', () => {
    expect(buildVideoTextResultPatch('pending', {
      ...falsyResult,
      error: null,
      errorKind: null,
    })).toEqual({
      status: 'pending',
      video: null,
      mediaId: '',
      generationId: '',
      videoPath: null,
      generatedAt: null,
      appliedInputs: null,
      error: null,
      errorKind: null,
    })
    expect(buildVideoTextResultPatch('pending', {})).toEqual({ status: 'pending' })
  })

  it('creates batch timestamps from now only for generating and terminal statuses', () => {
    const now = vi.fn()
      .mockReturnValueOnce(1000)
      .mockReturnValueOnce(2000)

    expect(buildVideoTextResultPatch('generating', {}, now)).toEqual({
      status: 'generating',
      generatingStartedAt: 1000,
      generatingEndedAt: null,
    })
    expect(buildVideoTextResultPatch('error', null, now)).toEqual({
      status: 'error',
      generatingEndedAt: 2000,
    })
    expect(buildVideoTextResultPatch('pending', undefined, now)).toEqual({ status: 'pending' })
    expect(now).toHaveBeenCalledTimes(2)
  })
})

describe('buildVideoI2VResultPatch', () => {
  it('includes every persisted I2V batch field and aliases base64 to video', () => {
    const now = vi.fn(() => 9000)

    expect(buildVideoI2VResultPatch('complete', completeResult, now)).toEqual({
      status: 'complete',
      generatingEndedAt: 9000,
      video: completeResult.base64,
      base64: completeResult.base64,
      mediaId: completeResult.mediaId,
      generationId: completeResult.generationId,
      videoPath: completeResult.videoPath,
      videoSaveId: completeResult.videoSaveId,
      duration: completeResult.duration,
      seed: completeResult.seed,
      generatedAt: completeResult.generatedAt,
      model: completeResult.model,
      appliedInputs: completeResult.appliedInputs,
      error: null,
      errorKind: null,
    })
  })

  // main 병합(M2-R6 K1): generationId 도 presence 검사(t2v 와 동일)
  it('D5: uses presence checks for null clears and preserves the base64 alias', () => {
    expect(buildVideoI2VResultPatch('pending', {
      ...falsyResult,
      error: null,
      errorKind: null,
    })).toEqual({
      status: 'pending',
      video: null,
      base64: null,
      mediaId: '',
      generationId: '',
      videoPath: null,
      generatedAt: null,
      appliedInputs: null,
      error: null,
      errorKind: null,
    })
    expect(buildVideoI2VResultPatch('pending', {})).toEqual({ status: 'pending' })
  })

  it('uses now for generating and terminal timestamps without reading timestamps from result', () => {
    const now = vi.fn()
      .mockReturnValueOnce(1000)
      .mockReturnValueOnce(2000)

    expect(buildVideoI2VResultPatch('generating', {
      generatingStartedAt: 1,
      generatingEndedAt: 2,
    }, now)).toEqual({
      status: 'generating',
      generatingStartedAt: 1000,
      generatingEndedAt: null,
    })
    expect(buildVideoI2VResultPatch('complete', { generatingEndedAt: 3 }, now)).toEqual({
      status: 'complete',
      generatingEndedAt: 2000,
    })
    expect(now).toHaveBeenCalledTimes(2)
  })
})

describe('batch generation provider persistence', () => {
  it('D3: T2V/I2V batch patches persist truthy generationProvider only', () => {
    expect(buildVideoTextResultPatch('generating', { generationProvider: 'grok' }, () => 1))
      .toMatchObject({ generationProvider: 'grok' })
    expect(buildVideoI2VResultPatch('generating', { generationProvider: 'fal' }, () => 1))
      .toMatchObject({ generationProvider: 'fal' })

    expect(buildVideoTextResultPatch('pending', { generationProvider: '' }))
      .not.toHaveProperty('generationProvider')
    expect(buildVideoI2VResultPatch('pending', { generationProvider: null }))
      .not.toHaveProperty('generationProvider')
  })
})

// main 병합: main(flow.google.com 재작업)이 인라인 패치에 더한 필드를 빌더가 그대로 싣는다 — presence 검사라 null 로 지우는 패치도 통과한다.
describe('main 병합 필드(M2-5 T6 · M2-R3 H6)', () => {
  const flowFields = { errorParams: { expected: 'veo_3_1_fast' }, rejectedMediaId: 'rej-1', rejectedMediaIds: ['rej-1', 'rej-2'], downloadGated: true }
  const cleared = { errorParams: null, rejectedMediaId: null, rejectedMediaIds: null, downloadGated: null }

  it('T2V·I2V 배치 패치는 errorParams·거부 미디어 id·downloadGated 를 presence 로 싣는다(null 로 지우는 패치 포함)', () => {
    for (const build of [buildVideoTextResultPatch, buildVideoI2VResultPatch]) {
      expect(build('error', flowFields, () => 1)).toMatchObject(flowFields)
      expect(build('pending', cleared, () => 1)).toEqual({ status: 'pending', ...cleared })
      expect(build('pending', {}, () => 1)).toEqual({ status: 'pending' })
    }
  })

  it('재시도 패치는 downloadGated 를 presence 로 싣는다(Regenerate 가 null 로 지운다) — errorParams·거부 id 는 재시도 경로에 없다', () => {
    for (const build of [buildVideoRetryFramePairPatch, buildVideoRetryScenePatch]) {
      expect(build('pending', { downloadGated: null })).toEqual({ status: 'pending', downloadGated: null })
      expect(build('complete', { downloadGated: true, generatingEndedAt: 5 })).toMatchObject({ downloadGated: true })
      expect(build('pending', { errorParams: { a: 1 }, rejectedMediaId: 'x' })).toEqual({ status: 'pending' })
    }
  })

  it('재시도 패치의 mediaId·generationId 는 명시적 null 도 통과한다(M2-R3 H3)', () => {
    for (const build of [buildVideoRetryFramePairPatch, buildVideoRetryScenePatch]) {
      expect(build('pending', { mediaId: null, generationId: null })).toEqual({ status: 'pending', mediaId: null, generationId: null })
    }
  })
})
