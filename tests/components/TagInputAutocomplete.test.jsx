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

  it('character: clicking an option replaces the partial last token', () => {
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

  it('ArrowDown highlights the next option, Enter applies the highlighted one', () => {
    const onChange = vi.fn()
    const refs = [
      { id: 1, type: 'character', name: 'Hero' },
      { id: 2, type: 'character', name: 'Villain' },
    ]
    const { container } = render(<TagInputAutocomplete {...baseProps} references={refs} onChange={onChange} />)
    const input = screen.getByRole('textbox')
    fireEvent.focus(input)
    fireEvent.keyDown(input, { key: 'ArrowDown' })
    // 첫 항목 highlighted
    const highlighted = container.querySelector('.tag-autocomplete-option.highlighted')
    expect(highlighted.textContent).toBe('Hero')
    fireEvent.keyDown(input, { key: 'ArrowDown' })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onChange).toHaveBeenCalledWith('Villain')
  })

  it('ArrowUp goes to previous option (no wrap)', () => {
    const refs = [
      { id: 1, type: 'character', name: 'Hero' },
      { id: 2, type: 'character', name: 'Villain' },
    ]
    const { container } = render(<TagInputAutocomplete {...baseProps} references={refs} />)
    const input = screen.getByRole('textbox')
    fireEvent.focus(input)
    fireEvent.keyDown(input, { key: 'ArrowDown' })
    fireEvent.keyDown(input, { key: 'ArrowDown' })
    fireEvent.keyDown(input, { key: 'ArrowUp' })
    const highlighted = container.querySelector('.tag-autocomplete-option.highlighted')
    expect(highlighted.textContent).toBe('Hero')
  })

  it('Enter without a highlighted option does not call onChange', () => {
    const onChange = vi.fn()
    const refs = [{ id: 1, type: 'character', name: 'Hero' }]
    render(<TagInputAutocomplete {...baseProps} references={refs} onChange={onChange} />)
    const input = screen.getByRole('textbox')
    fireEvent.focus(input)
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onChange).not.toHaveBeenCalled()
  })

  it('Escape closes the dropdown without changing value', () => {
    const refs = [{ id: 1, type: 'character', name: 'Hero' }]
    const { container } = render(<TagInputAutocomplete {...baseProps} references={refs} />)
    const input = screen.getByRole('textbox')
    fireEvent.focus(input)
    expect(container.querySelector('.tag-autocomplete-dropdown')).toBeInTheDocument()
    fireEvent.keyDown(input, { key: 'Escape' })
    expect(container.querySelector('.tag-autocomplete-dropdown')).toBeNull()
  })

  it('includes preset options when type is style', () => {
    const refs = [{ id: 1, type: 'style', name: 'Custom Noir' }]
    const presets = [
      { id: 'cinematic', name_ko: '시네마틱', name_en: 'Cinematic' },
      { id: 'noir', name_ko: '누아르', name_en: 'Noir' },
    ]
    render(<TagInputAutocomplete {...baseProps} type="style" references={refs} presets={presets} />)
    fireEvent.focus(screen.getByRole('textbox'))
    expect(screen.getByText('Custom Noir')).toBeInTheDocument()
    expect(screen.getByText('시네마틱')).toBeInTheDocument()
    expect(screen.getByText('누아르')).toBeInTheDocument()
  })

  it('does not show preset options when type is not style', () => {
    const refs = []
    const presets = [{ id: 'cinematic', name_ko: '시네마틱', name_en: 'Cinematic' }]
    render(<TagInputAutocomplete {...baseProps} type="character" references={refs} presets={presets} />)
    fireEvent.focus(screen.getByRole('textbox'))
    // empty notice, no preset
    expect(screen.queryByText('시네마틱')).toBeNull()
    expect(screen.getByText('사용 가능한 ref/preset이 없습니다')).toBeInTheDocument()
  })

  it('disabled input does not open dropdown on focus', () => {
    const refs = [{ id: 1, type: 'character', name: 'Hero' }]
    const { container } = render(<TagInputAutocomplete {...baseProps} references={refs} disabled />)
    const input = screen.getByRole('textbox')
    fireEvent.focus(input)
    expect(container.querySelector('.tag-autocomplete-dropdown')).toBeNull()
  })

  it('preset options are visually marked with "(preset)" suffix', () => {
    const presets = [{ id: 'noir', name_ko: '누아르', name_en: 'Noir' }]
    render(<TagInputAutocomplete {...baseProps} type="style" presets={presets} />)
    fireEvent.focus(screen.getByRole('textbox'))
    expect(screen.getByText(/preset/i)).toBeInTheDocument()
  })

  it('renders ref thumbnail from data when available', () => {
    const refs = [{
      id: 1, type: 'character', name: 'Hero',
      data: 'data:image/png;base64,iVBORw0KGgo='
    }]
    const { container } = render(<TagInputAutocomplete {...baseProps} references={refs} />)
    fireEvent.focus(screen.getByRole('textbox'))
    const img = container.querySelector('.tag-autocomplete-option img.tag-autocomplete-thumb')
    expect(img).toBeTruthy()
    expect(img.getAttribute('src')).toContain('data:image/png;base64')
  })

  it('renders empty thumb placeholder when ref has no image', () => {
    const refs = [{ id: 1, type: 'character', name: 'NoImage' }]
    const { container } = render(<TagInputAutocomplete {...baseProps} references={refs} />)
    fireEvent.focus(screen.getByRole('textbox'))
    expect(container.querySelector('.tag-autocomplete-thumb.empty')).toBeTruthy()
  })

  it('renders preset thumbnail from thumbnails map (style type)', () => {
    const presets = [{ id: 'noir', name_ko: '누아르', name_en: 'Noir' }]
    const thumbnails = { noir: '/some/path/noir.png' }
    const { container } = render(
      <TagInputAutocomplete {...baseProps} type="style" presets={presets} thumbnails={thumbnails} />
    )
    fireEvent.focus(screen.getByRole('textbox'))
    const img = container.querySelector('.tag-autocomplete-option.preset img.tag-autocomplete-thumb')
    expect(img).toBeTruthy()
    expect(img.getAttribute('src')).toContain('noir.png')
  })
})

