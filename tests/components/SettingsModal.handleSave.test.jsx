/**
 * SettingsModal.handleSave — 레이아웃 동기화 dead code 회귀
 *
 * 회귀: handleSave 가 `localSettings.layoutMode` 가 있으면 setLayout({ ratio: splitRatio || 0.5 })
 * 를 호출하던 블록이 dead code 였다. 레이아웃은 DisplayTab.handleLayout 이 라이브로 적용하며,
 * localSettings.layoutMode/splitRatio 는 어디서도 기록되지 않는다. 만약 settings 객체가 우연히
 * layoutMode 를 들고 있으면 save 시 ratio 가 0.5 로 덮여 드래그 비율이 날아갔다.
 * → SettingsModal 은 save 시 setLayout 을 호출하면 안 된다(DisplayTab 소유).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

import SettingsModal from '../../src/components/SettingsModal'

// 자식 탭/의존성은 모킹 — handleSave 동작만 격리 검증
vi.mock('../../src/hooks/useI18n', () => ({
  useI18n: () => ({ t: (k) => k }),
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
vi.mock('../../src/components/settings/ApiKeyTab', () => ({ default: () => null }))

beforeEach(() => {
  window.electronAPI = {
    setLayout: vi.fn().mockResolvedValue({}),
  }
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('SettingsModal.handleSave layout sync', () => {
  it('does not call setLayout on save even when settings carry layoutMode/splitRatio', () => {
    const onSave = vi.fn()
    // settings 가 우연히 layoutMode/splitRatio 를 들고 있는 경우(과거 dead block 의 트리거)
    render(
      <SettingsModal
        settings={{ layoutMode: 'split-right', splitRatio: 0.8 }}
        onSave={onSave}
        onClose={() => {}}
      />
    )

    fireEvent.click(screen.getByText('settings.save'))

    // DisplayTab 이 라이브로 레이아웃을 적용하므로 SettingsModal 은 setLayout 을 호출하지 않는다.
    // (호출하면 ratio 0.8 이 0.5 로 덮이는 회귀 — dead block 이 살아있을 때 발생)
    expect(window.electronAPI.setLayout).not.toHaveBeenCalled()
    expect(onSave).toHaveBeenCalledWith({ layoutMode: 'split-right', splitRatio: 0.8 })
  })
})
