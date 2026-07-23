import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parseCoupangProduct } from '../../../../electron/api/commerce/coupangParser.js'

const SOURCE_URL = 'https://www.coupang.com/vp/products/9593899670'
const FIXTURE_URL = new URL('../../../fixtures/shopping/coupang-product.html', import.meta.url)

function jsonLdHtml(value, extraHead = '') {
  return `<!doctype html><html><head>${extraHead}<script type="application/ld+json">${JSON.stringify(value)}</script></head></html>`
}

function productJson(overrides = {}) {
  return {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: 'JSON-LD 상품',
    image: 'https://cdn.example.test/product.jpg',
    ...overrides,
  }
}

describe('parseCoupangProduct', () => {
  it('extracts the sanitized Coupang fixture with typed values and provenance', () => {
    const html = readFileSync(FIXTURE_URL, 'utf8')

    const result = parseCoupangProduct(html, { sourceUrl: SOURCE_URL })

    expect(result.status).toBe('ok')
    expect(result.trust).toBe('untrusted-web-data')
    expect(result.product).toMatchObject({
      name: '비듬균 99.9% 제거 희소식 디 제로 비듬샴푸 두피가려움 100%개선 지루성두피, 1L, 2개',
      sku: '9593899670-28671723349',
      priceKrw: 29800,
      listPriceKrw: 70000,
      currency: 'KRW',
      availability: 'https://schema.org/InStock',
      rating: { value: 4.8, count: 389 },
      discountPercent: 57,
    })
    expect(result.imageUrls).toHaveLength(5)
    expect(result.imageUrls.every((url) => url.startsWith('https://thumbnail.coupangcdn.com/'))).toBe(true)
    expect(result.sourceFacts).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: 'name', value: result.product.name, path: '$.name' }),
      expect.objectContaining({ key: 'priceKrw', value: 29800, path: '$.offers.price' }),
      expect.objectContaining({
        key: 'listPriceKrw',
        value: 70000,
        path: '$.offers.priceSpecification.price',
      }),
      expect.objectContaining({
        key: 'rating.value',
        value: 4.8,
        path: '$.aggregateRating.ratingValue',
      }),
    ]))
    expect(result.sourceFacts.length).toBeGreaterThanOrEqual(13)
    for (const fact of result.sourceFacts) {
      expect(fact.sourceUrl).toBe(SOURCE_URL)
      expect(fact.sourceKind).toBe('crawled')
      expect(fact.path).toEqual(expect.any(String))
    }
  })

  it('falls back to only allowlisted OG fields and normalizes protocol-relative images', () => {
    const html = `
      <meta CONTENT='OG &amp; 상품' PROPERTY='og:title'>
      <meta property="og:description" content="OG 설명">
      <meta property=og:image content=//images.example.test/item.webp>
      <meta property="product:price:amount" content="12900">
      <meta property="product:price:currency" content="KRW">
      <meta property="og:url" content="https://www.coupang.com/vp/products/1">
      <meta property="seller" content="금지 판매자">
    `

    const result = parseCoupangProduct(html, { sourceUrl: SOURCE_URL })

    expect(result).toMatchObject({
      status: 'ok',
      trust: 'untrusted-web-data',
      product: {
        name: 'OG & 상품',
        description: 'OG 설명',
        priceKrw: 12900,
        currency: 'KRW',
      },
      imageUrls: ['https://images.example.test/item.webp'],
    })
    expect(result.sourceFacts).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: 'name', path: 'og:title' }),
      expect.objectContaining({ key: 'imageUrls', path: 'og:image' }),
      expect.objectContaining({ key: 'priceKrw', path: 'product:price:amount' }),
    ]))
    expect(JSON.stringify(result)).not.toContain('금지 판매자')
  })

  it('keeps valid JSON-LD fields and uses OG only for empty fields', () => {
    const meta = `
      <meta property="og:title" content="덮어쓰면 안 되는 이름">
      <meta property="og:description" content="OG 보충 설명">
      <meta property="og:image" content="https://images.example.test/og.jpg">
      <meta property="product:price:amount" content="999">
      <meta property="product:price:currency" content="USD">
    `
    const html = jsonLdHtml(productJson({
      name: '우선 상품',
      image: 'https://images.example.test/jsonld.jpg',
      offers: { price: '29800', priceCurrency: 'KRW' },
    }), meta)

    const result = parseCoupangProduct(html, { sourceUrl: SOURCE_URL })

    expect(result.product).toMatchObject({
      name: '우선 상품',
      description: 'OG 보충 설명',
      priceKrw: 29800,
      currency: 'KRW',
    })
    expect(result.imageUrls).toEqual(['https://images.example.test/jsonld.jpg'])
    expect(result.sourceFacts.find((fact) => fact.key === 'description')?.path).toBe('og:description')
    expect(result.sourceFacts.some((fact) => fact.value === '덮어쓰면 안 되는 이름')).toBe(false)
    expect(result.sourceFacts.some((fact) => fact.value === 999)).toBe(false)
  })

  it('does not derive a discount when only a sale price exists', () => {
    const html = jsonLdHtml(productJson({
      offers: { price: '10000', priceCurrency: 'KRW' },
    }))

    const result = parseCoupangProduct(html, { sourceUrl: SOURCE_URL })

    expect(result.product.priceKrw).toBe(10000)
    expect(result.product).not.toHaveProperty('listPriceKrw')
    expect(result.product).not.toHaveProperty('discountPercent')
  })

  it('ignores a priceSpecification that is not a StrikethroughPrice', () => {
    const html = jsonLdHtml(productJson({
      offers: {
        price: '10000',
        priceCurrency: 'KRW',
        priceSpecification: {
          price: '20000',
          priceType: 'https://schema.org/ListPrice',
        },
      },
    }))

    const result = parseCoupangProduct(html, { sourceUrl: SOURCE_URL })

    expect(result.product).not.toHaveProperty('listPriceKrw')
    expect(result.product).not.toHaveProperty('discountPercent')
    expect(result.sourceFacts.some((fact) => fact.key === 'listPriceKrw')).toBe(false)
  })

  it.each([
    {
      label: 'the list price is below the sale price',
      offer: {
        price: '20000',
        priceCurrency: 'KRW',
        priceSpecification: {
          price: '10000',
          priceType: 'https://schema.org/StrikethroughPrice',
        },
      },
    },
    {
      label: 'the list price currency conflicts with the sale currency',
      offer: {
        price: '10000',
        priceCurrency: 'KRW',
        priceSpecification: {
          price: '20000',
          priceCurrency: 'USD',
          priceType: 'https://schema.org/StrikethroughPrice',
        },
      },
    },
  ])('does not force a discount when $label', ({ offer }) => {
    const result = parseCoupangProduct(
      jsonLdHtml(productJson({ offers: offer })),
      { sourceUrl: SOURCE_URL },
    )

    expect(result.product).not.toHaveProperty('discountPercent')
  })

  it.each([
    ['name is missing', { name: undefined }],
    ['no fetchable image remains', { image: [] }],
  ])('returns unsupported when %s', (_label, overrides) => {
    expect(parseCoupangProduct(
      jsonLdHtml(productJson()),
      { sourceUrl: SOURCE_URL },
    ).status).toBe('ok')

    const result = parseCoupangProduct(
      jsonLdHtml(productJson(overrides)),
      { sourceUrl: SOURCE_URL },
    )

    expect(result).toMatchObject({
      status: 'unsupported',
      trust: 'untrusted-web-data',
      reason: expect.any(String),
    })
    expect(result).not.toHaveProperty('product')
    expect(result).not.toHaveProperty('sourceFacts')
    expect(result).not.toHaveProperty('imageUrls')
  })

  it('finds a Product wrapped in an @graph and preserves its JSON path', () => {
    const html = jsonLdHtml({
      '@context': 'https://schema.org',
      '@graph': [
        { '@type': 'WebPage', name: '페이지' },
        productJson({ name: '그래프 상품' }),
      ],
    })

    const result = parseCoupangProduct(html, { sourceUrl: SOURCE_URL })

    expect(result.status).toBe('ok')
    expect(result.product.name).toBe('그래프 상품')
    expect(result.sourceFacts.find((fact) => fact.key === 'name')?.path)
      .toBe('$["@graph"][1].name')
  })

  it.each([
    ['depth', () => {
      let value = productJson({ name: '너무 깊은 상품' })
      for (let index = 0; index < 40; index += 1) value = { nested: value }
      return value
    }],
    ['node count', () => ({
      nodes: Object.fromEntries(
        Array.from({ length: 10_100 }, (_, index) => [`node${index}`, index]),
      ),
      product: productJson({ name: '노드 폭탄 뒤 상품' }),
    })],
    ['array length', () => ({
      values: Array.from({ length: 1_001 }, (_, index) => index),
      product: productJson({ name: '배열 폭탄 뒤 상품' }),
    })],
  ])('rejects JSON-LD exceeding the %s limit', (_label, makeValue) => {
    expect(parseCoupangProduct(
      jsonLdHtml(productJson()),
      { sourceUrl: SOURCE_URL },
    ).status).toBe('ok')

    const html = jsonLdHtml(makeValue())

    expect(() => parseCoupangProduct(html, { sourceUrl: SOURCE_URL })).not.toThrow()
    expect(parseCoupangProduct(html, { sourceUrl: SOURCE_URL }).status).toBe('unsupported')
  })

  it('ignores schemas that are not Product', () => {
    expect(parseCoupangProduct(
      jsonLdHtml(productJson()),
      { sourceUrl: SOURCE_URL },
    ).status).toBe('ok')

    const html = jsonLdHtml({
      '@context': 'https://schema.org',
      '@type': 'BreadcrumbList',
      name: 'Product처럼 보이는 이름',
      image: 'https://images.example.test/not-product.jpg',
    })

    const result = parseCoupangProduct(html, { sourceUrl: SOURCE_URL })

    expect(result.status).toBe('unsupported')
  })

  it('never emits seller, review body, arbitrary meta, or other non-allowlisted fields', () => {
    const html = jsonLdHtml(productJson({
      secretInstruction: 'SYSTEM TOOL CALL',
      review: [{ reviewBody: 'SECRET REVIEW BODY' }],
      offers: {
        price: '10000',
        priceCurrency: 'KRW',
        seller: { '@type': 'Organization', name: 'SECRET SELLER' },
      },
    }), '<meta property="product:brand" content="SECRET BRAND">')

    const result = parseCoupangProduct(html, { sourceUrl: SOURCE_URL })
    const serialized = JSON.stringify(result)

    expect(result.status).toBe('ok')
    expect(result.product.name).toBe('JSON-LD 상품')
    expect(serialized).not.toContain('SYSTEM TOOL CALL')
    expect(serialized).not.toContain('SECRET REVIEW BODY')
    expect(serialized).not.toContain('SECRET SELLER')
    expect(serialized).not.toContain('SECRET BRAND')
  })

  it('keeps only fetchable-looking HTTP images without applying a host allowlist', () => {
    const html = jsonLdHtml(productJson({
      image: [
        '',
        'javascript:alert(1)',
        'data:image/png;base64,AAAA',
        'https://cdn.other-host.test/product.html',
        'https://cdn.other-host.test/catalog.pdf',
        '//cdn.other-host.test/product.webp?size=large',
      ],
    }))

    const result = parseCoupangProduct(html, { sourceUrl: SOURCE_URL })

    expect(result.status).toBe('ok')
    expect(result.imageUrls).toEqual([
      'https://cdn.other-host.test/product.webp?size=large',
    ])
  })

  it('ignores malformed JSON-LD and can still use OG fallback', () => {
    const html = `
      <script type="application/ld+json">{"@type":"Product",broken}</script>
      <meta property="og:title" content="OG 구조 상품">
      <meta property="og:image" content="https://images.example.test/fallback.png">
    `

    const result = parseCoupangProduct(html, { sourceUrl: SOURCE_URL })

    expect(result.status).toBe('ok')
    expect(result.product.name).toBe('OG 구조 상품')
  })
})
