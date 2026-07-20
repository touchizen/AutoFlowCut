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
      { id: 'scene_old_A', _sceneNum: 1, prompt: 'A', image: 'img-A', mediaId: 'mA', generatedAt: 100, upscaledAt: 101 },
      { id: 'scene_old_B', _sceneNum: 2, prompt: 'B', image: 'img-B', mediaId: 'mB', generatedAt: 200, upscaledAt: 201 },
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
    expect(result[0].generatedAt).toBe(200)
    expect(result[0].upscaledAt).toBe(201)
    // result[1] sceneNum=1 → 매칭 prev[0] (A), image=img-A 보존
    expect(result[1]._sceneNum).toBe(1)
    expect(result[1].prompt).toBe('A-refined')
    expect(result[1].image).toBe('img-A')
    expect(result[1].mediaId).toBe('mA')
    expect(result[1].generatedAt).toBe(100)
    expect(result[1].upscaledAt).toBe(101)
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
      { id: 'scene_1', prompt: 'A', image: 'img-A', generatedAt: 300, upscaledAt: 301 },
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
    expect(result[0].generatedAt).toBe(300)
    expect(result[0].upscaledAt).toBe(301)
  })

  it('update-scene 이미지 교체는 명시된 upscaledAt이 없을 때 업스케일 마커를 비운다', () => {
    const setScenes = vi.fn()
    renderHook(() => useMcpServer(makeProps({ setScenes })))

    cb({
      type: 'update-scene',
      index: 0,
      fields: { imagePath: '/new/scene_1.png' },
    })

    const updater = setScenes.mock.calls[0][0]
    const [updated] = updater([{
      id: 'scene_1',
      imagePath: '/old/scene_1.png',
      upscaledAt: 999,
      upscaled_size: { width: 4000, height: 3000 },
      donePrompt: 'old baseline prompt',
    }])
    expect(updated).toMatchObject({
      imagePath: '/new/scene_1.png',
      upscaledAt: null,
      upscaled_size: null,
      // 이미지 교체 = 새 baseline → main 의 donePrompt 불변식도 함께 클리어(merge 교차 갭 방지).
      donePrompt: null,
    })
  })

  it('update-scene이 donePrompt를 명시하면 자동 reset으로 덮지 않는다', () => {
    const setScenes = vi.fn()
    renderHook(() => useMcpServer(makeProps({ setScenes })))

    cb({
      type: 'update-scene',
      index: 0,
      fields: { image: 'NEW', donePrompt: 'explicit' },
    })

    const updater = setScenes.mock.calls[0][0]
    const [updated] = updater([{ id: 'scene_1', donePrompt: 'old' }])
    expect(updated.donePrompt).toBe('explicit')
  })

  it('update-scene이 upscaledAt을 명시하면 자동 reset으로 덮지 않는다', () => {
    const setScenes = vi.fn()
    renderHook(() => useMcpServer(makeProps({ setScenes })))

    cb({
      type: 'update-scene',
      index: 0,
      fields: { image: 'NEW', upscaledAt: 1234 },
    })

    const updater = setScenes.mock.calls[0][0]
    const [updated] = updater([{ id: 'scene_1', upscaledAt: 999 }])
    expect(updated.image).toBe('NEW')
    expect(updated.upscaledAt).toBe(1234)
  })
})
