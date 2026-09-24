/**
 * useVideoAutomation — Flow 세션 이유(flowSessionReason) 가 프리플라이트 안내에 닿는가 (R1#1)
 */
import { renderHook, act } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import { useVideoAutomation } from '../../src/hooks/useVideoAutomation'
import { __resetQuotaStopForTests } from '../../src/utils/quotaStop'

vi.mock('../../src/hooks/useFileSystem', () => ({ fileSystemAPI: { checkPermission: vi.fn().mockResolvedValue({ success: true }) } }))
vi.mock('../../src/components/Toast', () => ({ toast: { error: vi.fn(), info: vi.fn(), success: vi.fn(), warning: vi.fn() } }))
vi.mock('../../src/services/videoRecovery', () => ({ retryVideoDownload: vi.fn() }))
vi.mock('../../src/utils/videoMetadata', () => ({ pickVideoMetadata: vi.fn(() => ({})), buildVideoMetaPatch: vi.fn(() => ({})) }))

beforeEach(() => { __resetQuotaStopForTests(); vi.useFakeTimers() })
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks() })

function run(reason) {
  const genAPI = {
    generateVideoT2V: vi.fn(), generateVideoI2V: vi.fn(), checkVideoStatus: vi.fn(), upscaleVideo: vi.fn(), fetchMedia: vi.fn(),
    getAccessToken: vi.fn().mockResolvedValue(null),
    flowSessionReason: vi.fn(() => reason),
  }
  const hook = renderHook(() => useVideoAutomation(genAPI, (k) => k, null, null, 'flow'))
  return { hook, genAPI }
}

describe('useVideoAutomation — 세션 미준비 안내에 이유를 넣는다', () => {
  it('rpc:http:500 → 세션 확인 실패 안내(이유 포함), 제출 없음', async () => {
    const { hook, genAPI } = run('rpc:http:500')
    await act(async () => { await hook.result.current.start({ mode: 't2v', scenes: [{ id: 'v1', prompt: 'p' }], projectName: 'p', saveMode: 'folder' }) })
    expect(genAPI.generateVideoT2V).not.toHaveBeenCalled()
    expect(hook.result.current.status).toBe('error')
    expect(hook.result.current.statusMessage).toContain('rpc:http:500')
    expect(hook.result.current.statusMessage).not.toContain('Flow login required')
  })

  it('wiz-missing → 로그인 안내', async () => {
    const { hook } = run('wiz-missing')
    await act(async () => { await hook.result.current.start({ mode: 't2v', scenes: [{ id: 'v1', prompt: 'p' }], projectName: 'p', saveMode: 'folder' }) })
    expect(hook.result.current.statusMessage).toMatch(/Flow login required|toast\.flowLoginRequired/)
  })
})
