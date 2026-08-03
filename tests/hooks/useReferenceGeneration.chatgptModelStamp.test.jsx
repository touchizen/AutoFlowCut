/**
 * useReferenceGeneration — ChatGPT 타깃 레퍼런스 생성의 model/engineLabel 스탬프.
 *
 * ChatGPT 경로(genAPI.mode==='flow' + sessionTarget==='chatgpt')는 페이지가 모델명을
 * 노출하지 않으므로 저장 히스토리의 engineLabel/metadata.model 에 엔진 식별자
 * 'chatgpt' 를 기록한다 — 기존엔 mode==='flow' 분기에 걸려 'flow' + API 모델로 오기록.
 * Flow/API 경로는 기존 그대로(positive control, #R32-3 계약 유지).
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

const API_MODEL = 'gemini-3.1-flash-image' // "Nano Banana 2"

function makeHook(mode, route) {
  const genAPI = {
    getAccessToken: vi.fn().mockResolvedValue('token'),
    mode,
    generateImage: vi.fn().mockResolvedValue({ success: true, images: [{ base64: 'data:image/png;base64,X', mediaId: 'm' }] }),
    clearTokenCache: vi.fn(),
  }
  const { result } = renderHook(() => useReferenceGeneration({
    settings: { saveMode: 'folder', projectName: 'proj', imageBatchCount: 1, imageModel: API_MODEL, aspectRatio: '16:9' },
    references: [{ id: 1, prompt: 'a hero', type: 'scene', status: 'pending' }],
    setReferences: vi.fn(), genAPI,
    addPendingSave: vi.fn(), openSettings: vi.fn(), t: (k) => k, generationQueue: null,
    route,
  }))
  return { result, genAPI }
}

beforeEach(() => { vi.clearAllMocks(); saveReference.mockResolvedValue({ success: true, path: '/p/ref.png', dataUrl: 'd' }) })

describe('useReferenceGeneration — ChatGPT 타깃 model 스탬프', () => {
  it('ChatGPT 경로: engineLabel/metadata.model 에 "chatgpt" 기록 (flow/API 모델 아님)', async () => {
    const { result, genAPI } = makeHook('flow', { mode: 'flow', sessionTarget: 'chatgpt' })
    await act(async () => { await result.current.handleGenerateRef(0) })

    // saveReference(projectName, refName, imageData, engineLabel, metadata)
    const call = saveReference.mock.calls[0]
    expect(call[3]).toBe('chatgpt')
    expect(call[4].model).toBe('chatgpt')
    expect(call[4].model).not.toBe(API_MODEL)
    expect(genAPI.generateImage.mock.calls[0][2].model).toBe('chatgpt')
  })

  it('POSITIVE CONTROL — Flow 경로: engineLabel "flow" + metadata.model 은 기존 그대로', async () => {
    const { result, genAPI } = makeHook('flow', { mode: 'flow', sessionTarget: 'flow' })
    await act(async () => { await result.current.handleGenerateRef(0) })

    const call = saveReference.mock.calls[0]
    expect(call[3]).toBe('flow')
    expect(call[4].model).toBe(API_MODEL)
    expect(genAPI.generateImage.mock.calls[0][2].model).toBe(API_MODEL)
  })

  it('POSITIVE CONTROL — API 경로: engineLabel/metadata.model = 선택 모델 (#R32-3 유지)', async () => {
    const { result, genAPI } = makeHook('api', { mode: 'api', sessionTarget: 'flow' })
    await act(async () => { await result.current.handleGenerateRef(0) })

    const call = saveReference.mock.calls[0]
    expect(call[3]).toBe(API_MODEL)
    expect(call[4].model).toBe(API_MODEL)
    expect(genAPI.generateImage.mock.calls[0][2].model).toBe(API_MODEL)
  })
})
