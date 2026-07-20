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

  it('uses retry truthy checks, preserves explicit null errors, and omits absent appliedInputs', () => {
    expect(buildVideoRetryFramePairPatch('pending', {
      ...falsyResult,
      error: null,
      errorKind: null,
    })).toEqual({
      status: 'pending',
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

  it('skips falsy retry values but passes null error clears through', () => {
    expect(buildVideoRetryScenePatch('pending', {
      ...falsyResult,
      error: null,
      errorKind: null,
    })).toEqual({
      status: 'pending',
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

  it('D5: uses presence checks to pass null clears while other truthy fields stay omitted', () => {
    expect(buildVideoTextResultPatch('pending', {
      ...falsyResult,
      error: null,
      errorKind: null,
    })).toEqual({
      status: 'pending',
      video: null,
      mediaId: '',
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
