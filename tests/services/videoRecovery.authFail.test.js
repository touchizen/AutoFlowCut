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
