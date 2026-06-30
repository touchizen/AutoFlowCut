/**
 * ExportModal — 포맷 선택(CapCut / Premiere) UI 연동
 *
 * 잡는 동작:
 *   1) 상단 포맷 세그먼트에 CapCut/Premiere 버튼이 모두 노출된다 (발견성)
 *   2) 기본 포맷은 CapCut — Export 시 onExport 호출 (기존 회귀 방지)
 *   3) Premiere 선택 시 — onExportPremiere 호출, capcutProjectNumber 는
 *      프로젝트 폴더(`${workFolderPath}/${projectName}`)
 *   4) Premiere 선택 시 — CapCut 경로/번호 UI 숨김 + 저장 위치 안내 표시
 *   5) Premiere 선택 시 — CapCut 설치확인(checkCapcutInstalled) 미호출
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

const mockSaveSettings = vi.fn()

vi.mock('../../src/hooks/useI18n', () => ({
  default: () => ({ t: (k) => k, lang: 'ko', setLang: vi.fn() }),
  useI18n: () => ({ t: (k) => k, lang: 'ko', setLang: vi.fn() })
}))

vi.mock('../../src/contexts/AuthContext', () => ({
  useAuth: () => ({ isAuthenticated: false, subscription: { status: 'none' } })
}))

vi.mock('../../src/hooks/useExportSettings', () => ({
  useExportSettings: () => ({
    settings: {
      pathPreset: 'capcut',
      scaleMode: 'none',
      includeSubtitle: true,
      kenBurns: true,
      kenBurnsMode: 'random',
      kenBurnsCycle: 5,
      kenBurnsScaleMin: 100,
      kenBurnsScaleMax: 130
    },
    isLoaded: true,
    saveSettings: mockSaveSettings
  })
}))

vi.mock('../../src/hooks/useModalVisibility', () => ({
  useModalVisibility: () => {}
}))

vi.mock('../../src/hooks/useFileSystem', () => ({
  fileSystemAPI: {
    // 기본: 이미 workFolderPath 가 있는 환경 → 복원 불필요 (no-op)
    ensurePermission: vi.fn(async () => ({ success: true, hasPermission: true }))
  }
}))

import { fileSystemAPI } from '../../src/hooks/useFileSystem'

import { ExportModal } from '../../src/components/ExportModal'

const mockCheckCapcutInstalled = vi.fn(async () => ({ installed: true }))
const mockCheckVrewInstalled = vi.fn(async () => ({ installed: true }))

function setupElectronAPI() {
  window.electronAPI = {
    getSystemInfo: vi.fn(async () => ({ success: true, username: 'tester', platform: 'darwin' })),
    detectCapcutPath: vi.fn(async () => ({ success: true, basePath: '/Users/tester/Movies/CapCut/Projects' })),
    getNextProjectNumber: vi.fn(async () => ({ success: true, folderName: '0001' })),
    checkCapcutInstalled: mockCheckCapcutInstalled,
    checkFolderExists: vi.fn(async () => ({ exists: false })),  // 기본: 기존 .prproj 없음
    checkPremiereInstalled: vi.fn(async () => ({ installed: true })),  // 기본: 설치됨
    openPremiereProject: vi.fn(async () => ({ success: true })),
    openVrewProject: vi.fn(async () => ({ success: true })),
    checkVrewInstalled: mockCheckVrewInstalled,
    openExternal: vi.fn()
  }
  window.confirm = vi.fn(() => true)
}

const baseProps = {
  isOpen: true,
  onClose: vi.fn(),
  projectName: 'MyProject',
  loading: false,
  exportPhase: null,
  hasSubtitles: false,
  onUpgradeClick: vi.fn()
}

beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
  localStorage.setItem('workFolderPath', '/Users/tester/AFC')
  setupElectronAPI()
  // reassign 으로 덮였을 수 있으니 기본 ensurePermission 복구
  fileSystemAPI.ensurePermission = vi.fn(async () => ({ success: true, hasPermission: true }))
})

describe('ExportModal — 포맷 선택', () => {
  it('상단 포맷 세그먼트에 CapCut/Premiere/Vrew 버튼이 모두 노출된다', () => {
    render(<ExportModal {...baseProps} onExport={vi.fn()} onExportPremiere={vi.fn()} />)
    expect(screen.getByRole('button', { name: /CapCut/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Premiere/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Vrew/i })).toBeInTheDocument()
  })

  it('기본 포맷은 CapCut — Export 시 onExport 호출, onExportPremiere 미호출', async () => {
    const onExport = vi.fn()
    const onExportPremiere = vi.fn()
    render(<ExportModal {...baseProps} onExport={onExport} onExportPremiere={onExportPremiere} />)

    // autoDetect 가 경로를 채울 때까지 대기 (fullPath 입력이 나타남)
    await waitFor(() =>
      expect(screen.getByDisplayValue('/Users/tester/Movies/CapCut/Projects/0001')).toBeInTheDocument()
    )

    fireEvent.click(screen.getByRole('button', { name: /exportModal\.export/ }))

    await waitFor(() => expect(onExport).toHaveBeenCalledTimes(1))
    expect(onExportPremiere).not.toHaveBeenCalled()
    expect(onExport.mock.calls[0][0]).toMatchObject({
      capcutProjectNumber: '/Users/tester/Movies/CapCut/Projects/0001'
    })
  })

  it('Premiere 선택 후 Export — onExportPremiere 호출, capcutProjectNumber=프로젝트 폴더', async () => {
    const onExport = vi.fn()
    const onExportPremiere = vi.fn()
    render(<ExportModal {...baseProps} onExport={onExport} onExportPremiere={onExportPremiere} />)

    fireEvent.click(screen.getByRole('button', { name: /Premiere/i }))
    fireEvent.click(screen.getByRole('button', { name: /exportModal\.export/ }))

    await waitFor(() => expect(onExportPremiere).toHaveBeenCalledTimes(1))
    expect(onExport).not.toHaveBeenCalled()
    expect(onExportPremiere.mock.calls[0][0]).toMatchObject({
      capcutProjectNumber: '/Users/tester/AFC/MyProject'
    })
  })

  it('Vrew 선택 후 Export — onExportVrew 호출, capcutProjectNumber=프로젝트 폴더', async () => {
    const onExport = vi.fn()
    const onExportPremiere = vi.fn()
    const onExportVrew = vi.fn()
    render(
      <ExportModal
        {...baseProps}
        onExport={onExport}
        onExportPremiere={onExportPremiere}
        onExportVrew={onExportVrew}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: /Vrew/i }))
    fireEvent.click(screen.getByRole('button', { name: /exportModal\.export/ }))

    await waitFor(() => expect(onExportVrew).toHaveBeenCalledTimes(1))
    expect(onExport).not.toHaveBeenCalled()
    expect(onExportPremiere).not.toHaveBeenCalled()
    expect(onExportVrew.mock.calls[0][0]).toMatchObject({
      capcutProjectNumber: '/Users/tester/AFC/MyProject'
    })
  })

  it('Vrew 미설치 시 — 다운로드 안내 후 export 안 함 (CapCut 패턴 미러)', async () => {
    mockCheckVrewInstalled.mockResolvedValueOnce({ installed: false })
    window.confirm = vi.fn(() => true)
    const onExportVrew = vi.fn()
    render(<ExportModal {...baseProps} onExport={vi.fn()} onExportPremiere={vi.fn()} onExportVrew={onExportVrew} />)

    fireEvent.click(screen.getByRole('button', { name: /Vrew/i }))
    fireEvent.click(screen.getByRole('button', { name: /exportModal\.export/ }))

    await waitFor(() => expect(window.electronAPI.openExternal).toHaveBeenCalledWith('https://vrew.voyagerx.com/'))
    expect(window.confirm).toHaveBeenCalledWith('exportModalExtra.vrewNotInstalled')
    expect(onExportVrew).not.toHaveBeenCalled()
  })

  it('Premiere 선택 시 — CapCut 번호/경로 UI 숨김, 저장 위치 안내 표시', async () => {
    render(<ExportModal {...baseProps} onExport={vi.fn()} onExportPremiere={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: /Premiere/i }))

    // CapCut 프로젝트 번호 라벨은 사라진다
    expect(screen.queryByText(/exportModal\.projectNumber/)).not.toBeInTheDocument()
    // 저장 위치 안내에 .prproj 파일명이 보인다
    expect(screen.getByText(/MyProject\.prproj/)).toBeInTheDocument()
  })

  it('Vrew 선택 시 — CapCut 번호/경로 UI 숨김, .vrew 저장 위치 안내 표시', () => {
    render(<ExportModal {...baseProps} onExport={vi.fn()} onExportPremiere={vi.fn()} onExportVrew={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: /Vrew/i }))

    expect(screen.queryByText(/exportModal\.projectNumber/)).not.toBeInTheDocument()
    expect(screen.getByText(/MyProject\.vrew/)).toBeInTheDocument()
  })

  it('Premiere — 기존 .prproj 가 없으면 확인 없이 바로 onExportPremiere 호출', async () => {
    const onExportPremiere = vi.fn()
    render(<ExportModal {...baseProps} onExport={vi.fn()} onExportPremiere={onExportPremiere} />)

    fireEvent.click(screen.getByRole('button', { name: /Premiere/i }))
    fireEvent.click(screen.getByRole('button', { name: /exportModal\.export/ }))

    await waitFor(() => expect(onExportPremiere).toHaveBeenCalledTimes(1))
    expect(window.confirm).not.toHaveBeenCalled()
    expect(window.electronAPI.checkFolderExists).toHaveBeenCalledWith({
      folderPath: '/Users/tester/AFC/MyProject/MyProject.prproj'
    })
  })

  it('Premiere — 기존 .prproj 가 있고 사용자가 취소하면 onExportPremiere 미호출', async () => {
    window.electronAPI.checkFolderExists = vi.fn(async () => ({ exists: true }))
    window.confirm = vi.fn(() => false)
    const onExportPremiere = vi.fn()
    render(<ExportModal {...baseProps} onExport={vi.fn()} onExportPremiere={onExportPremiere} />)

    fireEvent.click(screen.getByRole('button', { name: /Premiere/i }))
    fireEvent.click(screen.getByRole('button', { name: /exportModal\.export/ }))

    await waitFor(() => expect(window.confirm).toHaveBeenCalled())
    expect(onExportPremiere).not.toHaveBeenCalled()
  })

  it('Premiere — 기존 .prproj 가 있어도 사용자가 확인하면 onExportPremiere 호출', async () => {
    window.electronAPI.checkFolderExists = vi.fn(async () => ({ exists: true }))
    window.confirm = vi.fn(() => true)
    const onExportPremiere = vi.fn()
    render(<ExportModal {...baseProps} onExport={vi.fn()} onExportPremiere={onExportPremiere} />)

    fireEvent.click(screen.getByRole('button', { name: /Premiere/i }))
    fireEvent.click(screen.getByRole('button', { name: /exportModal\.export/ }))

    await waitFor(() => expect(onExportPremiere).toHaveBeenCalledTimes(1))
  })

  it('Premiere — 작업 폴더 미설정 시 Export 비활성 + 안내 표시, onExportPremiere 미호출', () => {
    localStorage.removeItem('workFolderPath')
    const onExportPremiere = vi.fn()
    render(<ExportModal {...baseProps} onExport={vi.fn()} onExportPremiere={onExportPremiere} />)

    fireEvent.click(screen.getByRole('button', { name: /Premiere/i }))

    const exportBtn = screen.getByRole('button', { name: /exportModal\.export/ })
    expect(exportBtn).toBeDisabled()
    expect(screen.getByText(/exportModal\.premiereWorkFolderRequired/)).toBeInTheDocument()

    fireEvent.click(exportBtn)
    expect(onExportPremiere).not.toHaveBeenCalled()
  })

  it('포맷 세그먼트 — aria-pressed 로 활성 포맷을 표시한다', () => {
    render(<ExportModal {...baseProps} onExport={vi.fn()} onExportPremiere={vi.fn()} />)

    const capcutTab = screen.getByRole('button', { name: /✂️ CapCut/i })
    const premiereTab = screen.getByRole('button', { name: /🎬 Premiere/i })
    expect(capcutTab).toHaveAttribute('aria-pressed', 'true')
    expect(premiereTab).toHaveAttribute('aria-pressed', 'false')

    fireEvent.click(premiereTab)
    expect(premiereTab).toHaveAttribute('aria-pressed', 'true')
    expect(capcutTab).toHaveAttribute('aria-pressed', 'false')
  })

  it('Premiere — 로딩 오버레이가 premiere 전용 문구를 사용한다', () => {
    const { rerender } = render(
      <ExportModal {...baseProps} loading={false} onExport={vi.fn()} onExportPremiere={vi.fn()} />
    )
    fireEvent.click(screen.getByRole('button', { name: /🎬 Premiere/i }))
    rerender(<ExportModal {...baseProps} loading={true} onExport={vi.fn()} onExportPremiere={vi.fn()} />)

    expect(screen.getByText(/exportModal\.premiereExporting/)).toBeInTheDocument()
  })

  it('Premiere — launching 단계에서도 CapCut 문구가 아니라 Premiere 문구를 쓴다', () => {
    const { rerender } = render(
      <ExportModal {...baseProps} loading={false} onExport={vi.fn()} onExportPremiere={vi.fn()} />
    )
    fireEvent.click(screen.getByRole('button', { name: /🎬 Premiere/i }))
    rerender(<ExportModal {...baseProps} loading={true} exportPhase="launching" onExport={vi.fn()} onExportPremiere={vi.fn()} />)

    expect(screen.getByText('exportModal.premiereLaunching')).toBeInTheDocument()
    expect(screen.queryByText(/exportModal\.launchingCapcut/)).not.toBeInTheDocument()
  })

  it('Vrew — launching 단계에서도 CapCut 문구가 아니라 Vrew 문구를 쓴다', () => {
    const { rerender } = render(
      <ExportModal {...baseProps} loading={false} onExport={vi.fn()} onExportVrew={vi.fn()} />
    )
    fireEvent.click(screen.getByRole('button', { name: /📝 Vrew/i }))
    rerender(<ExportModal {...baseProps} loading={true} exportPhase="launching" onExport={vi.fn()} onExportVrew={vi.fn()} />)

    expect(screen.getByText('exportModal.vrewLaunching')).toBeInTheDocument()
    expect(screen.queryByText(/exportModal\.launchingCapcut/)).not.toBeInTheDocument()
  })

  it('Premiere — 미설치 시 다운로드 안내 후 onExportPremiere 미호출 (CapCut 패턴)', async () => {
    window.electronAPI.checkPremiereInstalled = vi.fn(async () => ({ installed: false }))
    window.confirm = vi.fn(() => true)
    const onExportPremiere = vi.fn()
    render(<ExportModal {...baseProps} onExport={vi.fn()} onExportPremiere={onExportPremiere} />)

    fireEvent.click(screen.getByRole('button', { name: /Premiere/i }))
    fireEvent.click(screen.getByRole('button', { name: /exportModal\.export/ }))

    // 비-appx 빌드(테스트=nsis): confirm 후 다운로드 페이지 열기
    await waitFor(() => expect(window.electronAPI.openExternal).toHaveBeenCalledWith('https://www.adobe.com/products/premiere.html'))
    expect(window.confirm).toHaveBeenCalledWith('exportModalExtra.premiereNotInstalledConfirm')
    expect(onExportPremiere).not.toHaveBeenCalled()
  })

  it('Premiere 선택 시 — CapCut 설치확인을 호출하지 않는다', async () => {
    const onExportPremiere = vi.fn()
    render(<ExportModal {...baseProps} onExport={vi.fn()} onExportPremiere={onExportPremiere} />)

    fireEvent.click(screen.getByRole('button', { name: /Premiere/i }))
    fireEvent.click(screen.getByRole('button', { name: /exportModal\.export/ }))

    await waitFor(() => expect(onExportPremiere).toHaveBeenCalledTimes(1))
    expect(mockCheckCapcutInstalled).not.toHaveBeenCalled()
  })

  it('Vrew 선택 시 — CapCut/Premiere 설치확인을 호출하지 않는다', async () => {
    const onExportVrew = vi.fn()
    render(<ExportModal {...baseProps} onExport={vi.fn()} onExportPremiere={vi.fn()} onExportVrew={onExportVrew} />)

    fireEvent.click(screen.getByRole('button', { name: /Vrew/i }))
    fireEvent.click(screen.getByRole('button', { name: /exportModal\.export/ }))

    await waitFor(() => expect(onExportVrew).toHaveBeenCalledTimes(1))
    expect(mockCheckCapcutInstalled).not.toHaveBeenCalled()
    expect(window.electronAPI.checkPremiereInstalled).not.toHaveBeenCalled()
  })

  it('Premiere — localStorage 가 비어도 ensurePermission 으로 복원되면 export 가능', async () => {
    localStorage.removeItem('workFolderPath')
    fileSystemAPI.ensurePermission = vi.fn(async () => {
      localStorage.setItem('workFolderPath', '/Users/tester/Recovered')
      return { success: true, hasPermission: true }
    })
    const onExportPremiere = vi.fn()
    render(<ExportModal {...baseProps} onExport={vi.fn()} onExportPremiere={onExportPremiere} />)

    fireEvent.click(screen.getByRole('button', { name: /Premiere/i }))

    const exportBtn = screen.getByRole('button', { name: /exportModal\.export/ })
    await waitFor(() => expect(exportBtn).toBeEnabled())

    fireEvent.click(exportBtn)
    await waitFor(() => expect(onExportPremiere).toHaveBeenCalledTimes(1))
    expect(onExportPremiere.mock.calls[0][0]).toMatchObject({
      capcutProjectNumber: '/Users/tester/Recovered/MyProject'
    })
  })

  it('initialFormat="premiere" 로 열면 Premiere 카드로 시작한다', () => {
    render(<ExportModal {...baseProps} initialFormat="premiere" onExport={vi.fn()} onExportPremiere={vi.fn()} />)
    expect(screen.getByRole('heading', { name: /exportModal\.premiereTitle/ })).toBeInTheDocument()
    expect(screen.getByText(/MyProject\.prproj/)).toBeInTheDocument()
  })

  it('이미 mount 된 모달을 닫았다가 새 initialFormat 으로 다시 열면 그 포맷으로 보인다 (실제 App 경로)', () => {
    const { rerender } = render(
      <ExportModal {...baseProps} isOpen={false} initialFormat="capcut" onExport={vi.fn()} onExportPremiere={vi.fn()} />
    )
    rerender(
      <ExportModal {...baseProps} isOpen={true} initialFormat="premiere" onExport={vi.fn()} onExportPremiere={vi.fn()} />
    )
    expect(screen.getByRole('heading', { name: /exportModal\.premiereTitle/ })).toBeInTheDocument()
  })

  it('initialFormat 이 깨진 값이면 CapCut 카드로 좁힌다', () => {
    render(<ExportModal {...baseProps} initialFormat="bad" onExport={vi.fn()} onExportPremiere={vi.fn()} />)
    expect(screen.getByRole('heading', { name: /exportModal\.title/ })).toBeInTheDocument()
    expect(screen.getByText(/_capcut\.zip/)).toBeInTheDocument()
  })

  it('포맷 제목 — Premiere 선택 시 헤더가 Premiere 전용 제목으로 바뀐다', () => {
    render(<ExportModal {...baseProps} onExport={vi.fn()} onExportPremiere={vi.fn()} />)
    expect(screen.getByRole('heading', { name: /exportModal\.title/ })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /🎬 Premiere/i }))
    expect(screen.getByRole('heading', { name: /exportModal\.premiereTitle/ })).toBeInTheDocument()
  })
})
