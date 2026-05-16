/**
 * ResultsTable — 에러 표시 회귀 테스트
 *
 * 변경된 동작 검증:
 *  - error 상태일 때 프롬프트 칸 아래에 .prompt-error 1줄 노출
 *  - error 메시지가 상태 칸의 .error-detail 로 더 이상 표시되지 않음
 *  - non-error 상태에는 .prompt-error 노출 안 됨
 *  - tooltip(title 속성)에 풀 메시지 들어감
 */

import { describe, it, expect, vi } from 'vitest'
import { render } from '@testing-library/react'
import ResultsTable from '../../src/components/ResultsTable'
import { I18nProvider } from '../../src/hooks/useI18n'

const wrap = (ui) => render(<I18nProvider>{ui}</I18nProvider>)

const baseItem = (overrides = {}) => ({
  id: 's1',
  prompt: 'A young scholar reading under an oak tree',
  status: 'done',
  ...overrides,
})

describe('ResultsTable — 에러 표시', () => {
  it('error 상태에서 프롬프트 칸 아래에 .prompt-error 노출', () => {
    const items = [baseItem({ status: 'error', error: 'Generation timed out after 60s' })]
    const { container } = wrap(
      <ResultsTable items={items} mediaType="image" onRetry={vi.fn()} />
    )
    const inline = container.querySelector('.prompt-error')
    expect(inline).toBeInTheDocument()
    expect(inline.textContent).toBe('Generation timed out after 60s')
  })

  it('done 상태에서는 .prompt-error 노출 안 됨', () => {
    const items = [baseItem({ status: 'done' })]
    const { container } = wrap(
      <ResultsTable items={items} mediaType="image" onRetry={vi.fn()} />
    )
    expect(container.querySelector('.prompt-error')).not.toBeInTheDocument()
  })

  it('error 상태이지만 error 메시지가 빈 문자열이면 .prompt-error 노출 안 됨', () => {
    const items = [baseItem({ status: 'error', error: '' })]
    const { container } = wrap(
      <ResultsTable items={items} mediaType="image" onRetry={vi.fn()} />
    )
    expect(container.querySelector('.prompt-error')).not.toBeInTheDocument()
  })

  it('인라인 에러의 title 속성에 풀 메시지 (hover tooltip)', () => {
    const longErr = 'Network error: '.repeat(20).trim()
    const items = [baseItem({ status: 'error', error: longErr })]
    const { container } = wrap(
      <ResultsTable items={items} mediaType="image" onRetry={vi.fn()} />
    )
    const inline = container.querySelector('.prompt-error')
    expect(inline.getAttribute('title')).toBe(longErr)
  })

  it('상태 칸에 .error-detail span이 더 이상 존재하지 않음 (회귀)', () => {
    const items = [baseItem({ status: 'error', error: 'some error' })]
    const { container } = wrap(
      <ResultsTable items={items} mediaType="image" onRetry={vi.fn()} />
    )
    expect(container.querySelector('.error-detail')).not.toBeInTheDocument()
  })

  it('image mediaType의 retry 버튼은 그대로 유지', () => {
    const onRetry = vi.fn()
    const items = [baseItem({ status: 'error', error: 'x' })]
    const { container } = wrap(
      <ResultsTable items={items} mediaType="image" onRetry={onRetry} />
    )
    const retryBtn = container.querySelector('.status.error.retry-btn')
    expect(retryBtn).toBeInTheDocument()
  })

  it('video mediaType: onVideoRetry로 retry 버튼 노출', () => {
    const onVideoRetry = vi.fn()
    const items = [baseItem({ status: 'error', error: 'x' })]
    const { container } = wrap(
      <ResultsTable items={items} mediaType="video" onVideoRetry={onVideoRetry} />
    )
    expect(container.querySelector('.status.error.retry-btn')).toBeInTheDocument()
  })

  it('다중 행: error 행만 .prompt-error 노출', () => {
    const items = [
      baseItem({ id: 's1', status: 'done' }),
      baseItem({ id: 's2', status: 'error', error: 'oops' }),
      baseItem({ id: 's3', status: 'pending' }),
    ]
    const { container } = wrap(
      <ResultsTable items={items} mediaType="image" onRetry={vi.fn()} />
    )
    const errors = container.querySelectorAll('.prompt-error')
    expect(errors.length).toBe(1)
    expect(errors[0].textContent).toBe('oops')
  })

  it('error가 객체로 들어와도 React child 위반 없이 렌더 (방어)', () => {
    // 비정상 케이스 — Error 객체나 plain object가 들어와도 String() 직렬화로 안전해야 함
    const errObj = new Error('boom')
    const items = [baseItem({ status: 'error', error: errObj })]
    expect(() => {
      wrap(<ResultsTable items={items} mediaType="image" onRetry={vi.fn()} />)
    }).not.toThrow()
  })

  describe('errorKind (codified, i18n-translated)', () => {
    // i18n contract: project.json stores only the stable `errorKind` code; the
    // localized message is generated at display time via t(). ResultsTable must
    // honor this — without these tests the prompt-error inline display breaks
    // for missing-image scenes (error: null + errorKind: 'image-missing').

    it('errorKind="image-missing" + error=null 인 경우에도 .prompt-error 노출 (regression)', () => {
      // The exact ep6_babo_yeonggam scene_105 / scene_124 shape after the load
      // healed the data. Pre-fix, this rendered nothing because the inline
      // display only checked item.error (truthy string).
      const items = [baseItem({ status: 'error', error: null, errorKind: 'image-missing' })]
      const { container } = wrap(
        <ResultsTable items={items} mediaType="image" onRetry={vi.fn()} />
      )
      const inline = container.querySelector('.prompt-error')
      expect(inline).toBeInTheDocument()
      // I18nProvider defaults to en (DEFAULT_LANG) — expect the English message
      expect(inline.textContent).toBe('Image file not found — please regenerate')
    })

    it('errorKind 가 free-form error 보다 우선 (translated message wins)', () => {
      // Stale Korean error string left over from a prior load — errorKind
      // takes priority so the user sees a freshly-translated message.
      const items = [baseItem({
        status: 'error',
        error: '이미지 파일을 찾을 수 없습니다 — 재생성이 필요합니다',
        errorKind: 'image-missing',
      })]
      const { container } = wrap(
        <ResultsTable items={items} mediaType="image" onRetry={vi.fn()} />
      )
      const inline = container.querySelector('.prompt-error')
      expect(inline.textContent).toBe('Image file not found — please regenerate')
    })

    it('Retry 버튼 title 속성에도 번역된 errorKind 메시지 노출', () => {
      const items = [baseItem({ status: 'error', error: null, errorKind: 'image-missing' })]
      const { container } = wrap(
        <ResultsTable items={items} mediaType="image" onRetry={vi.fn()} />
      )
      const retryBtn = container.querySelector('.status.error.retry-btn')
      expect(retryBtn.getAttribute('title')).toBe('Image file not found — please regenerate')
    })
  })
})

