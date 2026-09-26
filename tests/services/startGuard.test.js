import { describe, expect, it } from 'vitest'
import * as startGuard from '../../src/services/startGuard'

describe('isStartBlocked — handleStart entry guard', () => {
  it('returns false when all signals are idle', () => {
    expect(startGuard.isStartBlocked({})).toBe(false)
  })

  it.each([
    ['isRunning', { isRunning: true }],
    ['videoRunning', { videoRunning: true }],
    ['hasPendingBatch', { hasPendingBatch: true }],
    ['retryInFlight', { retryInFlight: true }],
    ['upscaylRunning', { upscaylRunning: true }],
    ['refBatchRunning', { refBatchRunning: true }],
  ])('returns true when %s is the only active signal', (_name, state) => {
    expect(startGuard.isStartBlocked(state)).toBe(true)
  })

  it('does not treat generatingSceneId as a start-block signal', () => {
    expect(startGuard.isStartBlocked({ generatingSceneId: 'scene_1' })).toBe(false)
  })
})

describe('isUpscaylStartBlocked — reverse-direction Upscayl guard', () => {
  it('returns false when all signals are idle', () => {
    expect(startGuard.isUpscaylStartBlocked({})).toBe(false)
  })

  it.each([
    ['isRunning', { isRunning: true }],
    ['isSceneBatchQueued', { isSceneBatchQueued: true }],
    ['hasPendingBatch', { hasPendingBatch: true }],
    ['startInFlight', { startInFlight: true }],
    ['generatingSceneId', { generatingSceneId: 'scene_1' }],
    ['videoRunning', { videoRunning: true }],
    ['videoRetryInFlight', { videoRetryInFlight: true }],
    ['refBatchRunning', { refBatchRunning: true }],
    ["gatePhase === 'busy'", { gatePhase: 'busy' }],
  ])('returns true when %s is the only active signal', (_name, state) => {
    expect(startGuard.isUpscaylStartBlocked(state)).toBe(true)
  })

  it('ignores thumbnail/gallery work and non-busy gate phases', () => {
    expect(startGuard.isUpscaylStartBlocked({
      thumbnailGenerating: true,
      galleryUploading: true,
      gatePhase: 'idle',
    })).toBe(false)
  })
})

describe('isAnyRunning — App anyRunning aggregate', () => {
  it('returns false when all signals are idle', () => {
    expect(startGuard.isAnyRunning({})).toBe(false)
  })

  it.each([
    ['isRunning', { isRunning: true }],
    ['videoRunning', { videoRunning: true }],
    ['hasPendingBatch', { hasPendingBatch: true }],
    ['upscaylRunning', { upscaylRunning: true }],
  ])('returns true when %s is the only active signal', (_name, state) => {
    expect(startGuard.isAnyRunning(state)).toBe(true)
  })

  it('does not treat thumbnail/gallery work as anyRunning', () => {
    expect(startGuard.isAnyRunning({
      thumbnailGenerating: true,
      galleryUploading: true,
    })).toBe(false)
  })
})

describe('isMcpRunning — MCP stop/wait aggregate', () => {
  it('returns false when all signals are idle', () => {
    expect(startGuard.isMcpRunning({})).toBe(false)
  })

  it.each([
    ['isRunning', { isRunning: true }],
    ['isSceneBatchQueued', { isSceneBatchQueued: true }],
    ['videoRunning', { videoRunning: true }],
    ['refBatchRunning', { refBatchRunning: true }],
    ['upscaylRunning', { upscaylRunning: true }],
  ])('returns true when %s is the only active signal', (_name, state) => {
    expect(startGuard.isMcpRunning(state)).toBe(true)
  })

  it('does not absorb the separate MCP batch-status or project-busy signals', () => {
    expect(startGuard.isMcpRunning({
      generatingRefs: [0],
      hasPendingBatch: true,
      videoRetryRunning: true,
      thumbnailGenerating: true,
      galleryUploading: true,
    })).toBe(false)
  })
})

describe('isProjectBusy — App fullProjectBusy aggregate', () => {
  it('returns false when all signals are idle', () => {
    expect(startGuard.isProjectBusy({})).toBe(false)
  })

  it.each([
    ['isRunning', { isRunning: true }],
    ['videoRunning', { videoRunning: true }],
    ['hasPendingBatch', { hasPendingBatch: true }],
    ['upscaylRunning', { upscaylRunning: true }],
    ['refBatchRunning', { refBatchRunning: true }],
    ['videoRetryRunning', { videoRetryRunning: true }],
    ['generatingSceneId', { generatingSceneId: 'scene_1' }],
    ['thumbnailGenerating', { thumbnailGenerating: true }],
    ['galleryUploading', { galleryUploading: true }],
  ])('returns true when %s is the only active signal', (_name, state) => {
    expect(startGuard.isProjectBusy(state)).toBe(true)
  })

  it('does not include queue/latch/gate signals outside fullProjectBusy', () => {
    expect(startGuard.isProjectBusy({
      isSceneBatchQueued: true,
      startInFlight: true,
      retryInFlight: true,
      generatingRefs: [0],
      gatePhase: 'busy',
    })).toBe(false)
  })
})
