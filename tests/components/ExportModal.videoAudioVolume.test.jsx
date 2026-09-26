/**
 * ExportModal — Veo 영상 오디오 볼륨 옵션 (발견성 + 배선)
 *
 * 잡는 동작:
 *   1) 옵션 select 가 실제로 렌더된다 (발견성 — 리뷰어가 못 잡는 부분)
 *   2) 저장된 값이 없으면 기본값은 원본(1) — 옵션이다(2026-09-26 사용자 결정: 대사 있는 영상에서 모르고 음소거되지 않게)
 *   3) 저장된 음소거(0)는 0 그대로 복원된다(0 이 유효값 — || 폴백에 묻히면 안 된다)
 *   4) '음소거' 선택 시 onExport 페이로드에 videoAudioVolume: 0 + 설정에 저장
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

// settings 객체는 identity 가 안정적이어야 한다 — 실제 훅은 useState 라 안 바뀐다.
// 매 렌더 새 객체를 주면 로드 useEffect([isLoaded, savedSettings])가 재실행돼 사용자의
// select 변경을 즉시 되돌린다(= 테스트만의 거짓 실패).
const SAVED_BASE = {
  pathPreset: 'capcut',
  scaleMode: 'none',
  includeSubtitle: true,
  kenBurns: true,
}
// 테스트마다 렌더 **전에** 바꾼다 — 렌더 중에는 같은 객체(identity 안정).
let currentSaved = SAVED_BASE

vi.mock('../../src/hooks/useExportSettings', () => ({
  useExportSettings: () => ({
    settings: currentSaved,
    isLoaded: true,
    saveSettings: mockSaveSettings
  })
}))

vi.mock('../../src/hooks/useModalVisibility', () => ({
  useModalVisibility: () => {}
}))

vi.mock('../../src/hooks/useFileSystem', () => ({
  fileSystemAPI: {
    ensurePermission: vi.fn(async () => ({ success: true, hasPermission: true }))
  }
}))

import { ExportModal } from '../../src/components/ExportModal'

const baseProps = {
  isOpen: true,
  onClose: vi.fn(),
  projectName: 'MyProject',
  loading: false,
  exportPhase: null,
  hasSubtitles: false,
  onUpgradeClick: vi.fn()
}

/** 경로 자동감지가 끝나 Export 버튼이 유효해질 때까지 대기 */
async function waitForPath() {
  await waitFor(() =>
    expect(screen.getByDisplayValue('/Users/tester/Movies/CapCut/Projects/0001')).toBeInTheDocument()
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
  localStorage.setItem('workFolderPath', '/Users/tester/AFC')
  window.electronAPI = {
    getSystemInfo: vi.fn(async () => ({ success: true, username: 'tester', platform: 'darwin' })),
    detectCapcutPath: vi.fn(async () => ({ success: true, basePath: '/Users/tester/Movies/CapCut/Projects' })),
    getNextProjectNumber: vi.fn(async () => ({ success: true, folderName: '0001' })),
    checkCapcutInstalled: vi.fn(async () => ({ installed: true })),
    checkFolderExists: vi.fn(async () => ({ exists: false })),
    openExternal: vi.fn()
  }
  window.confirm = vi.fn(() => true)
})

describe('ExportModal — 영상 오디오 볼륨 옵션', () => {
  it('옵션 select 가 렌더되고 세 선택지가 모두 보인다', async () => {
    render(<ExportModal {...baseProps} onExport={vi.fn()} />)

    expect(screen.getByText(/exportModal\.videoAudioVolume/)).toBeInTheDocument()
    expect(screen.getByRole('option', { name: /videoAudioMute/ })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: /videoAudioAmbience/ })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: /videoAudioOriginal/ })).toBeInTheDocument()
  })

  it('저장된 값이 없으면 기본값은 원본 — onExport 페이로드에 videoAudioVolume: 1', async () => {
    currentSaved = { ...SAVED_BASE }
    const onExport = vi.fn()
    render(<ExportModal {...baseProps} onExport={onExport} />)
    await waitForPath()

    fireEvent.click(screen.getByRole('button', { name: /exportModal\.export/ }))

    await waitFor(() => expect(onExport).toHaveBeenCalled())
    expect(onExport.mock.calls[0][0].videoAudioVolume).toBe(1)
  })

  it('저장된 음소거(0)는 0 그대로 — 기본값(1)에 묻히지 않는다', async () => {
    currentSaved = { ...SAVED_BASE, videoAudioVolume: 0 }
    const onExport = vi.fn()
    render(<ExportModal {...baseProps} onExport={onExport} />)
    await waitForPath()

    fireEvent.click(screen.getByRole('button', { name: /exportModal\.export/ }))

    await waitFor(() => expect(onExport).toHaveBeenCalled())
    expect(onExport.mock.calls[0][0].videoAudioVolume).toBe(0)
  })

  it.each([['abc'], [null], [0.5]])('알 수 없는 저장값 %s 은 원본(1)으로 — 음소거로 새지 않는다', async (bad) => {
    currentSaved = { ...SAVED_BASE, videoAudioVolume: bad }
    const onExport = vi.fn()
    render(<ExportModal {...baseProps} onExport={onExport} />)
    await waitForPath()

    fireEvent.click(screen.getByRole('button', { name: /exportModal\.export/ }))

    await waitFor(() => expect(onExport).toHaveBeenCalled())
    expect(onExport.mock.calls[0][0].videoAudioVolume).toBe(1)
  })

  it("'음소거' 선택 → onExport 페이로드 videoAudioVolume: 0 + 설정 저장", async () => {
    currentSaved = { ...SAVED_BASE }
    const onExport = vi.fn()
    render(<ExportModal {...baseProps} onExport={onExport} />)
    await waitForPath()

    const select = screen.getByRole('option', { name: /videoAudioMute/ }).closest('select')
    fireEvent.change(select, { target: { value: '0' } })

    fireEvent.click(screen.getByRole('button', { name: /exportModal\.export/ }))

    await waitFor(() => expect(onExport).toHaveBeenCalled())
    expect(onExport.mock.calls[0][0].videoAudioVolume).toBe(0)
    expect(mockSaveSettings).toHaveBeenCalledWith(
      expect.objectContaining({ videoAudioVolume: 0 })
    )
  })
})
