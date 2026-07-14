import { describe, it, expect } from 'vitest'
import { getMenuLabels } from '../../electron/menuLabels.js'

describe('getMenuLabels', () => {
  it('returns Korean labels for ko', () => {
    const l = getMenuLabels('ko')
    expect(l.showModeSelector).toBe('생성 모드 선택…')
    expect(l.checkForUpdates).toBe('업데이트 확인…')
    expect(l.updateDownloadFailed).toBe('업데이트 다운로드에 실패했습니다.')
  })

  it('returns English labels for en', () => {
    const l = getMenuLabels('en')
    expect(l.showModeSelector).toBe('Choose Generation Mode…')
    expect(l.github).toBe('GitHub Repository')
    expect(l.updateDownloadFailed).toBe('Could not download the update.')
  })

  it('falls back to English for unknown/undefined lang', () => {
    expect(getMenuLabels('fr').showModeSelector).toBe('Choose Generation Mode…')
    expect(getMenuLabels(undefined).showModeSelector).toBe('Choose Generation Mode…')
  })
})
