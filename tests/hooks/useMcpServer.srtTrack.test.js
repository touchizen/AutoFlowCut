/**
 * useMcpServer — Phase 11: MCP srtTrack handlers
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

describe('useMcpServer — Phase 11 srtTrack routing', () => {
  let mcpUpdateCallback = null

  beforeEach(() => {
    window.electronAPI = {
      startMcpHttp: vi.fn(),
      stopMcpHttp: vi.fn(),
      onMcpUpdate: vi.fn((cb) => {
        mcpUpdateCallback = cb
        return () => { mcpUpdateCallback = null }
      }),
    }
  })

  afterEach(() => {
    delete window.electronAPI
    mcpUpdateCallback = null
  })

  it('update-scenes 에 srtTrack 동봉 → setSrtTrack 호출됨', () => {
    const setSrtTrack = vi.fn()
    renderHook(() => useMcpServer(makeProps({ srtTrack: [], setSrtTrack })))
    expect(mcpUpdateCallback).toBeTruthy()

    const srtTrack = [
      { id: 'sub_1', startTime: 0, endTime: 1, text: 'a' },
      { id: 'sub_2', startTime: 1, endTime: 2, text: 'b' },
    ]
    mcpUpdateCallback({
      type: 'update-scenes',
      scenes: [{ id: 's1' }, { id: 's2' }],
      srtTrack,
    })
    expect(setSrtTrack).toHaveBeenCalledWith(srtTrack)
  })

  it('update-scenes 에 srtTrack 없으면 setSrtTrack 호출 안 됨', () => {
    const setSrtTrack = vi.fn()
    renderHook(() => useMcpServer(makeProps({ srtTrack: [], setSrtTrack })))

    mcpUpdateCallback({
      type: 'update-scenes',
      scenes: [{ id: 's1' }],
    })
    expect(setSrtTrack).not.toHaveBeenCalled()
  })

  it('update-srt-track 메시지 → setSrtTrack 호출', () => {
    const setSrtTrack = vi.fn()
    renderHook(() => useMcpServer(makeProps({ srtTrack: [], setSrtTrack })))

    const srtTrack = [{ id: 'sub_1', startTime: 0, endTime: 1, text: 'x' }]
    mcpUpdateCallback({ type: 'update-srt-track', srtTrack })
    expect(setSrtTrack).toHaveBeenCalledWith(srtTrack)
  })

  it('setSrtTrack 없으면 (옛 caller) 안전하게 무시', () => {
    renderHook(() => useMcpServer(makeProps()))
    expect(() => {
      mcpUpdateCallback({
        type: 'update-srt-track',
        srtTrack: [{ id: 'sub_1', startTime: 0, endTime: 1, text: 'y' }],
      })
    }).not.toThrow()
  })
})
