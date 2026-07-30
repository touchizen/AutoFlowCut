import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

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
    open: vi.fn(async () => ({ projectToken: 'token' })),
    submitProduct: vi.fn(async () => ({ ok: true })),
    setFactDecisions: vi.fn(async () => ({ ok: true })),
    draftPlan: vi.fn(async () => ({ ok: true })),
    approvePlan: vi.fn(async () => ({ ok: true, planHash: 'plan-hash-1' })),
    abort: vi.fn(async () => ({ ok: true })),
    pendingAction: null,
    ...overrides,
  }
}

function factReviewState() {
  return {
    state: 'fact_review',
    snapshot: {
      status: 'ok',
      snapshotId: 'snapshot-1',
      product: { name: '테스트 무선 청소기', priceKrw: 29800 },
      images: [{ id: 'image-1', sourceUrl: 'https://image.coupangcdn.com/product.jpg' }],
      selectedImageIds: ['image-1'],
      sourceFacts: [
        {
          id: 'fact-name',
          field: 'name',
          value: '테스트 무선 청소기',
          sourceKind: 'dom',
          verification: 'page-rendered',
        },
        {
          id: 'fact-price',
          field: 'priceKrw',
          value: 29800,
          sourceKind: 'dom',
          verification: 'page-rendered',
        },
      ],
    },
  }
}

function planReviewState({ approved = false } = {}) {
  const currentPlanHash = 'abc123currentplanhash'
  return {
    state: 'plan_review',
    currentPlanHash,
    approvedHash: approved ? currentPlanHash : null,
    pendingMaterialization: approved ? { operationId: 'materialize-1', revision: 2 } : null,
    snapshot: {
      persona: {
        name: '민지',
        role: 'presenter',
        gender: 'female',
        ageBand: '30s',
        ethnicity: 'Korean',
        appearance: '단정한 검은 단발과 베이지 셔츠',
      },
      claims: [
        { id: 'claim-1', text: '테스트 무선 청소기', claimType: 'product_identity', sourceFactIds: ['fact-name'] },
        { id: 'claim-2', text: '29,800원', claimType: 'numeric_fact', sourceFactIds: ['fact-price'] },
      ],
      scenes: [
        {
          sceneKey: 'S01',
          visualType: 'product_still',
          visualDescription: '승인된 실제 제품 정면 이미지',
          productImageId: 'image-1',
          dialogueText: '',
          subtitleText: '테스트 무선 청소기',
          claimIds: ['claim-1'],
          timelineDurationMs: 2000,
          generationDurationSec: 0,
        },
        {
          sceneKey: 'S02',
          visualType: 'persona_i2v',
          visualDescription: '진행자가 제품을 소개한다',
          productImageId: 'image-1',
          dialogueText: '29,800원',
          subtitleText: '29,800원',
          claimIds: ['claim-2'],
          timelineDurationMs: 4000,
          generationDurationSec: 4,
        },
      ],
    },
  }
}

