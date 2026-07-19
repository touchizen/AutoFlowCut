/**
 * useAutomation — integration tests (fake-timer-based)
 *
 * Exercises the real useAutomation algorithm against mocked GenAI IPC.
 * (reCAPTCHA 통합 테스트는 Flow 전용이라 API 전환 시 제거됨 — 관련 모듈도 삭제.)
 */

import { renderHook, act } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import { useAutomation } from '../../src/hooks/useAutomation'

// ─── Module mocks ──────────────────────────────────────────────────────────────

vi.mock('../../src/hooks/useFileSystem', () => ({
  fileSystemAPI: {
    checkPermission: vi.fn().mockResolvedValue({ success: true }),
    readFileByPath: vi.fn().mockRejectedValue(new Error('should not be called in integration tests')),
  },
}))


vi.mock('../../src/components/Toast', () => ({
  toast: {
    error: vi.fn(),
    warning: vi.fn(),
    success: vi.fn(),
  },
}))

vi.mock('../../src/services/styleService', () => ({
  presetTagForStyleId: vi.fn(() => null),
  resolveSceneStyle: vi.fn((prompt) => ({
    styledPrompt: prompt || 'p',
    appliedStyle: null,
  })),
}))

vi.mock('../../src/services/imageFinalize', () => ({
  processAsyncSceneResult: vi.fn().mockResolvedValue(true),
}))

vi.mock('../../src/utils/sceneFilters', () => ({
  filterPendingScenes: vi.fn((scenes) => scenes),
}))

// ─── Setup helper ──────────────────────────────────────────────────────────────

function setupHook(overrides = {}) {
  const submitGeneration = vi.fn().mockResolvedValue({ success: true, generationId: 'gen-1' })
  const checkGeneration = vi.fn().mockResolvedValue({ completed: false })
  const collectGeneration = vi.fn().mockResolvedValue({
    success: true,
    images: [{ id: 'img-1', mediaId: 'm-1' }],
  })
  const clearGenerations = vi.fn().mockResolvedValue(undefined)
  const uploadReference = vi.fn()
  const getAccessToken = vi.fn().mockResolvedValue('fake-token')
  const updateScene = vi.fn()
  const getMatchingReferences = vi.fn(() => [])

  const genAPI = {
    submitGeneration,
    checkGeneration,
    collectGeneration,
    clearGenerations,
    uploadReference,
    getAccessToken,
    ...(overrides.genAPI || {}),
  }

  const scenes = overrides.scenes || [
    { id: 's1', prompt: 'a', status: 'pending' },
    { id: 's2', prompt: 'b', status: 'pending' },
  ]

  const scenesHook = {
    scenes,
    references: [],
    updateScene,
    getMatchingReferences,
    ...(overrides.scenesHook || {}),
  }

  const t = overrides.t || ((k) => k)
  const mode = overrides.mode || 'api'

  const hook = renderHook(() =>
    useAutomation(genAPI, scenesHook, null, null, null, t, null, null, null, mode)
  )

  return {
    hook,
    genAPI,
    scenesHook,
    updateScene,
    submitGeneration,
    checkGeneration,
    collectGeneration,
  }
}

// ─── Timer setup ───────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.useFakeTimers()
  // Pin Math.random to 0 to eliminate inter-scene wait variance (20_000ms).
  vi.spyOn(Math, 'random').mockReturnValue(0)
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

// ─── Tests ─────────────────────────────────────────────────────────────────────

