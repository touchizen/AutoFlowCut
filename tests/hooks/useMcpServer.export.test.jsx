/**
 * useMcpServer — includePending 이 자동화 경로를 통과하는가 (스펙 v9 §4.5)
 *
 * 이 옵션은 세 곳에 막혀 있었다: MCP 툴 스키마, HTTP 바디, 그리고 여기 —
 * `exportOptions` 를 화이트리스트로 재구성하면서 조용히 버려졌다.
 * 셋 다 열려야 도달한다. 기본은 false 여야 한다 — 자동화의 의미가 조용히
 * 바뀌면 안 된다.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useMcpServer } from '../../src/hooks/useMcpServer'

const handleExportConfirm = vi.fn()
const handleExportPremiere = vi.fn()

function makeProps() {
  return {
    settings: { mcpHttpEnabled: false, mcpHttpPort: 3210 },
    scenes: [], setScenes: vi.fn(),
    references: [], setReferences: vi.fn(),
    handleGenerateRef: vi.fn(), handleGenerateScene: vi.fn(),
    handleGenerateAllRefs: vi.fn(), handleStart: vi.fn(), handleStop: vi.fn(),
    handleProjectChange: vi.fn(),
    handleExportConfirm, handleExportPremiere,
    selectedStyleRefId: null, setSelectedStyleRefId: vi.fn(),
    refreshReviews: vi.fn(), audioReviews: [],
    importByPath: vi.fn(), audioPackage: null,
    automationState: { isRunning: false, isPaused: false, progress: { current: 0, total: 0 }, status: 'idle', statusMessage: '' },
    videoAutomation: {}, generatingRefs: [],
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  handleExportConfirm.mockResolvedValue({ success: true, targetPath: '/out' })
  handleExportPremiere.mockResolvedValue({ success: true, targetPath: '/out' })
  localStorage.setItem('exportSettings', '{}')
  window.electronAPI = {
    detectCapcutPath: vi.fn().mockResolvedValue({ success: true, basePath: '/drafts' }),
    getNextProjectNumber: vi.fn().mockResolvedValue({ success: true, folderName: '1400' }),
    getSystemInfo: vi.fn().mockResolvedValue({ platform: 'darwin' }),
  }
})

const mount = () => renderHook(() => useMcpServer(makeProps()))

describe('useMcpServer — includePending 통과', () => {
  it('CapCut: 기본은 false 다', async () => {
    mount()

    await window.__mcpExportCapcut({ capcutProjectNumber: '/d/1' })

    expect(handleExportConfirm).toHaveBeenCalledWith(
      expect.objectContaining({ includePending: false })
    )
  })

  it('CapCut: true 를 주면 그대로 전달된다', async () => {
    mount()

    await window.__mcpExportCapcut({ capcutProjectNumber: '/d/1', includePending: true })

    expect(handleExportConfirm).toHaveBeenCalledWith(
      expect.objectContaining({ includePending: true })
    )
  })

  it('CapCut: truthy 문자열은 true 로 안 친다 (=== true)', async () => {
    mount()

    await window.__mcpExportCapcut({ capcutProjectNumber: '/d/1', includePending: 'yes' })

    expect(handleExportConfirm).toHaveBeenCalledWith(
      expect.objectContaining({ includePending: false })
    )
  })

  it('프리미어도 대칭이다', async () => {
    mount()

    await window.__mcpExportPremiere({ capcutProjectNumber: '/d/1' })
    expect(handleExportPremiere).toHaveBeenCalledWith(
      expect.objectContaining({ includePending: false })
    )

    await window.__mcpExportPremiere({ capcutProjectNumber: '/d/1', includePending: true })
    expect(handleExportPremiere).toHaveBeenLastCalledWith(
      expect.objectContaining({ includePending: true })
    )
  })
})
