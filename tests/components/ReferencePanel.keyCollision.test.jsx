/**
 * ReferencePanel — 카드 key 충돌 회귀.
 *
 * 레거시/CSV 로 들어온 ref 는 id 가 없고, UI 에서 추가한 ref 는 id 를 가진다(maxId+1).
 * 둘이 섞이면 `key={ref.id || index}` 가 id공간과 index공간을 합쳐, id=1 인 ref 와
 * index=1 의 무-id ref 가 둘 다 key="1" → React "two children with the same key" 경고
 * + 컴포넌트 오재사용/누락. key 가 충돌하지 않아야 한다.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

vi.mock('../../src/hooks/useI18n', () => ({
  default: () => ({ t: (k) => k, lang: 'en', setLang: vi.fn() }),
  useI18n: () => ({ t: (k) => k, lang: 'en', setLang: vi.fn() }),
}))
vi.mock('../../src/hooks/useElapsedTimer', () => ({ useElapsedTimer: () => 0 }))
vi.mock('../../src/hooks/useModalVisibility', () => ({ useModalVisibility: () => {} }))
vi.mock('../../src/components/Toast', () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() },
}))
vi.mock('../../src/components/StylePicker', () => ({ default: () => null }))
vi.mock('../../src/components/ReferenceCard', () => ({
  default: ({ reference, index, onShowDetail }) => (
    <button data-testid={`open-${reference.id ?? index}`} onClick={() => onShowDetail(index)}>
      {reference.name}
    </button>
  ),
}))
vi.mock('../../src/components/ReferenceDetailModal', async () => {
  const { useState } = await import('react')
  return {
    default: ({ reference, scenes }) => {
      const [draft, setDraft] = useState(reference.name)
      return (
        <div data-testid="detail-modal">
          <span>{draft}</span>
          <span data-testid="detail-scenes-count">{scenes?.length ?? 0}</span>
          <button onClick={() => setDraft('dirty-old-project')}>dirty</button>
        </div>
      )
    },
  }
})

import ReferencePanel from '../../src/components/ReferencePanel'

function panel(references, projectName = 'proj', scenes = []) {
  return (
    <ReferencePanel
      references={references} onUpdate={vi.fn()} onUpload={vi.fn()}
      onGenerate={vi.fn()} onGenerateAll={vi.fn()} onStopGenerateAll={vi.fn()} onClearAll={vi.fn()}
      aspectRatio="16:9" generatingRefs={[]} stoppingRefs={false} preparingRefs={false}
      selectedStyleRefId={null} onStyleRefChange={vi.fn()} projectName={projectName}
      scenes={scenes}
    />
  )
}

function renderPanel(references, projectName, scenes) {
  return render(panel(references, projectName, scenes))
}

beforeEach(() => { vi.clearAllMocks() })

describe('ReferencePanel — card key collision', () => {
  it('App에서 받은 scenes를 상세 모달까지 전달한다', () => {
    renderPanel(
      [{ id: 1, name: 'hero', type: 'character' }],
      'proj',
      [{ id: 11, prompt: 'scene', style_tag: 'korean-ani' }],
    )

    fireEvent.click(screen.getByTestId('open-1'))
    expect(screen.getByTestId('detail-scenes-count')).toHaveTextContent('1')
  })

  it('does not emit a duplicate-key warning for mixed id / no-id references', () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    // 실제 무한야담_ep10_test 형태: 무-id ref 들 + UI 추가분(id=1).
    // 무-id ref 가 index 1 에 있고 id=1 ref 가 있으면 옛 코드에선 key="1" 충돌.
    renderPanel([
      { name: 'a', type: 'character' },   // idx 0 (id 없음)
      { name: 'b', type: 'character' },   // idx 1 (id 없음) → 옛 key=1
      { id: 1, name: '', type: 'character' }, // id=1 → 옛 key=1 (충돌)
    ])

    const dupKeyWarning = errSpy.mock.calls.find(
      (args) => args.some((a) => String(a).includes('same key'))
    )
    expect(dupKeyWarning).toBeUndefined()

    errSpy.mockRestore()
  })
})

describe('ReferencePanel — 프로젝트별 상세 모달 identity', () => {
  it('같은 reference id여도 projectName이 바뀌면 모달 draft를 새 프로젝트 카드로 초기화한다', () => {
    const firstReference = { id: 1, type: 'character', name: 'project-a-card' }
    const { rerender } = renderPanel([firstReference], 'project-a')

    fireEvent.click(screen.getByTestId('open-1'))
    fireEvent.click(screen.getByRole('button', { name: 'dirty' }))
    expect(screen.getByTestId('detail-modal')).toHaveTextContent('dirty-old-project')

    const secondReference = { id: 1, type: 'character', name: 'project-b-card' }
    rerender(panel([secondReference], 'project-b'))

    expect(screen.getByTestId('detail-modal')).toHaveTextContent('project-b-card')
    expect(screen.getByTestId('detail-modal')).not.toHaveTextContent('dirty-old-project')
  })
})
