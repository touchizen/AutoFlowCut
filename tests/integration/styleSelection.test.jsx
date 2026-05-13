import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import StylePicker from '../../src/components/StylePicker'
import { resolveSceneStyle, previewStyleMatching } from '../../src/services/styleService'

const t = (k, vars) => {
  const map = {
    'reference.allCategories': '전체',
    'reference.noStyle': '스타일 없음',
    'reference.autoMatch': '자동 (씬별 매칭)',
    'reference.autoMatchNone': '자동 (매칭 없음)',
    'reference.matchPreviewTitle': '씬별 매칭 미리보기',
    'reference.matchPreviewSummary': '{name}: {count}개 씬',
    'reference.matchPreviewUnmatched': '미매칭: {count}개 씬',
    'reference.matchPreviewEmpty': '매칭된 씬이 없습니다',
    'reference.autoMatchHint': '씬별 style_tag로 스타일을 자동 결정합니다',
    'reference.uploadedStyles': '업로드된 스타일',
    'reference.generateThumbnails': '썸네일 생성',
    'reference.thumbnailProgress': '{current}/{total}',
    'reference.stop': '중단',
    'reference.stopping': '중단중',
  }
  let s = map[k] || k
  if (vars) for (const [v, val] of Object.entries(vars)) s = s.replace(`{${v}}`, val)
  return s
}

describe('Style selection — end-to-end', () => {
  const userStyle = { id: 100, type: 'style', name: '내 시그니처', prompt: 'signature look' }
  const scenes = [
    { id: 1, style_tag: '내 시그니처' },
    { id: 2, style_tag: '내 시그니처' },
    { id: 3, style_tag: '' }
  ]
  const references = [userStyle]

  it('preview shows user-named style matching across multiple scenes', () => {
    const preview = previewStyleMatching(scenes, references)
    expect(preview.styleSummary).toEqual([{ name: '내 시그니처', count: 2 }])
    expect(preview.unmatched).toEqual([3])
  })

  it('StylePicker first card reflects auto-match label and summary', () => {
    render(
      <StylePicker
        selectedId={null}
        onSelect={vi.fn()}
        scenes={scenes}
        references={references}
        thumbnails={{}}
        uploadedStyleRefs={[userStyle]}
        progress={{ current: 0, total: 0 }}
        t={t}
        isKo={true}
      />
    )
    expect(screen.getByText('자동 (씬별 매칭)')).toBeInTheDocument()
    // styleSummary가 카드 하단에 노출되는지 확인 (sp-auto-summary 클래스 안쪽)
    const summaryEl = document.querySelector('.sp-auto-summary')
    expect(summaryEl).toBeTruthy()
    expect(summaryEl.textContent).toContain('내 시그니처')
  })

  it('auto card tooltip includes the per-scene-matching hint', () => {
    const { container } = render(
      <StylePicker
        selectedId={null}
        onSelect={vi.fn()}
        scenes={scenes}
        references={references}
        thumbnails={{}}
        uploadedStyleRefs={[userStyle]}
        progress={{ current: 0, total: 0 }}
        t={t}
        isKo={true}
      />
    )
    const autoCard = container.querySelector('.sp-no-style')
    expect(autoCard.getAttribute('title')).toContain('씬별 style_tag로 스타일을 자동 결정합니다')
  })

  it('explicit selection overrides auto-match in resolveSceneStyle', () => {
    const matchedRefs = []
    const result = resolveSceneStyle(
      'a samurai in moonlight',
      [{ ...userStyle }],          // 태그로 매칭된 ref
      `ref:${userStyle.id}`,       // 명시 선택 → 1순위
      references,
      matchedRefs,
      '내 시그니처'
    )
    expect(result.appliedStyle).toBe(`ref:${userStyle.id}`)
    expect(result.styledPrompt).toContain('signature look')
  })

  it('without explicit selection, scene tag drives style application', () => {
    const matchedRefs = []
    const result = resolveSceneStyle(
      'a samurai in moonlight',
      [{ ...userStyle }],
      null,                         // 명시 선택 없음 → 자동 매칭
      references,
      matchedRefs,
      '내 시그니처'
    )
    expect(result.appliedStyle).toBe(`auto:${userStyle.name}`)
    expect(result.styledPrompt).toContain('signature look')
  })
})
