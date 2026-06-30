import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import { I18nProvider } from '../../src/hooks/useI18n'
import ModeSelector from '../../src/components/ModeSelector'

beforeEach(() => {
  localStorage.clear()
  localStorage.setItem('autoflowcut_lang', 'en') // 알려진 시작 언어로 고정
})

function renderSel(onSelect = () => {}) {
  return render(
    <I18nProvider>
      <ModeSelector onSelect={onSelect} />
    </I18nProvider>,
  )
}

describe('ModeSelector', () => {
  it('renders both mode choices', () => {
    renderSel()
    expect(screen.getByTestId('mode-selector')).toBeTruthy()
    expect(screen.getByTestId('mode-select-api')).toBeTruthy()
    expect(screen.getByTestId('mode-select-flow')).toBeTruthy()
  })

  it('calls onSelect with the chosen mode', () => {
    const onSelect = vi.fn()
    renderSel(onSelect)
    fireEvent.click(screen.getByTestId('mode-select-flow'))
    expect(onSelect).toHaveBeenCalledWith('flow')
    fireEvent.click(screen.getByTestId('mode-select-api'))
    expect(onSelect).toHaveBeenCalledWith('api')
  })

  it('shows pros/cons (audience · price · speed) on each card', () => {
    renderSel()
    const flow = within(screen.getByTestId('mode-select-flow'))
    // 언어-중립 마커(이모지)로 검증 — 기본 언어에 흔들리지 않음
    expect(flow.getByText(/👤/)).toBeInTheDocument() // audience
    expect(flow.getByText(/🐢/)).toBeInTheDocument() // slower
    expect(flow.getByText(/💰/)).toBeInTheDocument() // free/cheap

    const api = within(screen.getByTestId('mode-select-api'))
    expect(api.getByText(/🚀/)).toBeInTheDocument() // power users
    expect(api.getByText(/⚡/)).toBeInTheDocument() // fast
    expect(api.getByText(/✨/)).toBeInTheDocument() // more models coming
  })

  it('has a language picker and switching it localizes the picker text', () => {
    const { container } = renderSel()
    // 시작 언어 EN → 영어 제목
    expect(screen.getByText('Choose how to generate')).toBeInTheDocument()

    const langBtn = container.querySelector('.lang-picker-button')
    expect(langBtn).toBeTruthy()
    fireEvent.click(langBtn)
    fireEvent.click(screen.getByText('KO'))

    // 한국어로 전환 → 한국어 제목 + 카드 문구
    expect(screen.getByText('생성 방식을 선택하세요')).toBeInTheDocument()
    expect(within(screen.getByTestId('mode-select-api')).getByText(/고급 사용자/)).toBeInTheDocument()
  })
})
