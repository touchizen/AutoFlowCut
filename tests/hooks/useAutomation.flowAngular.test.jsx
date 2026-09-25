/**
 * useAutomation — flow.google.com(Angular) 재작업 (M1-10 게이트 부분 · M1-13 통합)
 *
 * M1-10: 배치는 엔진 게이트가 판정할 업스케일 설정(imageUpscale)을 callOpts 로 넘긴다. 세션이 준비되지 않으면 이유별 안내(flowSessionReason)로
 *   멈추고 제출하지 않는다.
 * M3-12(계획서 docs/plans/2026-09-25-flow-M3-references-plan.md D15): Flow 의 매칭 ref 필터는 로컬 이미지(sourceAvailable, imagePath → filePath) —
 *   파일만 있는 ref 도 submitGeneration 의 matchedRefs 로 가서 엔진이 ＋ 첨부로 붙인다. Flow 에선 선행 uploadReference 가 없다(엔진이 업로드한다).
 */
import { renderHook, act } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import { useAutomation } from '../../src/hooks/useAutomation'
import { __resetQuotaStopForTests } from '../../src/utils/quotaStop'

vi.mock('../../src/hooks/useFileSystem', () => ({
  fileSystemAPI: {
    checkPermission: vi.fn().mockResolvedValue({ success: true }),
    readFileByPath: vi.fn().mockRejectedValue(new Error('n/a')),
  },
}))
vi.mock('../../src/components/Toast', () => ({ toast: { error: vi.fn(), warning: vi.fn(), success: vi.fn(), info: vi.fn() } }))
vi.mock('../../src/services/styleService', () => ({
  presetTagForStyleId: vi.fn(() => null),
  resolveSceneStyle: vi.fn((prompt) => ({ styledPrompt: prompt || 'p', appliedStyle: null })),
}))
vi.mock('../../src/services/imageFinalize', () => ({ processAsyncSceneResult: vi.fn().mockResolvedValue(true) }))
vi.mock('../../src/utils/sceneFilters', () => ({ filterPendingScenes: vi.fn((scenes) => scenes) }))

function setupHook({ scenes, references = [], genOverrides = {} } = {}) {
  let gid = 0
  const genAPI = {
    mode: 'flow',
    submitGeneration: vi.fn(async () => ({ success: true, generationId: `gen-${++gid}` })),
    checkGeneration: vi.fn().mockResolvedValue({ success: true, completed: true }),
    collectGeneration: vi.fn().mockResolvedValue({ success: true, images: [{ base64: 'x', mediaId: 'm' }] }),
    clearGenerations: vi.fn().mockResolvedValue(undefined),
    uploadReference: vi.fn(),
    getAccessToken: vi.fn().mockResolvedValue('flow-session'),
    flowSessionReason: vi.fn(() => null),
    ...genOverrides,
  }
  const updateScene = vi.fn()
  const scenesHook = { scenes, references, updateScene, getMatchingReferences: vi.fn(() => references) }
  const hook = renderHook(() => useAutomation(genAPI, scenesHook, null, null, null, (k) => k, null, null, null, 'flow', true))
  return { hook, genAPI, updateScene }
}

beforeEach(() => { __resetQuotaStopForTests(); vi.useFakeTimers(); vi.spyOn(Math, 'random').mockReturnValue(0) })
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks() })

async function runStart(hook, opts = {}) {
  let p
  await act(async () => { p = hook.result.current.start({ projectName: 'p', saveMode: 'memory', concurrency: 5, ...opts }) })
  await act(async () => { await vi.advanceTimersByTimeAsync(30000) })
  await act(async () => { await p })
}

