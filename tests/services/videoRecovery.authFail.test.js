/**
 * videoRecovery — Flow auth-failure propagation (#R24-3).
 *
 * engineFlow.checkVideoStatus surfaces dead auth as { success:true, statuses:[], authFailed:true }.
 * Both recovery paths must treat this as auth failure (fire flow-login-expired, mark/stop),
 * NOT as a successful-empty or a generic "Generation expired".
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('../../src/hooks/useFileSystem', () => ({
  fileSystemAPI: { saveVideo: vi.fn() },
}))

import { recoverInFlightVideos, retryVideoDownload } from '../../src/services/videoRecovery'

let authEvents
const onAuthExpired = () => authEvents.push(1)

beforeEach(() => {
  authEvents = []
  window.addEventListener('flow-login-expired', onAuthExpired)
})
afterEach(() => {
  window.removeEventListener('flow-login-expired', onAuthExpired)
  vi.useRealTimers()
  vi.clearAllMocks()
})

describe('recoverInFlightVideos — authFailed (#R24-3)', () => {
  it('stops recovery + fires flow-login-expired, does not leave candidates as a silent success', async () => {
    const checkVideoStatus = vi.fn().mockResolvedValue({ success: true, statuses: [], authFailed: true, error: '401' })
    const onFramePairUpdate = vi.fn()

    const res = await recoverInFlightVideos({
      framePairs: [{ id: 'fp_1', generationId: 'g1', status: 'generating' }],
      projectName: 'p',
      checkVideoStatus,
      downloadVideo: vi.fn(),
      onFramePairUpdate,
    })

    expect(authEvents.length).toBeGreaterThanOrEqual(1)
    // no candidate was "recovered" and we did not mis-mark anything complete
    expect(res.recovered).toBe(0)
    const completeCalls = onFramePairUpdate.mock.calls.filter(([, patch]) => patch?.status === 'complete')
    expect(completeCalls.length).toBe(0)
  })
})

describe('recoverInFlightVideos — cross-engine guard (#R34-1)', () => {
  const FLOW_UUID = '12345678-1234-1234-1234-123456789abc'
  const API_OP = 'models/veo-3.1-fast-generate-preview/operations/abc123'

  it('API mode skips Flow-UUID generationIds (no poll, no error-mark → not orphaned)', async () => {
    const checkVideoStatus = vi.fn().mockResolvedValue({ success: true, statuses: [{ status: 'failed' }] })
    const onFramePairUpdate = vi.fn()
    const res = await recoverInFlightVideos({
      framePairs: [{ id: 'fp_1', generationId: FLOW_UUID, status: 'generating' }],
      projectName: 'p', mode: 'api', checkVideoStatus, downloadVideo: vi.fn(), onFramePairUpdate,
    })
    expect(checkVideoStatus).not.toHaveBeenCalled()   // not polled via the wrong engine
    expect(res.total).toBe(0)                          // not a candidate
    expect(onFramePairUpdate).not.toHaveBeenCalled()   // not marked error
  })

  it('Flow mode skips API-operationName generationIds', async () => {
    const checkVideoStatus = vi.fn().mockResolvedValue({ success: true, statuses: [{ status: 'failed' }] })
    const onFramePairUpdate = vi.fn()
    const res = await recoverInFlightVideos({
      framePairs: [{ id: 'fp_1', generationId: API_OP, status: 'generating' }],
      projectName: 'p', mode: 'flow', checkVideoStatus, downloadVideo: vi.fn(), onFramePairUpdate,
    })
    expect(checkVideoStatus).not.toHaveBeenCalled()
    expect(res.total).toBe(0)
  })

  it('API mode DOES poll matching API-operationName generationIds', async () => {
    const checkVideoStatus = vi.fn().mockResolvedValue({ success: true, statuses: [{ status: 'pending' }] })
    await recoverInFlightVideos({
      framePairs: [{ id: 'fp_1', generationId: API_OP, status: 'generating' }],
      projectName: 'p', mode: 'api', checkVideoStatus, downloadVideo: vi.fn(), onFramePairUpdate: vi.fn(),
    })
    expect(checkVideoStatus).toHaveBeenCalled()
  })

  it('pending 작업 재점화 patch에 framePair 경과 시간 기준을 넣는다', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-23T00:00:00Z'))
    const onFramePairUpdate = vi.fn()

    await recoverInFlightVideos({
      framePairs: [{ id: 'fp_1', generationId: API_OP, status: 'pending' }],
      projectName: 'p',
      mode: 'api',
      checkVideoStatus: vi.fn().mockResolvedValue({ success: true, statuses: [{ status: 'pending' }] }),
      downloadVideo: vi.fn(),
      onFramePairUpdate,
    })

    expect(onFramePairUpdate).toHaveBeenCalledWith('fp_1', {
      status: 'generating',
      generatingStartedAt: Date.now(),
    })
  })

  it('legacy: mode undefined → no engine filtering (back-compat)', async () => {
    const checkVideoStatus = vi.fn().mockResolvedValue({ success: true, statuses: [{ status: 'pending' }] })
    await recoverInFlightVideos({
      framePairs: [{ id: 'fp_1', generationId: FLOW_UUID, status: 'generating' }],
      projectName: 'p', checkVideoStatus, downloadVideo: vi.fn(), onFramePairUpdate: vi.fn(),
    })
    expect(checkVideoStatus).toHaveBeenCalled()
  })
})

describe('retryVideoDownload — authFailed (#R24-3)', () => {
  // M2-R3 H5(A5/B3): kind 를 동반한 authFailed(main 의 flow-session-missing 게이트 격상·읽기 RPC 401/16 → flow-rpc-error)의 error 는 기계 토큰이다 — 그대로 항목에 쓰면
  //   resolveDisplayError(errorKind:'auth' → error 그대로) 가 표에 raw 토큰을 그린다. 훅의 authFailureText 와 같은 규칙: kind 동반이면 인증 안내 문구(호출자가
  //   authErrorText 로 준 문자열/함수, 없으면 기본 문구), kind 없는 옛 결과는 error 그대로. 결과에도 errorKind:'auth' 를 실어 훅이 같은 규칙으로 상태 문구를 만든다.
  const AUTH_TEXT = 'Auth error. Please login to Flow and try again.'
  it.each([
    ['문자열', AUTH_TEXT],
    ['함수', () => AUTH_TEXT],
  ])('kind 동반 authFailed(flow-session-missing) + authErrorText(%s) → 패치·결과의 error 는 인증 문구, errorKind:auth, raw 토큰 없음', async (_l, authErrorText) => {
    const onUpdate = vi.fn()
    const genAPI = {
      checkVideoStatus: vi.fn().mockResolvedValue({ success: false, authFailed: true, errorKind: 'flow-session-missing', error: 'flow-session-missing' }),
      downloadVideo: vi.fn(),
    }
    const res = await retryVideoDownload({ item: { id: 'vscene_1', generationId: 'g1', mediaId: 'g1' }, genAPI, onUpdate, projectName: 'p', authErrorText })
    expect(res).toEqual({ success: false, error: AUTH_TEXT, authFailed: true, errorKind: 'auth' })
    expect(genAPI.downloadVideo).not.toHaveBeenCalled()
    const [, status, patch] = onUpdate.mock.calls.at(-1)
    expect(status).toBe('error')
    expect(patch).toMatchObject({ error: AUTH_TEXT, errorKind: 'auth' })
    expect(JSON.stringify([res, patch])).not.toMatch(/flow-session-missing|flow-rpc-error|wiz-missing/)
  })

  it('kind 동반 authFailed 인데 authErrorText 가 없으면 기본 인증 문구 — raw 토큰은 절대 아니다', async () => {
    const onUpdate = vi.fn()
    const genAPI = { checkVideoStatus: vi.fn().mockResolvedValue({ success: false, authFailed: true, errorKind: 'flow-rpc-error', error: 'flow-rpc-error', rpcStatus: 401 }), downloadVideo: vi.fn() }
    const res = await retryVideoDownload({ item: { id: 'vscene_1', generationId: 'g1', mediaId: 'g1' }, genAPI, onUpdate, projectName: 'p' })
    expect(res).toMatchObject({ success: false, authFailed: true, errorKind: 'auth', error: 'Auth expired — please re-login to Flow' })
    const [, , patch] = onUpdate.mock.calls.at(-1)
    expect(patch).toMatchObject({ error: 'Auth expired — please re-login to Flow', errorKind: 'auth' })
    expect(JSON.stringify([res, patch])).not.toContain('flow-rpc-error')
  })

  it('kind 없는 옛 authFailed 결과는 error 그대로이고 결과에 errorKind 가 없다(회귀 없음)', async () => {
    const onUpdate = vi.fn()
    const genAPI = { checkVideoStatus: vi.fn().mockResolvedValue({ success: true, statuses: [], authFailed: true, error: 'Auth expired — please re-login to Flow' }), downloadVideo: vi.fn() }
    const res = await retryVideoDownload({ item: { id: 'vscene_1', generationId: 'g1', mediaId: 'g1' }, genAPI, onUpdate, projectName: 'p', authErrorText: AUTH_TEXT })
    expect(res).toEqual({ success: false, error: 'Auth expired — please re-login to Flow', authFailed: true })
    expect(onUpdate.mock.calls.at(-1)[2]).toMatchObject({ error: 'Auth expired — please re-login to Flow', errorKind: 'auth' })
  })

  it('reports auth error (not "Generation expired") + fires flow-login-expired', async () => {
    const onUpdate = vi.fn()
    const genAPI = {
      checkVideoStatus: vi.fn().mockResolvedValue({ success: true, statuses: [], authFailed: true, error: '401 Unauthorized' }),
      downloadVideo: vi.fn(),
    }

    const res = await retryVideoDownload({
      item: { id: 'fp_1', generationId: 'g1', mediaId: 'm1' },
      genAPI,
      onUpdate,
      projectName: 'p',
    })

    expect(res.success).toBe(false)
    expect(res.authFailed).toBe(true)
    expect(authEvents.length).toBeGreaterThanOrEqual(1)
    // must NOT download nor claim "Generation expired"
    expect(genAPI.downloadVideo).not.toHaveBeenCalled()
    const errCalls = onUpdate.mock.calls.filter(([, status]) => status === 'error')
    expect(errCalls.length).toBeGreaterThanOrEqual(1)
    const [, , patch] = errCalls[errCalls.length - 1]
    expect(patch.errorKind).toBe('auth')
    // must NOT report the wrong "Generation expired — please regenerate" path
    expect(patch.error).not.toMatch(/generation expired/i)
  })
})
