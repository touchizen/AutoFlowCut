/**
 * DisplayTab — Flow split 레이아웃 방향 선택
 *
 * 회귀: settings.layoutModeHint 키가 locale 에 없어 t() 가 raw 키('settings.layoutModeHint')를
 * 그대로 렌더 → 화면에 키가 노출되던 버그. 실제 locale 기반 t() 로 렌더해 raw 키가 새지 않음을 검증.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'

import DisplayTab from '../../../src/components/settings/DisplayTab'
import ko from '../../../src/locales/ko'
import en from '../../../src/locales/en'

// useI18n 의 t() 와 동일한 dot-notation 조회 (없으면 키 자체 반환)
function makeT(strings) {
  return (key) => {
    let value = strings
    for (const k of key.split('.')) {
      if (value && typeof value === 'object' && k in value) value = value[k]
      else return key
    }
    return typeof value === 'string' ? value : key
  }
}

beforeEach(() => {
  window.electronAPI = {
    getPreventSleep: vi.fn().mockResolvedValue({ enabled: false }),
    getLayout: vi.fn().mockResolvedValue({ mode: 'split-left', splitRatio: 0.5 }),
    setLayout: vi.fn().mockResolvedValue({}),
    setPreventSleep: vi.fn().mockResolvedValue({}),
  }
})

describe('DisplayTab layout hint i18n', () => {
  for (const [lang, strings] of [['ko', ko], ['en', en]]) {
    it(`renders the layout hint string (not a raw key) in ${lang}`, () => {
      render(<DisplayTab t={makeT(strings)} appMode="flow" />)
      // raw 키가 화면에 노출되면 안 됨
      expect(screen.queryByText('settings.layoutModeHint')).toBeNull()
      // 실제 hint 문자열이 렌더되어야 함
      expect(strings.settings.layoutModeHint).toBeTruthy()
      expect(screen.getByText(strings.settings.layoutModeHint)).toBeInTheDocument()
    })
  }

  it('hides the layout section outside flow mode', () => {
    render(<DisplayTab t={makeT(ko)} appMode="api" />)
    expect(screen.queryByText(ko.settings.layoutMode)).toBeNull()
  })
})
