/**
 * useMcpServer — review R15 fix
 *
 * insert 후 result 의 scene id 가 모두 unique 해야 함. MCP bundler 가 매번
 * scene_N 새로 부여하므로 incoming.id 와 prev/matched.id 가 충돌 가능.
 * unmatched incoming 은 fresh id 할당.
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

describe('R15 — MCP merge result scene ids must be unique', () => {
  let cb = null
  beforeEach(() => {
    window.electronAPI = {
      startMcpHttp: vi.fn(),
      stopMcpHttp: vi.fn(),
      onMcpUpdate: vi.fn((fn) => { cb = fn; return () => {} }),
    }
  })
  afterEach(() => { delete window.electronAPI; cb = null })

  it('insert 시 incoming.id 가 prev 의 matched.id 와 충돌해도 result id 유니크', () => {
    const setScenes = vi.fn()
    renderHook(() => useMcpServer(makeProps({ setScenes })))

    const prev = [
      { id: 'scene_1', _sceneNum: 1, image: 'imgA' },
      { id: 'scene_2', _sceneNum: 2, image: 'imgB' },
    ]

    // MCP bundler 가 scene=0 추가하면서 ids 를 [scene_1, scene_2, scene_3] 재발급
    cb({
      type: 'update-scenes',
      scenes: [
        { id: 'scene_1', _sceneNum: 0, prompt: 'NEW' }, // 신규
        { id: 'scene_2', _sceneNum: 1, prompt: 'A' },   // 매칭 → matched.id='scene_1'
        { id: 'scene_3', _sceneNum: 2, prompt: 'B' },   // 매칭 → matched.id='scene_2'
      ],
    })

    const updater = setScenes.mock.calls[0][0]
    const result = updater(prev)
    const ids = result.map(s => s.id)

    // 모든 id 유니크
    expect(new Set(ids).size).toBe(ids.length)
    // 기존 matched scenes 의 stable id 유지
    const sceneA = result.find(s => s._sceneNum === 1)
    const sceneB = result.find(s => s._sceneNum === 2)
    expect(sceneA.id).toBe('scene_1') // prev[0] 의 stable id
    expect(sceneB.id).toBe('scene_2') // prev[1] 의 stable id
    // 신규 씬은 충돌 안 하는 fresh id
    const sceneNew = result.find(s => s._sceneNum === 0)
    expect(sceneNew.id).not.toBe('scene_1')
    expect(sceneNew.id).not.toBe('scene_2')
    expect(sceneNew.id).toMatch(/^scene_\d+$/)
  })

  it('legacy MCP (_sceneNum 없음, id 만) 도 incoming 끼리 충돌 시 fresh id', () => {
    const setScenes = vi.fn()
    renderHook(() => useMcpServer(makeProps({ setScenes })))

    const prev = [
      { id: 'scene_1', prompt: 'A' },
    ]
    // incoming 두 행이 모두 id='scene_1' (잘못된 MCP 출력 가정) — 결과는 유니크여야
    cb({
      type: 'update-scenes',
      scenes: [
        { id: 'scene_1', prompt: 'A-refined' },
        { id: 'scene_1', prompt: 'DUP' },
      ],
    })
    const updater = setScenes.mock.calls[0][0]
    const result = updater(prev)
    const ids = result.map(s => s.id)
    expect(new Set(ids).size).toBe(ids.length)
  })
})