describe('TagInputAutocomplete — A3 멀티선택/단일 교체', () => {
  it('character: 이미 선택된 옵션을 클릭하면 제거된다 (토글 off)', () => {
    const onChange = vi.fn()
    const refs = [{ id: 1, type: 'character', name: 'Hero' }]
    render(<TagInputAutocomplete {...baseProps} type="character" references={refs} value="Hero" onChange={onChange} />)
    fireEvent.focus(screen.getByRole('textbox'))
    fireEvent.mouseDown(screen.getByText('Hero'))
    expect(onChange).toHaveBeenCalledWith('')
  })

  it('character: 다른 옵션을 클릭하면 콤마 목록에 누적된다', () => {
    const onChange = vi.fn()
    const refs = [
      { id: 1, type: 'character', name: 'Hero' },
      { id: 2, type: 'character', name: 'Villain' },
    ]
    render(<TagInputAutocomplete {...baseProps} type="character" references={refs} value="Hero, " onChange={onChange} />)
    fireEvent.focus(screen.getByRole('textbox'))
    fireEvent.mouseDown(screen.getByText('Villain'))
    expect(onChange).toHaveBeenCalledWith('Hero, Villain')
  })

  it('scene: 옵션 클릭 시 값이 통째로 교체된다 (단일)', () => {
    const onChange = vi.fn()
    const refs = [
      { id: 1, type: 'scene', name: 'Forest' },
      { id: 2, type: 'scene', name: 'Beach' },
    ]
    render(<TagInputAutocomplete {...baseProps} type="scene" references={refs} value="Forest, " onChange={onChange} />)
    fireEvent.focus(screen.getByRole('textbox'))
    fireEvent.mouseDown(screen.getByText('Beach'))
    expect(onChange).toHaveBeenCalledWith('Beach')
  })

  it('style: 옵션 클릭 시 값이 통째로 교체된다 (단일)', () => {
    const onChange = vi.fn()
    const refs = [
      { id: 1, type: 'style', name: 'Noir' },
      { id: 2, type: 'style', name: 'Pastel' },
    ]
    render(<TagInputAutocomplete {...baseProps} type="style" references={refs} value="Noir, " onChange={onChange} />)
    fireEvent.focus(screen.getByRole('textbox'))
    fireEvent.mouseDown(screen.getByText('Pastel'))
    expect(onChange).toHaveBeenCalledWith('Pastel')
  })

  it('character: 멀티값에서 마지막이 아닌 토큰도 토글 해제된다', () => {
    const onChange = vi.fn()
    const refs = [
      { id: 1, type: 'character', name: 'Hero' },
      { id: 2, type: 'character', name: 'Villain' },
    ]
    // 마지막 토큰이 빈 문자열이면 모든 옵션이 표시되어 Hero를 클릭할 수 있다
    render(<TagInputAutocomplete {...baseProps} type="character" references={refs} value="Hero, Villain, " onChange={onChange} />)
    fireEvent.focus(screen.getByRole('textbox'))
    fireEvent.mouseDown(screen.getByText('Hero'))
    expect(onChange).toHaveBeenCalledWith('Villain')
  })
})

describe('TagInputAutocomplete — A1 확정 선택 시 전체목록', () => {
  it('마지막 토큰이 ref 이름과 정확히 일치하면 전체 옵션을 보여준다', () => {
    const refs = [
      { id: 1, type: 'character', name: 'Hero' },
      { id: 2, type: 'character', name: 'Villain' },
    ]
    render(<TagInputAutocomplete {...baseProps} type="character" references={refs} value="Hero" />)
    fireEvent.focus(screen.getByRole('textbox'))
    // Hero 가 확정 매칭이어도 Villain 이 계속 보여야 함
    expect(screen.getByText('Hero')).toBeInTheDocument()
    expect(screen.getByText('Villain')).toBeInTheDocument()
  })

  it('입력 중인 미완성 토큰은 여전히 필터링한다', () => {
    const refs = [
      { id: 1, type: 'character', name: 'Hero' },
      { id: 2, type: 'character', name: 'Villain' },
    ]
    render(<TagInputAutocomplete {...baseProps} type="character" references={refs} value="vil" />)
    fireEvent.focus(screen.getByRole('textbox'))
    expect(screen.queryByText('Hero')).toBeNull()
    expect(screen.getByText('Villain')).toBeInTheDocument()
  })
})
