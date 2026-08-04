/**
 * Real-defaults regression net — the REAL default settings through the REAL chain.
 *
 * Several "green suite, dead app" Criticals shared one shape: a guard written against a
 * hand-shaped fixture that never matched what the app actually sends (dead first-run picker,
 * auth probe stub, aspectRatio refusal, seed refusal). Each slipped through because unit
 * fixtures defaulted the poisoned field to a passing value (e.g. `seed: null` while the real
 * useAppSettings default is seedLocked:true + numeric seedNo).
 *
 * This test refuses to hand-shape anything on that axis:
 *  - the settings object comes from the REAL useAppSettings hook (first-run defaults),
 *  - the start options come from the REAL buildImageStartOptions App.jsx calls,
 *  - the submission runs through the REAL useAutomation → createEngineApi → useGenAPI chain,
 * faking only the preload IPC boundary (window.electronAPI.genai*). Any new refusal that
 * fires on an app-default field anywhere renderer-side breaks this test immediately.
 */
import { describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'

vi.mock('../../src/components/Toast', () => ({
  toast: { error: vi.fn(), warning: vi.fn(), success: vi.fn(), info: vi.fn() },
}))
vi.mock('../../src/hooks/useFileSystem', () => ({
  fileSystemAPI: {
    checkPermission: vi.fn().mockResolvedValue({ success: true }),
    readFileByPath: vi.fn().mockRejectedValue(new Error('must not be called')),
  },
}))
const { finalizeResults } = vi.hoisted(() => ({ finalizeResults: [] }))
vi.mock('../../src/services/imageFinalize', () => ({
  processAsyncSceneResult: vi.fn(async ({ result }) => {
    finalizeResults.push(result)
    return true
  }),
}))

import { useAutomation } from '../../src/hooks/useAutomation'
import { useAppSettings } from '../../src/hooks/useAppSettings'
import { buildImageStartOptions } from '../../src/services/startOptions'
import { createEngineApi } from '../../src/engine/engineApi'
import { useGenAPI } from '../../src/hooks/useGenAPI'

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUg=='

function installElectronAPI() {
  const electronAPI = {
    genaiGetKeyStatus: vi.fn(async () => ({ success: true, hasKey: true, byProvider: {} })),
    genaiGenerateImage: vi.fn(async () => ({
      success: true,
      images: [{ dataUrl: PNG, mimeType: 'image/png' }],
    })),
  }
  window.electronAPI = electronAPI
  return electronAPI
}

function makeScenesHook() {
  const scenes = [{ id: 'scene-real-chain', prompt: 'a copper lighthouse over a violet sea', status: 'pending' }]
  const updates = []
  return {
    updates,
    scenesHook: {
      scenes,
      references: [],
      updateScene: vi.fn((id, patch) => updates.push({ id, ...patch })),
      getMatchingReferences: vi.fn(() => []),
      updateReferences: vi.fn(),
    },
  }
}

// The REAL first-run settings object and the REAL App.jsx handleStart derivation — no field
// is hand-shaped, so a default value a guard refuses cannot hide behind a fixture again.
function realDefaultStartOptions() {
  window.localStorage.removeItem('autoflowcut_settings')
  const { result } = renderHook(() => useAppSettings())
  return buildImageStartOptions(result.current.settings, {
    projectName: 'real-chain-project',
    effectiveStyleId: null,
    force: false,
  })
}

describe('API mode — real default settings through the real engine chain', () => {
  it('a stock-settings scene submission reaches the IPC boundary and completes', async () => {
    finalizeResults.length = 0
    const electronAPI = installElectronAPI()
    const { scenesHook, updates } = makeScenesHook()

    const startOptions = realDefaultStartOptions()
    // Reality check on the fixture itself: the app default is a NUMBER seed (seedLocked:true +
    // random seedNo) and a STRING aspect ratio — the exact values earlier waves' fixtures nulled.
    expect(Number.isFinite(startOptions.seed)).toBe(true)
    expect(startOptions.aspectRatio).toBe('16:9')
    expect(startOptions.imageBatchCount).toBe(1)
    expect(startOptions.imageProvider).toBe('google')

    const { result } = renderHook(() => {
      const genAPI = useGenAPI()
      const engine = createEngineApi(genAPI)
      return useAutomation(
        engine, scenesHook, null, null, null, (key) => key, null, null, null, 'api', true,
      )
    })

    await act(async () => {
      await result.current.start(startOptions)
    })

    // No renderer-side guard refused an app-default field.
    expect(updates.filter((u) => u.status === 'error')).toEqual([])
    expect(finalizeResults).toHaveLength(1)
    expect(finalizeResults[0].success).toBe(true)
    expect(finalizeResults[0].images?.[0]?.base64).toBeTruthy()

    // The IPC payload carries exactly what the real defaults imply.
    expect(electronAPI.genaiGenerateImage).toHaveBeenCalledTimes(1)
    const request = electronAPI.genaiGenerateImage.mock.calls[0][0]
    expect(request.prompt).toContain('a copper lighthouse over a violet sea')
    expect(request.aspectRatio).toBe('16:9')
    expect(typeof request.model).toBe('string')
    expect(request.model.length).toBeGreaterThan(0)
    expect(request.referenceImages).toEqual([])
  })
})
