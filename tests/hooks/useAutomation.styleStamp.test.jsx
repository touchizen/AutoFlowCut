/**
 * useAutomation — 배치 생성 시 전역 프리셋 스타일을 씬 style_tag 에 stamp (Issue #3)
 *
 * 전역 selectedStyleRefId(프리셋)로 배치 생성하면 각 씬의 style_tag 가 비어있어
 * 상세 모달이 스타일을 못 보여주고 모달 재생성이 실사로 돌아가는 문제 → 배치가
 * 적용한 프리셋 표시명을 style_tag 에 기록한다.
 */
import { renderHook, act } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import { useAutomation } from '../../src/hooks/useAutomation'
import { STYLE_PRESETS } from '../../src/config/defaults'

vi.mock('../../src/hooks/useFileSystem', () => ({
  fileSystemAPI: {
    checkPermission: vi.fn().mockResolvedValue({ success: true }),
    readFileByPath: vi.fn().mockRejectedValue(new Error('n/a')),
  },
}))
vi.mock('../../src/components/Toast', () => ({ toast: { error: vi.fn(), warning: vi.fn(), success: vi.fn() } }))
vi.mock('../../src/services/imageFinalize', () => ({ processAsyncSceneResult: vi.fn().mockResolvedValue(true) }))
vi.mock('../../src/utils/sceneFilters', () => ({ filterPendingScenes: vi.fn((scenes) => scenes) }))

const PRESET = STYLE_PRESETS.styles[0]
const PRESET_TAG = PRESET.name_en || PRESET.name_ko || PRESET.id

function setupHook(scenes) {
  let gid = 0
  const submitGeneration = vi.fn().mockImplementation(async () => ({ success: true, generationId: `gen-${++gid}` }))
  const genAPI = {
    submitGeneration,
    checkGeneration: vi.fn().mockResolvedValue({ completed: true }),
    collectGeneration: vi.fn().mockResolvedValue({ success: true, images: [{ id: 'i', mediaId: 'm' }] }),
    clearGenerations: vi.fn().mockResolvedValue(undefined),
    uploadReference: vi.fn(),
    getAccessToken: vi.fn().mockResolvedValue('tok'),
  }
  const updateScene = vi.fn()
  const scenesHook = { scenes, references: [], updateScene, getMatchingReferences: vi.fn(() => []) }
  const hook = renderHook(() => useAutomation(genAPI, scenesHook, null, null, null, (k) => k, null, null, null, 'api', true))
  return { hook, updateScene }
}

beforeEach(() => { vi.useFakeTimers() })
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks() })

const TWO = [
  { id: 's1', prompt: 'a', status: 'pending', style_tag: '' },
  { id: 's2', prompt: 'b', status: 'pending', style_tag: '' },
]

describe('useAutomation — 배치 프리셋 스타일 stamp', () => {
  it('전역 preset 스타일이면 각 씬 style_tag 에 프리셋 표시명 기록', async () => {
    const { hook, updateScene } = setupHook(TWO)
    let p
    await act(async () => {
      p = hook.result.current.start({
        projectName: 'p', saveMode: 'memory', concurrency: 5,
        selectedStyleRefId: `preset:${PRESET.id}`,
      })
    })
    await act(async () => { await vi.advanceTimersByTimeAsync(5000) })
    await p
    // 각 씬에 style_tag stamp 호출이 있었는지
    const stampCalls = updateScene.mock.calls.filter(([, patch]) => patch && patch.style_tag === PRESET_TAG)
    const stampedIds = new Set(stampCalls.map(([id]) => id))
    expect(stampedIds.has('s1')).toBe(true)
    expect(stampedIds.has('s2')).toBe(true)
  })

  it('스타일 미선택(null)이면 style_tag 를 건드리지 않음', async () => {
    const { hook, updateScene } = setupHook(TWO)
    let p
    await act(async () => {
      p = hook.result.current.start({ projectName: 'p', saveMode: 'memory', concurrency: 5 })
    })
    await act(async () => { await vi.advanceTimersByTimeAsync(5000) })
    await p
    const stampCalls = updateScene.mock.calls.filter(([, patch]) => patch && 'style_tag' in patch)
    expect(stampCalls.length).toBe(0)
  })
})
