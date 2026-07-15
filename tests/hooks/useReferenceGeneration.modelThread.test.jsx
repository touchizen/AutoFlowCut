/**
 * useReferenceGeneration — API-mode model threading + history engine label (#R32-2, #R32-3).
 *
 * #R32-2: single/batch ref generation must pass settings.imageModel to generateImage/submitGeneration,
 *   else useGenAPI falls back to DEFAULT_IMAGE_MODEL_ID and a non-default BYOK model is ignored.
 * #R32-3: saved reference history must label the engine by actual mode (API → model id, not 'flow').
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'

vi.mock('../../src/utils/guards', () => ({
  checkAuthToken: vi.fn().mockResolvedValue(true),
  checkFolderPermission: vi.fn().mockResolvedValue({ ok: true }),
  checkFlowProjectReady: vi.fn().mockReturnValue({ ok: true }),
}))
const saveReference = vi.fn().mockResolvedValue({ success: true, path: '/p/ref.png', dataUrl: 'd' })
vi.mock('../../src/hooks/useFileSystem', () => ({
  fileSystemAPI: {
    ensurePermission: vi.fn().mockResolvedValue({ hasPermission: true, name: 'test' }),
    saveReference: (...a) => saveReference(...a),
    saveExtraToHistory: vi.fn().mockResolvedValue({ success: true }),
  },
}))
vi.mock('../../src/components/Toast', () => ({ toast: { info: vi.fn(), warning: vi.fn(), error: vi.fn(), success: vi.fn() } }))
vi.mock('../../src/utils/imageProcessing', () => ({ tryUpscaleImage: vi.fn(), extractThumbnailBase64: vi.fn().mockResolvedValue('thumb') }))
vi.mock('../../src/utils/urls', () => ({ cleanBase64: vi.fn((s) => s), toDataURL: vi.fn((s) => s) }))

import { useReferenceGeneration } from '../../src/hooks/useReferenceGeneration'

function makeHook(mode, refOverrides = {}) {
  const genAPI = {
    getAccessToken: vi.fn().mockResolvedValue('token'),
    mode,
    generateImage: vi.fn().mockResolvedValue({ success: true, images: [{ base64: 'data:image/png;base64,X', mediaId: 'm' }] }),
    clearTokenCache: vi.fn(),
  }
  const { result } = renderHook(() => useReferenceGeneration({
    settings: { saveMode: 'folder', projectName: 'proj', imageBatchCount: 1, imageModel: 'gemini-3-custom', aspectRatio: '16:9' },
    references: [{ id: 1, prompt: 'a hero', type: 'character', status: 'pending', ...refOverrides }],
    setReferences: vi.fn(), genAPI,
    addPendingSave: vi.fn(), openSettings: vi.fn(), t: (k) => k, generationQueue: null,
  }))
  return { result, genAPI }
}

beforeEach(() => { vi.clearAllMocks(); saveReference.mockResolvedValue({ success: true, path: '/p/ref.png', dataUrl: 'd' }) })

describe('useReferenceGeneration — model threading + engine label', () => {
  it('#R32-2: single-ref generation passes settings.imageModel to generateImage', async () => {
    const { result, genAPI } = makeHook('api')
    await act(async () => { await result.current.handleGenerateRef(0) })
    expect(genAPI.generateImage).toHaveBeenCalledWith(
      expect.any(String), expect.anything(),
      expect.objectContaining({ model: 'gemini-3-custom' })
    )
  })

  it('Flow character 재생성은 기존 entityId/workflowId 를 engine 에 전달한다', async () => {
    const { result, genAPI } = makeHook('flow', { entityId: 'e-existing', workflowId: 'w-old' })
    await act(async () => { await result.current.handleGenerateRef(0) })
    expect(genAPI.generateImage).toHaveBeenCalledWith(
      expect.any(String), expect.anything(),
      expect.objectContaining({ ref: expect.objectContaining({ entityId: 'e-existing', workflowId: 'w-old' }) })
    )
  })

  it('#R32-3: API-mode ref history labels engine by model (not "flow")', async () => {
    const { result } = makeHook('api')
    await act(async () => { await result.current.handleGenerateRef(0) })
    // saveReference(projectName, refName, imageData, engineLabel, metadata)
    const call = saveReference.mock.calls[0]
    expect(call[3]).toBe('gemini-3-custom')      // engine label = model in API mode
    expect(call[4]).toMatchObject({ model: 'gemini-3-custom' })
  })

  it('#R32-3: Flow-mode ref history still labels engine "flow"', async () => {
    const { result } = makeHook('flow')
    await act(async () => { await result.current.handleGenerateRef(0) })
    expect(saveReference.mock.calls[0][3]).toBe('flow')
  })
})
