/**
 * ReferencePanel — 카드 key 충돌 회귀.
 *
 * 레거시/CSV 로 들어온 ref 는 id 가 없고, UI 에서 추가한 ref 는 id 를 가진다(maxId+1).
 * 둘이 섞이면 `key={ref.id || index}` 가 id공간과 index공간을 합쳐, id=1 인 ref 와
 * index=1 의 무-id ref 가 둘 다 key="1" → React "two children with the same key" 경고
 * + 컴포넌트 오재사용/누락. key 가 충돌하지 않아야 한다.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render } from '@testing-library/react'

vi.mock('../../src/hooks/useI18n', () => ({
  default: () => ({ t: (k) => k, lang: 'en', setLang: vi.fn() }),
  useI18n: () => ({ t: (k) => k, lang: 'en', setLang: vi.fn() }),
}))
vi.mock('../../src/hooks/useElapsedTimer', () => ({ useElapsedTimer: () => 0 }))
vi.mock('../../src/hooks/useModalVisibility', () => ({ useModalVisibility: () => {} }))
vi.mock('../../src/components/Toast', () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() },
}))
vi.mock('../../src/components/ReferenceDetailModal', () => ({ default: () => null }))
vi.mock('../../src/components/StylePicker', () => ({ default: () => null }))
vi.mock('../../src/components/ReferenceCard', () => ({ default: () => null }))

import ReferencePanel from '../../src/components/ReferencePanel'

function renderPanel(references) {
  return render(
    <ReferencePanel
      references={references} onUpdate={vi.fn()} onUpload={vi.fn()}
      onGenerate={vi.fn()} onGenerateAll={vi.fn()} onStopGenerateAll={vi.fn()} onClearAll={vi.fn()}
      aspectRatio="16:9" generatingRefs={[]} stoppingRefs={false} preparingRefs={false}
      selectedStyleRefId={null} onStyleRefChange={vi.fn()} projectName="proj"
    />
  )
}

beforeEach(() => { vi.clearAllMocks() })

describe('ReferencePanel — card key collision', () => {
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