describe('useAutomation — Flow 레퍼런스 배관·게이트 재료 (M1-10 · M3-12)', () => {
  it('M3: filePath 만 있는(mediaId 없는) 태그 ref → submitGeneration 의 matchedRefs 에 포함 · references(멘션 해석용) 도 같이', async () => {
    const hero = { id: 'h', name: 'hero', type: 'character', category: 'character', filePath: '/refs/hero.png' }
    const { hook, genAPI } = setupHook({ scenes: [{ id: 's1', prompt: 'a', status: 'pending' }], references: [hero] })
    await runStart(hook)
    expect(genAPI.submitGeneration).toHaveBeenCalledTimes(1)
    const [, refs, callOpts] = genAPI.submitGeneration.mock.calls[0]
    expect(refs).toEqual([{ category: 'character', mediaId: null, caption: '', name: 'hero', data: null, filePath: '/refs/hero.png' }])
    expect(callOpts).toMatchObject({ imageUpscale: 'off', references: [hero] })
  })

  it('M3: imagePath 만 있는 ref 는 filePath 로 옮겨 싣고, 로컬 이미지가 없는 ref(mediaId 만)는 거른다', async () => {
    const castle = { id: 'c', name: 'castle', type: 'scene', category: 'scene', imagePath: 'references/castle.png' }
    const old = { id: 'o', name: 'old', type: 'scene', category: 'scene', mediaId: 'm-old' }
    const { hook, genAPI } = setupHook({ scenes: [{ id: 's1', prompt: 'a', status: 'pending' }], references: [castle, old] })
    await runStart(hook)
    expect(genAPI.submitGeneration.mock.calls[0][1]).toEqual([{ category: 'scene', mediaId: null, caption: '', name: 'castle', data: null, filePath: 'references/castle.png' }])
  })

  it('M3: Flow 에선 선행 uploadReference 가 없다 — 업로드할 만한 비-캐릭터 ref(이미지 있음·mediaId 없음)라도', async () => {
    // data 로 준다 — 이 하네스의 readFileByPath 는 실패하므로 filePath 만이면 옛 코드도 uploadReference 전에 멈춰 이 핀이 공허해진다.
    const forest = { id: 'f', name: 'forest', type: 'scene', category: 'scene', data: 'data:image/png;base64,Rk9S' }
    const { hook, genAPI } = setupHook({ scenes: [{ id: 's1', prompt: 'a', status: 'pending' }], references: [forest] })
    await runStart(hook)
    expect(genAPI.uploadReference).not.toHaveBeenCalled()
    expect(genAPI.submitGeneration).toHaveBeenCalledTimes(1)
  })

  it('imageUpscale 설정이 callOpts 로 그대로 간다(2k)', async () => {
    const { hook, genAPI } = setupHook({ scenes: [{ id: 's1', prompt: 'a', status: 'pending' }] })
    await runStart(hook, { imageUpscale: '2k' })
    expect(genAPI.submitGeneration.mock.calls[0][2]).toMatchObject({ imageUpscale: '2k' })
    expect(genAPI.submitGeneration.mock.calls[0][2]).not.toHaveProperty('matchedRefCount')   // M3: 엔진이 더는 보지 않는다
  })

  it('세션 미준비(rpc:http:500) → 세션 확인 실패 안내(이유 포함)로 멈추고 제출하지 않는다', async () => {
    const { hook, genAPI } = setupHook({
      scenes: [{ id: 's1', prompt: 'a', status: 'pending' }],
      genOverrides: { getAccessToken: vi.fn().mockResolvedValue(null), flowSessionReason: vi.fn(() => 'rpc:http:500') },
    })
    await runStart(hook)
    expect(genAPI.submitGeneration).not.toHaveBeenCalled()
    expect(hook.result.current.status).toBe('error')
    expect(hook.result.current.statusMessage).toContain('rpc:http:500')
    expect(hook.result.current.statusMessage).not.toContain('Flow login required')
  })

  it('세션 미준비(wiz-missing) → 로그인 안내', async () => {
    const { hook, genAPI } = setupHook({
      scenes: [{ id: 's1', prompt: 'a', status: 'pending' }],
      genOverrides: { getAccessToken: vi.fn().mockResolvedValue(null), flowSessionReason: vi.fn(() => 'wiz-missing') },
    })
    await runStart(hook)
    expect(genAPI.submitGeneration).not.toHaveBeenCalled()
    expect(hook.result.current.statusMessage).toContain('Flow login required')
  })
})