describe('useAutomation — batch reference contract (API mode name-based)', () => {
  // 회귀: API 모드는 mediaId 대신 name 으로 레퍼런스 base64 를 해석한다(uploadReference 가
  // mediaId:null 반환). 배치 경로가 r.mediaId 로만 필터링하면 name-only 레퍼런스가 전부
  // 탈락해 캐릭터/스타일 일관성이 깨진다. 단일 씬 경로와 동일하게 mediaId||name 으로 선택하고
  // name 을 보존해야 한다.
  it('name-only 레퍼런스(mediaId 없음)를 submitGeneration 에 name 포함해 전달', async () => {
    const { hook, submitGeneration, checkGeneration, collectGeneration } = setupHook({
      scenes: [{ id: 's1', prompt: 'a', status: 'pending' }],
      scenesHook: {
        getMatchingReferences: vi.fn(() => [
          { category: 'character', name: 'hero', mediaId: null, caption: 'main' },
        ]),
      },
    })

    submitGeneration.mockResolvedValue({ success: true, generationId: 'gen-1' })
    checkGeneration.mockResolvedValue({ completed: true })
    collectGeneration.mockResolvedValue({ success: true, images: [{ id: 'img-1', mediaId: 'm-1' }] })

    let startPromise
    await act(async () => {
      startPromise = hook.result.current.start({ projectName: 'p', saveMode: 'memory' })
    })
    await act(async () => { await vi.advanceTimersByTimeAsync(60 * 1000) })
    await startPromise

    expect(submitGeneration).toHaveBeenCalled()
    const matchedRefs = submitGeneration.mock.calls[0][1]
    // R37 review fix: data/filePath 도 보존 (memory-only ref 회귀 차단)
    expect(matchedRefs).toEqual([
      { category: 'character', mediaId: null, caption: 'main', name: 'hero', data: null, filePath: null },
    ])
  })

  // 회귀: 설정의 imageModel(T2I 선택 모델)이 배치 제출 옵션까지 전달돼야 generateImage →
  // genai 호출이 선택 모델을 쓰고, 결과 model 이 item.model 로 기록된다(ResultsTable 모델 컬럼).
  it('start({imageModel}) 을 submitGeneration 옵션으로 전달', async () => {
    const { hook, submitGeneration, checkGeneration, collectGeneration } = setupHook({
      scenes: [{ id: 's1', prompt: 'a', status: 'pending' }],
    })
    submitGeneration.mockResolvedValue({ success: true, generationId: 'gen-1' })
    checkGeneration.mockResolvedValue({ completed: true })
    collectGeneration.mockResolvedValue({ success: true, images: [{ id: 'img-1', mediaId: 'm-1' }] })

    let startPromise
    await act(async () => {
      startPromise = hook.result.current.start({ projectName: 'p', saveMode: 'memory', imageModel: 'gemini-3.1-flash-image' })
    })
    await act(async () => { await vi.advanceTimersByTimeAsync(60 * 1000) })
    await startPromise

    const submitOptions = submitGeneration.mock.calls[0][2]
    // M4 T7: imageModel → model (engineApi 정규화 후 genAPI로 전달되는 키)
    expect(submitOptions.model).toBe('gemini-3.1-flash-image')
  })
})

