import { useMemo, useState } from 'react'

import './ShoppingPanel.css'

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
  const [localError, setLocalError] = useState(null)
  const snapshot = pipeline.state?.snapshot
  const product = snapshot?.status === 'ok' ? snapshot.product : null
  const loading = pending || pipeline.submitting
  const selectedImage = useMemo(() => {
    if (!snapshot?.images?.length) return null
    const selectedId = snapshot.selectedImageIds?.[0]
    return snapshot.images.find((image) => image.id === selectedId) || snapshot.images[0]
  }, [snapshot])

  const unsupportedError = snapshot?.status === 'unsupported'
    ? `상품 정보를 가져올 수 없습니다: ${snapshot.reason || '지원하지 않는 상품 페이지입니다.'}`
    : null
  const visibleError = unsupportedError || localError || pipeline.error || pipeline.openError

  const handleSubmit = async (event) => {
    event.preventDefault()
    const value = url.trim()
    if (!value) {
      setLocalError('상품 URL을 입력해 주세요.')
      return
    }
    setLocalError(null)
    setPending(true)
    try {
      const result = await pipeline.submitProduct(value)
      if (result?.error) setLocalError(`상품 정보를 가져올 수 없습니다: ${result.error}`)
    } catch (error) {
      setLocalError(`상품 정보를 가져올 수 없습니다: ${error?.message || 'product-fetch-failed'}`)
    } finally {
      setPending(false)
    }
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

      {visibleError && <div className="shopping-panel__error" role="alert">{visibleError}</div>}

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
