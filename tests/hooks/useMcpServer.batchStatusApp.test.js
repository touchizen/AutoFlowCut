/**
 * useMcpServer — __mcpBatchStatus 에 app 상태 + T2V 카운트 노출
 *
 * MCP 배치가 preflight(Flow 로그인/프로젝트 준비/탭)에서 조용히 return 하면 에이전트는
 * "isRunning:false" 만 보고 원인을 알 수 없다. batch-status 에 mode/flowProjectReady/activeTab 과
 * videoT2VStatus 카운트를 실어 밖에서 진단할 수 있게 한다.
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
    videoAutomation: { isRunning: false, isPaused: false, progress: { current: 0, total: 0 }, status: 'idle', statusMessage: '' },
    generatingRefs: [], isRunning: false,
    ...overrides,
  }
}

describe('MCP batch-status — app 상태 + video 카운트', () => {
  beforeEach(() => {
    window.electronAPI = { startMcpHttp: vi.fn(), stopMcpHttp: vi.fn(), onMcpUpdate: vi.fn(() => () => {}) }
  })
  afterEach(() => { delete window.electronAPI })

  it('app: { mode, flowProjectReady, activeTab } 를 그대로 노출', () => {
    renderHook(() => useMcpServer(makeProps({ mode: 'flow', flowProjectReady: false, activeTab: 'video-text' })))
    expect(window.__mcpBatchStatus().app).toEqual({ mode: 'flow', flowProjectReady: false, activeTab: 'video-text' })
  })

  it('video: videoT2VPrompt 있는 씬만 세고 videoT2VStatus 로 분류 (미설정=pending)', () => {
    const scenes = [
      { id: 'scene_1', status: 'pending', videoT2VPrompt: 'a' },                                  // status 없음 → pending
      { id: 'scene_2', status: 'pending', videoT2VPrompt: 'b', videoT2VStatus: 'generating' },
      { id: 'scene_3', status: 'done',    videoT2VPrompt: 'c', videoT2VStatus: 'complete' },
      { id: 'scene_4', status: 'pending', videoT2VPrompt: 'd', videoT2VStatus: 'error' },
      { id: 'scene_5', status: 'done' },                                                          // 비디오 프롬프트 없음 → 제외
    ]
    renderHook(() => useMcpServer(makeProps({ scenes })))
    expect(window.__mcpBatchStatus().video).toEqual({ total: 4, done: 1, generating: 1, error: 1, pending: 1 })
  })

  it('props 를 안 넘긴 옛 호출자도 깨지지 않는다 (app 필드는 undefined 값, video 는 0)', () => {
    renderHook(() => useMcpServer(makeProps()))
    const s = window.__mcpBatchStatus()
    expect(s.app).toEqual({ mode: undefined, flowProjectReady: undefined, activeTab: undefined })
    expect(s.video).toEqual({ total: 0, done: 0, generating: 0, error: 0, pending: 0 })
  })
})