describe('useAutomation — force regenerate status reset ordering', () => {
  // 회귀: force 리셋이 토큰 확인보다 먼저 실행되면, 로그인 만료 상태에서 "전체 재생성"을
  // 눌렀을 때 done 씬이 pending 으로 리셋된 채 생성은 시작도 못 하고 abort →
  // pending+image = "이미지는 있는데 미완료" 상태로 저장된다. 리셋은 확인 통과 후에 해야 한다.
  it('force=true: does not reset scene status when the auth token check fails', async () => {
    const { hook, updateScene } = setupHook({
      genAPI: { getAccessToken: vi.fn().mockResolvedValue(null) },
      scenes: [
        { id: 's1', prompt: 'a', status: 'done', image: 'data:old-1' },
        { id: 's2', prompt: 'b', status: 'done', image: 'data:old-2' },
      ],
    })

    await act(async () => {
      await hook.result.current.start({ projectName: 'X', saveMode: 'folder', force: true })
    })

    // 토큰이 없어 생성이 시작도 못 했으므로 done 씬을 pending 으로 되돌리면 안 된다.
    const resetToPending = updateScene.mock.calls.filter(
      ([, patch]) => patch && patch.status === 'pending'
    )
    expect(resetToPending).toEqual([])
  })

  it('flow mode no-token preflight shows Flow login guidance, not API-key guidance', async () => {
    const { hook, submitGeneration } = setupHook({
      mode: 'flow',
      genAPI: { getAccessToken: vi.fn().mockResolvedValue(null) },
      t: (k) => ({
        'toast.flowLoginRequired': 'Flow 창에서 로그인해주세요.',
        'status.loginRequired': 'API 키가 필요합니다.',
        'status.checkingAuth': '인증 확인 중',
      }[k] || k),
      scenes: [{ id: 's1', prompt: 'a', status: 'pending' }],
    })

    await act(async () => {
      await hook.result.current.start({ projectName: 'X', saveMode: 'memory' })
    })

    expect(submitGeneration).not.toHaveBeenCalled()
    expect(hook.result.current.status).toBe('error')
    expect(hook.result.current.statusMessage).toContain('Flow 창에서 로그인해주세요.')
    expect(hook.result.current.statusMessage).not.toContain('API 키')
  })

  it('force=true: does not reset scene status when Stop is pressed during pre-flight', async () => {
    // checkPermission / getAccessToken / reference upload 대기 중 Stop 을 누르면
    // 실제 씬 제출은 안 되는데 force reset 만 실행될 수 있다 — !stopRequestedRef 가드 확인.
    let triggerStop
    const { hook, updateScene } = setupHook({
      genAPI: {
        getAccessToken: vi.fn().mockImplementation(async () => {
          triggerStop()           // 토큰 확인 await 중 사용자가 Stop 누른 상황 모사
          return 'fake-token'
        }),
      },
      scenes: [
        { id: 's1', prompt: 'a', status: 'done', image: 'data:old-1' },
        { id: 's2', prompt: 'b', status: 'done', image: 'data:old-2' },
      ],
    })
    triggerStop = () => hook.result.current.stop()

    await act(async () => {
      await hook.result.current.start({ projectName: 'X', saveMode: 'folder', force: true })
    })

    const resetToPending = updateScene.mock.calls.filter(
      ([, patch]) => patch && patch.status === 'pending'
    )
    expect(resetToPending).toEqual([])
  })
})

describe('C2 regression — opts.references must be the FULL references list', () => {
  it('passes the full references array (not just matched subset) to submitGeneration opts.references', async () => {
    // Two refs: one matches the scene tag, one does not. The non-matching ref has an @mention in the prompt.
    const fullRefs = [
      { id: 1, name: 'hero', type: 'character', category: 'character', mediaId: 'm1', tags: ['hero'] },
      { id: 2, name: 'manualRef', type: 'character', category: 'character', mediaId: 'm2', tags: [] },
    ]
    // getMatchingReferences returns only the tag-matched ref (allMatched = [fullRefs[0]])
    const { hook, submitGeneration, checkGeneration, collectGeneration } = setupHook({
      scenes: [{ id: 's1', prompt: '@manualRef walks', status: 'pending' }],
      scenesHook: {
        references: fullRefs,
        getMatchingReferences: vi.fn(() => [fullRefs[0]]),
      },
    })

    checkGeneration.mockResolvedValue({ completed: true })
    collectGeneration.mockResolvedValue({ success: true, images: [{ id: 'img-c2', mediaId: 'm-c2' }] })

    let startPromise
    await act(async () => {
      startPromise = hook.result.current.start({ projectName: 'p', saveMode: 'memory' })
    })
    await act(async () => { await vi.advanceTimersByTimeAsync(60 * 1000) })
    await startPromise

    expect(submitGeneration).toHaveBeenCalledTimes(1)
    const opts = submitGeneration.mock.calls[0][2]
    // The FULL refs list must be in opts.references (not just allMatched which is [fullRefs[0]])
    expect(opts.references).toHaveLength(2)
    expect(opts.references).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'manualRef' }),
      expect.objectContaining({ name: 'hero' }),
    ]))
  })
})