describe('ResultsTable — 화면비', () => {
  // 썸네일 셀(.image-cell)이 프로젝트 화면비를 따라야 한다 — 9:16 프로젝트인데
  // 16:9 가로 썸네일로 보이던 버그(App 이 aspectRatio prop 을 안 넘김) 회귀 방지.
  it('9:16 프로젝트는 image-cell 에 ratio-portrait 적용', () => {
    const items = [baseItem({ status: 'done' })]
    const { container } = wrap(
      <ResultsTable items={items} mediaType="image" aspectRatio="9:16" onRetry={vi.fn()} />
    )
    expect(container.querySelector('.image-cell.ratio-portrait')).toBeInTheDocument()
    expect(container.querySelector('.image-cell.ratio-landscape')).not.toBeInTheDocument()
  })

  it('16:9 프로젝트는 image-cell 에 ratio-landscape 적용', () => {
    const items = [baseItem({ status: 'done' })]
    const { container } = wrap(
      <ResultsTable items={items} mediaType="image" aspectRatio="16:9" onRetry={vi.fn()} />
    )
    expect(container.querySelector('.image-cell.ratio-landscape')).toBeInTheDocument()
    expect(container.querySelector('.image-cell.ratio-portrait')).not.toBeInTheDocument()
  })

  it('aspectRatio 미지정 시 기본 ratio-landscape', () => {
    const items = [baseItem({ status: 'done' })]
    const { container } = wrap(
      <ResultsTable items={items} mediaType="image" onRetry={vi.fn()} />
    )
    expect(container.querySelector('.image-cell.ratio-landscape')).toBeInTheDocument()
  })
})