describe('ShoppingPanel', () => {
  afterEach(() => vi.restoreAllMocks())

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

  it('shopping:open 오류 코드를 한국어로 표시하고 재시도 버튼을 제공한다', async () => {
    const pipeline = makePipeline({ openError: 'invalid-project-path' })
    render(<ShoppingPanel pipeline={pipeline} />)

    expect(screen.getByRole('alert')).toHaveTextContent('프로젝트 폴더를 열 수 없습니다')
    expect(screen.getByRole('alert')).not.toHaveTextContent('invalid-project-path')
    fireEvent.click(screen.getByRole('button', { name: '프로젝트 다시 열기' }))

    await act(async () => {})
    expect(pipeline.open).toHaveBeenCalledTimes(1)
  })

  it('프로젝트 다시 열기 중에는 crawl placeholder나 취소 버튼을 표시하지 않는다', async () => {
    const request = deferred()
    const pipeline = makePipeline({
      openError: 'invalid-project-path',
      open: vi.fn(() => request.promise),
    })
    render(<ShoppingPanel pipeline={pipeline} />)

    fireEvent.click(screen.getByRole('button', { name: '프로젝트 다시 열기' }))

    expect(screen.queryByTestId('shopping-crawl-placeholder')).toBeNull()
    expect(screen.queryByRole('button', { name: '크롤 취소' })).toBeNull()
    await act(async () => { request.resolve({ ok: true }); await request.promise })
  })

  it('stale-token 내부 코드를 사용자에게 그대로 노출하지 않는다', () => {
    render(<ShoppingPanel pipeline={makePipeline({ error: 'stale-token' })} />)

    expect(screen.getByRole('alert')).toHaveTextContent('프로젝트가 전환되었습니다')
    expect(screen.getByRole('alert')).not.toHaveTextContent('stale-token')
  })

  it('설치 브라우저가 없으면 설치 또는 수동 입력 안내를 표시한다', () => {
    render(<ShoppingPanel pipeline={makePipeline({ error: 'no-browser-found' })} />)

    expect(screen.getByRole('alert')).toHaveTextContent('Chrome/Brave')
    expect(screen.getByRole('alert')).toHaveTextContent('설치')
    expect(screen.getByRole('alert')).toHaveTextContent('수동 입력')
  })

  it('크롤 중 별도 브라우저 안내와 취소 버튼만 표시하고 bounds를 보내지 않는다', () => {
    const legacyBoundsSender = vi.fn()
    const pipeline = makePipeline({
      submitting: true,
      setCrawlViewBounds: legacyBoundsSender,
    })

    render(<ShoppingPanel pipeline={pipeline} />)

    expect(screen.getByText('별도 브라우저 창에서 상품을 확인하고 있습니다.')).toBeTruthy()
    expect(screen.getByRole('button', { name: '크롤 취소' })).toBeTruthy()
    expect(screen.queryByTestId('shopping-crawl-placeholder')).toBeNull()
    expect(legacyBoundsSender).not.toHaveBeenCalled()
  })

  it('크롤 중 취소 버튼으로 기존 shopping abort를 호출한다', async () => {
    const pipeline = makePipeline({ submitting: true })
    render(<ShoppingPanel pipeline={pipeline} />)

    fireEvent.click(screen.getByRole('button', { name: '크롤 취소' }))

    await act(async () => {})
    expect(pipeline.abort).toHaveBeenCalledOnce()
  })

  it('사용자 취소 결과를 일반 크롤 오류로 표시하지 않는다', async () => {
    const pipeline = makePipeline({ submitProduct: vi.fn(async () => ({ error: 'aborted' })) })
    render(<ShoppingPanel pipeline={pipeline} />)
    fireEvent.change(screen.getByLabelText('상품 URL'), {
      target: { value: 'https://www.coupang.com/vp/products/1' },
    })

    fireEvent.click(screen.getByRole('button', { name: '상품 불러오기' }))
    await act(async () => {})

    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('fact_review에서 모든 사실의 명시적 A/제외 결정과 B 금지 주장을 저장한 뒤 draft 버튼을 연다', async () => {
    const pipeline = makePipeline({ state: factReviewState() })
    render(<ShoppingPanel pipeline={pipeline} />)

    expect(screen.getByRole('heading', { name: 'A/B 사실확인' })).toBeTruthy()
    expect(screen.queryByLabelText('상품 URL')).toBeNull()
    expect(screen.getAllByText('dom · page-rendered')).toHaveLength(2)
    expect(screen.getByText('웹페이지에 표시된 값도 자동 승인되지 않습니다.')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'A/B 사실확인 저장' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '대본·씬표 생성' })).toBeDisabled()

    const allowed = screen.getAllByRole('radio', { name: 'A · 대본에 사용' })
    const excluded = screen.getAllByRole('radio', { name: '사용 안 함' })
    fireEvent.click(allowed[0])
    fireEvent.click(excluded[1])
    fireEvent.change(screen.getByLabelText('금지 주장 1'), {
      target: { value: '흡입력이 업계 최고다' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'A/B 사실확인 저장' }))

    await waitFor(() => expect(pipeline.setFactDecisions).toHaveBeenCalledWith(
      [
        expect.objectContaining({
          sourceFactId: 'fact-name',
          decision: 'allowed',
          confirmedAt: expect.any(String),
        }),
        expect.objectContaining({
          sourceFactId: 'fact-price',
          decision: 'excluded',
          confirmedAt: expect.any(String),
        }),
      ],
      [{ id: 'prohibited-1', text: '흡입력이 업계 최고다', reason: '사용자 B 확정' }],
    ))
    expect(screen.getByRole('button', { name: '대본·씬표 생성' })).toBeEnabled()

    fireEvent.click(screen.getByRole('button', { name: '대본·씬표 생성' }))
    await waitFor(() => expect(pipeline.draftPlan).toHaveBeenCalledWith({}))
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('A/B 저장 실패 뒤 같은 snapshot을 재독해도 미저장 입력을 보존한다', async () => {
    const initialState = factReviewState()
    const pipeline = makePipeline({
      state: initialState,
      setFactDecisions: vi.fn(async () => ({ error: 'fact-decision-failed' })),
    })
    const { rerender } = render(<ShoppingPanel pipeline={pipeline} />)

    const allowed = screen.getAllByRole('radio', { name: 'A · 대본에 사용' })
    const excluded = screen.getAllByRole('radio', { name: '사용 안 함' })
    fireEvent.click(allowed[0])
    fireEvent.click(excluded[1])
    fireEvent.change(screen.getByLabelText('금지 주장 1'), {
      target: { value: '검증되지 않은 최고 표현' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'A/B 사실확인 저장' }))
    await waitFor(() => expect(pipeline.setFactDecisions).toHaveBeenCalledOnce())

    rerender(<ShoppingPanel pipeline={{
      ...pipeline,
      state: structuredClone(initialState),
      error: 'fact-decision-failed',
    }} />)

    expect(screen.getAllByRole('radio', { name: 'A · 대본에 사용' })[0]).toBeChecked()
    expect(screen.getAllByRole('radio', { name: '사용 안 함' })[1]).toBeChecked()
    expect(screen.getByLabelText('금지 주장 1')).toHaveValue('검증되지 않은 최고 표현')
  })

  it('plan_review에서 persona·대본·claim과 스펙의 7개 씬표 컬럼을 표시한다', () => {
    render(<ShoppingPanel pipeline={makePipeline({ state: planReviewState() })} />)

    expect(screen.getByRole('heading', { name: '대본·씬표 검토' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: '민지' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: '대본' })).toBeTruthy()
    for (const column of ['씬', '시간', 'visualType', '실사 asset', '대사·자막', 'claim', '생성 길이']) {
      expect(screen.getByRole('columnheader', { name: column })).toBeTruthy()
    }
    expect(screen.getByText('0.0–2.0초')).toBeTruthy()
    expect(screen.getByText('2.0–6.0초')).toBeTruthy()
    expect(screen.getByText('승인된 실제 제품 정면 이미지')).toBeTruthy()
    expect(screen.getByText('claim-2 · 29,800원')).toBeTruthy()
    expect(screen.getByText('4초')).toBeTruthy()
    expect(screen.queryByLabelText('상품 URL')).toBeNull()
  })

  it('씬표 실사 asset 셀에 productImageId와 빈 값 placeholder를 표시한다', () => {
    const state = planReviewState()
    state.snapshot.scenes[1].productImageId = ''
    render(<ShoppingPanel pipeline={makePipeline({ state })} />)

    const rows = screen.getAllByRole('row')
    expect(within(rows[1]).getByText('image-1')).toBeTruthy()
    expect(within(rows[2]).getByText('미지정')).toBeTruthy()
  })

  it('plan_review 승인 버튼은 hash 인자 없이 pipeline approvePlan을 호출한다', async () => {
    const pipeline = makePipeline({ state: planReviewState() })
    render(<ShoppingPanel pipeline={pipeline} />)

    fireEvent.click(screen.getByRole('button', { name: '이 씬표로 생성 승인' }))

    await waitFor(() => expect(pipeline.approvePlan).toHaveBeenCalledWith())
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('main 승인 hash가 current plan과 같으면 승인·물질화 대기 상태를 인라인 표시한다', () => {
    const state = planReviewState({ approved: true })
    render(<ShoppingPanel pipeline={makePipeline({ state })} />)

    expect(screen.getByText('씬표 승인 완료 · 물질화 대기')).toBeTruthy()
    expect(screen.getByText(state.currentPlanHash)).toBeTruthy()
    expect(screen.getByRole('button', { name: '이 씬표로 생성 승인' })).toBeDisabled()
  })

  it('승인 뒤 물질화 실패면 matching hash여도 approvePlan 재시도를 연다', async () => {
    const pipeline = makePipeline({
      state: planReviewState({ approved: true }),
      error: 'materialization-failed',
    })
    render(<ShoppingPanel pipeline={pipeline} />)

    expect(screen.getByRole('alert')).toHaveTextContent('물질화를 시작하지 못했습니다')
    const retry = screen.getByRole('button', { name: '물질화 다시 시도' })
    expect(retry).toBeEnabled()

    fireEvent.click(retry)

    await waitFor(() => expect(pipeline.approvePlan).toHaveBeenCalledTimes(1))
  })

  it('새 plan 오류 코드를 내부 코드 없이 인라인 메시지로 표시한다', () => {
    render(<ShoppingPanel pipeline={makePipeline({ error: 'plan-draft-invalid' })} />)

    expect(screen.getByRole('alert')).toHaveTextContent('대본·씬표 형식')
    expect(screen.getByRole('alert')).not.toHaveTextContent('plan-draft-invalid')
  })
})
