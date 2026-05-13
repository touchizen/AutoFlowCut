import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import StylePicker from '../../src/components/StylePicker'

const t = (k, vars) => {
  const map = {
    'reference.allCategories': '전체',
    'reference.noStyle': '스타일 없음',
    'reference.uploadedStyles': '업로드된 스타일',
    'reference.generateThumbnails': '썸네일 생성',
    'reference.thumbnailProgress': '{current}/{total} 생성 중',
    'reference.stop': '중단',
    'reference.stopping': '중단중',
  }
  let s = map[k] || k
  if (vars) for (const [v, val] of Object.entries(vars)) s = s.replace(`{${v}}`, val)
  return s
}

const baseProps = {
  selectedId: null,
  onSelect: vi.fn(),
  thumbnails: {},
  uploadedStyleRefs: [],
  generating: false,
  stopping: false,
  progress: { current: 0, total: 0 },
  onGenerateThumbnails: vi.fn(),
  onStopGenerating: vi.fn(),
  t,
  isKo: true,
}

describe('StylePicker — auto card via autoCardMeta', () => {
  it('falls back to "스타일 없음" + 🚫 icon when no autoCardMeta passed', () => {
    const { container } = render(<StylePicker {...baseProps} />)
    expect(screen.getByText('스타일 없음')).toBeInTheDocument()
    const icon = container.querySelector('.sp-no-style .sp-icon')
    expect(icon.textContent).toBe('🚫')
  })

  it('renders autoCardMeta.label', () => {
    render(<StylePicker {...baseProps}
      autoCardMeta={{ label: 'custom auto label', icon: '🪄', tooltip: 'tip', summary: 'sumX' }}
    />)
    expect(screen.getByText('custom auto label')).toBeInTheDocument()
  })

  it('renders autoCardMeta.icon', () => {
    const { container } = render(<StylePicker {...baseProps}
      autoCardMeta={{ label: 'L', icon: '🪄', tooltip: '', summary: null }}
    />)
    expect(container.querySelector('.sp-no-style .sp-icon').textContent).toBe('🪄')
  })

  it('renders autoCardMeta.tooltip via title attr', () => {
    const { container } = render(<StylePicker {...baseProps}
      autoCardMeta={{ label: 'L', icon: '🪄', tooltip: 'helpful tip', summary: null }}
    />)
    expect(container.querySelector('.sp-no-style').getAttribute('title')).toBe('helpful tip')
  })

  it('hides summary when autoCardMeta.summary is null', () => {
    const { container } = render(<StylePicker {...baseProps}
      autoCardMeta={{ label: 'L', icon: '🪄', tooltip: '', summary: null }}
    />)
    expect(container.querySelector('.sp-auto-summary')).toBeNull()
  })

  it('shows summary when autoCardMeta.summary is set', () => {
    const { container } = render(<StylePicker {...baseProps}
      autoCardMeta={{ label: 'L', icon: '🪄', tooltip: '', summary: 'A, B +1' }}
    />)
    expect(container.querySelector('.sp-auto-summary').textContent).toBe('A, B +1')
  })

  it('marks auto card as selected when selectedId is null', () => {
    const { container } = render(<StylePicker {...baseProps} />)
    const autoCard = container.querySelector('.sp-no-style')
    expect(autoCard.className).toMatch(/selected/)
  })
})
