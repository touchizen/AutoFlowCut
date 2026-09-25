/**
 * useMcpServer — MCP HTTP `{type:'update-settings', fields}` 가 앱 설정을 병합한다 (M2 실기 준비).
 *   에이전트가 영상 모델·해상도 같은 설정을 UI 없이 맞출 수 있어야 T2V 배치를 자동으로 돌린다(useAppSettings 가
 *   localStorage 로 동기화하므로 재시작 뒤에도 남는다). fields 가 객체가 아니면 아무것도 하지 않는다.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useMcpServer } from '../../src/hooks/useMcpServer'

let mcpHandler = null
function makeProps(overrides = {}) {
  return {
    settings: { mcpHttpEnabled: false, mcpHttpPort: 3210 },
    scenes: [], setScenes: vi.fn(), references: [], setReferences: vi.fn(),
    handleGenerateRef: vi.fn(), handleGenerateScene: vi.fn(), handleGenerateAllRefs: vi.fn(), handleStart: vi.fn(), handleStop: vi.fn(),
    handleProjectChange: vi.fn(), handleExportConfirm: vi.fn(), selectedStyleRefId: null, setSelectedStyleRefId: vi.fn(),
    refreshReviews: vi.fn(), audioReviews: [], importByPath: vi.fn(), audioPackage: null,
    automationState: { isRunning: false, isPaused: false, progress: { current: 0, total: 0 }, status: 'idle', statusMessage: '' },
    videoAutomation: {}, generatingRefs: [], isRunning: false,
    ...overrides,
  }
}
beforeEach(() => {
  mcpHandler = null
  window.electronAPI = { startMcpHttp: vi.fn(), stopMcpHttp: vi.fn(), onMcpUpdate: vi.fn((cb) => { mcpHandler = cb; return () => {} }) }
})
afterEach(() => { delete window.electronAPI })

describe('useMcpServer — update-settings', () => {
  it('fields 를 기존 설정에 병합하는 updater 로 setSettings 를 부른다', () => {
    const setSettings = vi.fn()
    renderHook(() => useMcpServer(makeProps({ setSettings })))
    expect(typeof mcpHandler).toBe('function')
    mcpHandler({ type: 'update-settings', fields: { videoModelT2V: 'Omni Flash', videoResolution: '720p' } })
    expect(setSettings).toHaveBeenCalledTimes(1)
    const updater = setSettings.mock.calls[0][0]
    expect(typeof updater).toBe('function')
    expect(updater({ aspectRatio: '9:16', videoResolution: '1080p' })).toEqual({ aspectRatio: '9:16', videoResolution: '720p', videoModelT2V: 'Omni Flash' })
  })
  // M2-LIVE N3(A3/B2): main 의 /api/update 가 먼저 400 으로 거르지만 렌더러도 화이트리스트 밖·모양 틀린 키를 버린다(이중 방어 — 공용 상수 src/utils/mcpSettingsWhitelist.js).
  it('화이트리스트 밖의 키(projectName·mcpHttpEnabled·saveMode)와 모양 틀린 값(seedNo:"abc")은 버리고 유효한 키만 병합한다', () => {
    const setSettings = vi.fn()
    renderHook(() => useMcpServer(makeProps({ setSettings })))
    mcpHandler({ type: 'update-settings', fields: { videoModelT2V: 'Omni Flash', projectName: 'B', mcpHttpEnabled: false, saveMode: 'none', seedNo: 'abc' } })
    expect(setSettings).toHaveBeenCalledTimes(1)
    const merged = setSettings.mock.calls[0][0]({ projectName: 'A', mcpHttpEnabled: true, saveMode: 'folder', seedNo: 7, videoModelT2V: 'Veo 3.1 - Fast' })
    expect(merged).toEqual({ projectName: 'A', mcpHttpEnabled: true, saveMode: 'folder', seedNo: 7, videoModelT2V: 'Omni Flash' })
  })
  it('유효한 키가 하나도 없으면 setSettings 를 부르지 않는다', () => {
    const setSettings = vi.fn()
    renderHook(() => useMcpServer(makeProps({ setSettings })))
    mcpHandler({ type: 'update-settings', fields: { projectName: 'B', flowAgentOn: true } })
    expect(setSettings).not.toHaveBeenCalled()
  })
  it('fields 가 객체가 아니면 setSettings 를 부르지 않는다', () => {
    const setSettings = vi.fn()
    renderHook(() => useMcpServer(makeProps({ setSettings })))
    mcpHandler({ type: 'update-settings' })
    mcpHandler({ type: 'update-settings', fields: 'x' })
    expect(setSettings).not.toHaveBeenCalled()
  })
})
