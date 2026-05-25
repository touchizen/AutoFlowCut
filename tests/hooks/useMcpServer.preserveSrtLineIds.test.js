/**
 * useMcpServer — C9 fix: srtTrack 없이 update-scenes 와도 srtLineIds 보존
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useMcpServer } from '../../src/hooks/useMcpServer'

function makeProps(overrides = {}) {
  return {
    settings: { mcpHttpEnabled: false, mcpHttpPort: 3210 },
    scenes: [
      { id: 'scene_1', prompt: 'P1', srtLineIds: ['sub_1', 'sub_2'], image: 'img1' },
    ],
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

describe('useMcpServer — C9 fix: preserve srtLineIds', () => {
  let mcpUpdateCallback = null

  beforeEach(() => {
    window.electronAPI = {
      startMcpHttp: vi.fn(),
      stopMcpHttp: vi.fn(),
      onMcpUpdate: vi.fn((cb) => { mcpUpdateCallback = cb; return () => {} }),
    }
  })

  afterEach(() => {
    delete window.electronAPI
    mcpUpdateCallback = null
  })

  it('incoming 씬이 srtLineIds 없으면 기존 srtLineIds 보존', () => {
    const setScenes = vi.fn()
    renderHook(() => useMcpServer(makeProps({ setScenes })))

    mcpUpdateCallback({
      type: 'update-scenes',
      scenes: [
        { id: 'scene_1', prompt: 'P1-Refined' }, // srtLineIds 없음
      ],
    })

    // setScenes 의 updater 호출 → 인자로 함수 받음 → 함수 실행해서 결과 확인
    expect(setScenes).toHaveBeenCalled()
    const updater = setScenes.mock.calls[0][0]
    const prev = [{ id: 'scene_1', prompt: 'P1', srtLineIds: ['sub_1', 'sub_2'], image: 'img1' }]
    const result = updater(prev)
    expect(result[0].srtLineIds).toEqual(['sub_1', 'sub_2']) // 보존
    expect(result[0].image).toBe('img1')
    expect(result[0].prompt).toBe('P1-Refined') // 갱신
  })

  it('incoming 씬이 srtLineIds 명시하면 그 값 사용', () => {
    const setScenes = vi.fn()
    renderHook(() => useMcpServer(makeProps({ setScenes })))

    mcpUpdateCallback({
      type: 'update-scenes',
      scenes: [
        { id: 'scene_1', srtLineIds: ['sub_9'] },
      ],
    })

    const updater = setScenes.mock.calls[0][0]
    const prev = [{ id: 'scene_1', srtLineIds: ['sub_1', 'sub_2'] }]
    const result = updater(prev)
    expect(result[0].srtLineIds).toEqual(['sub_9'])
  })

  it('새 씬 (existing 없음) 은 incoming.srtLineIds 또는 빈 배열', () => {
    const setScenes = vi.fn()
    renderHook(() => useMcpServer(makeProps({ setScenes })))

    mcpUpdateCallback({
      type: 'update-scenes',
      scenes: [
        { id: 'scene_new', prompt: 'NEW' },
      ],
    })

    const updater = setScenes.mock.calls[0][0]
    const result = updater([]) // 빈 prev
    expect(result[0].id).toBe('scene_new')
  })
})
