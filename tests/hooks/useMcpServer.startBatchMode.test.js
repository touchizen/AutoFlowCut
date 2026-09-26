/**
 * useMcpServer — start-scene-batch `mode` → handleStart tab override
 *
 * MCP 의 start-scene-batch 는 UI 의 현재 탭(activeTab)으로 이미지/비디오가 갈렸다.
 * 에이전트가 T2V 배치를 돌리려면 사용자가 손으로 비디오 탭을 눌러야 했으므로,
 * `mode: 'video' | 'image'` 를 받아 handleStart 에 `tab` 오버라이드로 넘긴다.
 * mode 를 생략하면 옛 동작(현재 탭) 그대로 — options 에 tab 키가 생기지 않아야 한다.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useMcpServer } from '../../src/hooks/useMcpServer'

function makeProps(overrides = {}) {
  return {
    settings: { mcpHttpEnabled: false, mcpHttpPort: 3210 },
    scenes: [], setScenes: vi.fn(), references: [], setReferences: vi.fn(),
    handleGenerateRef: vi.fn(), handleGenerateScene: vi.fn(), handleGenerateAllRefs: vi.fn(),
    handleStart: vi.fn(), handleStop: vi.fn(), handleProjectChange: vi.fn(), handleExportConfirm: vi.fn(),
    selectedStyleRefId: null, setSelectedStyleRefId: vi.fn(), refreshReviews: vi.fn(),
    audioReviews: [], importByPath: vi.fn(), audioPackage: null,
    automationState: { isRunning: false, isPaused: false, progress: { current: 0, total: 0 }, status: 'idle', statusMessage: '' },
    videoAutomation: {}, generatingRefs: [], isRunning: false,
    ...overrides,
  }
}

describe('MCP start-scene-batch mode → handleStart tab override', () => {
  let cb = null
  beforeEach(() => {
    window.electronAPI = { startMcpHttp: vi.fn(), stopMcpHttp: vi.fn(), onMcpUpdate: vi.fn((fn) => { cb = fn; return () => {} }) }
  })
  afterEach(() => { delete window.electronAPI; cb = null })

  it("mode:'video' → handleStart 에 tab:'video-text' 전달", () => {
    const handleStart = vi.fn()
    renderHook(() => useMcpServer(makeProps({ handleStart })))
    cb({ type: 'start-scene-batch', styleId: 'preset:cinematic', mode: 'video' })
    expect(handleStart).toHaveBeenCalledWith('preset:cinematic', { source: 'mcp', tab: 'video-text' })
  })

  it("mode:'image' → tab:'text' 전달 (비디오 탭에 있어도 이미지 배치 강제)", () => {
    const handleStart = vi.fn()
    renderHook(() => useMcpServer(makeProps({ handleStart })))
    cb({ type: 'start-scene-batch', styleId: 'preset:cinematic', mode: 'image', force: true })
    expect(handleStart).toHaveBeenCalledWith('preset:cinematic', { force: true, source: 'mcp', tab: 'text' })
  })

  it('mode 생략 → tab 키 없음 (현재 탭 그대로, 옛 호출자 호환)', () => {
    const handleStart = vi.fn()
    renderHook(() => useMcpServer(makeProps({ handleStart })))
    cb({ type: 'start-scene-batch', styleId: 'preset:cinematic', force: true })
    expect(handleStart).toHaveBeenCalledWith('preset:cinematic', { force: true, source: 'mcp' })
  })

  it('알 수 없는 mode → tab 키 없음', () => {
    const handleStart = vi.fn()
    renderHook(() => useMcpServer(makeProps({ handleStart })))
    cb({ type: 'start-scene-batch', styleId: 'preset:cinematic', mode: 'f2v' })
    expect(handleStart).toHaveBeenCalledWith('preset:cinematic', { source: 'mcp' })
  })

  // M2-LIVE N7(A5): MCP_BATCH_MODE_TAB[mode] 는 평범한 객체 조회라 'constructor'·'toString'·'__proto__' 가 truthy 비문자열(함수·객체)을 내어 setActiveTab(fn) 이
  //   React 업데이터로 적용돼 탭 UI 가 깨졌다. 자기 키(Object.hasOwn)만 탭이다.
  it.each(['constructor', 'toString', '__proto__', 'hasOwnProperty'])("프로토타입 키 mode=%s → tab 키 없음(함수·객체가 tab 으로 새지 않는다) (M2-LIVE N7)", (mode) => {
    const handleStart = vi.fn()
    renderHook(() => useMcpServer(makeProps({ handleStart })))
    cb({ type: 'start-scene-batch', styleId: 'preset:cinematic', mode })
    expect(handleStart).toHaveBeenCalledWith('preset:cinematic', { source: 'mcp' })
    expect(handleStart.mock.calls[0][1]).not.toHaveProperty('tab')
  })
})
