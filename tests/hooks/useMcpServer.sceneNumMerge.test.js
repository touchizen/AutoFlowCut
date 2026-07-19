/**
 * useMcpServer — review R9 fix
 *
 * MCP update-scenes 가 incoming._sceneNum 으로 stable key 매칭 → reorder/insert
 * 시 generated image/imagePath/status 가 옳은 prompt 따라감.
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

describe('R9 — MCP update-scenes 가 _sceneNum 으로 매칭', () => {
  let cb = null
  beforeEach(() => {
    window.electronAPI = {
      startMcpHttp: vi.fn(),
      stopMcpHttp: vi.fn(),
      onMcpUpdate: vi.fn((fn) => { cb = fn; return () => {} }),
    }
  })
  afterEach(() => { delete window.electronAPI; cb = null })

  it('incoming._sceneNum 매칭 시 기존 image/imagePath/status 보존 (id 다를 때도)', () => {
    const setScenes = vi.fn()
    renderHook(() => useMcpServer(makeProps({ setScenes })))

    const prev = [
      { id: 'scene_old_A', _sceneNum: 1, prompt: 'A', image: 'img-A', mediaId: 'mA' },
      { id: 'scene_old_B', _sceneNum: 2, prompt: 'B', image: 'img-B', mediaId: 'mB' },
    ]

    // MCP bundler 가 새로 부여한 id (scene_1, scene_2) — 옛 id 와 다름
    cb({
      type: 'update-scenes',
      scenes: [
        { id: 'scene_1', _sceneNum: 2, prompt: 'B-refined' },
        { id: 'scene_2', _sceneNum: 1, prompt: 'A-refined' },
      ],
    })

    const updater = setScenes.mock.calls[0][0]
    const result = updater(prev)
    // result[0] sceneNum=2 → 매칭 prev[1] (B), image=img-B 보존
    expect(result[0]._sceneNum).toBe(2)
    expect(result[0].prompt).toBe('B-refined')
    expect(result[0].image).toBe('img-B')
    expect(result[0].mediaId).toBe('mB')
    // result[1] sceneNum=1 → 매칭 prev[0] (A), image=img-A 보존
    expect(result[1]._sceneNum).toBe(1)
    expect(result[1].prompt).toBe('A-refined')
    expect(result[1].image).toBe('img-A')
    expect(result[1].mediaId).toBe('mA')
  })

  it('새 _sceneNum (이전에 없음) 은 신규 씬으로 취급, image 없음', () => {
    const setScenes = vi.fn()
    renderHook(() => useMcpServer(makeProps({ setScenes })))

    const prev = [
      { id: 'scene_1', _sceneNum: 1, prompt: 'A', image: 'img-A' },
    ]
    cb({
      type: 'update-scenes',
      scenes: [
        { id: 'scene_new', _sceneNum: 99, prompt: 'NEW' },
      ],
    })

    const updater = setScenes.mock.calls[0][0]
    const result = updater(prev)
    expect(result[0]._sceneNum).toBe(99)
    expect(result[0].prompt).toBe('NEW')
    expect(result[0].image).toBeUndefined() // 신규 — image 안 가져옴
  })

  it('incoming 에 _sceneNum 없으면 id 로 fallback (legacy MCP 호환)', () => {
    const setScenes = vi.fn()
    renderHook(() => useMcpServer(makeProps({ setScenes })))

    const prev = [
      { id: 'scene_1', prompt: 'A', image: 'img-A' },
    ]
    cb({
      type: 'update-scenes',
      scenes: [
        { id: 'scene_1', prompt: 'A-refined' }, // _sceneNum 없음
      ],
    })

    const updater = setScenes.mock.calls[0][0]
    const result = updater(prev)
    expect(result[0].prompt).toBe('A-refined')
    expect(result[0].image).toBe('img-A')
  })

  it('update-scenes runtime merge preserves generation when incoming omits it', () => {
    const setScenes = vi.fn()
    renderHook(() => useMcpServer(makeProps({ setScenes })))
    const generation = {
      image: { provider: 'openai', model: 'gpt-image-1' },
      video: { t2v: { provider: 'grok', model: 'grok-imagine-video-1.5' } },
    }

    cb({
      type: 'update-scenes',
      scenes: [{ id: 'scene_1', _sceneNum: 1, prompt: 'updated without generation' }],
    })

    const result = setScenes.mock.calls[0][0]([
      { id: 'scene_1', _sceneNum: 1, prompt: 'old', generation },
    ])
    expect(result[0].generation).toEqual(generation)
  })
})
