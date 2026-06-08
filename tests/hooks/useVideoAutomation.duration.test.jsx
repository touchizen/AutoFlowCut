/**
 * useVideoAutomation — 씬 길이 자동 duration + resolution 이 제출까지 전달되는지(회귀).
 *
 * 회귀: start() 내부에서 items 재구성 시 targetDuration 미복사 / 제출 options 에
 * videoResolution 누락으로, 자동 길이와 해상도가 generateVideoT2V 까지 도달하지 못하고
 * 기본값으로 떨어졌다. 제출 호출 인자를 직접 검증한다.
 */
import { renderHook, act } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import { useVideoAutomation } from '../../src/hooks/useVideoAutomation'
import { __resetQuotaStopForTests } from '../../src/utils/quotaStop'

vi.mock('../../src/hooks/useFileSystem', () => ({
  fileSystemAPI: { checkPermission: vi.fn().mockResolvedValue({ success: true }) },
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
})
afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

function makeHook() {
  const generateVideoT2V = vi.fn().mockResolvedValue({ success: true, generationId: 'gen-1' })
  // pending 유지 → 제출만 확인하고 stop 으로 종료
  const checkVideoStatus = vi.fn().mockResolvedValue({
    success: true, statuses: [{ generationId: 'gen-1', status: 'pending' }],
  })
  const genAPI = {
    generateVideoT2V,
    generateVideoI2V: vi.fn(),
    checkVideoStatus,
    downloadVideo: vi.fn(),
    upscaleVideo: vi.fn(),
    getAccessToken: vi.fn().mockResolvedValue('token'),
  }
  const hook = renderHook(() => useVideoAutomation(genAPI, (k) => k, null))
  return { hook, generateVideoT2V }
}

async function runT2V(hook, sceneOverrides, startOverrides) {
  let startPromise
  await act(async () => {
    startPromise = hook.result.current.start({
      mode: 't2v',
      scenes: [{ id: 'vscene_v1', prompt: 'p', ...sceneOverrides }],
      projectName: 'test', saveMode: 'memory',
      videoModel: 'veo-3.1-fast-generate-preview', aspectRatio: '16:9',
      duration: 8, seed: null, ...startOverrides,
    })
  })
  // 제출 + 첫 폴링까지 진행
  await act(async () => { await vi.advanceTimersByTimeAsync(20 * 1000) })
  // 정리: 폴링 중단
  await act(async () => { hook.result.current.stop() })
  await act(async () => { await vi.advanceTimersByTimeAsync(30 * 1000) })
  await startPromise
}

describe('useVideoAutomation — 자동 duration + resolution 제출 전달', () => {
  // generateVideoT2V(prompt, model, aspectRatio, duration, seed, resolution)
  it('720p + 씬 길이 5s → duration 6 으로 스냅, resolution 전달', async () => {
    const { hook, generateVideoT2V } = makeHook()
    await runT2V(hook, { targetDuration: 5 }, { videoResolution: '720p' })

    expect(generateVideoT2V).toHaveBeenCalledTimes(1)
    const args = generateVideoT2V.mock.calls[0]
    expect(args[3]).toBe(6)        // 5 → {4,6,8} 스냅 = 6
    expect(args[5]).toBe('720p')   // [P1] resolution 가 제출까지 도달
  })

  it('1080p 면 씬 길이 4s 라도 duration 8 강제 + resolution 전달', async () => {
    const { hook, generateVideoT2V } = makeHook()
    await runT2V(hook, { targetDuration: 4 }, { videoResolution: '1080p' })

    const args = generateVideoT2V.mock.calls[0]
    expect(args[3]).toBe(8)        // 1080p → 8 강제
    expect(args[5]).toBe('1080p')
  })

  it('targetDuration 없으면 batch duration(8) 사용', async () => {
    const { hook, generateVideoT2V } = makeHook()
    await runT2V(hook, {}, { videoResolution: '720p', duration: 8 })

    expect(generateVideoT2V.mock.calls[0][3]).toBe(8)
  })

  it('referenceImages 가 있으면 720p + 씬 길이 4s 도 duration 8 강제 + refs 전달', async () => {
    const { hook, generateVideoT2V } = makeHook()
    const referenceImages = [{ name: 'hero', data: 'data:image/png;base64,REF' }]
    await runT2V(hook, { targetDuration: 4, referenceImages }, { videoResolution: '720p' })

    const args = generateVideoT2V.mock.calls[0]
    expect(args[3]).toBe(8)
    expect(args[6]).toEqual(referenceImages)
  })

  // 회귀(리뷰 P2): 해상도 강등은 start() 에서 한 번 일어나야 duration/메타/생성이 일관.
  // generateVideoT2V 가 mock 이라 내부 coerce 가 없으므로, 인자가 coerced 면 upstream 강등 증명.
  it('Veo Lite + 4k 는 start 에서 1080p 로 강등돼 제출까지 일관', async () => {
    const { hook, generateVideoT2V } = makeHook()
    await runT2V(hook, { targetDuration: 4 }, {
      videoModel: 'veo-3.1-lite-generate-preview', videoResolution: '4k',
    })
    const args = generateVideoT2V.mock.calls[0]
    expect(args[5]).toBe('1080p')  // 원본 '4k' 가 아니라 강등값 도달
    expect(args[3]).toBe(8)        // 1080p → 8 강제 (duration 도 강등값 기준)
  })

  it('known set 밖 해상도(stale)는 무단 상향 없이 undefined 로 제출', async () => {
    const { hook, generateVideoT2V } = makeHook()
    await runT2V(hook, { targetDuration: 5 }, {
      videoModel: 'veo-3.1-fast-generate-preview', videoResolution: '2k',
    })
    const args = generateVideoT2V.mock.calls[0]
    expect(args[5]).toBeUndefined()  // '2k' 가 '4k' 로 올라가지 않음
    expect(args[3]).toBe(6)          // resolution 미지 → 씬 길이 5 스냅 = 6 (8 강제 아님)
  })

  it('stale Vertex Veo 3.1 모델 id 는 제출/상태 메타 모두 preview id 로 정규화', async () => {
    const { hook, generateVideoT2V } = makeHook()
    const onItemUpdate = vi.fn()
    await runT2V(hook, { targetDuration: 4 }, {
      videoModel: 'veo-3.1-fast-generate-001',
      videoResolution: '720p',
      onItemUpdate,
    })

    expect(generateVideoT2V.mock.calls[0][1]).toBe('veo-3.1-fast-generate-preview')
    expect(onItemUpdate).toHaveBeenCalledWith(
      'vscene_v1',
      'generating',
      expect.objectContaining({ model: 'veo-3.1-fast-generate-preview' })
    )
  })
})
