/**
 * useMcpServer — review R11 fix
 *
 * MCP _sceneNum 매칭이 실패해도 byId fallback 하면, MCP bundler 가 매번
 * scene_1, scene_2 새 id 부여하는 특성상 새 _sceneNum 이 옛 id 와 충돌해
 * 새 prompt 에 기존 image 가 붙는 corruption 발생.
 *
 * 정책: prev 에 _sceneNum 있고 incoming._sceneNum 도 있으면 byNum 만 신뢰.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useMcpServer } from '../../src/hooks/useMcpServer'

function makeProps(overrides = {}) {
  return {
    settings: { mcpHttpEnabled: false, mcpHttpPort: 3210 },
    scenes: [],
    setScenes: vi.fn(),
    references: [],
    setReferences: vi.fn(),
    handleGenerateRef: vi.fn(),
    handleGenerateScene: vi.fn(),
    handleGenerateAllRefs: vi.fn(),
    handleStart: vi.fn(),
    handleStop: vi.fn(),
    handleProjectChange: vi.fn(),
    handleExportConfirm: vi.fn(),
    selectedStyleRefId: null,
    setSelectedStyleRefId: vi.fn(),
    refreshReviews: vi.fn(),
    audioReviews: [],
    importByPath: vi.fn(),
    audioPackage: null,
    automationState: { isRunning: false, isPaused: false, progress: { current: 0, total: 0 }, status: 'idle', statusMessage: '' },
    videoAutomation: {},
    generatingRefs: [],
    isRunning: false,
    ...overrides,
  }
}

describe('R11 — MCP _sceneNum strict mode', () => {
  let cb = null
  beforeEach(() => {
    window.electronAPI = {
      startMcpHttp: vi.fn(),
      stopMcpHttp: vi.fn(),
      onMcpUpdate: vi.fn((fn) => { cb = fn; return () => {} }),
    }
  })
  afterEach(() => { delete window.electronAPI; cb = null })

  it('insert 시나리오: MCP bundler id 충돌이 있어도 byNum 매칭 우선', () => {
    const setScenes = vi.fn()
    renderHook(() => useMcpServer(makeProps({ setScenes })))

    // prev: 2 scenes from prior load — id=scene_1/_sceneNum=1 + id=scene_2/_sceneNum=2
    const prev = [
      { id: 'scene_1', _sceneNum: 1, prompt: 'A', image: 'imgA', mediaId: 'mA' },
      { id: 'scene_2', _sceneNum: 2, prompt: 'B', image: 'imgB', mediaId: 'mB' },
    ]

    // MCP bundler reassigns ids on new CSV (scene=0 added at top)
    // incoming[0] id=scene_1 (collision with prev[0]) but _sceneNum=0 (new)
    cb({
      type: 'update-scenes',
      scenes: [
        { id: 'scene_1', _sceneNum: 0, prompt: 'NEW_AT_TOP' },
        { id: 'scene_2', _sceneNum: 1, prompt: 'A' },
        { id: 'scene_3', _sceneNum: 2, prompt: 'B' },
      ],
    })

    const updater = setScenes.mock.calls[0][0]
    const result = updater(prev)

    // 새 _sceneNum=0 씬은 신규 — 기존 imgA 가 붙으면 안 됨
    const newScene = result.find(s => s._sceneNum === 0)
    expect(newScene).toBeTruthy()
    expect(newScene.prompt).toBe('NEW_AT_TOP')
    expect(newScene.image).toBeUndefined()
    expect(newScene.mediaId).toBeUndefined()

    // _sceneNum=1 의 image 는 prev (옛 scene_1) 의 imgA
    const sceneA = result.find(s => s._sceneNum === 1)
    expect(sceneA.image).toBe('imgA')
    expect(sceneA.mediaId).toBe('mA')

    // _sceneNum=2 의 image 는 imgB
    const sceneB = result.find(s => s._sceneNum === 2)
    expect(sceneB.image).toBe('imgB')
    expect(sceneB.mediaId).toBe('mB')
  })

  it('legacy MCP payload (_sceneNum 없음) 는 id fallback 그대로 (회귀 없음)', () => {
    const setScenes = vi.fn()
    renderHook(() => useMcpServer(makeProps({ setScenes })))

    const prev = [
      { id: 'scene_1', prompt: 'A', image: 'imgA' }, // _sceneNum 없음
    ]
    cb({
      type: 'update-scenes',
      scenes: [
        { id: 'scene_1', prompt: 'A-refined' }, // _sceneNum 없음
      ],
    })
    const updater = setScenes.mock.calls[0][0]
    const result = updater(prev)
    expect(result[0].image).toBe('imgA') // legacy: id 매칭 작동
  })
})
