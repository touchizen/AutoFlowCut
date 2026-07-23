import { act, fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import ShoppingPanel from '../../../src/components/shopping/ShoppingPanel.jsx'

function deferred() {
  let resolve
  const promise = new Promise((done) => { resolve = done })
  return { promise, resolve }
}

function makePipeline(overrides = {}) {
  return {
    state: { state: 'empty', snapshot: null },
    submitting: false,
    error: null,
    openError: null,
    submitProduct: vi.fn(async () => ({ ok: true })),
    ...overrides,
  }
}

describe('ShoppingPanel', () => {
  it('URL 제출 중 로딩 후 상품 요약을 표시하며 모달을 만들지 않는다', async () => {
    const request = deferred()
    const pipeline = makePipeline({ submitProduct: vi.fn(() => request.promise) })
    const { container, rerender } = render(<ShoppingPanel pipeline={pipeline} />)

    fireEvent.change(screen.getByLabelText('상품 URL'), {
      target: { value: 'https://www.coupang.com/vp/products/1' },
    })
    fireEvent.click(screen.getByRole('button', { name: '상품 불러오기' }))

    expect(pipeline.submitProduct).toHaveBeenCalledWith('https://www.coupang.com/vp/products/1')
    expect(screen.getByRole('button', { name: '상품 불러오는 중' })).toBeDisabled()

    rerender(<ShoppingPanel pipeline={{
      ...pipeline,
      state: {
        state: 'fact_review',
        snapshot: {
          status: 'ok',
          product: {
            name: '테스트 무선 청소기',
            priceKrw: 29800,
            listPriceKrw: 39900,
            discountPercent: 25,
          },
          images: [{ id: 'image-1', sourceUrl: 'https://image.coupangcdn.com/product.jpg' }],
          selectedImageIds: ['image-1'],
          sourceFacts: [
            { id: 'fact-1', field: 'name', value: '테스트 무선 청소기' },
            { id: 'fact-2', field: 'availability', value: 'InStock' },
          ],
        },
      },
    }} />)
    await act(async () => { request.resolve({ ok: true }); await request.promise })

    expect(screen.getByRole('heading', { name: '테스트 무선 청소기' })).toBeTruthy()
    expect(screen.getByText('29,800원')).toBeTruthy()
    expect(screen.getByText('39,900원')).toBeTruthy()
    expect(screen.getByText('25%')).toBeTruthy()
    expect(screen.getByRole('img', { name: '테스트 무선 청소기' })).toHaveAttribute(
      'src',
      'https://image.coupangcdn.com/product.jpg',
    )
    expect(screen.getByText((_text, node) => (
      node?.tagName === 'LI' && node.textContent === 'availability: InStock'
    ))).toBeTruthy()
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(container.querySelector('.modal')).toBeNull()
  })

  it('unsupported snapshot의 이유를 인라인 오류로 표시한다', () => {
    render(<ShoppingPanel pipeline={makePipeline({
      state: {
        state: 'fact_review',
        snapshot: {
          status: 'unsupported',
          reason: 'Required product image is unavailable',
        },
      },
    })} />)

    expect(screen.getByRole('alert')).toHaveTextContent('상품 정보를 가져올 수 없습니다')
    expect(screen.getByRole('alert')).toHaveTextContent('Required product image is unavailable')
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})
