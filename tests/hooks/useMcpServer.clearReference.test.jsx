import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'

vi.mock('../../src/utils/guards', () => ({
  checkAuthToken: vi.fn().mockResolvedValue(true),
  checkFolderPermission: vi.fn().mockResolvedValue({ ok: true }),
  checkFlowProjectReady: vi.fn().mockReturnValue({ ok: true }),
}))

vi.mock('../../src/hooks/useFileSystem', () => ({
  fileSystemAPI: {
    ensurePermission: vi.fn().mockResolvedValue({ hasPermission: true, name: 'test' }),
  },
}))

vi.mock('../../src/components/Toast', () => ({
  toast: { info: vi.fn(), warning: vi.fn(), error: vi.fn(), success: vi.fn() },
}))

vi.mock('../../src/utils/imageProcessing', () => ({
  tryUpscaleImage: vi.fn(),
  extractThumbnailBase64: vi.fn().mockResolvedValue('thumb'),
}))

vi.mock('../../src/utils/urls', () => ({
  cleanBase64: vi.fn(value => value),
  toDataURL: vi.fn(value => value),
}))

import { useMcpServer } from '../../src/hooks/useMcpServer'
import { useReferenceGeneration } from '../../src/hooks/useReferenceGeneration'

const mcpProps = overrides => ({
  settings: { mcpHttpEnabled: false, mcpHttpPort: 3210 },
  scenes: [],
  setScenes: vi.fn(),
  references: [],
  setReferences: vi.fn(),
  handleGenerateRef: vi.fn(),
  handleGenerateScene: vi.fn(),
  handleGenerateAllRefs: vi.fn(),
  handleStart: vi.fn(),
  handleStop: vi.fn(),
  handleProjectChange: vi.fn(),
  handleExportConfirm: vi.fn(),
  selectedStyleRefId: null,
  setSelectedStyleRefId: vi.fn(),
  refreshReviews: vi.fn(),
  audioReviews: [],
  importByPath: vi.fn(),
  audioPackage: null,
  automationState: { isRunning: false, isPaused: false, progress: { current: 0, total: 0 }, status: 'idle', statusMessage: '' },
  videoAutomation: {},
  generatingRefs: [],
  isRunning: false,
  ...overrides,
})

describe('MCP clear-reference-image → global reference batch', () => {
  let onMcpUpdate

  beforeEach(() => {
    window.electronAPI = {
      startMcpHttp: vi.fn(),
      stopMcpHttp: vi.fn(),
      onMcpUpdate: vi.fn(callback => { onMcpUpdate = callback; return () => {} }),
    }
  })

  afterEach(() => {
    vi.useRealTimers()
    delete window.electronAPI
    delete window.__mcpGetReferences
    delete window.__mcpGenerateRef
    delete window.__mcpStartRefBatch
    delete window.__mcpStartBatch
  })

  it('done ref를 pending으로 비우고 실제 global batch 생성 대상으로 남긴다', async () => {
    let liveRefs = [{
      id: 9,
      name: 'Mina',
      type: 'character',
      prompt: 'portrait',
      data: 'data:image/png;base64,OLD',
      filePath: null,
      status: 'done',
      errorMessage: 'old failure',
      errorKind: 'old-kind',
      error: 'old error',
      entityId: 'old-entity',
      workflowId: 'old-workflow',
      registered: true,
      flowNameSyncStatus: 'synced',
    }]
    const setReferences = vi.fn(updater => {
      liveRefs = typeof updater === 'function' ? updater(liveRefs) : updater
    })

    renderHook(() => useMcpServer(mcpProps({ references: liveRefs, setReferences })))
    act(() => onMcpUpdate({ type: 'clear-reference-image', index: 0 }))

    expect(liveRefs[0]).toMatchObject({
      data: null,
      filePath: null,
      status: 'pending',
      errorMessage: null,
      errorKind: null,
      error: null,
      entityId: null,
      workflowId: null,
    })

    const genAPI = {
      mode: 'api',
      getAccessToken: vi.fn().mockResolvedValue('token'),
      clearTokenCache: vi.fn(),
      submitGeneration: vi.fn().mockResolvedValue({ success: true, generationId: 'g-cleared' }),
      checkGeneration: vi.fn().mockResolvedValue({ success: true, completed: true }),
      collectGeneration: vi.fn().mockResolvedValue({ success: true, images: [{ base64: 'new-image' }] }),
      clearGenerations: vi.fn().mockResolvedValue(undefined),
    }
    const generation = renderHook(() => useReferenceGeneration({
      settings: { saveMode: 'project', imageBatchCount: 1 },
      references: liveRefs,
      setReferences,
      genAPI,
      addPendingSave: vi.fn(),
      openSettings: vi.fn(),
      t: key => key,
      generationQueue: null,
    }))

    vi.useFakeTimers()
    let batchPromise
    await act(async () => { batchPromise = generation.result.current.handleGenerateAllRefs() })
    for (let i = 0; i < 20; i++) {
      await act(async () => { await vi.advanceTimersByTimeAsync(16000) })
    }
    let batchResult
    await act(async () => { batchResult = await batchPromise })

    expect(genAPI.submitGeneration).toHaveBeenCalledTimes(1)
    expect(batchResult).toMatchObject({ ok: true, outcome: 'completed' })
  })
})
