/**
 * useMcpServer — review R18 fix
 *
 * freshId 가 max(prev ids, incoming ids) + 1 부터 시작 (monotonic).
 * gap 재사용 안 함 — useScenes 의 stable id 정책과 일관.
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

describe('R18 — MCP freshId monotonic (gap 재사용 안 함)', () => {
  let cb = null
  beforeEach(() => {
    window.electronAPI = {
      startMcpHttp: vi.fn(),
      stopMcpHttp: vi.fn(),
      onMcpUpdate: vi.fn((fn) => { cb = fn; return () => {} }),
    }
  })
  afterEach(() => { delete window.electronAPI; cb = null })

  it('prev=[scene_1, scene_3] (gap 있음) 에 새 unmatched scene 들어와도 scene_2 재사용 안 함', () => {
    const setScenes = vi.fn()
    renderHook(() => useMcpServer(makeProps({ setScenes })))

    const prev = [
      { id: 'scene_1', _sceneNum: 1, image: 'imgA' },
      { id: 'scene_3', _sceneNum: 3, image: 'imgC' },
    ]
    // MCP 가 새 _sceneNum=2 scene 보냄, id='scene_2' (gap 와 동일)
    cb({
      type: 'update-scenes',
      scenes: [
        { id: 'scene_1', _sceneNum: 1, prompt: 'A' },
        { id: 'scene_2', _sceneNum: 2, prompt: 'NEW_MIDDLE' },
        { id: 'scene_3', _sceneNum: 3, prompt: 'C' },
      ],
    })

    const updater = setScenes.mock.calls[0][0]
    const result = updater(prev)
    const ids = result.map(s => s.id)

    // 모두 unique
    expect(new Set(ids).size).toBe(ids.length)
    // 새 scene 은 scene_2 (gap) 재사용 안 하고 scene_4 (max+1) 부터
    const newScene = result.find(s => s._sceneNum === 2)
    expect(newScene.id).not.toBe('scene_2') // gap 재사용 금지
    expect(newScene.id).toBe('scene_4')
  })

  it('incoming 의 id 도 max 계산에 포함 (incoming scene_5 → fresh 는 scene_6+)', () => {
    const setScenes = vi.fn()
    renderHook(() => useMcpServer(makeProps({ setScenes })))

    const prev = [
      { id: 'scene_1', _sceneNum: 1, image: 'imgA' },
    ]
    // incoming 이 scene_5 (collision 없음) 와 scene_1 (collision) 가짐
    cb({
      type: 'update-scenes',
      scenes: [
        { id: 'scene_1', _sceneNum: 1, prompt: 'A' },
        { id: 'scene_1', _sceneNum: 2, prompt: 'COLLIDE' }, // duplicate id (잘못된 payload)
        { id: 'scene_5', _sceneNum: 3, prompt: 'B' },
      ],
    })
    const updater = setScenes.mock.calls[0][0]
    const result = updater(prev)
    const ids = result.map(s => s.id)
    expect(new Set(ids).size).toBe(ids.length)
    // duplicate scene_1 의 두번째는 fresh id (>= scene_6, max(1,5)+1 부터)
    const dup = result.find(s => s._sceneNum === 2)
    expect(dup.id).not.toBe('scene_1')
    expect(dup.id).not.toBe('scene_5')
    expect(dup.id).toBe('scene_6')
  })
})
