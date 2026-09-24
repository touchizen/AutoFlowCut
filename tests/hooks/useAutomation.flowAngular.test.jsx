/**
 * useAutomation — flow.google.com(Angular) 재작업 (M1-10 게이트 부분 · M1-13 통합)
 *
 * M1-10: 배치는 엔진 게이트가 판정할 재료를 callOpts 로 넘긴다 — 필터 **전** 매칭 ref 개수(matchedRefCount)와
 *   업스케일 설정(imageUpscale). 세션이 준비되지 않으면 이유별 안내(flowSessionReason)로 멈추고 제출하지 않는다.
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

describe('useAutomation — Flow 게이트 재료 (M1-10)', () => {
  it('filePath 만 있는(주입 불가) 태그 ref 도 matchedRefCount 에 센다 — referenceImages 는 [], 개수는 1', async () => {
    const { hook, genAPI } = setupHook({ scenes: [{ id: 's1', prompt: 'a', status: 'pending' }], references: [{ name: 'hero', filePath: '/refs/hero.png' }] })
    await runStart(hook)
    expect(genAPI.submitGeneration).toHaveBeenCalledTimes(1)
    const [, refs, callOpts] = genAPI.submitGeneration.mock.calls[0]
    expect(refs).toEqual([])
    expect(callOpts).toMatchObject({ matchedRefCount: 1, imageUpscale: 'off' })
  })

  it('imageUpscale 설정이 callOpts 로 그대로 간다(2k)', async () => {
    const { hook, genAPI } = setupHook({ scenes: [{ id: 's1', prompt: 'a', status: 'pending' }] })
    await runStart(hook, { imageUpscale: '2k' })
    expect(genAPI.submitGeneration.mock.calls[0][2]).toMatchObject({ matchedRefCount: 0, imageUpscale: '2k' })
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
