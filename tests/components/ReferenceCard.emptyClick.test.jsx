/**
 * ReferenceCard — 빈 카드 클릭 동작
 *   - 1클릭 = 상세 모달(onShowDetail), 더블클릭 = 업로드(file input click)
 *   - 단/더블 충돌은 ~250ms 타이머로 구분 (더블이면 상세 취소)
 *   - placeholder 문구 = reference.uploadHint ('더블클릭: 업로드')
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, fireEvent, act } from '@testing-library/react'

vi.mock('../../src/hooks/useFileSystem', () => ({
  fileSystemAPI: { checkPermission: vi.fn(), saveReference: vi.fn() },
}))
vi.mock('../../src/hooks/useI18n', () => ({ default: () => ({ t: (k) => k }), useI18n: () => ({ t: (k) => k }) }))
vi.mock('../../src/components/Toast', () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() } }))
vi.mock('../../src/components/HoverImageBalloon', () => ({ default: () => null }))

import ReferenceCard from '../../src/components/ReferenceCard'

const emptyRef = { id: 1, type: 'character', name: 'hero', status: 'pending' }

function renderCard(onShowDetail) {
  return render(
    <ReferenceCard reference={emptyRef} index={2} onUpdate={vi.fn()} onRemove={vi.fn()}
      onUpload={vi.fn()} onShowDetail={onShowDetail} t={(k) => k} projectName="P" />
  )
}

beforeEach(() => vi.useFakeTimers())
afterEach(() => { vi.runOnlyPendingTimers(); vi.useRealTimers(); vi.restoreAllMocks() })

describe('ReferenceCard 빈 카드 클릭', () => {
  it('placeholder 에 더블클릭 업로드 안내(reference.uploadHint) 노출', () => {
    const { container } = renderCard(vi.fn())
    expect(container.querySelector('.ref-placeholder').textContent).toContain('reference.uploadHint')
  })

  it('단일 클릭(250ms 경과) → onShowDetail, 업로드 안 함', () => {
    const onShowDetail = vi.fn()
    const clickSpy = vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(() => {})
    const { container } = renderCard(onShowDetail)
    const area = container.querySelector('.ref-image-area')

    fireEvent.click(area)
    expect(onShowDetail).not.toHaveBeenCalled() // 아직 지연 중
    act(() => { vi.advanceTimersByTime(260) })
    expect(onShowDetail).toHaveBeenCalledWith(2)
    expect(clickSpy).not.toHaveBeenCalled()
  })

  it('더블클릭 → 업로드(file input click), 상세는 취소(onShowDetail 안 함)', () => {
    const onShowDetail = vi.fn()
    const clickSpy = vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(() => {})
    const { container } = renderCard(onShowDetail)
    const area = container.querySelector('.ref-image-area')

    fireEvent.click(area)       // 단일 타이머 set
    fireEvent.doubleClick(area) // 타이머 취소 + 업로드
    act(() => { vi.advanceTimersByTime(300) })

    expect(clickSpy).toHaveBeenCalledTimes(1)
    expect(onShowDetail).not.toHaveBeenCalled()
  })
})
