/**
 * useReferenceGeneration — authFailed 결과의 저장 문구/토스트는 기계 토큰이 아니라 사람 문구 (R2-2 O1#2/O2#1)
 *
 * 씬 경로(R1#6/R2#5, useAutomation.authFailureText)와 같은 규칙: authFailed 결과에 errorKind 가 있으면(새 Flow 의
 * flow-session-missing 등 — error 는 'not-on-flow'/'wiz-missing' 같은 이유 토큰) 저장 errorMessage 와 토스트 문구는
 * authErrorMessage() 다. 단일 ref(handleGenerateRef)·배치(handleGenerateAllRefs) 둘 다.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'

const coordinatorMocks = vi.hoisted(() => ({ runFlowCharacterOperation: vi.fn(), runFlowComposerRefresh: vi.fn() }))
const toastMock = vi.hoisted(() => ({ info: vi.fn(), warning: vi.fn(), error: vi.fn(), success: vi.fn() }))

vi.mock('../../src/utils/guards', () => ({
  checkAuthToken: vi.fn().mockResolvedValue(true),
  checkFolderPermission: vi.fn().mockResolvedValue({ ok: true }),
  checkFlowProjectReady: vi.fn().mockReturnValue({ ok: true }),
}))
vi.mock('../../src/hooks/useFileSystem', () => ({
  fileSystemAPI: { ensurePermission: vi.fn().mockResolvedValue({ hasPermission: true, name: 'test' }) },
}))
vi.mock('../../src/components/Toast', () => ({ toast: toastMock }))
vi.mock('../../src/utils/imageProcessing', () => ({ tryUpscaleImage: vi.fn(), extractThumbnailBase64: vi.fn().mockResolvedValue('thumb') }))
vi.mock('../../src/utils/urls', () => ({ cleanBase64: vi.fn((v) => v), toDataURL: vi.fn((v) => v) }))
vi.mock('../../src/utils/flowCharacterCoordinator', () => ({
  runFlowCharacterOperation: coordinatorMocks.runFlowCharacterOperation,
  runFlowComposerRefresh: coordinatorMocks.runFlowComposerRefresh,
}))

import { useReferenceGeneration } from '../../src/hooks/useReferenceGeneration'

const AUTH_RESULT = { success: false, authFailed: true, errorKind: 'flow-session-missing', error: 'not-on-flow' }
// t 는 키를 돌려주되 params.error 를 붙인다 — 토스트 문구에 무엇이 들어갔는지 보인다.
const t = (k, p) => (p && p.error !== undefined ? `${k}:${p.error}` : k)
const AUTH_TEXT = 'Auth error. Please login to Flow and try again.'   // getAuthErrorMessage('flow', t) 의 폴백(t 가 키를 돌려주므로)

function setupHook({ generateImage, submitGeneration }) {
  window.electronAPI = { ...(window.electronAPI || {}), refreshFlowComposer: vi.fn().mockResolvedValue({ success: true }) }
  let liveRefs = [{ id: 'hero', type: 'character', prompt: 'hero portrait', status: 'pending' }]
  const setReferences = vi.fn((updater) => { liveRefs = typeof updater === 'function' ? updater(liveRefs) : updater })
  const genAPI = {
    mode: 'flow',
    getAccessToken: vi.fn().mockResolvedValue('flow-session'),
    flowSessionReason: vi.fn(() => null),
    clearTokenCache: vi.fn(),
    generateImage: generateImage || vi.fn(),
    submitGeneration: submitGeneration || vi.fn(),
    checkGeneration: vi.fn().mockResolvedValue({ success: true, completed: true }),
    collectGeneration: vi.fn(),
    uploadReference: vi.fn(),
    clearGenerations: vi.fn().mockResolvedValue(undefined),
  }
  const { result } = renderHook(() => useReferenceGeneration({
    settings: { saveMode: 'project', imageBatchCount: 1, concurrency: 5, imageUpscale: 'off' },
    references: liveRefs, setReferences, genAPI, addPendingSave: vi.fn(), openSettings: vi.fn(), t,
    selectedStyleRefId: null, generationQueue: null, flowProjectReady: true, flowProjectId: 'flow-project',
  }))
  return { result, genAPI, getLiveRefs: () => liveRefs, setReferences }
}

beforeEach(() => {
  vi.clearAllMocks()
  coordinatorMocks.runFlowCharacterOperation.mockImplementation(({ task }) => task())
  coordinatorMocks.runFlowComposerRefresh.mockImplementation(() => window.electronAPI?.refreshFlowComposer?.())
})
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks() })

describe('useReferenceGeneration — authFailed 결과의 문구', () => {
  it('단일 ref: {errorKind:flow-session-missing, error:not-on-flow, authFailed} → 저장 errorMessage 와 토스트가 사람 문구(기계 토큰 없음)', async () => {
    const { result, getLiveRefs } = setupHook({ generateImage: vi.fn().mockResolvedValue(AUTH_RESULT) })
    await act(async () => { await result.current.handleGenerateRef(0) })
    const ref = getLiveRefs()[0]
    expect(ref).toMatchObject({ status: 'error', errorKind: 'auth', errorMessage: AUTH_TEXT })
    expect(JSON.stringify(ref)).not.toContain('not-on-flow')
    expect(toastMock.error).toHaveBeenCalledTimes(1)
    const msg = String(toastMock.error.mock.calls[0][0])
    expect(msg).toContain(AUTH_TEXT)
    expect(msg).not.toContain('not-on-flow')
  })

  it('배치 ref: submitGeneration 의 같은 결과 → errorKind:auth + 사람 문구, 토스트에 기계 토큰 없음', async () => {
    const { result, setReferences } = setupHook({ submitGeneration: vi.fn().mockResolvedValue(AUTH_RESULT) })
    await act(async () => { await result.current.handleGenerateAllRefs() })
    const patches = setReferences.mock.calls.map(([u]) => (typeof u === 'function' ? u([{ id: 'hero', type: 'character', prompt: 'hero portrait', status: 'generating' }]) : u))
    const marked = patches.flat().find((r) => r.id === 'hero' && r.status === 'error' && r.errorKind === 'auth')
    expect(marked).toBeTruthy()
    expect(marked.errorMessage).toBe(AUTH_TEXT)
    for (const call of toastMock.error.mock.calls) expect(String(call[0])).not.toContain('not-on-flow')
    expect(toastMock.error.mock.calls.some((c) => String(c[0]).includes(AUTH_TEXT))).toBe(true)
  })

  it('authFailed 인데 errorKind 가 없는 옛 결과는 error 문구를 그대로 쓴다(회귀 없음)', async () => {
    const { result, getLiveRefs } = setupHook({ generateImage: vi.fn().mockResolvedValue({ success: false, authFailed: true, error: 'Auth expired — please re-login to Flow' }) })
    await act(async () => { await result.current.handleGenerateRef(0) })
    expect(getLiveRefs()[0]).toMatchObject({ status: 'error', errorKind: 'auth', errorMessage: 'Auth expired — please re-login to Flow' })
  })
})
