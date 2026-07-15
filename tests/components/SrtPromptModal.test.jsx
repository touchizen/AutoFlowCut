import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import SrtPromptModal from '../../src/components/SrtPromptModal'

vi.mock('../../src/hooks/useI18n', () => ({
  useI18n: () => ({
    t: (key, vars = {}) => {
      if (key === 'srtPrompt.progress') {
        return `Chunk ${vars.current}/${vars.total} (scenes ${vars.from}~${vars.to})`
      }
      if (key === 'srtPrompt.skipped') return `Skipped ${vars.count}`
      if (key === 'srtPrompt.overwriteImpact') return `Affects ${vars.count} scenes`
      return key
    },
  }),
}))

const capabilities = {
  gemini: { available: false, reason: 'missing_api_key' },
  claude: { available: true, reason: 'ok', model: 'claude-opus-4-8' },
  codex: { available: false, reason: 'login_required' },
}

const baseProps = {
  open: true,
  onClose: vi.fn(),
  onGenerate: vi.fn(),
  onCancel: vi.fn(),
  onRetryFailed: vi.fn(),
  onRefreshCapabilities: vi.fn(),
  capabilities,
  targetCount: 3,
  overwriteImpactCount: 2,
  styles: [{ id: 'noir', label: 'Noir' }],
  report: { status: 'idle', failures: [], skipped: 0 },
}

describe('SrtPromptModal', () => {
  beforeEach(() => vi.clearAllMocks())

  it('defaults to mode A and disables unavailable engines with reason guidance', () => {
    render(<SrtPromptModal {...baseProps} />)

    expect(screen.getByLabelText('srtPrompt.modeA')).toBeChecked()
    expect(screen.getByLabelText('srtPrompt.engine.gemini')).toBeDisabled()
    expect(screen.getByText('srtPrompt.capability.missing_api_key')).toBeInTheDocument()
    expect(screen.getByLabelText('srtPrompt.engine.claude')).toBeEnabled()
    expect(screen.getByLabelText('srtPrompt.engine.claude')).toBeChecked()
    expect(screen.getByText('claude-opus-4-8')).toBeInTheDocument()
    expect(screen.getByLabelText('srtPrompt.engine.codex')).toBeDisabled()
    expect(screen.getByText('srtPrompt.capability.login_required')).toBeInTheDocument()
  })

  it('shows overwrite impact and submits style/overwrite choices', () => {
    const onGenerate = vi.fn()
    render(<SrtPromptModal {...baseProps} onGenerate={onGenerate} />)

    fireEvent.change(screen.getByLabelText('srtPrompt.style'), { target: { value: 'noir' } })
    fireEvent.click(screen.getByLabelText('srtPrompt.overwriteAll'))
    expect(screen.getByText('Affects 2 scenes')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'srtPrompt.generate' }))

    expect(onGenerate).toHaveBeenCalledWith({
      mode: 'A', engine: 'claude', style: 'noir', onlyEmpty: false,
    })
  })

  it('requires destructive confirmation for mode B and recommends A when images exist', () => {
    const onGenerate = vi.fn()
    render(<SrtPromptModal
      {...baseProps}
      onGenerate={onGenerate}
      hasExistingImages
      isFolderProject={false}
    />)

    fireEvent.click(screen.getByLabelText('srtPrompt.modeB'))
    fireEvent.click(screen.getByRole('button', { name: 'srtPrompt.generate' }))

    expect(onGenerate).not.toHaveBeenCalled()
    expect(screen.getByText('srtPrompt.confirm.title')).toBeInTheDocument()
    expect(screen.getByText('srtPrompt.confirm.imageRecommendation')).toBeInTheDocument()
    expect(screen.getByText('srtPrompt.confirm.nonFolderWarning')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'srtPrompt.confirm.proceed' }))
    expect(onGenerate).toHaveBeenCalledWith(expect.objectContaining({ mode: 'B' }))
  })

  it('renders live chunk progress plus failure, unsaved, and skipped reports', () => {
    render(<SrtPromptModal
      {...baseProps}
      report={{
        status: 'running',
        totalChunks: 3,
        currentChunk: 1,
        currentSceneRange: { from: 21, to: 40 },
        failures: [{ chunkIndex: 0, error: 'provider failed' }],
        skipped: 2,
        unsaved: true,
        error: 'disk full',
      }}
    />)

    expect(screen.getByText('Chunk 2/3 (scenes 21~40)')).toBeInTheDocument()
    expect(screen.getByText(/provider failed/)).toBeInTheDocument()
    expect(screen.getByText('srtPrompt.report.unsaved')).toBeInTheDocument()
    expect(screen.getByText('disk full')).toBeInTheDocument()
    expect(screen.getByText('Skipped 2')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'srtPrompt.cancelRun' }))
    expect(baseProps.onCancel).toHaveBeenCalledTimes(1)
  })

  it('uses separate mode A and B target counts', () => {
    render(<SrtPromptModal
      {...baseProps}
      modeATargetCount={0}
      modeBTargetCount={2}
    />)

    expect(screen.getByRole('button', { name: 'srtPrompt.generate' })).toBeDisabled()
    fireEvent.click(screen.getByLabelText('srtPrompt.modeB'))
    expect(screen.getByRole('button', { name: 'srtPrompt.generate' })).toBeEnabled()
  })

  it('offers failed-only retry after a partial run', () => {
    const onRetryFailed = vi.fn()
    render(<SrtPromptModal
      {...baseProps}
      onRetryFailed={onRetryFailed}
      report={{
        status: 'completed_with_failures',
        failures: [{ chunkIndex: 1, error: 'try again' }],
        skipped: 0,
      }}
    />)

    fireEvent.click(screen.getByRole('button', { name: 'srtPrompt.retryFailed' }))
    expect(onRetryFailed).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['stale', 'srtPrompt.report.stale'],
    ['blocked', 'srtPrompt.report.blocked'],
  ])('renders an explicit %s transaction result', (status, messageKey) => {
    render(<SrtPromptModal
      {...baseProps}
      report={{ status, failures: [], skipped: 0 }}
    />)

    expect(screen.getByRole('alert')).toHaveTextContent(messageKey)
  })
})
