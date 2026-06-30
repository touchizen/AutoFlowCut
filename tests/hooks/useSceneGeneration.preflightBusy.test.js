/**
 * #R27-1: single-scene preflight window must be busy.
 *
 * generatingSceneId was set only AFTER awaiting folder/ready/auth checks, leaving a window where
 * Header disabled/modeBusy (which key off !!generatingSceneId) still allowed project/mode switching —
 * a stale generation could then run on the wrong engine and patch the current project's scene.
 * Fix: set generatingSceneId BEFORE the preflight awaits; reset on every early return.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'

import * as guards from '../../src/utils/guards'

vi.mock('../../src/utils/guards', () => ({
  checkFolderPermission: vi.fn().mockResolvedValue({ ok: true }),
  checkAuthToken: vi.fn().mockResolvedValue(true),
  checkFlowProjectReady: vi.fn(() => ({ ok: true })),
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

const makeProps = () => ({
  settings: { imageModel: 'gemini-2.5-flash-image', aspectRatio: '16:9', imageBatchCount: 1, saveMode: 'memory' },
  scenes: [{ id: 'scene_1', prompt: 'a hero' }],
  scenesHook: { references: [], updateScene: vi.fn(), getMatchingReferences: vi.fn(() => []) },
  genAPI: { generateImage: vi.fn().mockResolvedValue({ success: true, images: [{ base64: 'X' }] }) },
  openSettings: vi.fn(), setSelectedScene: vi.fn(), t: (k) => k, generationQueue: null, flowProjectReady: true,
})

beforeEach(() => {
  vi.clearAllMocks()
  guards.checkFolderPermission.mockResolvedValue({ ok: true })
  guards.checkAuthToken.mockResolvedValue(true)
  guards.checkFlowProjectReady.mockReturnValue({ ok: true })
})

describe('#R27-1: single-scene preflight is busy', () => {
  it('generatingSceneId is set while the auth preflight is still pending', async () => {
    let resolveAuth
    guards.checkAuthToken.mockReturnValue(new Promise((r) => { resolveAuth = r }))
    const props = makeProps()
    const { result } = renderHook(() => useSceneGeneration(props))

    let p
    await act(async () => {
      p = result.current.handleGenerateScene('scene_1')
      await new Promise((r) => setTimeout(r, 0))  // flush past folder/ready, park at auth
    })

    // busy during preflight → switch would be blocked
    expect(result.current.generatingSceneId).toBe('scene_1')
    expect(props.genAPI.generateImage).not.toHaveBeenCalled()

    await act(async () => { resolveAuth(true); await p })
    expect(result.current.generatingSceneId).toBeNull()  // cleared after completion
  })

  it('resets generatingSceneId when a preflight check fails (no stuck busy)', async () => {
    guards.checkFlowProjectReady.mockReturnValue({ ok: false })
    const props = makeProps()
    const { result } = renderHook(() => useSceneGeneration(props))

    await act(async () => { await result.current.handleGenerateScene('scene_1') })

    expect(result.current.generatingSceneId).toBeNull()
    expect(props.genAPI.generateImage).not.toHaveBeenCalled()
  })
})
