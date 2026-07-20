import { beforeEach, describe, expect, it } from 'vitest'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import AudioTimeline from '../../src/components/AudioTimeline/AudioTimeline'
import { useExportSettingsContext } from '../../src/contexts/ExportSettingsContext'
import { I18nProvider } from '../../src/hooks/useI18n'
import { renderWithExportSettings } from '../utils/renderWithExportSettings'

function SettingsProbe() {
  const { settings } = useExportSettingsContext()
  return <output data-testid="ken-burns-setting">{String(settings.kenBurns)}</output>
}

describe('ExportSettingsContext consumer sync', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('AudioTimeline checkbox 토글을 다른 consumer가 즉시 본다', async () => {
    const scenes = [{
      id: 'scene-1',
      status: 'done',
      imagePath: '/images/scene-1.png',
      startTime: 0,
      endTime: 3,
    }]
    const { container } = renderWithExportSettings(
      <I18nProvider>
        <AudioTimeline audioPackage={null} scenes={scenes} srtEntries={[]} />
        <SettingsProbe />
      </I18nProvider>,
    )
    const checkbox = container.querySelector('.atl-kb-toggle input[type="checkbox"]')
    const previewLayer = container.querySelector('.atl-preview-kb')

    expect(checkbox).toBeChecked()
    expect(screen.getByTestId('ken-burns-setting')).toHaveTextContent('true')
    expect(previewLayer.style.transform).not.toBe('')

    fireEvent.click(checkbox)

    await waitFor(() => {
      expect(checkbox).not.toBeChecked()
      expect(screen.getByTestId('ken-burns-setting')).toHaveTextContent('false')
      expect(previewLayer.style.transform).toBe('')
    })
  })
})
