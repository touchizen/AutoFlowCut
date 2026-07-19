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
import { buildVideoTextStartPayload } from '../../src/services/videoTextStart'
import { __resetQuotaStopForTests } from '../../src/utils/quotaStop'

vi.mock('../../src/hooks/useFileSystem', () => ({
  fileSystemAPI: { checkPermission: vi.fn().mockResolvedValue({ success: true }) },
}))
vi.mock('../../src/components/Toast', () => ({
  toast: { error: vi.fn(), info: vi.fn(), success: vi.fn(), warning: vi.fn() },
}))
vi.mock('../../src/services/videoRecovery', () => ({ retryVideoDownload: vi.fn() }))
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
  const generateVideoI2V = vi.fn().mockResolvedValue({ success: true, generationId: 'gen-1' })
  // pending 유지 → 제출만 확인하고 stop 으로 종료
  const checkVideoStatus = vi.fn().mockResolvedValue({
    success: true, statuses: [{ generationId: 'gen-1', status: 'pending' }],
  })
  const genAPI = {
    generateVideoT2V,
    generateVideoI2V,
    checkVideoStatus,
    downloadVideo: vi.fn(),
    upscaleVideo: vi.fn(),
    getAccessToken: vi.fn().mockResolvedValue('token'),
  }
  const hook = renderHook(() => useVideoAutomation(genAPI, (k) => k, null))
  return { hook, generateVideoT2V, generateVideoI2V, getAccessToken: genAPI.getAccessToken }
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

