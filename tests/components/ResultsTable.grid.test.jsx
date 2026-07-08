/**
 * ResultsTable — layout="grid" 렌더 테스트
 *
 * 하단 패널에 타임라인/결과표에 이어 그리드 뷰를 추가한다. 그리드는 기존
 * 결과표(테이블)와 동일한 데이터/핸들러를 받아 카드형으로 렌더한다.
 *  - layout="grid" → .results-grid + item 당 .result-card 1개 (테이블 아님)
 *  - 카드 클릭 → onShowDetail(item)
 *  - error 카드 → 재시도 버튼, 클릭 시 onRetry(id)
 *  - selectable → 카드마다 체크박스, 토글 시 onToggle(id)
 *  - 빈 배열 → .results-empty
 *  - layout 미지정(기본) → 기존 테이블 유지 (회귀)
 */

import { describe, it, expect, vi } from 'vitest'
import { render, fireEvent } from '@testing-library/react'
import ResultsTable from '../../src/components/ResultsTable'
import { I18nProvider } from '../../src/hooks/useI18n'

const wrap = (ui) => render(<I18nProvider>{ui}</I18nProvider>)

const baseItem = (overrides = {}) => ({
  id: 's1',
  prompt: 'A young scholar reading under an oak tree',
  status: 'done',
  image: 'data:image/png;base64,AAAA',
  ...overrides,
})

describe('ResultsTable — layout="grid"', () => {
  it('그리드 레이아웃은 .results-grid 와 item 당 .result-card 를 렌더한다', () => {
    const items = [baseItem({ id: 'a' }), baseItem({ id: 'b' }), baseItem({ id: 'c' })]
    const { container } = wrap(
      <ResultsTable items={items} mediaType="image" layout="grid" onRetry={vi.fn()} />
    )
    expect(container.querySelector('.results-grid')).toBeInTheDocument()
    expect(container.querySelectorAll('.result-card')).toHaveLength(3)
    // 테이블은 렌더하지 않는다
    expect(container.querySelector('.results-table')).not.toBeInTheDocument()
  })

  it('카드의 미디어 클릭 시 onShowDetail(item) 호출', () => {
    const onShowDetail = vi.fn()
    const item = baseItem({ id: 'a' })
    const { container } = wrap(
      <ResultsTable items={[item]} mediaType="image" layout="grid" onShowDetail={onShowDetail} onRetry={vi.fn()} />
    )
    fireEvent.click(container.querySelector('.result-card .image-cell'))
    expect(onShowDetail).toHaveBeenCalledWith(expect.objectContaining({ id: 'a' }))
  })

  it('error 카드는 재시도 버튼을 노출하고 클릭 시 onRetry(id) 호출', () => {
    const onRetry = vi.fn()
    const items = [baseItem({ id: 'a', status: 'error', error: 'boom', image: null })]
    const { container } = wrap(
      <ResultsTable items={items} mediaType="image" layout="grid" onRetry={onRetry} />
    )
    const btn = container.querySelector('.result-card .retry-btn')
    expect(btn).toBeInTheDocument()
    fireEvent.click(btn)
    expect(onRetry).toHaveBeenCalledWith('a')
  })

  it('selectable 그리드는 카드마다 체크박스, 토글 시 onToggle(id) 호출', () => {
    const onToggle = vi.fn()
    const items = [baseItem({ id: 'a', selected: true }), baseItem({ id: 'b', selected: false })]
    const { container } = wrap(
      <ResultsTable
        items={items}
        mediaType="video"
        layout="grid"
        selectable
        onToggle={onToggle}
        onToggleAll={vi.fn()}
      />
    )
    const boxes = container.querySelectorAll('.result-card input[type="checkbox"]')
    expect(boxes).toHaveLength(2)
    fireEvent.click(boxes[0])
    expect(onToggle).toHaveBeenCalledWith('a')
  })

  it('selectable 그리드는 전체선택 체크박스를 노출하고 onToggleAll 호출', () => {
    const onToggleAll = vi.fn()
    const items = [baseItem({ id: 'a', selected: true }), baseItem({ id: 'b', selected: false })]
    const { container } = wrap(
      <ResultsTable
        items={items}
        mediaType="video"
        layout="grid"
        selectable
        onToggle={vi.fn()}
        onToggleAll={onToggleAll}
      />
    )
    const selectAll = container.querySelector('.grid-select-all input[type="checkbox"]')
    expect(selectAll).toBeInTheDocument()
    fireEvent.click(selectAll)
    expect(onToggleAll).toHaveBeenCalled()
  })

  it('빈 배열이면 .results-empty', () => {
    const { container } = wrap(
      <ResultsTable items={[]} mediaType="image" layout="grid" onRetry={vi.fn()} />
    )
    expect(container.querySelector('.results-empty')).toBeInTheDocument()
    expect(container.querySelector('.results-grid')).not.toBeInTheDocument()
  })

  it('layout 미지정(기본)이면 기존 테이블을 렌더한다 (회귀)', () => {
    const items = [baseItem()]
    const { container } = wrap(
      <ResultsTable items={items} mediaType="image" onRetry={vi.fn()} />
    )
    expect(container.querySelector('.results-table')).toBeInTheDocument()
    expect(container.querySelector('.results-grid')).not.toBeInTheDocument()
  })
})
