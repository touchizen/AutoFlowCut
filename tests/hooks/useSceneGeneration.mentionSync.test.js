/**
 * 개별 씬 생성의 미동기화 @멘션 처리.
 *
 * 배치(Start)에는 "동기화 후 생성" 게이트가 있는데(App 의 runEmptyRefGateFlow) 씬 카드의 개별
 * 생성에는 없었다. 같은 프롬프트가 Start 로는 되고 씬 카드 버튼으로는 "Unresolved @mention(s)"
 * 로 영구 실패했다 — 실제로 '부자와 빈자' 6번 씬이 그 상태로 고착됐다(문지기만 sync='failed').
 *
 * 두 층으로 막는다:
 *  1. 프리플라이트 — 생성 전에 동기화가 필요한 멘션이 있으면 먼저 게이트를 연다(배치와 같은 계약).
 *  2. 사후 복구 — 그래도 미해결로 실패하면 그 자리에서 동기화를 제안하고 한 번 재시도한다.
 *     (Flow 쪽이 그 사이 회복됐는데 앱이 옛 판정을 붙들고 거부하던 상황이 여기서 풀린다.)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'

vi.mock('../../src/utils/guards', () => ({
  checkFolderPermission: vi.fn().mockResolvedValue({ ok: true }),
  checkAuthToken: vi.fn().mockResolvedValue(true),
  checkFlowProjectReady: vi.fn().mockReturnValue({ ok: true }),
}))
// 실제 resolveSceneStyle 은 넘겨받은 matchedRefs 배열에 스타일 ref 이미지를 **밀어 넣는다**
// (styleService: matchedRefs.push(img)). 목이 그 부수효과를 흉내내지 않으면 "재시도가 스타일을
// 떨군다"는 회귀를 이 파일 어느 테스트도 잡지 못한다.
vi.mock('../../src/services/styleService', () => ({
  resolveSceneStyle: vi.fn((prompt, _a, _override, _all, matchedRefs) => {
    matchedRefs?.push({ name: '__style__', mediaId: 'style-1' })
    return { styledPrompt: `styled:${prompt}` }
  }),
}))
vi.mock('../../src/services/imageFinalize', () => ({
  finalizeGeneratedImage: vi.fn(async ({ result }) => (
    result?.success
      ? { success: true, sceneUpdate: { status: 'done' } }
      : { success: false, sceneUpdate: { status: 'error', error: result?.error, errorKind: result?.errorKind } }
  )),
}))
vi.mock('../../src/components/Toast', () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}))
vi.mock('../../src/utils/quotaStop', () => ({
  isQuotaExhaustedError: vi.fn(() => false),
  emitQuotaStop: vi.fn(),
}))

import { useSceneGeneration } from '../../src/hooks/useSceneGeneration'

const SCENE = { id: 'scene_6', prompt: '@문지기 가 @박씨 를 막아선다' }
const UNSYNCED = { id: 3, name: '문지기', type: 'character', entityId: 'e3', workflowId: 'w3', flowNameSyncStatus: 'failed', mediaId: 'm3' }
const SYNCED = { id: 3, name: '문지기', type: 'character', entityId: 'e3', workflowId: 'w3', flowNameSyncStatus: 'synced', mediaId: 'm3' }

const unresolvedResult = { success: false, error: 'Unresolved @mention(s): 문지기', errorKind: 'unresolved-mentions', unresolvedNames: ['문지기'] }

function setup({ generateImage, requestMentionSync, references = [UNSYNCED] }) {
  const scenesHook = {
    references,
    updateScene: vi.fn(),
    getMatchingReferences: vi.fn((_scene, pool = references) => pool),
  }
  const settings = { imageModel: 'x', aspectRatio: '16:9', imageBatchCount: 1, saveMode: 'memory' }
  const hook = renderHook(() =>
    useSceneGeneration({
      settings, scenes: [SCENE], scenesHook,
      genAPI: { mode: 'flow', generateImage },
      openSettings: vi.fn(), setSelectedScene: vi.fn(),
      t: (k) => k, generationQueue: null,
      requestMentionSync,
    })
  )
  return { ...hook, scenesHook }
}

describe('개별 씬 생성 — 미동기화 @멘션', () => {
  beforeEach(() => vi.clearAllMocks())

  it('생성 전에 동기화가 필요한지 먼저 묻는다(프리플라이트)', async () => {
    const generateImage = vi.fn().mockResolvedValue({ success: true, images: [{ base64: 'a' }] })
    const requestMentionSync = vi.fn().mockResolvedValue({ proceeded: true, refs: [SYNCED] })
    const { result } = setup({ generateImage, requestMentionSync })

    await act(async () => { await result.current.handleGenerateScene('scene_6') })

    expect(requestMentionSync).toHaveBeenCalledWith(expect.objectContaining({ scene: expect.objectContaining({ id: 'scene_6' }) }))
    // 동기화 결과로 패치된 refs 가 멘션 해석에 쓰여야 한다 — React state 는 같은 tick 에 stale 이다.
    expect(generateImage).toHaveBeenCalledWith(expect.any(String), expect.anything(),
      expect.objectContaining({ references: [SYNCED] }))
  })

  it('사용자가 동기화를 취소하면 생성하지 않는다', async () => {
    const generateImage = vi.fn()
    const requestMentionSync = vi.fn().mockResolvedValue({ proceeded: false })
    const { result } = setup({ generateImage, requestMentionSync })

    await act(async () => { await result.current.handleGenerateScene('scene_6') })

    expect(generateImage).not.toHaveBeenCalled()
  })

  // 프리플라이트가 "동기화 필요 없음"으로 판단했는데도(앱이 붙들고 있던 판정이 옛것일 수 있다)
  // 엔진이 미해결로 거절하면, 거기서 끝내지 않고 그 이름들로 동기화를 제안한 뒤 한 번 재시도한다.
  it('그래도 미해결로 실패하면 그 이름들로 동기화 후 한 번 재시도한다', async () => {
    const generateImage = vi.fn()
      .mockResolvedValueOnce(unresolvedResult)
      .mockResolvedValue({ success: true, images: [{ base64: 'a' }] })
    const requestMentionSync = vi.fn()
      .mockResolvedValueOnce({ proceeded: true })                    // 프리플라이트: 동기화 대상 없음
      .mockResolvedValue({ proceeded: true, refs: [SYNCED] })        // 사후: 실제 동기화
    const { result } = setup({ generateImage, requestMentionSync })

    await act(async () => { await result.current.handleGenerateScene('scene_6') })

    expect(requestMentionSync).toHaveBeenLastCalledWith(expect.objectContaining({ names: ['문지기'] }))
    expect(generateImage).toHaveBeenCalledTimes(2)
    expect(generateImage).toHaveBeenLastCalledWith(expect.any(String), expect.anything(),
      expect.objectContaining({ references: [SYNCED] }))
  })

  // 무한 재시도 금지 — 동기화해도 여전히 미해결이면 그냥 실패로 남긴다.
  it('재시도해도 미해결이면 다시 시도하지 않는다', async () => {
    const generateImage = vi.fn().mockResolvedValue(unresolvedResult)
    const requestMentionSync = vi.fn().mockResolvedValue({ proceeded: true, refs: [UNSYNCED] })
    const { result, scenesHook } = setup({ generateImage, requestMentionSync })

    await act(async () => { await result.current.handleGenerateScene('scene_6') })

    expect(generateImage).toHaveBeenCalledTimes(2)
    expect(scenesHook.updateScene).toHaveBeenCalledWith('scene_6', expect.objectContaining({ status: 'error' }))
  })

  it('사후 동기화를 취소하면 재시도하지 않고 에러로 남긴다', async () => {
    const generateImage = vi.fn().mockResolvedValue(unresolvedResult)
    const requestMentionSync = vi.fn()
      .mockResolvedValueOnce({ proceeded: true })
      .mockResolvedValue({ proceeded: false })
    const { result } = setup({ generateImage, requestMentionSync })

    await act(async () => { await result.current.handleGenerateScene('scene_6') })

    // 복구를 **시도는 했고**(두 번째 호출) 사용자가 거절해서 재생성이 없었다는 것까지 고정한다 —
    // 호출 횟수만 보면 복구 분기를 통째로 지워도 통과한다.
    expect(requestMentionSync).toHaveBeenCalledTimes(2)
    expect(generateImage).toHaveBeenCalledTimes(1)
  })

  // 취소했는데 씬이 'generating' 으로 남으면 삭제도 안 되고 다음 배치 선택에서도 빠진다
  // (filterPendingScenes 는 pending/error 만 잡는다) — 사용자 입장에선 씬이 얼어붙는다.
  it('취소하면 씬을 generating 으로 남기지 않는다', async () => {
    const generateImage = vi.fn()
    const requestMentionSync = vi.fn().mockResolvedValue({ proceeded: false })
    const { result, scenesHook } = setup({ generateImage, requestMentionSync })

    await act(async () => { await result.current.handleGenerateScene('scene_6') })

    const statuses = scenesHook.updateScene.mock.calls.map(([, patch]) => patch?.status)
    expect(statuses).not.toContain('generating')
  })

  // 재시도가 스타일 ref 이미지를 떨구면 사용자가 고른 스타일이 조용히 사라진 그림이 나온다.
  // (resolveSceneStyle 이 matchedRefs 에 스타일 이미지를 밀어 넣는다 — 재시도도 같은 경로여야 한다.)
  it('재시도도 첫 호출과 같은 방식으로 레퍼런스를 만든다', async () => {
    const generateImage = vi.fn()
      .mockResolvedValueOnce(unresolvedResult)
      .mockResolvedValue({ success: true, images: [{ base64: 'a' }] })
    const requestMentionSync = vi.fn()
      .mockResolvedValueOnce({ proceeded: true })
      .mockResolvedValue({ proceeded: true, refs: [SYNCED] })
    const { result } = setup({ generateImage, requestMentionSync })

    await act(async () => { await result.current.handleGenerateScene('scene_6') })

    const [firstPrompt, firstRefs] = generateImage.mock.calls[0]
    const [retryPrompt, retryRefs] = generateImage.mock.calls[1]
    expect(retryPrompt).toBe(firstPrompt)
    expect(retryRefs).toEqual(firstRefs)
  })

  // Flow 가 "그 칩은 이제 없다"(staleMention)고 알려주는 경우 — 앱 기록은 synced 인데 Flow 에서
  // 캐릭터가 사라진 상태다. 배치는 그 ref 를 failed 로 찍어 다음 실행에 자가치유하는데
  // (useAutomation), 개별 생성은 아무것도 안 해서 눌러도 계속 같은 실패였다.
  it('Flow 가 stale 멘션을 알려주면 그 이름으로 동기화를 제안하고 재시도한다', async () => {
    const generateImage = vi.fn()
      .mockResolvedValueOnce({ success: false, error: 'option-not-found', staleMention: '문지기' })
      .mockResolvedValue({ success: true, images: [{ base64: 'a' }] })
    const requestMentionSync = vi.fn()
      .mockResolvedValueOnce({ proceeded: true })
      .mockResolvedValue({ proceeded: true, refs: [SYNCED] })
    const { result } = setup({ generateImage, requestMentionSync })

    await act(async () => { await result.current.handleGenerateScene('scene_6') })

    expect(requestMentionSync).toHaveBeenLastCalledWith(expect.objectContaining({ names: ['문지기'] }))
    expect(generateImage).toHaveBeenCalledTimes(2)
  })

  // API 모드엔 Flow 캐릭터 동기화 개념이 없다 — 게이트를 부르면 안 된다.
  it('api 모드에서는 동기화를 묻지 않는다', async () => {
    const generateImage = vi.fn().mockResolvedValue({ success: true, images: [{ base64: 'a' }] })
    const requestMentionSync = vi.fn()
    const scenesHook = {
      references: [UNSYNCED],
      updateScene: vi.fn(),
      getMatchingReferences: vi.fn(() => [UNSYNCED]),
    }
    const { result } = renderHook(() =>
      useSceneGeneration({
        settings: { imageModel: 'x', aspectRatio: '16:9', imageBatchCount: 1, saveMode: 'memory' },
        scenes: [SCENE], scenesHook,
        genAPI: { mode: 'api', generateImage },
        openSettings: vi.fn(), setSelectedScene: vi.fn(),
        t: (k) => k, generationQueue: null,
        requestMentionSync,
      })
    )

    await act(async () => { await result.current.handleGenerateScene('scene_6') })

    expect(requestMentionSync).not.toHaveBeenCalled()
    expect(generateImage).toHaveBeenCalledTimes(1)
  })
})
