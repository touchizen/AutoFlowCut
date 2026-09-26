import { render } from '@testing-library/react'
import { ExportSettingsProvider } from '../../src/contexts/ExportSettingsContext'

export function renderWithExportSettings(ui, {
  aspectRatio = '16:9',
  wrapper: ConsumerWrapper,
  ...options
} = {}) {
  function Wrapper({ children }) {
    return (
      <ExportSettingsProvider aspectRatio={aspectRatio}>
        {ConsumerWrapper ? <ConsumerWrapper>{children}</ConsumerWrapper> : children}
      </ExportSettingsProvider>
    )
  }

  return render(ui, { ...options, wrapper: Wrapper })
}
