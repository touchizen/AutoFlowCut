import { useMemo, useState } from 'react'

import './ShoppingPanel.css'

const SHOPPING_ERROR_MESSAGES = Object.freeze({
  'invalid-project-path': '프로젝트 폴더를 열 수 없습니다.',
  'project-context-not-ready': '작업 폴더를 준비하고 있습니다. 잠시 후 다시 시도해 주세요.',
  'project-open-failed': '프로젝트를 여는 중 오류가 발생했습니다(저장 파일 손상 등). 다시 시도해 주세요.',
  'story-workflow-requires-step-machine': '쇼핑 숏츠 프로젝트가 아닙니다.',
  'stale-token': '프로젝트가 전환되었습니다. 다시 시도해 주세요.',
  'product-unsupported': '지원하지 않는 상품 페이지입니다.',
  'product-fetch-failed': '상품 정보를 가져오지 못했습니다.',
  'no-browser-found': '크롤에 Chrome/Brave가 필요합니다. 설치하거나 상품 정보를 수동 입력해 주세요.',
  'shopping-workflow-disabled': '쇼핑 숏츠 프로젝트를 먼저 열어 주세요.',
})

export function shoppingErrorMessage(error) {
  const code = typeof error === 'string' ? error : error?.error
  if (!code) return null
  return SHOPPING_ERROR_MESSAGES[code] || '쇼핑 숏츠 작업을 처리하지 못했습니다. 다시 시도해 주세요.'
}

function formatPrice(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  return `${new Intl.NumberFormat('ko-KR').format(value)}원`
}

function formatFactValue(value) {
  if (value == null) return ''
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return String(value)
  }
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

export default function ShoppingPanel({ pipeline }) {
  const [url, setUrl] = useState('')
  const [pending, setPending] = useState(false)
  const [crawlPending, setCrawlPending] = useState(false)
  const [localError, setLocalError] = useState(null)
  const snapshot = pipeline.state?.snapshot
  const product = snapshot?.status === 'ok' ? snapshot.product : null
  const loading = pending || pipeline.submitting
  const crawlActive = crawlPending || pipeline.submitting

  const selectedImage = useMemo(() => {
    if (!snapshot?.images?.length) return null
    const selectedId = snapshot.selectedImageIds?.[0]
    return snapshot.images.find((image) => image.id === selectedId) || snapshot.images[0]
  }, [snapshot])

  const unsupportedError = snapshot?.status === 'unsupported'
    ? `상품 정보를 가져올 수 없습니다: ${snapshot.reason || '지원하지 않는 상품 페이지입니다.'}`
    : null
  const visibleError = unsupportedError
    || localError
    || shoppingErrorMessage(pipeline.error)
    || shoppingErrorMessage(pipeline.openError)

  const handleSubmit = async (event) => {
    event.preventDefault()
    const value = url.trim()
    if (!value) {
      setLocalError('상품 URL을 입력해 주세요.')
      return
    }
    setLocalError(null)
    setPending(true)
    setCrawlPending(true)
    try {
      const result = await pipeline.submitProduct(value)
      if (result?.error && result.error !== 'aborted') {
        setLocalError(shoppingErrorMessage(result.error))
      }
    } catch (error) {
      setLocalError(shoppingErrorMessage(error?.message || 'product-fetch-failed'))
    } finally {
      setPending(false)
      setCrawlPending(false)
    }
  }

  const handleRetryOpen = async () => {
    setLocalError(null)
    setPending(true)
    try {
      const result = await pipeline.open()
      if (result?.error) setLocalError(shoppingErrorMessage(result.error))
    } catch {
      setLocalError(shoppingErrorMessage('product-fetch-failed'))
    } finally {
      setPending(false)
    }
  }

  const handleAbort = () => {
    pipeline.abort?.()?.catch?.(() => {})
  }

  return (
    <section className="shopping-panel" aria-label="쇼핑 숏츠 상품">
      <header className="shopping-panel__header">
        <p className="shopping-panel__eyebrow">쇼핑 숏츠</p>
        <h1>상품 정보 불러오기</h1>
        <p>쿠팡 상품 URL을 입력하면 상품 정보와 근거 사실을 안전하게 가져옵니다.</p>
      </header>

      <form className="shopping-panel__form" onSubmit={handleSubmit}>
        <label htmlFor="shopping-product-url">상품 URL</label>
        <div className="shopping-panel__url-row">
          <input
            id="shopping-product-url"
            type="url"
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            placeholder="https://www.coupang.com/vp/products/..."
            disabled={loading}
          />
          <button type="submit" disabled={loading}>
            {loading ? '상품 불러오는 중' : '상품 불러오기'}
          </button>
        </div>
      </form>

      {crawlActive && (
        <div className="shopping-panel__crawl-controls" aria-live="polite">
          <span>별도 브라우저 창에서 상품을 확인하고 있습니다.</span>
          <button type="button" onClick={handleAbort}>크롤 취소</button>
        </div>
      )}

      {visibleError && (
        <div className="shopping-panel__error" role="alert">
          <span>{visibleError}</span>
          {pipeline.openError && (
            <button type="button" onClick={handleRetryOpen} disabled={loading}>
              프로젝트 다시 열기
            </button>
          )}
        </div>
      )}

      {product && (
        <article className="shopping-product" aria-busy={loading}>
          <div className="shopping-product__summary">
            {selectedImage?.sourceUrl && (
              <img src={selectedImage.sourceUrl} alt={product.name || '상품 이미지'} />
            )}
            <div>
              <p className="shopping-product__label">불러온 상품</p>
              <h2>{product.name}</h2>
              <dl className="shopping-product__prices">
                {formatPrice(product.priceKrw) && (
                  <div><dt>판매가</dt><dd>{formatPrice(product.priceKrw)}</dd></div>
                )}
                {formatPrice(product.listPriceKrw) && (
                  <div><dt>정가</dt><dd>{formatPrice(product.listPriceKrw)}</dd></div>
                )}
                {typeof product.discountPercent === 'number' && (
                  <div><dt>할인율</dt><dd>{product.discountPercent}%</dd></div>
                )}
              </dl>
            </div>
          </div>

          <section className="shopping-product__facts" aria-labelledby="shopping-facts-title">
            <h3 id="shopping-facts-title">상품 사실 요약</h3>
            <ul>
              {(snapshot.sourceFacts || []).map((fact) => (
                <li key={fact.id || `${fact.field}-${formatFactValue(fact.value)}`}>
                  <strong>{fact.field}</strong>: {formatFactValue(fact.value)}
                </li>
              ))}
            </ul>
          </section>
        </article>
      )}
    </section>
  )
}
