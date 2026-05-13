import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import StylePicker from '../../src/components/StylePicker'

const t = (k, vars) => {
  const map = {
    'reference.allCategories': '전체',
    'reference.noStyle': '스타일 없음',
    'reference.autoMatch': '자동 (씬별 매칭)',
    'reference.autoMatchNone': '자동 (매칭 없음)',
    'reference.matchPreviewTitle': '씬별 매칭 미리보기',
    'reference.matchPreviewEmpty': '매칭된 씬이 없습니다',
    'reference.matchPreviewSummary': '{name}: {count}개 씬',
    'reference.matchPreviewUnmatched': '미매칭: {count}개 씬',
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
  scenes: [],
  references: [],
  t,
  isKo: true,
}

describe('StylePicker — auto-match card', () => {
  it('renders auto card label "자동 (매칭 없음)" when no scenes match', () => {
    render(<StylePicker {...baseProps} scenes={[{ id: 1, style_tag: '' }]} />)
    expect(screen.getByText('자동 (매칭 없음)')).toBeInTheDocument()
  })

  it('renders auto card label "자동 (씬별 매칭)" when matches exist', () => {
    const scenes = [{ id: 1, style_tag: '누아르' }]
    const references = [{ id: 10, type: 'style', name: '누아르', prompt: 'noir' }]
    render(<StylePicker {...baseProps} scenes={scenes} references={references} />)
    expect(screen.getByText('자동 (씬별 매칭)')).toBeInTheDocument()
  })

  it('falls back to "스타일 없음" label when no scenes prop given (backward compat)', () => {
    render(<StylePicker {...baseProps} scenes={undefined} />)
    expect(screen.getByText('스타일 없음')).toBeInTheDocument()
  })

  it('marks auto card as selected when selectedId is null', () => {
    const { container } = render(<StylePicker {...baseProps} scenes={[]} />)
    const autoCard = container.querySelector('.sp-no-style')
    expect(autoCard.className).toMatch(/selected/)
  })

  it('autoCardLabelOverride takes precedence over scene-match preview', () => {
    const scenes = [{ id: 1, style_tag: '누아르' }]
    const references = [{ id: 10, type: 'style', name: '누아르', prompt: 'noir' }]
    render(
      <StylePicker
        {...baseProps}
        scenes={scenes}
        references={references}
        autoCardLabelOverride="custom override label"
      />
    )
    expect(screen.getByText('custom override label')).toBeInTheDocument()
    // Scene-match label must NOT appear when override is set
    expect(screen.queryByText('자동 (씬별 매칭)')).toBeNull()
  })

  it('hides scene-match summary/tooltip when autoCardLabelOverride is set', () => {
    const scenes = [{ id: 1, style_tag: '누아르' }, { id: 2, style_tag: '누아르' }]
    const references = [{ id: 10, type: 'style', name: '누아르', prompt: 'noir' }]
    const { container } = render(
      <StylePicker
        {...baseProps}
        scenes={scenes}
        references={references}
        autoCardLabelOverride="video-text auto"
      />
    )
    // No sp-auto-summary rendered (image scene preview suppressed)
    expect(container.querySelector('.sp-auto-summary')).toBeNull()
    // Auto card title (tooltip) is empty (not the scene-match preview tooltip)
    const autoCard = container.querySelector('.sp-no-style')
    expect(autoCard.getAttribute('title')).toBe('')
  })

  it('uses 🪄 icon when autoCardLabelOverride is set (auto mode visual)', () => {
    const { container } = render(
      <StylePicker
        {...baseProps}
        scenes={undefined}  // no scene preview
        autoCardLabelOverride="auto via override"
      />
    )
    const icon = container.querySelector('.sp-no-style .sp-icon')
    expect(icon.textContent).toBe('🪄')
  })
})
