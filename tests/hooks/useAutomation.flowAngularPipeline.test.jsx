/**
 * useAutomation — flow.google.com 렌더러 통합 (b) (M1-13)
 *
 * 실제 useFlowEngine + useAutomation + 실제 imageFinalize(processAsyncSceneResult) 를 window.electronAPI.flow* 모킹 위에서
 * 돌린다: 세션 판정 → 제출(token:null) → check → collect → saveImage → updateScene(done, imagePath, image_size).
 * 실패 kind 는 씬 패치에 errorKind/errorParams 로 남는다. 가짜 시계로 main 의 마감(flow-submit-lost) 이 렌더러의
 * ITEM_TIMEOUT(120s) 보다 먼저 씬에 도착함을 본다 — collectCompleted 가 checkGeneration 을 먼저 부르기 때문.
 */
import { renderHook, act } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import { useAutomation } from '../../src/hooks/useAutomation'
import { useFlowEngine } from '../../src/engine/engineFlow'
import { __resetQuotaStopForTests } from '../../src/utils/quotaStop'

vi.mock('../../src/hooks/useFileSystem', () => ({
  fileSystemAPI: {
    checkPermission: vi.fn().mockResolvedValue({ success: true }),
    readFileByPath: vi.fn().mockRejectedValue(new Error('n/a')),
    saveImage: vi.fn(async () => ({ success: true, path: '/proj/scenes/s1.png' })),
    saveExtraToHistory: vi.fn(async () => ({ success: true })),
  },
}))
vi.mock('../../src/utils/formatters', async (orig) => ({ ...(await orig()), getImageSizeFromBase64: vi.fn(async () => ({ width: 1376, height: 768 })) }))
vi.mock('../../src/components/Toast', () => ({ toast: { error: vi.fn(), warning: vi.fn(), success: vi.fn(), info: vi.fn() } }))
vi.mock('../../src/services/styleService', () => ({ presetTagForStyleId: vi.fn(() => null), resolveSceneStyle: vi.fn((prompt) => ({ styledPrompt: prompt || 'p', appliedStyle: null })) }))
vi.mock('../../src/utils/sceneFilters', () => ({ filterPendingScenes: vi.fn((scenes) => scenes) }))
vi.mock('../../src/firebase/functions', () => ({ consumeBatchDownload: vi.fn(async () => ({ charged: false })) }))

import { fileSystemAPI } from '../../src/hooks/useFileSystem'

const IMAGE = { base64: 'data:image/png;base64,AQID', mediaId: '<uuid#5>', width: 1376, height: 768, seed: 1687588041 }
const api = {}
beforeEach(() => {
  __resetQuotaStopForTests()
  vi.useFakeTimers({ now: 1790240102500 })
  vi.spyOn(Math, 'random').mockReturnValue(0)
  let n = 0
  Object.assign(api, {
    flowSessionStatus: vi.fn(async () => ({ ready: true, credits: 1050 })),
    flowExtractProjectId: vi.fn(async () => ({ projectId: 'proj-1' })),
    flowGenerateImage: vi.fn(async () => ({ success: true, generationId: `gen-${++n}`, submitted: true })),
    flowCheckGeneration: vi.fn(async () => ({ success: true, completed: true, via: 'rpc' })),
    flowCollectGeneration: vi.fn(async () => ({ success: true, images: [IMAGE] })),
    flowClearGenerations: vi.fn(async () => ({ success: true, cleared: 0 })),
  })
  Object.assign(window.electronAPI, api)
})
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks() })

// 씬에 image 를 준다 — useAutomation 의 "이미지 없는 씬만 남으면 ready 로 되돌리는" 효과가 error 상태를 덮지 않게(authFail 테스트와 동일).
const SCENE = (id, prompt) => ({ id, prompt, status: 'pending', image: 'data:image/png;base64,old' })
function setup({ scenes = [SCENE('s1', 'a')], references = [] } = {}) {
  const updateScene = vi.fn()
  const scenesHook = { scenes, references, updateScene, getMatchingReferences: vi.fn(() => references) }
  const hook = renderHook(() => {
    const engine = useFlowEngine({})
    const auto = useAutomation(engine, scenesHook, null, null, null, (k) => k, null, null, null, 'flow', true)
    return { engine, auto }
  })
  return { hook, updateScene }
}
async function runStart(hook, opts = {}, ms = 30000) {
  let p
  await act(async () => { p = hook.result.current.auto.start({ projectName: 'proj', saveMode: 'folder', concurrency: 5, aspectRatio: '16:9', imageUpscale: 'off', ...opts }) })
  for (let t = 0; t < ms; t += 500) await act(async () => { await vi.advanceTimersByTimeAsync(500) })
  await act(async () => { await p })
}
const patchesFor = (updateScene, id) => updateScene.mock.calls.filter((c) => c[0] === id).map((c) => c[1])
const lastPatch = (updateScene, id) => patchesFor(updateScene, id).at(-1)

