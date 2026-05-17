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
    isRunning: false,  // Phase 2: anyRunning (scene + ref + video) — used for auto stop-restart
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

  it('__mcpStartRefBatch normalizes styleId correctly (and syncs UI for explicit IDs)', () => {
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

    // null/empty — must become null (auto mode), no UI sync
    setSelectedStyleRefId.mockClear()
    window.__mcpStartRefBatch(undefined)
    expect(handleGenerateAllRefs).toHaveBeenLastCalledWith(null)
    expect(setSelectedStyleRefId).not.toHaveBeenCalled()

    // 'preset:preset:*' / 'preset:ref:*' 회귀 가드 — double-wrap도 단 한번도 일어나지 않아야
    for (const call of setSelectedStyleRefId.mock.calls) {
      expect(call[0]).not.toMatch(/^preset:preset:/)
      expect(call[0]).not.toMatch(/^preset:ref:/)
    }
  })

  it('__mcpStartBatch (scene batch) normalizes explicit styleId correctly (and syncs UI)', () => {
    const handleStart = vi.fn()
    const setSelectedStyleRefId = vi.fn()
    renderHook(() => useMcpServer(makeProps({ handleStart, setSelectedStyleRefId })))

    window.__mcpStartBatch('preset:cinematic')
    expect(handleStart).toHaveBeenCalledWith('preset:cinematic')

    window.__mcpStartBatch('cinematic')  // legacy plain
    expect(handleStart).toHaveBeenCalledWith('preset:cinematic')

    window.__mcpStartBatch('ref:42')
    expect(handleStart).toHaveBeenCalledWith('ref:42')

    // double-wrap 회귀 가드 — setSelectedStyleRefId 호출 인자에 'preset:preset:*' 없어야
    for (const call of setSelectedStyleRefId.mock.calls) {
      expect(call[0]).not.toMatch(/^preset:preset:/)
      expect(call[0]).not.toMatch(/^preset:ref:/)
    }
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

  it('__mcpGenerateRef applies caller-side fallback when styleId omitted (no UI leak)', async () => {
    const handleGenerateRef = vi.fn(() => Promise.resolve({ success: true }))
    const refWithMedia = { id: 555, type: 'style', mediaId: 'm-555' }
    renderHook(() => useMcpServer(makeProps({
      handleGenerateRef,
      references: [refWithMedia],
      selectedStyleRefId: 'preset:noir',  // UI has a selection — must NOT leak through MCP
    })))

    await window.__mcpGenerateRef(0)
    // Override is the first style card, not the UI selection
    expect(handleGenerateRef).toHaveBeenCalledWith(0, false, 'ref:555')
  })

  it('__mcpGenerateRef finds prompt-only style card via findAutoStyle', async () => {
    const handleGenerateRef = vi.fn(() => Promise.resolve({ success: true }))
    const promptOnlyStyle = { id: 777, type: 'style', prompt: 'noir vibes' /* no mediaId */ }
    renderHook(() => useMcpServer(makeProps({
      handleGenerateRef,
      references: [promptOnlyStyle],
    })))

    await window.__mcpGenerateRef(0)
    expect(handleGenerateRef).toHaveBeenCalledWith(0, false, 'ref:777')
  })

  it('__mcpStartRefBatch applies caller-side fallback when styleId omitted (no UI leak)', () => {
    const handleGenerateAllRefs = vi.fn()
    const refWithMedia = { id: 555, type: 'style', mediaId: 'm-555' }
    renderHook(() => useMcpServer(makeProps({
      handleGenerateAllRefs,
      references: [refWithMedia],
      selectedStyleRefId: 'preset:noir',  // UI has a selection — must NOT leak through MCP
    })))

    window.__mcpStartRefBatch(undefined)
    expect(handleGenerateAllRefs).toHaveBeenCalledWith('ref:555')
  })

  it("__mcpStartRefBatch('auto') is silently ignored (refs have no per-scene matching)", () => {
    const handleGenerateAllRefs = vi.fn()
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    renderHook(() => useMcpServer(makeProps({ handleGenerateAllRefs })))

    window.__mcpStartRefBatch('auto')
    expect(handleGenerateAllRefs).toHaveBeenCalledWith(null)  // not 'preset:auto'
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('start-ref-batch received styleId="auto"'))

    warnSpy.mockRestore()
  })

  it("__mcpGenerateRef(_, 'auto') is silently ignored (refs have no per-scene matching)", async () => {
    const handleGenerateRef = vi.fn(() => Promise.resolve({ success: true }))
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    renderHook(() => useMcpServer(makeProps({ handleGenerateRef })))

    await window.__mcpGenerateRef(3, 'auto')
    expect(handleGenerateRef).toHaveBeenCalledWith(3, false, null)  // not 'preset:auto'
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('generate-reference received styleId="auto"'))

    warnSpy.mockRestore()
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

  it("__mcpStartBatch('none') passes 'none' sentinel through (downstream forces no style)", () => {
    const handleStart = vi.fn()
    const refWithMedia = { id: 555, type: 'style', mediaId: 'm-555' }
    renderHook(() => useMcpServer(makeProps({ handleStart, references: [refWithMedia] })))

    window.__mcpStartBatch('none')
    // 'none' must propagate end-to-end so styleService.resolveSceneStyle skips all style application.
    // null would have meant "auto-match per-scene" which is not what 'none' guarantees.
    expect(handleStart).toHaveBeenCalledWith('none')
  })

  it("__mcpStartRefBatch('none') passes 'none' sentinel through", () => {
    const handleGenerateAllRefs = vi.fn()
    const refWithMedia = { id: 555, type: 'style', mediaId: 'm-555' }
    renderHook(() => useMcpServer(makeProps({ handleGenerateAllRefs, references: [refWithMedia] })))

    window.__mcpStartRefBatch('none')
    expect(handleGenerateAllRefs).toHaveBeenCalledWith('none')
  })

  it("__mcpGenerateRef(_, 'none') passes 'none' sentinel through", async () => {
    const handleGenerateRef = vi.fn(() => Promise.resolve({ success: true }))
    const refWithMedia = { id: 555, type: 'style', mediaId: 'm-555' }
    renderHook(() => useMcpServer(makeProps({ handleGenerateRef, references: [refWithMedia] })))

    await window.__mcpGenerateRef(2, 'none')
    expect(handleGenerateRef).toHaveBeenCalledWith(2, false, 'none')
  })

  // --- Task 2: app_generate_scene styleId ---

  it('__mcpGenerateScene forwards styleId to handleGenerateScene (preset)', () => {
    const handleGenerateScene = vi.fn(() => Promise.resolve({ success: true }))
    renderHook(() => useMcpServer(makeProps({ handleGenerateScene })))

    window.__mcpGenerateScene('scene_42', 'preset:noir')
    expect(handleGenerateScene).toHaveBeenCalledWith('scene_42', 'preset:noir')
  })

  it("__mcpGenerateScene with styleId='none' passes 'none' through", () => {
    const handleGenerateScene = vi.fn(() => Promise.resolve({ success: true }))
    renderHook(() => useMcpServer(makeProps({ handleGenerateScene })))

    window.__mcpGenerateScene('scene_42', 'none')
    expect(handleGenerateScene).toHaveBeenCalledWith('scene_42', 'none')
  })

  it('__mcpGenerateScene without styleId passes undefined (UI default fallback)', () => {
    const handleGenerateScene = vi.fn(() => Promise.resolve({ success: true }))
    renderHook(() => useMcpServer(makeProps({ handleGenerateScene })))

    window.__mcpGenerateScene('scene_42')
    expect(handleGenerateScene).toHaveBeenCalledWith('scene_42', undefined)
  })

  // P2 fix: plain id ('noir') → 'preset:noir' wrap (다른 path들과 일관)
  it('__mcpGenerateScene wraps legacy plain id to preset: form', () => {
    const handleGenerateScene = vi.fn(() => Promise.resolve({ success: true }))
    renderHook(() => useMcpServer(makeProps({ handleGenerateScene })))

    window.__mcpGenerateScene('scene_42', 'noir')
    expect(handleGenerateScene).toHaveBeenCalledWith('scene_42', 'preset:noir')
  })

  it('__mcpGenerateScene passes ref:* through unchanged (no double-wrap)', () => {
    const handleGenerateScene = vi.fn(() => Promise.resolve({ success: true }))
    renderHook(() => useMcpServer(makeProps({ handleGenerateScene })))

    window.__mcpGenerateScene('scene_42', 'ref:1773499846144')
    expect(handleGenerateScene).toHaveBeenCalledWith('scene_42', 'ref:1773499846144')
  })

  it("__mcpGenerateScene with 'auto' passes 'auto' through (not normalized to preset:auto)", () => {
    const handleGenerateScene = vi.fn(() => Promise.resolve({ success: true }))
    renderHook(() => useMcpServer(makeProps({ handleGenerateScene })))

    window.__mcpGenerateScene('scene_42', 'auto')
    expect(handleGenerateScene).toHaveBeenCalledWith('scene_42', 'auto')
  })

  // --- Task 3: start-scene-batch force ---

  it('__mcpStartBatch passes { force: true } as second arg to handleStart', () => {
    const handleStart = vi.fn()
    const refWithMedia = { id: 555, type: 'style', mediaId: 'm-555' }
    renderHook(() => useMcpServer(makeProps({ handleStart, references: [refWithMedia] })))

    window.__mcpStartBatch('preset:cinematic', { force: true })
    expect(handleStart).toHaveBeenCalledWith('preset:cinematic', { force: true })
  })

  it('__mcpStartBatch without force keeps single-arg call (backward compat)', () => {
    const handleStart = vi.fn()
    renderHook(() => useMcpServer(makeProps({ handleStart })))

    window.__mcpStartBatch('preset:cinematic')
    // 백워드 호환 — 옵션 안 넘기면 handleStart도 1-arg 호출 (기존 테스트가 이 형태 기대)
    expect(handleStart).toHaveBeenCalledWith('preset:cinematic')
  })

  it("__mcpStartBatch('auto', { force: true }) forwards force with null override", () => {
    const handleStart = vi.fn()
    renderHook(() => useMcpServer(makeProps({ handleStart })))

    window.__mcpStartBatch('auto', { force: true })
    expect(handleStart).toHaveBeenCalledWith(null, { force: true })
  })

  it("__mcpStartBatch('none', { force: true }) forwards force with 'none' override", () => {
    const handleStart = vi.fn()
    renderHook(() => useMcpServer(makeProps({ handleStart })))

    window.__mcpStartBatch('none', { force: true })
    expect(handleStart).toHaveBeenCalledWith('none', { force: true })
  })

  // --- Task 4: start-ref-batch force ---

  it('__mcpStartRefBatch passes { force: true } as second arg to handleGenerateAllRefs', () => {
    const handleGenerateAllRefs = vi.fn()
    const refWithMedia = { id: 555, type: 'style', mediaId: 'm-555' }
    renderHook(() => useMcpServer(makeProps({ handleGenerateAllRefs, references: [refWithMedia] })))

    window.__mcpStartRefBatch('preset:cinematic', { force: true })
    expect(handleGenerateAllRefs).toHaveBeenCalledWith('preset:cinematic', { force: true })
  })

  it('__mcpStartRefBatch without force keeps single-arg call (backward compat)', () => {
    const handleGenerateAllRefs = vi.fn()
    renderHook(() => useMcpServer(makeProps({ handleGenerateAllRefs })))

    window.__mcpStartRefBatch('preset:cinematic')
    expect(handleGenerateAllRefs).toHaveBeenCalledWith('preset:cinematic')
  })

  it("__mcpStartRefBatch('auto', { force: true }) forwards force with null override", () => {
    const handleGenerateAllRefs = vi.fn()
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    renderHook(() => useMcpServer(makeProps({ handleGenerateAllRefs })))

    window.__mcpStartRefBatch('auto', { force: true })
    expect(handleGenerateAllRefs).toHaveBeenCalledWith(null, { force: true })
    warnSpy.mockRestore()
  })

  it("__mcpStartRefBatch('none', { force: true }) forwards force with 'none' override", () => {
    const handleGenerateAllRefs = vi.fn()
    renderHook(() => useMcpServer(makeProps({ handleGenerateAllRefs })))

    window.__mcpStartRefBatch('none', { force: true })
    expect(handleGenerateAllRefs).toHaveBeenCalledWith('none', { force: true })
  })

  // --- Task 5 (Phase 2): auto stop-restart when batch called during running ---

  it('__mcpStartBatch with isRunning=false starts immediately (no stop)', async () => {
    const handleStart = vi.fn()
    const handleStop = vi.fn()
    renderHook(() => useMcpServer(makeProps({
      isRunning: false,
      handleStart,
      handleStop,
    })))

    await window.__mcpStartBatch('preset:noir', { force: true })

    expect(handleStop).not.toHaveBeenCalled()
    expect(handleStart).toHaveBeenCalledWith('preset:noir', { force: true })
  })

  it('handleStartRef uses LATEST handleStart even when rerender happens DURING __mcpStartBatch async call (P0 stale closure)', async () => {
    // 회귀 컨텍스트 (P0 — live verify에서 발견):
    //   __mcpStartBatch는 async. 진행 중 stop-restart 경로에서:
    //   1. 호출 시작 (closure에 handleStart_v1 캡처, await waitForStopped)
    //   2. state 변경 (isRunning=false 됨) → re-render → handleStart_v2 생성
    //   3. useEffect 재실행 → window.__mcpStartBatch는 v2 binding으로 교체 — 하지만 이미 실행 중인
    //      v1 async frame은 자기 closure(handleStart_v1)로 계속 진행
    //   4. waitForStopped 해소 → v1 closure가 handleStart_v1 호출 — stale `isRunning=true`로 reject
    //
    //   handleStartRef 갱신을 useEffect가 매 render마다 하므로, ref.current는 항상 최신 v2.
    //   async 호출 중에도 ref를 보면 v2를 부른다.
    //
    //   ❌ 잘못된 재현: rerender 먼저 → window.__mcpStartBatch 호출 → useEffect가 이미 v2 바인딩으로
    //   교체했기 때문에 ref 없어도 통과 (예전 코드가 잡고 있던 stale closure를 거치지 않음).
    //   ✅ 올바른 재현: isRunning=true로 호출 시작 → await 중에 rerender → stop 후 어느 handler가 호출되나.
    vi.useFakeTimers()

    const handleStart_v1 = vi.fn()
    const handleStart_v2 = vi.fn()
    const handleStop = vi.fn()
    let currentIsRunning = true
    let currentHandleStart = handleStart_v1

    function Wrapper() {
      return useMcpServer(makeProps({
        isRunning: currentIsRunning,
        handleStart: currentHandleStart,
        handleStop,
      }))
    }
    const { rerender } = renderHook(Wrapper)

    // 1. async 호출 시작 — v1 closure가 stop-restart 분기 진입, waitForStopped pending
    const callPromise = window.__mcpStartBatch('preset:noir', { force: true })
    expect(handleStop).toHaveBeenCalled()
    expect(handleStart_v1).not.toHaveBeenCalled()
    expect(handleStart_v2).not.toHaveBeenCalled()

    // 2. 진행 중 re-render: 새 handleStart (v2), isRunning=false
    currentHandleStart = handleStart_v2
    currentIsRunning = false
    rerender()

    // 3. polling이 isRunning=false 감지 → waitForStopped 해소 → restart 호출
    await vi.advanceTimersByTimeAsync(100)
    await callPromise

    // ref fix가 없으면: v1만 호출됨 (stale).
    // ref fix가 있으면: v2 호출, v1은 호출 안 됨.
    expect(handleStart_v2).toHaveBeenCalledWith('preset:noir', { force: true })
    expect(handleStart_v1).not.toHaveBeenCalled()

    vi.useRealTimers()
  })

  it('handleGenerateAllRefsRef uses LATEST handler when rerender happens DURING __mcpStartRefBatch (symmetric to handleStartRef)', async () => {
    vi.useFakeTimers()

    const handleGenerateAllRefs_v1 = vi.fn()
    const handleGenerateAllRefs_v2 = vi.fn()
    const handleStop = vi.fn()
    let currentIsRunning = true
    let currentHandler = handleGenerateAllRefs_v1

    function Wrapper() {
      return useMcpServer(makeProps({
        isRunning: currentIsRunning,
        handleGenerateAllRefs: currentHandler,
        handleStop,
      }))
    }
    const { rerender } = renderHook(Wrapper)

    const callPromise = window.__mcpStartRefBatch('preset:noir', { force: true })
    expect(handleStop).toHaveBeenCalled()

    currentHandler = handleGenerateAllRefs_v2
    currentIsRunning = false
    rerender()

    await vi.advanceTimersByTimeAsync(100)
    await callPromise

    expect(handleGenerateAllRefs_v2).toHaveBeenCalledWith('preset:noir', { force: true })
    expect(handleGenerateAllRefs_v1).not.toHaveBeenCalled()

    vi.useRealTimers()
  })

  it('__mcpStartBatch with isRunning=true calls handleStop and waits before handleStart', async () => {
    vi.useFakeTimers()
    const handleStart = vi.fn()
    const handleStop = vi.fn()
    let isRunning = true

    function Wrapper() {
      // rerender 시 새 isRunning 값으로 hook 재실행 → useEffect가 isRunningRef 갱신
      return useMcpServer(makeProps({
        isRunning,
        handleStart,
        handleStop,
      }))
    }
    const { rerender } = renderHook(Wrapper)

    // 호출 → handleStop 즉시, handleStart는 아직 pending
    const callPromise = window.__mcpStartBatch('preset:noir', { force: true })
    expect(handleStop).toHaveBeenCalled()
    expect(handleStart).not.toHaveBeenCalled()

    // running 상태 flip
    isRunning = false
    rerender()

    // polling이 다음 tick에서 isRunning=false 감지
    await vi.advanceTimersByTimeAsync(100)
    await callPromise

    expect(handleStart).toHaveBeenCalledWith('preset:noir', { force: true })
    vi.useRealTimers()
  })

  it('__mcpStartBatch waitForStopped timeout: handleStart NOT called', async () => {
    vi.useFakeTimers()
    const handleStart = vi.fn()
    const handleStop = vi.fn()
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    renderHook(() => useMcpServer(makeProps({
      isRunning: true,
      handleStart,
      handleStop,
    })))

    const callPromise = window.__mcpStartBatch('preset:noir', { force: true })
    await vi.advanceTimersByTimeAsync(31000)  // > 30s timeout
    await callPromise

    expect(handleStop).toHaveBeenCalled()
    expect(handleStart).not.toHaveBeenCalled()
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('stop timeout'))

    warnSpy.mockRestore()
    vi.useRealTimers()
  })

  it('__mcpStartRefBatch with isRunning=true also auto-stops and restarts', async () => {
    vi.useFakeTimers()
    const handleGenerateAllRefs = vi.fn()
    const handleStop = vi.fn()
    let isRunning = true

    function Wrapper() {
      return useMcpServer(makeProps({
        isRunning,
        handleGenerateAllRefs,
        handleStop,
      }))
    }
    const { rerender } = renderHook(Wrapper)

    const callPromise = window.__mcpStartRefBatch('preset:noir', { force: true })
    expect(handleStop).toHaveBeenCalled()
    expect(handleGenerateAllRefs).not.toHaveBeenCalled()

    isRunning = false
    rerender()
    await vi.advanceTimersByTimeAsync(100)
    await callPromise

    expect(handleGenerateAllRefs).toHaveBeenCalledWith('preset:noir', { force: true })
    vi.useRealTimers()
  })

  // --- Task 6 (Phase 2): selectedStyleRefId sync — UI 버튼 라벨 자동 갱신 ---

  it("__mcpStartBatch with explicit 'preset:noir' updates selectedStyleRefId", async () => {
    const setSelectedStyleRefId = vi.fn()
    renderHook(() => useMcpServer(makeProps({ setSelectedStyleRefId })))

    await window.__mcpStartBatch('preset:noir')
    expect(setSelectedStyleRefId).toHaveBeenCalledWith('preset:noir')
  })

  it("__mcpStartBatch with 'ref:123' updates selectedStyleRefId", async () => {
    const setSelectedStyleRefId = vi.fn()
    renderHook(() => useMcpServer(makeProps({ setSelectedStyleRefId })))

    await window.__mcpStartBatch('ref:123')
    expect(setSelectedStyleRefId).toHaveBeenCalledWith('ref:123')
  })

  it("__mcpStartBatch with plain id (legacy) updates selectedStyleRefId to wrapped form", async () => {
    const setSelectedStyleRefId = vi.fn()
    renderHook(() => useMcpServer(makeProps({ setSelectedStyleRefId })))

    await window.__mcpStartBatch('korean-ani')
    expect(setSelectedStyleRefId).toHaveBeenCalledWith('preset:korean-ani')
  })

  it("__mcpStartBatch with 'auto' does NOT update selectedStyleRefId", async () => {
    const setSelectedStyleRefId = vi.fn()
    renderHook(() => useMcpServer(makeProps({ setSelectedStyleRefId })))

    await window.__mcpStartBatch('auto')
    expect(setSelectedStyleRefId).not.toHaveBeenCalled()
  })

  it("__mcpStartBatch with 'none' does NOT update selectedStyleRefId", async () => {
    const setSelectedStyleRefId = vi.fn()
    renderHook(() => useMcpServer(makeProps({ setSelectedStyleRefId })))

    await window.__mcpStartBatch('none')
    expect(setSelectedStyleRefId).not.toHaveBeenCalled()
  })

  it('__mcpStartBatch with undefined styleId does NOT update selectedStyleRefId', async () => {
    const setSelectedStyleRefId = vi.fn()
    renderHook(() => useMcpServer(makeProps({ setSelectedStyleRefId })))

    await window.__mcpStartBatch(undefined)
    expect(setSelectedStyleRefId).not.toHaveBeenCalled()
  })

  it("__mcpStartRefBatch with explicit 'preset:noir' updates selectedStyleRefId", async () => {
    const setSelectedStyleRefId = vi.fn()
    renderHook(() => useMcpServer(makeProps({ setSelectedStyleRefId })))

    await window.__mcpStartRefBatch('preset:noir')
    expect(setSelectedStyleRefId).toHaveBeenCalledWith('preset:noir')
  })

  it("__mcpStartRefBatch with 'auto' does NOT update selectedStyleRefId", async () => {
    const setSelectedStyleRefId = vi.fn()
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    renderHook(() => useMcpServer(makeProps({ setSelectedStyleRefId })))

    await window.__mcpStartRefBatch('auto')
    expect(setSelectedStyleRefId).not.toHaveBeenCalled()
    warnSpy.mockRestore()
  })

  it("__mcpStartRefBatch with 'none' does NOT update selectedStyleRefId", async () => {
    const setSelectedStyleRefId = vi.fn()
    renderHook(() => useMcpServer(makeProps({ setSelectedStyleRefId })))

    await window.__mcpStartRefBatch('none')
    expect(setSelectedStyleRefId).not.toHaveBeenCalled()
  })

  // --- P1 fix: refBatchRunning prop (preparing/stopping/generating 통합) ---
  // generatingRefs.length만으로는 prepare 구간(폴더/토큰 체크 ~ 첫 submit 사이)을 못 잡아서
  // MCP 호출 중복 진행 회귀 가능. refBatchRunning prop이 그 gap을 메운다.

  it('__mcpStartRefBatch with refBatchRunning=true (preparing) auto-stops and restarts', async () => {
    vi.useFakeTimers()
    const handleGenerateAllRefs = vi.fn()
    const handleStop = vi.fn()
    let refBatchRunning = true

    function Wrapper() {
      return useMcpServer(makeProps({
        // isRunning은 false지만 refBatchRunning=true → stop-restart 발동해야
        isRunning: refBatchRunning,
        refBatchRunning,
        generatingRefs: [],  // preparing 구간이라 아직 비어있음
        handleGenerateAllRefs,
        handleStop,
      }))
    }
    const { rerender } = renderHook(Wrapper)

    const callPromise = window.__mcpStartRefBatch('preset:noir', { force: true })
    expect(handleStop).toHaveBeenCalled()
    expect(handleGenerateAllRefs).not.toHaveBeenCalled()

    // batch가 stop되어 flag 내려감
    refBatchRunning = false
    rerender()
    await vi.advanceTimersByTimeAsync(100)
    await callPromise

    expect(handleGenerateAllRefs).toHaveBeenCalledWith('preset:noir', { force: true })
    vi.useRealTimers()
  })

  it('__mcpBatchStatus.ref.isRunning reflects refBatchRunning (P1 gap fix)', () => {
    const result = renderHook(() => useMcpServer(makeProps({
      refBatchRunning: true,
      generatingRefs: [],  // preparing 구간 — generatingRefs는 비어있어도
    })))
    // useMcpServer 호출 직후 __mcpBatchStatus 등록됨
    expect(window.__mcpBatchStatus().ref.isRunning).toBe(true)

    // Cleanup
    result.unmount()
  })

  // --- 회귀 가드: style 카드도 batch가 생성하므로 ref status에 포함돼야 ---
  // 이전엔 style을 batch 대상 아님으로 취급 → style-only batch가 { total: 0, generating: 1 }
  // 같은 모순된 상태를 보고함. style을 prompt 기준 total에 포함 + done helper로 카운트.

  it('__mcpBatchStatus counts a generating style card in ref.total (not 0)', () => {
    // style 카드 1개, prompt 있음, index 0이 생성 중 (generatingRefs).
    const result = renderHook(() => useMcpServer(makeProps({
      references: [{ id: 1, type: 'style', prompt: 'noir vibes' }],
      generatingRefs: [0],
    })))
    const ref = window.__mcpBatchStatus().ref
    // total은 style을 포함 → 최소 1 (예전 회귀에선 0)
    expect(ref.total).toBeGreaterThanOrEqual(1)
    expect(ref.generating).toBeGreaterThanOrEqual(1)
    // 내부 일관성: generating이 total을 넘지 않음, done은 아직 0
    expect(ref.total).toBeGreaterThanOrEqual(ref.generating)
    expect(ref.done).toBe(0)

    result.unmount()
  })

  it('__mcpBatchStatus counts a completed style card in ref.done', () => {
    // style 카드 완료: mediaId 있음, status done, generatingRefs 비어있음.
    const result = renderHook(() => useMcpServer(makeProps({
      references: [{ id: 1, type: 'style', prompt: 'noir vibes', status: 'done', mediaId: 'm-1' }],
      generatingRefs: [],
    })))
    const ref = window.__mcpBatchStatus().ref
    expect(ref.total).toBeGreaterThanOrEqual(1)
    expect(ref.done).toBeGreaterThanOrEqual(1)
    expect(ref.generating).toBe(0)

    result.unmount()
  })

  it('__mcpBatchStatus: prompt 없는 수동 업로드 ref가 done>total 모순을 만들지 않는다', () => {
    // prompt 없이 mediaId만 있는 수동 업로드 ref — total(prompt 기준)엔 안 들어가는데
    // done이 전체 references에 적용되면 done>total 모순. total/done은 같은 모집단이어야 한다.
    const result = renderHook(() => useMcpServer(makeProps({
      references: [
        { id: 1, type: 'style', mediaId: 'm-1', status: 'done' },     // prompt 없음
        { id: 2, type: 'character', mediaId: 'm-2', status: 'done' },  // prompt 없음
      ],
      generatingRefs: [],
    })))
    const ref = window.__mcpBatchStatus().ref
    expect(ref.done).toBeLessThanOrEqual(ref.total)
    // prompt 없는 ref는 total/done 양쪽 모두에서 제외
    expect(ref.total).toBe(0)
    expect(ref.done).toBe(0)

    result.unmount()
  })
})

describe("styleService — 'none' sentinel end-to-end", () => {
  it("resolveSceneStyle('none') skips auto-match and preset fallback", async () => {
    const { resolveSceneStyle } = await import('../../src/services/styleService')
    const allMatched = [{ id: 1, type: 'style', name: 'noir', prompt: 'noir' }]
    const matchedRefs = []
    const result = resolveSceneStyle(
      'a samurai',
      allMatched,
      'none',  // selectedStyleRefId = 'none'
      [],
      matchedRefs,
      'noir'
    )
    expect(result.appliedStyle).toBe('none')
    expect(result.styledPrompt).toBe('a samurai')  // unchanged
  })

  it("applyStyle('none') returns prompt unchanged with empty styleRefImages", async () => {
    const { applyStyle } = await import('../../src/services/styleService')
    const styleRef = { id: 1, type: 'style', prompt: 'noir', mediaId: 'm-1' }
    const result = applyStyle('a samurai', 'none', [styleRef], [])
    expect(result.styledPrompt).toBe('a samurai')
    expect(result.styleRefImages).toEqual([])
  })
})
