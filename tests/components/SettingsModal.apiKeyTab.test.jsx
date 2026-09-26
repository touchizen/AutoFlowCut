import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

const { apiKeyTabProps } = vi.hoisted(() => ({ apiKeyTabProps: { current: null } }))

vi.mock('../../src/hooks/useI18n', () => ({
  useI18n: () => ({ t: (key) => key }),
}))
vi.mock('../../src/hooks/useFileSystem', () => ({
  fileSystemAPI: {
    checkPermission: vi.fn().mockResolvedValue({ success: true, name: 'work' }),
    selectWorkFolder: vi.fn().mockResolvedValue({ success: false }),
  },
}))
vi.mock('../../src/components/settings/StorageTab', () => ({ default: () => null }))
vi.mock('../../src/components/settings/SceneTab', () => ({ default: () => null }))
vi.mock('../../src/components/settings/DisplayTab', () => ({ default: () => null }))
vi.mock('../../src/components/settings/McpTab', () => ({ default: () => null }))
vi.mock('../../src/components/settings/ApiKeyTab', () => ({
  default: (props) => {
    apiKeyTabProps.current = props
    return (
      <button data-testid="api-key-tab-content" onClick={() => props.onKeySaved?.('elevenlabs')}>
        API key content
      </button>
    )
  },
}))

import SettingsModal from '../../src/components/SettingsModal'

afterEach(() => {
  vi.clearAllMocks()
  apiKeyTabProps.current = null
})

describe('SettingsModal consolidated API key tab', () => {
  it('renders exactly one key tab, no legacy TTS tab, and forwards onKeySaved', () => {
    const onKeySaved = vi.fn()
    render(
      <SettingsModal
        settings={{}}
        onSave={vi.fn()}
        onClose={vi.fn()}
        initialTab="apiKey"
        onKeySaved={onKeySaved}
      />,
    )

    const settingsTabs = screen.getAllByRole('button').filter((button) => button.classList.contains('settings-tab'))
    expect(settingsTabs.map((button) => button.textContent)).toEqual([
      '📁settings.tabStorage',
      '🔑settings.tabApiKey',
      '🎬settings.tabScene',
      '🖥️settings.tabDisplay',
      '🔌settings.tabMcp',
    ])
    const keyTabs = settingsTabs.filter((button) => button.textContent.includes('🔑'))
    expect(keyTabs).toHaveLength(1)
    expect(keyTabs[0]).toHaveTextContent('settings.tabApiKey')
    expect(apiKeyTabProps.current.onKeySaved).toBe(onKeySaved)

    fireEvent.click(screen.getByTestId('api-key-tab-content'))
    expect(onKeySaved).toHaveBeenCalledWith('elevenlabs')
  })
})
