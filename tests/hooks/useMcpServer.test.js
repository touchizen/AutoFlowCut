/**
 * useMcpServer — MCP 글로벌 핸들러 회귀 테스트
 *
 * 핵심 회귀 가드:
 *   - window.__mcpGenerateRef가 styleId를 override로 직접 forward (race 없음)
 *   - 전역 setSelectedStyleRefId를 부르지 않음 (전역 상태 누수 없음)
 *   - 배치 핸들러도 normalizeStyleId 후 override만 전달, 전역 상태 변경 없음
 *
 * 이 테스트가 깨지면 setTimeout race나 'preset:preset:*' 더블 wrap 회귀가 다시 들어왔다는 신호.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useMcpServer } from '../../src/hooks/useMcpServer'

const noop = () => undefined

function makeProps(overrides = {}) {
  return {
    settings: { mcpHttpEnabled: false, mcpHttpPort: 3210 },
    scenes: [],
    setScenes: vi.fn(),
    references: [],
    setReferences: vi.fn(),
    handleGenerateRef: vi.fn(() => Promise.resolve({ success: true })),
    handleGenerateScene: vi.fn(() => Promise.resolve({ success: true })),
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
    ...overrides,
  }
}

describe('useMcpServer — global handlers (regression guards)', () => {
  beforeEach(() => {
    // electronAPI는 useEffect의 startMcpHttp/stopMcpHttp가 호출 시도
    window.electronAPI = {
      startMcpHttp: vi.fn(),
      stopMcpHttp: vi.fn(),
    }
  })

  afterEach(() => {
    delete window.__mcpGenerateRef
    delete window.__mcpStartRefBatch
    delete window.__mcpStartBatch
    delete window.__mcpSetStyle
    delete window.electronAPI
  })

  it('registers __mcpGenerateRef on mount', () => {
    renderHook(() => useMcpServer(makeProps()))
    expect(typeof window.__mcpGenerateRef).toBe('function')
  })

  it('__mcpGenerateRef forwards (index, false, normalized styleId) to handleGenerateRef', async () => {
    const handleGenerateRef = vi.fn(() => Promise.resolve({ success: true }))
    const setSelectedStyleRefId = vi.fn()
    renderHook(() => useMcpServer(makeProps({ handleGenerateRef, setSelectedStyleRefId })))

    await window.__mcpGenerateRef(2, 'preset:noir')

    expect(handleGenerateRef).toHaveBeenCalledTimes(1)
    expect(handleGenerateRef).toHaveBeenCalledWith(2, false, 'preset:noir')
    // 전역 누수 가드 — setSelectedStyleRefId는 호출되면 안 됨
    expect(setSelectedStyleRefId).not.toHaveBeenCalled()
  })

  it('__mcpGenerateRef normalizes plain id (legacy MCP shape)', async () => {
    const handleGenerateRef = vi.fn(() => Promise.resolve({ success: true }))
    renderHook(() => useMcpServer(makeProps({ handleGenerateRef })))

    await window.__mcpGenerateRef(0, 'korean-ani')
    expect(handleGenerateRef).toHaveBeenCalledWith(0, false, 'preset:korean-ani')
  })

  it('__mcpGenerateRef passes ref:* through unchanged (no double-wrap)', async () => {
    const handleGenerateRef = vi.fn(() => Promise.resolve({ success: true }))
    renderHook(() => useMcpServer(makeProps({ handleGenerateRef })))

    await window.__mcpGenerateRef(1, 'ref:1773499846144')
    expect(handleGenerateRef).toHaveBeenCalledWith(1, false, 'ref:1773499846144')
  })

  it('__mcpGenerateRef passes null for omitted styleId (auto mode)', async () => {
    const handleGenerateRef = vi.fn(() => Promise.resolve({ success: true }))
    renderHook(() => useMcpServer(makeProps({ handleGenerateRef })))

    await window.__mcpGenerateRef(0, undefined)
    expect(handleGenerateRef).toHaveBeenCalledWith(0, false, null)

    await window.__mcpGenerateRef(0, '')
    expect(handleGenerateRef).toHaveBeenCalledWith(0, false, null)
  })

  it('__mcpStartRefBatch normalizes styleId and never mutates global state', () => {
    const handleGenerateAllRefs = vi.fn()
    const setSelectedStyleRefId = vi.fn()
    renderHook(() => useMcpServer(makeProps({ handleGenerateAllRefs, setSelectedStyleRefId })))

    // legacy plain id — must wrap to preset:, not preset:preset:
    window.__mcpStartRefBatch('korean-ani')
    expect(handleGenerateAllRefs).toHaveBeenCalledWith('preset:korean-ani')

    // already preset: — must pass through unchanged
    window.__mcpStartRefBatch('preset:noir')
    expect(handleGenerateAllRefs).toHaveBeenCalledWith('preset:noir')

    // ref: — must pass through unchanged (was 'preset:ref:123' before fix)
    window.__mcpStartRefBatch('ref:123')
    expect(handleGenerateAllRefs).toHaveBeenCalledWith('ref:123')

    // null/empty — must become null (auto mode)
    window.__mcpStartRefBatch(undefined)
    expect(handleGenerateAllRefs).toHaveBeenLastCalledWith(null)

    // 전역 누수 가드 — setSelectedStyleRefId는 한 번도 호출되면 안 됨
    expect(setSelectedStyleRefId).not.toHaveBeenCalled()
  })

  it('__mcpStartBatch (scene batch) normalizes explicit styleId and does not leak global state', () => {
    const handleStart = vi.fn()
    const setSelectedStyleRefId = vi.fn()
    renderHook(() => useMcpServer(makeProps({ handleStart, setSelectedStyleRefId })))

    window.__mcpStartBatch('preset:cinematic')
    expect(handleStart).toHaveBeenCalledWith('preset:cinematic')

    window.__mcpStartBatch('cinematic')  // legacy plain
    expect(handleStart).toHaveBeenCalledWith('preset:cinematic')

    window.__mcpStartBatch('ref:42')
    expect(handleStart).toHaveBeenCalledWith('ref:42')

    expect(setSelectedStyleRefId).not.toHaveBeenCalled()
  })

  it('__mcpStartBatch falls back to first style card when styleId omitted (MCP automation default)', () => {
    const handleStart = vi.fn()
    const refWithMedia = { id: 555, type: 'style', mediaId: 'm-555' }
    renderHook(() => useMcpServer(makeProps({
      handleStart,
      references: [{ id: 1, type: 'character' }, refWithMedia, { id: 999, type: 'style' /* no mediaId */ }],
    })))

    window.__mcpStartBatch(undefined)
    expect(handleStart).toHaveBeenCalledWith('ref:555')

    window.__mcpStartBatch('')
    expect(handleStart).toHaveBeenLastCalledWith('ref:555')

    window.__mcpStartBatch(null)
    expect(handleStart).toHaveBeenLastCalledWith('ref:555')
  })

  it('__mcpStartBatch passes null when styleId omitted AND no usable style card exists', () => {
    const handleStart = vi.fn()
    renderHook(() => useMcpServer(makeProps({
      handleStart,
      references: [{ id: 1, type: 'character' }],  // no style card with mediaId
    })))

    window.__mcpStartBatch(undefined)
    expect(handleStart).toHaveBeenCalledWith(null)
  })

  it("__mcpStartBatch('auto') forces per-scene matching (skips first-card fallback)", () => {
    const handleStart = vi.fn()
    const refWithMedia = { id: 555, type: 'style', mediaId: 'm-555' }
    renderHook(() => useMcpServer(makeProps({
      handleStart,
      references: [refWithMedia],  // first-card fallback would otherwise pick this
    })))

    // 'auto' sentinel → caller explicitly wants per-scene matching, no fallback
    window.__mcpStartBatch('auto')
    expect(handleStart).toHaveBeenCalledWith(null)

    // Sanity: same setup, undefined styleId would pick the fallback (proves the sentinel changes behavior)
    handleStart.mockClear()
    window.__mcpStartBatch(undefined)
    expect(handleStart).toHaveBeenCalledWith('ref:555')
  })
})
