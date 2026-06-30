/**
 * R2-5: flowProjectReady missing from _executeSceneGeneration useCallback dep array.
 *
 * Bug: _executeSceneGeneration captures flowProjectReady at creation time. When
 * flowProjectReady changes (e.g., after binding completes or after switching
 * mode), the callback still holds the stale value — could block generation after
 * recovery or allow generation during rebinding.
 *
 * Fix: flowProjectReady added to the useCallback dep array so the callback is
 * recreated whenever flowProjectReady changes.
 *
 * Verification strategy: render the hook with flowProjectReady=false → try to
 * generate → confirm it is blocked. Then rerender with flowProjectReady=true →
 * confirm the new callback allows generation.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'

// Import checkFlowProjectReady so we can inspect what value it receives
import * as guards from '../../src/utils/guards'

vi.mock('../../src/utils/guards', () => ({
  checkFolderPermission: vi.fn().mockResolvedValue({ ok: true }),
  checkAuthToken: vi.fn().mockResolvedValue(true),
  // Pass through the real logic so we can verify the value seen by the callback
  checkFlowProjectReady: vi.fn((ready, _t) => ({ ok: ready })),
}))
vi.mock('../../src/services/styleService', () => ({
  resolveSceneStyle: vi.fn(() => ({ styledPrompt: 'styled prompt' })),
}))
vi.mock('../../src/services/imageFinalize', () => ({
  finalizeGeneratedImage: vi.fn().mockResolvedValue({ success: true, sceneUpdate: { status: 'done' } }),
}))
vi.mock('../../src/components/Toast', () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}))
vi.mock('../../src/utils/quotaStop', () => ({
  isQuotaExhaustedError: vi.fn(() => false),
  emitQuotaStop: vi.fn(),
}))
vi.mock('../../src/utils/mentionParser', () => ({
  resolveMentions: vi.fn(() => ({ missing: [] })),
}))

import { useSceneGeneration } from '../../src/hooks/useSceneGeneration'

const makeProps = (flowProjectReady) => ({
  settings: { imageModel: 'gemini-2.5-flash-image', aspectRatio: '16:9', imageBatchCount: 1, saveMode: 'memory' },
  scenes: [{ id: 'scene_1', prompt: 'a hero' }],
  scenesHook: {
    references: [],
    updateScene: vi.fn(),
    getMatchingReferences: vi.fn(() => []),
  },
  genAPI: { generateImage: vi.fn().mockResolvedValue({ success: true, images: [{ base64: 'X' }] }) },
  openSettings: vi.fn(),
  setSelectedScene: vi.fn(),
  t: (k) => k,
  generationQueue: null,
  flowProjectReady,
})

describe('R2-5: flowProjectReady dep in _executeSceneGeneration useCallback', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('blocks generation when flowProjectReady=false', async () => {
    const props = makeProps(false)
    const { result } = renderHook(() => useSceneGeneration(props))

    await act(async () => { await result.current.handleGenerateScene('scene_1') })

    // checkFlowProjectReady called with false → ok: false → generation blocked
    expect(guards.checkFlowProjectReady).toHaveBeenCalledWith(false, expect.anything())
    expect(props.genAPI.generateImage).not.toHaveBeenCalled()
  })

  it('allows generation when flowProjectReady=true', async () => {
    const props = makeProps(true)
    const { result } = renderHook(() => useSceneGeneration(props))

    await act(async () => { await result.current.handleGenerateScene('scene_1') })

    expect(guards.checkFlowProjectReady).toHaveBeenCalledWith(true, expect.anything())
    expect(props.genAPI.generateImage).toHaveBeenCalledTimes(1)
  })

  it('callback updates when flowProjectReady changes from false → true (dep fix)', async () => {
    // Render with flowProjectReady=false initially
    const { result, rerender } = renderHook(
      ({ flowProjectReady }) => useSceneGeneration(makeProps(flowProjectReady)),
      { initialProps: { flowProjectReady: false } }
    )

    // First call — blocked
    await act(async () => { await result.current.handleGenerateScene('scene_1') })
    const callsAfterBlocked = guards.checkFlowProjectReady.mock.calls.length
    expect(callsAfterBlocked).toBeGreaterThanOrEqual(1)
    // The last call to checkFlowProjectReady should have received false
    const lastCallBeforeRerender = guards.checkFlowProjectReady.mock.calls[callsAfterBlocked - 1]
    expect(lastCallBeforeRerender[0]).toBe(false)

    vi.clearAllMocks()

    // Rerender with flowProjectReady=true — the callback MUST be recreated (dep fix)
    rerender({ flowProjectReady: true })

    await act(async () => { await result.current.handleGenerateScene('scene_1') })
    // checkFlowProjectReady should now receive true (not the stale false)
    expect(guards.checkFlowProjectReady).toHaveBeenCalledWith(true, expect.anything())
    // And generation should proceed
    // (Each rerender creates new genAPI mock since makeProps is called fresh,
    //  so we check via the guard call rather than generateImage count)
  })
})
