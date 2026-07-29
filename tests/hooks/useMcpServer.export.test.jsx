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

// exporter 만 mock 하고 **진짜 useExport** 를 주입한다 — 핸들러를 mock 하면
// 옵션이 전달됐다는 것만 보이고 "실제로 몇 씬이 나갔는가" 를 못 본다.
const mockExportCapcut = vi.fn()
const mockExportPremiere = vi.fn()
vi.mock('../../src/exporters/capcut.js', () => ({ exportCapcut: (...a) => mockExportCapcut(...a) }))
vi.mock('../../src/exporters/premiere.js', () => ({ exportPremiere: (...a) => mockExportPremiere(...a) }))
vi.mock('../../src/exporters/vrew.js', () => ({ exportVrew: vi.fn().mockResolvedValue({ success: true }) }))
vi.mock('../../src/components/Toast', () => ({
  toast: { warning: vi.fn(), success: vi.fn(), info: vi.fn(), error: vi.fn() }
}))
vi.mock('../../src/hooks/useI18n', () => ({
  default: () => ({ t: (k) => k, lang: 'ko', setLang: vi.fn() }),
  useI18n: () => ({ t: (k) => k, lang: 'ko', setLang: vi.fn() })
}))
vi.mock('../../src/hooks/useFileSystem', () => ({
  fileSystemAPI: { ensurePermission: vi.fn().mockResolvedValue({ hasPermission: true }) },
  default: () => ({})
}))

import { useMcpServer } from '../../src/hooks/useMcpServer'
import { useExport } from '../../src/hooks/useExport'

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
  mockExportCapcut.mockResolvedValue({ success: true, targetPath: '/out' })
  mockExportPremiere.mockResolvedValue({ success: true, targetPath: '/out' })
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

// ── 결과 개수까지 본다 (스펙 §7.5: real useExport 주입) ────────────────
describe('useMcpServer — 자동화가 실제로 내보내는 씬 수', () => {
  const scene = (id, status) => ({
    id, status, image: 'data:image/png;base64,x',
    startTime: 0, endTime: 5, duration: 5,
  })
  // done 1 + pending+이미지 2 — 시각은 아래에서 겹치지 않게 다시 준다.
  const scenes = [
    { ...scene('d', 'done'), startTime: 0, endTime: 5, duration: 5 },
    { ...scene('p1', 'pending'), startTime: 5, endTime: 9, duration: 4 },
    { ...scene('p2', 'pending'), startTime: 9, endTime: 15, duration: 6 },
  ]

  function mountWithRealExport() {
    return renderHook(() => {
      const exportHook = useExport({
        settings: { projectName: 'P', aspectRatio: '16:9', defaultDuration: 3 },
        scenes,
        openSettings: vi.fn(),
        isAuthenticated: true,
        subscription: { status: 'active', canExport: true },
        refreshSubscription: vi.fn(),
        onLoginRequired: vi.fn(),
        onPaywallRequired: vi.fn(),
      })
      useMcpServer({
        ...makeProps(),
        scenes,
        handleExportConfirm: exportHook.handleExportConfirm,
        handleExportPremiere: exportHook.handleExportPremiere,
      })
      return exportHook
    })
  }

  it('기본은 ready 만 나간다', async () => {
    mountWithRealExport()

    await window.__mcpExportCapcut({ capcutProjectNumber: '/d/1' })

    expect(mockExportCapcut.mock.calls[0][0].scenes.map(s => s.id)).toEqual(['d'])
  })

  it('includePending:true 면 pending 씬도 함께 나간다', async () => {
    mountWithRealExport()

    await window.__mcpExportCapcut({ capcutProjectNumber: '/d/1', includePending: true })

    expect(mockExportCapcut.mock.calls[0][0].scenes.map(s => s.id)).toEqual(['d', 'p1', 'p2'])
  })

  // ⚠️ 프리미어도 **반드시** 같은 단언을 받아야 한다. CapCut 만 세면
  // 프리미어 경로에 `{ includePending: true }` 를 박아넣는 뮤턴트가 전 스위트를
  // 통과한다(실측). 그건 사용자가 "배제" 를 눌렀는데 pending 이 나가는 것이다.
  it('프리미어도 기본은 ready 만 나간다', async () => {
    mountWithRealExport()

    await window.__mcpExportPremiere({ capcutProjectNumber: '/d/1' })

    expect(mockExportPremiere.mock.calls[0][0].scenes.map(s => s.id)).toEqual(['d'])
  })

  it('프리미어도 includePending:true 면 함께 나간다', async () => {
    mountWithRealExport()

    await window.__mcpExportPremiere({ capcutProjectNumber: '/d/1', includePending: true })

    expect(mockExportPremiere.mock.calls[0][0].scenes.map(s => s.id)).toEqual(['d', 'p1', 'p2'])
  })

  it('자동화 경로는 모달을 띄우지 않는다 — 훅만으로 완결된다', async () => {
    const { result } = mountWithRealExport()

    await window.__mcpExportCapcut({ capcutProjectNumber: '/d/1' })

    expect(result.current.showExportModal).toBe(false)
  })
})