describe('useAutomation × useFlowEngine — 성공 경로', () => {
  it('ready → 제출(token:null, referenceImages:[]) → check → collect → saveImage → updateScene(done, imagePath, image_size)', async () => {
    const { hook, updateScene } = setup()
    await runStart(hook)
    expect(api.flowSessionStatus).toHaveBeenCalled()
    expect(api.flowGenerateImage).toHaveBeenCalledTimes(1)
    expect(api.flowGenerateImage.mock.calls[0][0]).toMatchObject({ token: null, prompt: 'a', referenceImages: [], asyncMode: true, aspectRatio: '16:9', projectId: 'proj-1' })
    expect(api.flowCollectGeneration).toHaveBeenCalledWith({ generationId: 'gen-1', token: null })
    expect(fileSystemAPI.saveImage).toHaveBeenCalledWith('proj', 's1', IMAGE.base64, expect.anything(), expect.objectContaining({ mediaId: '<uuid#5>', seed: 1687588041 }))
    expect(lastPatch(updateScene, 's1')).toMatchObject({ status: 'done', imagePath: '/proj/scenes/s1.png', image_size: { width: 1376, height: 768 }, mediaId: '<uuid#5>', seed: 1687588041, errorKind: null, errorParams: {} })
    expect(hook.result.current.auto.status).not.toBe('error')
  })
})

describe('useAutomation × useFlowEngine — 세션·게이트', () => {
  it('세션 미준비(wiz-missing) → 로그인 안내, 제출 없음', async () => {
    api.flowSessionStatus.mockResolvedValue({ ready: false, reason: 'wiz-missing' })
    const { hook } = setup()
    await runStart(hook, {}, 3000)
    expect(api.flowGenerateImage).not.toHaveBeenCalled()
    expect(hook.result.current.auto.statusMessage).toContain('Flow login required')
  })

  it('세션 확인 실패(rpc:http:500) → 이유가 든 안내, 제출 없음', async () => {
    api.flowSessionStatus.mockResolvedValue({ ready: false, reason: 'rpc:http:500' })
    const { hook } = setup()
    await runStart(hook, {}, 3000)
    expect(api.flowGenerateImage).not.toHaveBeenCalled()
    expect(hook.result.current.auto.statusMessage).toContain('rpc:http:500')
  })

  it('filePath 만 있고 mediaId 없는 태그 ref → 씬 error flow-references-unsupported, flowGenerateImage 미호출', async () => {
    const { hook, updateScene } = setup({ references: [{ name: 'hero', filePath: '/refs/hero.png' }] })
    await runStart(hook, {}, 5000)
    expect(api.flowGenerateImage).not.toHaveBeenCalled()
    expect(lastPatch(updateScene, 's1')).toMatchObject({ status: 'error', errorKind: 'flow-references-unsupported' })
  })

  it('imageUpscale:2k → 씬 error flow-upscale-unsupported, 제출 없음', async () => {
    const { hook, updateScene } = setup()
    await runStart(hook, { imageUpscale: '2k' }, 5000)
    expect(api.flowGenerateImage).not.toHaveBeenCalled()
    expect(lastPatch(updateScene, 's1')).toMatchObject({ status: 'error', errorKind: 'flow-upscale-unsupported' })
  })
})

