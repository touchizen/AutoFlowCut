/**
 * ReferencePanel — 일괄 생성 버튼이 스타일 카드도 배치 대상으로 포함하는지 검증.
 *
 * 회귀 컨텍스트: _executeBatchRefs는 style 카드를 배치(style phase)에 포함하도록
 * 바뀌었지만 ReferencePanel UI는 여전히 style 카드를 generatableRefs에서 제외해서
 * 버튼이 안 뜨거나 카운트가 틀리던 버그.
 */
import { describe, it, expect, vi } from 'vitest'
import { fireEvent, render } from '@testing-library/react'

vi.mock('../../src/hooks/useI18n', () => ({
  default: () => ({ t: (k) => k, lang: 'en', setLang: vi.fn() }),
  useI18n: () => ({ t: (k) => k, lang: 'en', setLang: vi.fn() })
}))

vi.mock('../../src/hooks/useElapsedTimer', () => ({
  useElapsedTimer: () => 0
}))

vi.mock('../../src/hooks/useModalVisibility', () => ({
  useModalVisibility: () => {}
}))

vi.mock('../../src/components/Toast', () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() }
}))

vi.mock('../../src/components/ReferenceCard', () => ({
  default: ({ refBatchRunning }) => <div className="card-batch-prop">{String(!!refBatchRunning)}</div>
}))
vi.mock('../../src/components/ReferenceDetailModal', () => ({ default: () => null }))
vi.mock('../../src/components/StylePicker', () => ({ default: () => null }))

import ReferencePanel from '../../src/components/ReferencePanel'

function renderPanel(references, extraProps = {}) {
  return render(
    <ReferencePanel
      references={references}
      onUpdate={vi.fn()}
      onUpload={vi.fn()}
      onGenerate={vi.fn()}
      onGenerateAll={vi.fn()}
      onStopGenerateAll={vi.fn()}
      onClearAll={vi.fn()}
      aspectRatio="16:9"
      generatingRefs={[]}
      stoppingRefs={false}
      preparingRefs={false}
      selectedStyleRefId={null}
      onStyleRefChange={vi.fn()}
      projectName="proj"
      {...extraProps}
    />
  )
}

describe('ReferencePanel — 일괄 생성 버튼 (style 카드 포함)', () => {
  it('위저드 시작은 현재 selectedStyleRefId를 배치 override로 원자 전달한다', () => {
    const onGenerateAll = vi.fn()
    const { container } = renderPanel([
      { id: 1, type: 'character', prompt: 'a hero' }
    ], {
      selectedStyleRefId: 'preset:korean-ani',
      onGenerateAll,
    })

    fireEvent.click(container.querySelector('.btn-generate-all'))
    fireEvent.click(document.body.querySelector('.btn-wizard-start'))

    expect(onGenerateAll).toHaveBeenCalledTimes(1)
    expect(onGenerateAll).toHaveBeenCalledWith('preset:korean-ani')
  })

  it('style 카드만 pending 일 때도 일괄 생성 버튼이 뜬다', () => {
    const { container } = renderPanel([
      { id: 1, type: 'style', prompt: 'a noir style' }
    ])
    const btn = container.querySelector('.btn-generate-all')
    expect(btn).toBeTruthy()
    // stop/preparing 변종이 아닌 진짜 생성 버튼이어야 함
    expect(btn.className).not.toContain('btn-stop')
    expect(btn.className).not.toContain('btn-preparing')
  })

  it('style + character 둘 다 pending 이면 버튼 카운트가 2를 반영한다', () => {
    const { container } = renderPanel([
      { id: 1, type: 'style', prompt: 'a noir style' },
      { id: 2, type: 'character', prompt: 'a hero' }
    ])
    const btn = container.querySelector('.btn-generate-all')
    expect(btn).toBeTruthy()
    expect(btn.textContent).toContain('(2)')
  })

  it('gate batch가 pending이면 Clear All과 일괄 생성 진입점을 비활성화한다', () => {
    const { container } = renderPanel([
      { id: 1, type: 'character', prompt: 'a hero' }
    ], { hasPendingBatch: true })

    expect(container.querySelector('.btn-clear-refs').disabled).toBe(true)
    expect(container.querySelector('.btn-generate-all').disabled).toBe(true)
  })

  it('gate batch가 pending이면 Flow 일괄 Sync 진입점도 비활성화한다', () => {
    const { container } = renderPanel([
      {
        id: 1,
        type: 'character',
        name: 'Hero',
        prompt: 'a hero',
        data: 'data:image/png;base64,AAA',
      }
    ], { hasPendingBatch: true, appMode: 'flow' })

    expect(container.querySelector('.btn-sync-all').disabled).toBe(true)
    expect(container.querySelector('.btn-clear-refs').disabled).toBe(true)
  })

  it('ref batch lifecycle 중에는 Flow 일괄 Sync 진입점을 비활성화한다', () => {
    const { container } = renderPanel([
      {
        id: 1,
        type: 'character',
        name: 'Hero',
        prompt: 'a hero',
        data: 'data:image/png;base64,AAA',
      }
    ], { refBatchRunning: true, appMode: 'flow' })

    expect(container.querySelector('.btn-sync-all').disabled).toBe(true)
  })

  it('refBatchRunning을 각 ReferenceCard 직접 업로드 가드에 전달한다', () => {
    const { container } = renderPanel([
      { id: 1, type: 'character', name: 'Hero', data: 'data:image/png;base64,AAA' }
    ], { refBatchRunning: true, appMode: 'flow' })

    expect(container.querySelector('.card-batch-prop').textContent).toBe('true')
  })

  it('아이템 auth 대기 창에도 Stop을 유지하고 Generate All 진입을 막는다', () => {
    const { container } = renderPanel([
      { id: 1, type: 'character', prompt: 'a hero' }
    ], {
      preparingRefs: false,
      generatingRefs: [],
      refBatchActive: true,
    })

    const batchButton = container.querySelector('.btn-generate-all')
    expect(batchButton).toBeTruthy()
    expect(batchButton.className).toContain('btn-stop')
    expect(batchButton.textContent).toContain('reference.stop')
    expect(batchButton.textContent).not.toContain('reference.generateAll')
    expect(container.querySelector('.btn-clear-refs').disabled).toBe(true)
  })
})
