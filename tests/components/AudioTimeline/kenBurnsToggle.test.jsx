import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render } from '@testing-library/react'
import { I18nProvider } from '../../../src/hooks/useI18n'

const { mockUpdateSetting, mockToastInfo, mockContext } = vi.hoisted(() => ({
  mockUpdateSetting: vi.fn(),
  mockToastInfo: vi.fn(),
  mockContext: {
    settings: { kenBurns: true },
    updateSetting: vi.fn(),
  },
}))
mockContext.updateSetting = mockUpdateSetting

vi.mock('../../../src/contexts/ExportSettingsContext', () => ({
  useExportSettingsContext: () => mockContext,
}))

vi.mock('../../../src/components/Toast', () => ({
  toast: { info: mockToastInfo },
}))

import AudioTimeline from '../../../src/components/AudioTimeline/AudioTimeline'

function renderTimeline() {
  return render(
    <I18nProvider>
      <AudioTimeline audioPackage={null} scenes={[]} srtEntries={[]} />
    </I18nProvider>,
  )
}

describe('AudioTimeline Ken Burns toggle', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockContext.settings = { kenBurns: true }
  })

  it('Context의 kenBurns 값을 checked에 반영한다', () => {
    const { container, rerender } = renderTimeline()
    const checkbox = container.querySelector('.atl-kb-toggle input[type="checkbox"]')
    expect(checkbox).toBeChecked()

    mockContext.settings = { kenBurns: false }
    rerender(
      <I18nProvider>
        <AudioTimeline audioPackage={null} scenes={[]} srtEntries={[]} />
      </I18nProvider>,
    )
    expect(checkbox).not.toBeChecked()
  })

  it('클릭하면 updateSetting을 호출하고 안내 toast는 띄우지 않는다', () => {
    const { container } = renderTimeline()
    const checkbox = container.querySelector('.atl-kb-toggle input[type="checkbox"]')

    fireEvent.click(checkbox)

    expect(mockUpdateSetting).toHaveBeenCalledWith('kenBurns', false)
    expect(mockToastInfo).not.toHaveBeenCalled()
  })
})
