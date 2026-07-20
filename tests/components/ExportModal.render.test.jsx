import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'

const mockSaveSettings = vi.fn()
const mockSavedSettings = {
  pathPreset: 'capcut',
  scaleMode: 'none',
  includeSubtitle: true,
  kenBurns: true,
  kenBurnsMode: 'random',
  kenBurnsCycle: 5,
  kenBurnsScaleMin: 100,
  kenBurnsScaleMax: 130,
  renderMode: 'final',
  renderBurnSubtitle: true,
}

vi.mock('../../src/hooks/useI18n', () => ({
  default: () => ({ t: key => key, lang: 'ko', setLang: vi.fn() }),
  useI18n: () => ({ t: key => key, lang: 'ko', setLang: vi.fn() }),
}))

vi.mock('../../src/contexts/AuthContext', () => ({
  useAuth: () => ({
    isAuthenticated: true,
    subscription: {
      status: 'trial',
      exportsRemaining: 3,
      daysRemaining: 5,
    },
  }),
}))

vi.mock('../../src/hooks/useExportSettings', () => ({
  useExportSettings: () => ({
    settings: mockSavedSettings,
    isLoaded: true,
    saveSettings: mockSaveSettings,
  }),
}))

vi.mock('../../src/hooks/useModalVisibility', () => ({
  useModalVisibility: () => {},
}))

vi.mock('../../src/hooks/useFileSystem', () => ({
  fileSystemAPI: {
    ensurePermission: vi.fn(async () => ({ success: true, hasPermission: true })),
  },
}))

import { ExportModal } from '../../src/components/ExportModal'

const baseProps = {
  isOpen: true,
  onClose: vi.fn(),
  onExport: vi.fn(),
  onExportPremiere: vi.fn(),
  onExportVrew: vi.fn(),
  onExportRender: vi.fn(),
  onCancelRender: vi.fn(),
  renderProgress: null,
  initialFormat: 'capcut',
  projectName: 'RenderProject',
  loading: false,
  exportPhase: null,
  hasSubtitles: true,
  onUpgradeClick: vi.fn(),
}

beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
  window.electronAPI = {}
})

describe('ExportModal self-render format', () => {
  it('renders the i18n-labelled tab and shows render mode plus its own subtitle control', () => {
    render(<ExportModal {...baseProps} />)

    const renderTab = screen.getByRole('button', { name: /exportModal\.renderTab/ })
    expect(renderTab).toBeInTheDocument()
    fireEvent.click(renderTab)

    expect(screen.getByLabelText('exportModal.renderModePreview')).not.toBeChecked()
    expect(screen.getByLabelText('exportModal.renderModeFinal')).toBeChecked()
    expect(screen.getByLabelText('exportModal.renderBurnSubtitle')).toBeChecked()
    expect(screen.queryByLabelText(/exportModal\.includeSubtitle/)).not.toBeInTheDocument()
  })

  it('persists render choices and dispatches them through onExportRender', async () => {
    const onExportRender = vi.fn()
    render(<ExportModal {...baseProps} initialFormat="render" onExportRender={onExportRender} />)

    fireEvent.click(screen.getByLabelText('exportModal.renderModePreview'))
    fireEvent.click(screen.getByLabelText('exportModal.renderBurnSubtitle'))
    fireEvent.click(screen.getByRole('button', { name: /actions\.exportRender/ }))

    await waitFor(() => expect(onExportRender).toHaveBeenCalledTimes(1))
    expect(onExportRender).toHaveBeenCalledWith(expect.objectContaining({
      kenBurnsMode: 'random',
      kenBurnsScaleMin: 1,
      kenBurnsScaleMax: 1.3,
      renderMode: 'preview',
      renderBurnSubtitle: false,
    }))
    const exportOptions = onExportRender.mock.calls[0][0]
    expect(exportOptions).not.toHaveProperty('mode')
    expect(exportOptions).not.toHaveProperty('scaleMin')
    expect(exportOptions).not.toHaveProperty('scaleMax')
    expect(mockSaveSettings).toHaveBeenCalledWith(expect.objectContaining({
      renderMode: 'preview',
      renderBurnSubtitle: false,
    }))
  })

  it('shows render progress and cancels the active render', () => {
    const onCancelRender = vi.fn()
    render(
      <ExportModal
        {...baseProps}
        initialFormat="render"
        loading={false}
        exportPhase="rendering"
        renderProgress={{ percent: 37, stage: 'video' }}
        onCancelRender={onCancelRender}
      />
    )

    const progress = screen.getByRole('progressbar', { name: 'exportModal.renderProgress' })
    expect(progress).toHaveAttribute('aria-valuenow', '37')
    expect(screen.getByText('37%')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'exportModal.renderCancel' }))
    expect(onCancelRender).toHaveBeenCalledTimes(1)
  })

  it('hides the paid-export trial badge after selecting local render', () => {
    render(<ExportModal {...baseProps} />)
    expect(screen.getByText(/exportModal\.trialBadge/)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /exportModal\.renderTab/ }))
    expect(screen.queryByText(/exportModal\.trialBadge/)).not.toBeInTheDocument()
  })
})
