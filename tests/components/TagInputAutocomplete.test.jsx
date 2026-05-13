import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import TagInputAutocomplete from '../../src/components/TagInputAutocomplete'

const t = (k) => {
  const map = { 'sceneList.noRefsForType': '사용 가능한 ref/preset이 없습니다' }
  return map[k] || k
}

const baseProps = {
  type: 'character',
  value: '',
  onChange: vi.fn(),
  references: [],
  presets: [],
  isKo: true,
  t,
}

describe('TagInputAutocomplete — basic render', () => {
  it('renders the input with given value and placeholder', () => {
    render(<TagInputAutocomplete {...baseProps} value="hero" placeholder="placeholder-text" />)
    const input = screen.getByPlaceholderText('placeholder-text')
    expect(input).toBeInTheDocument()
    expect(input.value).toBe('hero')
  })

  it('does not show dropdown until input is focused', () => {
    const { container } = render(<TagInputAutocomplete {...baseProps} />)
    expect(container.querySelector('.tag-autocomplete-dropdown')).toBeNull()
  })

  it('shows dropdown on focus', () => {
    const refs = [{ id: 1, type: 'character', name: 'Hero' }]
    const { container } = render(<TagInputAutocomplete {...baseProps} references={refs} />)
    fireEvent.focus(screen.getByRole('textbox'))
    expect(container.querySelector('.tag-autocomplete-dropdown')).toBeInTheDocument()
  })

  it('filters options by the last token (case-insensitive)', () => {
    const refs = [
      { id: 1, type: 'character', name: 'Hero' },
      { id: 2, type: 'character', name: 'Villain' },
    ]
    render(<TagInputAutocomplete {...baseProps} references={refs} value="he" />)
    fireEvent.focus(screen.getByRole('textbox'))
    expect(screen.getByText('Hero')).toBeInTheDocument()
    expect(screen.queryByText('Villain')).toBeNull()
  })

  it('filters by the last token only (multi-tag aware)', () => {
    const refs = [
      { id: 1, type: 'character', name: 'Hero' },
      { id: 2, type: 'character', name: 'Villain' },
    ]
    // 사용자가 "hero, vi" 까지 타이핑 — 마지막 토큰 "vi" 기준 filter
    render(<TagInputAutocomplete {...baseProps} references={refs} value="hero, vi" />)
    fireEvent.focus(screen.getByRole('textbox'))
    expect(screen.queryByText('Hero')).toBeNull()
    expect(screen.getByText('Villain')).toBeInTheDocument()
  })

  it('clicking an option replaces only the last token', () => {
    const onChange = vi.fn()
    const refs = [{ id: 1, type: 'character', name: 'Villain' }]
    render(<TagInputAutocomplete {...baseProps} references={refs} value="hero, vi" onChange={onChange} />)
    fireEvent.focus(screen.getByRole('textbox'))
    fireEvent.mouseDown(screen.getByText('Villain'))
    expect(onChange).toHaveBeenCalledWith('hero, Villain')
  })

  it('clicking an option when input is empty sets the option as the only token', () => {
    const onChange = vi.fn()
    const refs = [{ id: 1, type: 'character', name: 'Hero' }]
    render(<TagInputAutocomplete {...baseProps} references={refs} value="" onChange={onChange} />)
    fireEvent.focus(screen.getByRole('textbox'))
    fireEvent.mouseDown(screen.getByText('Hero'))
    expect(onChange).toHaveBeenCalledWith('Hero')
  })

  it('clicking an option when input ends with comma adds the option as a new token', () => {
    const onChange = vi.fn()
    const refs = [{ id: 1, type: 'character', name: 'Sidekick' }]
    render(<TagInputAutocomplete {...baseProps} references={refs} value="hero, " onChange={onChange} />)
    fireEvent.focus(screen.getByRole('textbox'))
    fireEvent.mouseDown(screen.getByText('Sidekick'))
    expect(onChange).toHaveBeenCalledWith('hero, Sidekick')
  })
})
