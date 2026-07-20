import { useEffect } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import {
  ExportSettingsProvider,
  useExportSettingsContext,
} from '../../src/contexts/ExportSettingsContext'

function Probe({ onValue }) {
  const value = useExportSettingsContext()
  useEffect(() => {
    onValue?.(value)
  }, [onValue, value])
  return (
    <div>
      <span data-testid="loaded">{String(value.isLoaded)}</span>
      <span data-testid="aspect">{value.aspectRatio}</span>
    </div>
  )
}

describe('ExportSettingsContext', () => {
  it('Provider 밖에서 사용하면 ModeContext 관례의 오류를 던진다', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      expect(() => render(<Probe />)).toThrow(
        'useExportSettingsContext must be used within ExportSettingsProvider',
      )
    } finally {
      consoleError.mockRestore()
    }
  })

  it('settings store와 aspectRatio를 공급한다', async () => {
    render(
      <ExportSettingsProvider aspectRatio="9:16">
        <Probe />
      </ExportSettingsProvider>,
    )

    await waitFor(() => expect(screen.getByTestId('loaded')).toHaveTextContent('true'))
    expect(screen.getByTestId('aspect')).toHaveTextContent('9:16')
  })

  it('stable constituent가 같으면 memoized context value를 재사용한다', async () => {
    const values = []
    const onValue = value => values.push(value)
    const { rerender } = render(
      <ExportSettingsProvider aspectRatio="16:9">
        <Probe onValue={onValue} />
      </ExportSettingsProvider>,
    )

    await waitFor(() => expect(values.at(-1)?.isLoaded).toBe(true))
    const stableValue = values.at(-1)

    rerender(
      <ExportSettingsProvider aspectRatio="16:9">
        <Probe onValue={onValue} />
      </ExportSettingsProvider>,
    )

    expect(values.at(-1)).toBe(stableValue)
  })
})
