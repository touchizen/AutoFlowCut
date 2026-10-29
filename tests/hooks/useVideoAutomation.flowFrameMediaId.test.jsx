/**
 * useVideoAutomation — Flow I2V: 아카이브 복원 프레임은 Flow mediaId 우선 (R22-1).
 *
 * 회귀: 아카이브에서 복원한 씬은 scene.image 에 archive CDN URL 이 들어있고(base64 아님),
 * Flow I2V 가 그 URL 을 base64 로 인식하지 못해 잘못된 mediaId 로 제출했다. Flow 모드에서
 * 씬 기반 프레임은 item.startMediaId/endMediaId(실제 Flow mediaId)를 우선해 제출해야 한다.
 * API(cloud Veo) 모드는 inline base64 가 필요하므로 이 우회는 Flow 모드 한정(회귀 방지).
 */
import { renderHook, act } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import { useVideoAutomation } from '../../src/hooks/useVideoAutomation'
import { __resetQuotaStopForTests } from '../../src/utils/quotaStop'

const readImageMock = vi.fn()
const readResourceMock = vi.fn()
const readFileByPathMock = vi.fn()
vi.mock('../../src/hooks/useFileSystem', () => ({
  fileSystemAPI: {
    checkPermission: vi.fn().mockResolvedValue({ success: true }),
    readImage: (...a) => readImageMock(...a),
    readResource: (...a) => readResourceMock(...a),
    readFileByPath: (...a) => readFileByPathMock(...a),
  },
}))
vi.mock('../../src/components/Toast', () => ({
  toast: { error: vi.fn(), info: vi.fn(), success: vi.fn(), warning: vi.fn() },
}))
vi.mock('../../src/services/videoRecovery', () => ({ retryVideoDownload: vi.fn() }))
vi.mock('../../src/utils/videoMetadata', () => ({
  pickVideoMetadata: vi.fn(() => ({})),
  buildVideoMetaPatch: vi.fn(() => ({})),
}))

beforeEach(() => {
  __resetQuotaStopForTests()
  vi.useFakeTimers()
  vi.spyOn(Math, 'random').mockReturnValue(0)
  readImageMock.mockReset().mockResolvedValue({ success: false })
  readResourceMock.mockReset().mockResolvedValue({ success: false })
  readFileByPathMock.mockReset().mockResolvedValue({ success: false })
})
afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

function makeHook(appMode) {
  const generateVideoI2V = vi.fn().mockResolvedValue({ success: true, generationId: 'gen-1' })
  const checkVideoStatus = vi.fn().mockResolvedValue({
    success: true, statuses: [{ generationId: 'gen-1', status: 'pending' }],
  })
  const genAPI = {
    generateVideoT2V: vi.fn(),
    generateVideoI2V,
    checkVideoStatus,
    downloadVideo: vi.fn(),
    upscaleVideo: vi.fn(),
    getAccessToken: vi.fn().mockResolvedValue('token'),
  }
  const hook = renderHook(() => useVideoAutomation(genAPI, (k) => k, null, null, appMode, true))
  return { hook, generateVideoI2V }
}

async function runI2V(hook, framePairOverrides) {
  let startPromise
  await act(async () => {
    startPromise = hook.result.current.start({
      mode: 'i2v',
      framePairs: [{
        id: 'fp_1',
        prompt: 'p',
        startSceneId: 'scene_1',
        status: 'waiting',
        ...framePairOverrides,
      }],
      projectName: 'test', saveMode: 'memory',
      videoModel: 'veo-3.1-fast-generate-preview', aspectRatio: '16:9',
      duration: 8, seed: null,
    })
  })
  await act(async () => { await vi.advanceTimersByTimeAsync(20 * 1000) })
  await act(async () => { hook.result.current.stop() })
  await act(async () => { await vi.advanceTimersByTimeAsync(30 * 1000) })
  await startPromise
}