describe('useAutomation × useFlowEngine — collect 결과 kind', () => {
  it('collect flow-aspect-mismatch → 씬 errorKind', async () => {
    api.flowCollectGeneration.mockResolvedValue({ success: false, errorKind: 'flow-aspect-mismatch', error: 'flow-aspect-mismatch' })
    const { hook, updateScene } = setup()
    await runStart(hook)
    expect(lastPatch(updateScene, 's1')).toMatchObject({ status: 'error', errorKind: 'flow-aspect-mismatch', error: 'flow-aspect-mismatch' })
  })

  it('collect 의 errorParams 가 씬 패치에 실린다(flow-resolution-not-offered {requested})', async () => {
    api.flowCollectGeneration.mockResolvedValue({ success: false, errorKind: 'flow-resolution-not-offered', error: 'flow-resolution-not-offered', errorParams: { requested: '1080p' } })
    const { hook, updateScene } = setup()
    await runStart(hook)
    expect(lastPatch(updateScene, 's1')).toMatchObject({ status: 'error', errorKind: 'flow-resolution-not-offered', errorParams: { requested: '1080p' } })
  })

  it('collect authFailed(HTTP 401 명시) → 배치 중단(status error, 씬 errorKind auth)', async () => {
    api.flowCollectGeneration.mockResolvedValue({ success: false, errorKind: 'flow-rpc-error', error: 'flow-rpc-error', rpcStatus: 401, authFailed: true })
    const { hook, updateScene } = setup({ scenes: [SCENE('s1', 'a'), SCENE('s2', 'b')] })
    await runStart(hook)
    expect(lastPatch(updateScene, 's1')).toMatchObject({ status: 'error', errorKind: 'auth' })
    expect(hook.result.current.auto.status).toBe('error')
  })
})

describe('useAutomation × useFlowEngine — main 의 마감이 렌더러 ITEM_TIMEOUT 보다 먼저 씬에 도착한다', () => {
  /** main 흉내: 제출 100s 뒤 loadend 마감 → completed + flow-submit-lost. */
  function mainDeadlineAt(submittedAtMs, lostAfterMs = 100000) {
    api.flowCheckGeneration.mockImplementation(async () => ({ success: true, completed: Date.now() - submittedAtMs >= lostAfterMs, via: 'rpc' }))
    api.flowCollectGeneration.mockImplementation(async () => ({ success: false, errorKind: 'flow-submit-lost', error: 'flow-submit-lost' }))
  }

  it('단일 씬: send 뒤 100s → 씬 errorKind flow-submit-lost (Generation timeout 아님)', async () => {
    const t0 = Date.now()
    mainDeadlineAt(t0)
    const { hook, updateScene } = setup()
    await runStart(hook, {}, 130000)
    expect(lastPatch(updateScene, 's1')).toMatchObject({ status: 'error', errorKind: 'flow-submit-lost', error: 'flow-submit-lost' })
  })

  it('3씬 + 페이싱 60s(상한) + 제출 IPC 1s: 첫 씬의 재확인이 120s 를 넘긴 시점에 와도 checkGeneration 을 먼저 불러 main 의 kind 가 씬에 도착한다', async () => {
    // 제출 t≈0 / 61 / 122. 첫 씬은 t=100 부터 main 에서 lost. 렌더러의 다음 수집은 scene3 제출 직전 t≈121 —
    // 옛 순서(ITEM_TIMEOUT 먼저)면 elapsed 121s > 120s 로 'Generation timeout', errorKind null 이 main 의 kind 를 덮는다.
    // 새 순서는 checkGeneration → completed → collect → flow-submit-lost. (실기에서는 await 오버헤드가 그 몇 ms 를 만든다.)
    const t0 = Date.now()
    let n = 0
    api.flowGenerateImage.mockImplementation(async () => { await new Promise((r) => setTimeout(r, 1000)); return { success: true, generationId: `gen-${++n}`, submitted: true } })
    api.flowCheckGeneration.mockImplementation(async ({ generationId }) => ({ success: true, completed: generationId === 'gen-1' && Date.now() - t0 >= 100000, via: 'rpc' }))
    api.flowCollectGeneration.mockImplementation(async () => ({ success: false, errorKind: 'flow-submit-lost', error: 'flow-submit-lost' }))
    const scenes = [SCENE('s1', 'a'), SCENE('s2', 'b'), SCENE('s3', 'c')]
    const { hook, updateScene } = setup({ scenes })
    let p
    await act(async () => { p = hook.result.current.auto.start({ projectName: 'proj', saveMode: 'folder', concurrency: 5, aspectRatio: '16:9', flowPacingMinMs: 60000, flowPacingMaxMs: 60000 }) })
    for (let t = 0; t < 130000; t += 500) await act(async () => { await vi.advanceTimersByTimeAsync(500) })
    const s1 = lastPatch(updateScene, 's1')
    expect(s1).toMatchObject({ status: 'error', errorKind: 'flow-submit-lost', error: 'flow-submit-lost' })
    expect(patchesFor(updateScene, 's1').some((x) => x.error === 'Generation timeout')).toBe(false)
    await act(async () => { hook.result.current.auto.stop() })
    for (let t = 0; t < 200000; t += 5000) await act(async () => { await vi.advanceTimersByTimeAsync(5000) })
    await act(async () => { await p })
  })
})
