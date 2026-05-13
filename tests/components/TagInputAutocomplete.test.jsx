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
})