// 2026-10-30 I2V(새 Flow): main 이 시작 프레임을 **바이트**로 받아 편집기 붙여넣기로 올린다(앞 세션 애셋은 id 로 고를 수 없다) — 이미지 바이트(메모리 dataUrl·디스크)가
//   있으면 Flow mediaId 보다 먼저 쓴다. 바이트가 없을 때만(아카이브 CDN URL 등) 옛 규칙대로 mediaId(엔진이 바이트 아님으로 거부한다).
describe('useVideoAutomation — Flow I2V 시작 프레임 바이트 우선 (2026-10-30)', () => {
  it('Flow 모드: 메모리 dataUrl 이 있으면 Flow mediaId 대신 그 바이트로 제출', async () => {
    const { hook, generateVideoI2V } = makeHook('flow')
    await runI2V(hook, { _startMediaId: 'flowStart123', _startImage: 'data:image/png;base64,STARTB64' })
    expect(generateVideoI2V.mock.calls[0][1]).toBe('data:image/png;base64,STARTB64')
  })

  it('Flow 모드: 씬의 imagePath(_startImagePath)가 있으면 그 파일 — scenes/<id> 의 옛 이미지가 아니라 (Codex 2차 H1)', async () => {
    readFileByPathMock.mockImplementation(async (p) => (p === '/w/p/replaced.png' ? { success: true, data: 'data:image/png;base64,NEW' } : { success: false }))
    readImageMock.mockResolvedValue({ success: true, data: 'data:image/png;base64,OLD' })
    const { hook, generateVideoI2V } = makeHook('flow')
    await runI2V(hook, { _startMediaId: 'flowStart123', _startImage: null, _startImagePath: '/w/p/replaced.png' })
    expect(generateVideoI2V.mock.calls[0][1]).toBe('data:image/png;base64,NEW')
  })

  it('Flow 모드: 메모리 이미지가 없으면 디스크(scenes/<id>) 바이트를 mediaId 보다 먼저', async () => {
    readImageMock.mockResolvedValue({ success: true, data: 'data:image/jpeg;base64,DISKSCENE' })
    const { hook, generateVideoI2V } = makeHook('flow')
    await runI2V(hook, { _startMediaId: 'flowStart123', _startImage: null })
    expect(generateVideoI2V.mock.calls[0][1]).toBe('data:image/jpeg;base64,DISKSCENE')
  })
})

describe('useVideoAutomation — Flow I2V: 바이트가 없을 때만 mediaId (R22-1 · 새 Flow 엔진은 바이트 아님으로 거부 — engineFlow.test)', () => {
  it('Flow 모드: 씬 프레임은 archive CDN URL 대신 Flow mediaId 로 제출', async () => {
    const { hook, generateVideoI2V } = makeHook('flow')
    await runI2V(hook, {
      _startMediaId: 'flowStart123',
      _endMediaId: 'flowEnd456',
      _startImage: 'https://cdn.flow.example/archive/start.png',
      _endImage: 'https://cdn.flow.example/archive/end.png',
      endSceneId: 'scene_2',
    })

    expect(generateVideoI2V).toHaveBeenCalledTimes(1)
    const args = generateVideoI2V.mock.calls[0]
    expect(args[1]).toBe('flowStart123')   // startImage = mediaId, NOT CDN URL
    expect(args[2]).toBe('flowEnd456')     // endImage  = mediaId, NOT CDN URL
  })

  it('API 모드: mediaId 가 있어도 inline base64(이미지) 로 제출 (회귀 방지)', async () => {
    const { hook, generateVideoI2V } = makeHook('api')
    await runI2V(hook, {
      _startMediaId: 'flowStart123',
      _startImage: 'data:image/png;base64,STARTB64',
    })

    const args = generateVideoI2V.mock.calls[0]
    expect(args[1]).toBe('data:image/png;base64,STARTB64')  // base64, NOT mediaId
  })

  it('Flow 모드: 아카이브 갤러리 프레임(gallery::<flowMediaId>)도 mediaId 우선 (R23-6)', async () => {
    const { hook, generateVideoI2V } = makeHook('flow')
    await runI2V(hook, {
      startSceneId: 'gallery::flowArchive789',
      _startMediaId: 'flowArchive789',
      _startImage: 'https://cdn.flow.example/archive/g.png',  // 아카이브는 CDN URL
    })

    const args = generateVideoI2V.mock.calls[0]
    expect(args[1]).toBe('flowArchive789')  // 실제 Flow mediaId 우선 (CDN URL 아님)
  })

  it('Flow 모드: 디스크 업로드(local-* id)는 dataUrl(base64) 업로드 경로 유지', async () => {
    const { hook, generateVideoI2V } = makeHook('flow')
    await runI2V(hook, {
      startSceneId: 'gallery::local-123-abc',
      _startMediaId: 'local-123-abc',
      _startImage: 'data:image/png;base64,DISKB64',
    })

    const args = generateVideoI2V.mock.calls[0]
    expect(args[1]).toBe('data:image/png;base64,DISKB64')  // local-* 는 우회 제외 → base64 업로드
  })
})
