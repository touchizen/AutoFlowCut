import { describe, it, expect } from 'vitest'
import { canSwitchMode, shouldApplyModeScopedUpdate } from '../../src/utils/modeSwitchGuard'

describe('canSwitchMode', () => {
  it('returns true when all idle', () => {
    expect(canSwitchMode({ isRunning: false, videoRunning: false, refBatchRunning: false })).toBe(true)
  })

  it('returns false when isRunning is true', () => {
    expect(canSwitchMode({ isRunning: true, videoRunning: false, refBatchRunning: false })).toBe(false)
  })

  it('returns false when videoRunning is true', () => {
    expect(canSwitchMode({ isRunning: false, videoRunning: true, refBatchRunning: false })).toBe(false)
  })

  it('returns false when refBatchRunning is true', () => {
    expect(canSwitchMode({ isRunning: false, videoRunning: false, refBatchRunning: true })).toBe(false)
  })

  it('returns false when multiple are running', () => {
    expect(canSwitchMode({ isRunning: true, videoRunning: true, refBatchRunning: true })).toBe(false)
  })

  it('returns false when hasPendingBatch is true even if other flags are false (Fix #5)', () => {
    expect(canSwitchMode({ isRunning: false, videoRunning: false, refBatchRunning: false, hasPendingBatch: true })).toBe(false)
  })

  it('returns true when all flags including hasPendingBatch are false', () => {
    expect(canSwitchMode({ isRunning: false, videoRunning: false, refBatchRunning: false, hasPendingBatch: false })).toBe(true)
  })

  it('defaults hasPendingBatch to false (backward-compat: old callers omit it)', () => {
    expect(canSwitchMode({ isRunning: false, videoRunning: false, refBatchRunning: false })).toBe(true)
  })

  it('keeps ignoring signals that only fullProjectBusy considers busy', () => {
    expect(canSwitchMode({
      isRunning: false,
      videoRunning: false,
      refBatchRunning: false,
      hasPendingBatch: false,
      upscaylRunning: true,
      videoRetryRunning: true,
      generatingSceneId: 'scene_1',
      thumbnailGenerating: true,
      galleryUploading: true,
    })).toBe(true)
  })
})

describe('shouldApplyModeScopedUpdate (#R23-7)', () => {
  it('applies update when mode unchanged since work started', () => {
    expect(shouldApplyModeScopedUpdate('flow', 'flow')).toBe(true)
    expect(shouldApplyModeScopedUpdate('api', 'api')).toBe(true)
  })

  it('skips update when mode switched mid-flight (stale cross-mode patch)', () => {
    expect(shouldApplyModeScopedUpdate('api', 'flow')).toBe(false)
    expect(shouldApplyModeScopedUpdate('flow', 'api')).toBe(false)
  })

  it('re-applies if mode switched away and back to the start mode', () => {
    // currentMode === startMode again → safe to apply
    expect(shouldApplyModeScopedUpdate('flow', 'flow')).toBe(true)
  })
})