async function runI2V(hook, framePairOverrides, startOverrides) {
  let startPromise
  await act(async () => {
    startPromise = hook.result.current.start({
      mode: 'i2v',
      framePairs: [{
        id: 'fp_1',
        prompt: 'p',
        startSceneId: 'scene_1',
        _startImage: 'data:image/png;base64,REF',
        status: 'waiting',
        ...framePairOverrides,
      }],
      projectName: 'test', saveMode: 'memory',
      videoModel: 'veo-3.1-fast-generate-preview', aspectRatio: '16:9',
      duration: 8, seed: null, ...startOverrides,
    })
  })
  await act(async () => { await vi.advanceTimersByTimeAsync(20 * 1000) })
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

  it('video-text start payload keeps cleaned @mention prompt and refs through T2V submit', async () => {
    const { hook, generateVideoT2V } = makeHook()
    const heroRef = {
      id: 'ref_hero',
      name: 'hero',
      category: 'character',
      data: 'data:image/png;base64,REF',
      filePath: null,
    }
    const { startOptions, runningStyle } = buildVideoTextStartPayload({
      videoScenes: [{ id: 'vscene_v1', prompt: 'A wizard @hero walks', targetDuration: 4 }],
      references: [heroRef],
      effectiveStyleId: null,
      settings: {
        saveMode: 'memory',
        videoModelT2V: 'veo-3.1-fast-generate-preview',
        videoResolution: '720p',
        videoBatchCount: 1,
        videoConcurrency: 4,
      },
      projectName: 'test',
      styleLabel: 'None',
      warn: vi.fn(),
    })

    expect(runningStyle).toEqual({ styleId: null, label: 'None', applies: true })
    let startPromise
    await act(async () => {
      startPromise = hook.result.current.start(startOptions)
    })
    await act(async () => { await vi.advanceTimersByTimeAsync(20 * 1000) })
    await act(async () => { hook.result.current.stop() })
    await act(async () => { await vi.advanceTimersByTimeAsync(30 * 1000) })
    await startPromise

    const args = generateVideoT2V.mock.calls[0]
    expect(args[0]).toBe('A wizard hero walks')
    expect(args[3]).toBe(8)
    expect(args[6]).toEqual([
      expect.objectContaining({ name: 'hero', data: 'data:image/png;base64,REF' }),
    ])
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

  it('I2V 720p 는 framePair targetDuration 을 {4,6,8} 로 스냅해서 제출', async () => {
    const { hook, generateVideoI2V } = makeHook()
    await runI2V(hook, { targetDuration: 5 }, { videoResolution: '720p' })

    const args = generateVideoI2V.mock.calls[0]
    expect(args[5]).toBe(6)
    expect(args[7]).toBe('720p')
  })

  it('I2V 1080p 는 framePair targetDuration 이 짧아도 8초로 제출', async () => {
    const { hook, generateVideoI2V } = makeHook()
    await runI2V(hook, { targetDuration: 4 }, { videoResolution: '1080p' })

    const args = generateVideoI2V.mock.calls[0]
    expect(args[5]).toBe(8)
    expect(args[7]).toBe('1080p')
  })

  it('non-google T2V: grok model/resolution/duration과 provider를 변조 없이 제출', async () => {
    const { hook, generateVideoT2V, getAccessToken } = makeHook()
    await runT2V(hook, { targetDuration: 5 }, {
      videoProvider: 'grok',
      videoModel: 'grok-imagine-video-1.5',
      videoResolution: 'native-ultra',
    })

    const args = generateVideoT2V.mock.calls[0]
    expect(args[1]).toBe('grok-imagine-video-1.5')
    expect(args[3]).toBe(5)
    expect(args[5]).toBe('native-ultra')
    expect(args[7]).toMatchObject({ provider: 'grok' })
    expect(getAccessToken).toHaveBeenCalledWith(false, false, 'grok')
  })

  it('non-google I2V: grok model/resolution/duration과 i2v provider를 변조 없이 제출', async () => {
    const { hook, generateVideoI2V } = makeHook()
    await runI2V(hook, { targetDuration: 7 }, {
      videoProvider: 'grok',
      videoModel: 'grok-imagine-video-1.5',
      videoResolution: 'provider-native',
    })

    const args = generateVideoI2V.mock.calls[0]
    expect(args[3]).toBe('grok-imagine-video-1.5')
    expect(args[5]).toBe(7)
    expect(args[7]).toBe('provider-native')
    expect(args[8]).toMatchObject({ provider: 'grok' })
  })

  it('submit appliedInputs를 pending/project patch와 완료 duration/model에 반영', async () => {
    const generateVideoT2V = vi.fn().mockResolvedValue({
      success: true,
      generationId: 'gen-applied',
      appliedInputs: {
        model: 'veo-3.1-lite-generate-preview',
        aspectRatio: '16:9',
        durationSeconds: 8,
        resolution: '1080p',
      },
    })
    const checkVideoStatus = vi.fn().mockResolvedValue({
      success: true,
      statuses: [{ generationId: 'gen-applied', status: 'complete', mediaId: 'uri', videoUrl: 'uri' }],
    })
    const genAPI = {
      generateVideoT2V,
      generateVideoI2V: vi.fn(),
      checkVideoStatus,
      downloadVideo: vi.fn().mockResolvedValue({ success: true, base64: 'VIDEO' }),
      upscaleVideo: vi.fn(),
      getAccessToken: vi.fn().mockResolvedValue('token'),
    }
    const onItemUpdate = vi.fn()
    const hook = renderHook(() => useVideoAutomation(genAPI, (k) => k, null))

    await act(async () => {
      await hook.result.current.start({
        mode: 't2v',
        scenes: [{ id: 'vscene_v1', prompt: 'p' }],
        projectName: 'test',
        saveMode: 'memory',
        videoProvider: 'google',
        videoModel: 'veo-3.1-lite',
        aspectRatio: '16:9',
        duration: 4,
        videoResolution: '4k',
        onItemUpdate,
      })
    })

    expect(onItemUpdate).toHaveBeenCalledWith(
      'vscene_v1',
      'generating',
      expect.objectContaining({
        model: 'veo-3.1-lite-generate-preview',
        appliedInputs: {
          model: 'veo-3.1-lite-generate-preview',
          aspectRatio: '16:9',
          durationSeconds: 8,
          resolution: '1080p',
        },
      }),
    )
    expect(onItemUpdate).toHaveBeenCalledWith(
      'vscene_v1',
      'complete',
      expect.objectContaining({
        model: 'veo-3.1-lite-generate-preview',
        duration: 8,
        appliedInputs: expect.objectContaining({ resolution: '1080p' }),
      }),
    )
  })
})
