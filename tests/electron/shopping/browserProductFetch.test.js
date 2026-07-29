// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { runInNewContext } from 'node:vm'

import { parseCoupangProduct } from '../../../electron/api/commerce/coupangParser.js'
import { HTML_FETCH_POLICY } from '../../../electron/api/net/safeHttpFetch.js'
import {
  buildMinimalProductHtml,
  createBrowserProductFetch,
  validateInitialProductUrl,
} from '../../../electron/shopping/browserProductFetch.js'

const PRODUCT_URL = 'https://www.coupang.com/vp/products/123?itemId=456'

function productExtraction(overrides = {}) {
  return {
    jsonLd: [JSON.stringify({
      '@context': 'https://schema.org',
      '@type': 'Product',
      name: '안전한 <상품>',
      image: ['https://image.coupangcdn.com/product.jpg'],
      offers: { '@type': 'Offer', price: '12900', priceCurrency: 'KRW' },
    })],
    meta: [
      { property: 'og:title', content: '메타 & < > " \' 제목' },
      { property: 'og:image', content: 'https://image.coupangcdn.com/meta.jpg' },
    ],
    url: PRODUCT_URL,
    readyState: 'complete',
    ...overrides,
  }
}

function makeView({ readiness = [true], extraction = productExtraction(), loadURL } = {}) {
  const webContentsHandlers = new Map()
  const sessionHandlers = new Map()
  const readinessQueue = [...readiness]
  const session = {
    setPermissionRequestHandler: vi.fn(),
    on: vi.fn((event, handler) => sessionHandlers.set(event, handler)),
    removeListener: vi.fn((event, handler) => {
      if (sessionHandlers.get(event) === handler) sessionHandlers.delete(event)
    }),
  }
  const webContents = {
    session,
    setUserAgent: vi.fn(),
    setWindowOpenHandler: vi.fn(),
    on: vi.fn((event, handler) => webContentsHandlers.set(event, handler)),
    loadURL: vi.fn(loadURL || (async () => {})),
    executeJavaScript: vi.fn(async (source) => {
      if (source.includes('const properties = new Set')) {
        return typeof extraction === 'function' ? extraction(source) : extraction
      }
      if (source.includes('document.querySelector')) {
        const value = readinessQueue.shift()
        return typeof value === 'function' ? value(source) : value
      }
      throw new Error('unknown browser product probe')
    }),
    close: vi.fn(),
  }
  return {
    view: { webContents, setBounds: vi.fn() },
    webContents,
    webContentsHandlers,
    session,
    sessionHandlers,
    readinessQueue,
  }
}

function makeHarness({
  views = [makeView()],
  now,
  pollIntervalMs = 1,
  challengeAfterMs = 15_000,
  hardTimeoutMs,
  onViewClosed = vi.fn(),
  getBounds = () => ({ x: 10, y: 20, width: 640, height: 480 }),
} = {}) {
  const pendingViews = [...views]
  const contentView = {
    addChildView: vi.fn(),
    removeChildView: vi.fn(),
  }
  const win = { isDestroyed: vi.fn(() => false), contentView }
  const statuses = []
  const createView = vi.fn(() => pendingViews.shift().view)
  const fetch = createBrowserProductFetch({
    getWindow: () => win,
    createView,
    getBounds,
    emitStatus: (status) => statuses.push(status),
    onViewClosed,
    ...(now ? { now } : {}),
    pollIntervalMs,
    challengeAfterMs,
    ...(hardTimeoutMs === undefined ? {} : { hardTimeoutMs }),
  })
  return { fetch, createView, contentView, statuses, win, onViewClosed }
}

beforeEach(() => {
  Object.defineProperty(process.versions, 'chrome', {
    value: '136.0.7103.113',
    configurable: true,
  })
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  delete process.versions.chrome
})

describe('buildMinimalProductHtml', () => {
  it('허용된 JSON-LD/meta만 이스케이프해 기존 파서가 왕복 해석한다', () => {
    const productBlock = JSON.parse(productExtraction().jsonLd[0])
    productBlock.description = '설명 안의 </script> 문자열도 보존'
    const extraction = productExtraction({
      jsonLd: [JSON.stringify(productBlock)],
      meta: [
        ...productExtraction().meta,
        { property: 'twitter:title', content: '허용되지 않음' },
      ],
    })

    const html = buildMinimalProductHtml(extraction, HTML_FETCH_POLICY.maxBytes)
    const parsed = parseCoupangProduct(html, { sourceUrl: extraction.url })

    expect(Buffer.byteLength(html)).toBeLessThanOrEqual(HTML_FETCH_POLICY.maxBytes)
    expect(html).toContain('\\u003c상품>')
    expect(html).toContain('설명 안의 \\u003c/script> 문자열도 보존')
    expect(html).not.toContain('</script> 문자열도 보존')
    expect(html).toContain('메타 &amp; &lt; &gt; &quot; &#39; 제목')
    expect(html).not.toContain('twitter:title')
    expect(parsed).toMatchObject({
      status: 'ok',
      product: {
        name: '안전한 <상품>',
        description: '설명 안의 </script> 문자열도 보존',
        priceKrw: 12900,
        currency: 'KRW',
      },
      imageUrls: ['https://image.coupangcdn.com/product.jpg'],
    })
  })

  it('여러 대형 블록이 있어도 조립 결과를 parser의 2MB 아래로 제한한다', () => {
    const block = JSON.stringify({ '@type': 'Thing', value: 'x'.repeat(510 * 1024) })
    const html = buildMinimalProductHtml(
      productExtraction({ jsonLd: Array.from({ length: 10 }, () => block), meta: [] }),
      HTML_FETCH_POLICY.maxBytes,
    )

    expect(Buffer.byteLength(html)).toBeLessThanOrEqual(HTML_FETCH_POLICY.maxBytes)
  })

  it('view 계약보다 긴 meta 배열의 뒤쪽 항목을 main 재검증에서 버린다', () => {
    const html = buildMinimalProductHtml(productExtraction({
      jsonLd: [],
      meta: [
        ...Array.from({ length: 120 }, (_, index) => ({
          property: 'og:title',
          content: `title-${index}`,
        })),
        { property: 'og:image', content: 'https://image.coupangcdn.com/too-late.jpg' },
      ],
    }), HTML_FETCH_POLICY.maxBytes)

    expect(html).not.toContain('too-late.jpg')
  })

  it('상품 상세 path가 아닌 Coupang extraction URL을 거부한다', () => {
    expect(() => buildMinimalProductHtml(
      productExtraction({ url: 'https://www.coupang.com/' }),
      HTML_FETCH_POLICY.maxBytes,
    )).toThrow('invalid browser extraction')
  })
})

describe('validateInitialProductUrl', () => {
  it('정확한 Coupang HTTPS 상품 상세 URL만 허용한다', () => {
    expect(validateInitialProductUrl(PRODUCT_URL, HTML_FETCH_POLICY).toString()).toBe(PRODUCT_URL)

    for (const value of [
      'http://www.coupang.com/vp/products/123',
      'https://m.coupang.com/vp/products/123',
      'https://www.coupang.com:444/vp/products/123',
      'https://user@www.coupang.com/vp/products/123',
      'https://www.coupang.com/vp/products/not-a-number',
      'https://www.coupang.com/vp/products/123/other',
      'https://www.coupang.com/vp/products/123#facts',
      'https://www.coupang.com\\@attacker.test/vp/products/123',
    ]) {
      expect(() => validateInitialProductUrl(value, HTML_FETCH_POLICY), value).toThrow('URL not allowed')
    }
  })
})

describe('createBrowserProductFetch', () => {
  it('보이는 격리 뷰를 붙이고 readiness 뒤 추출한 뒤 같은 finally에서 닫는다', async () => {
    const fake = makeView()
    const harness = makeHarness({ views: [fake] })

    const response = await harness.fetch(PRODUCT_URL, HTML_FETCH_POLICY, {})

    expect(harness.statuses).toEqual(['loading', 'extracting'])
    expect(fake.view.setBounds).toHaveBeenCalledWith({ x: 10, y: 20, width: 640, height: 480 })
    expect(harness.contentView.addChildView).toHaveBeenCalledWith(fake.view)
    expect(fake.webContents.loadURL).toHaveBeenCalledWith(PRODUCT_URL)
    expect(fake.webContents.executeJavaScript.mock.calls[0][0]).toContain('\\s*')
    expect(fake.webContents.setUserAgent).toHaveBeenCalledWith(expect.stringMatching(
      /^Mozilla\/5\.0 .* Chrome\/136\.0\.7103\.113 Safari\/537\.36$/,
    ))
    expect(fake.webContents.setUserAgent.mock.calls[0][0]).not.toMatch(/Electron|AutoFlowCut/)
    expect(response.url).toBe(PRODUCT_URL)
    expect(Buffer.isBuffer(response.body)).toBe(true)
    expect(parseCoupangProduct(response.body.toString('utf8'), { sourceUrl: response.url }).status).toBe('ok')
    expect(harness.contentView.removeChildView).toHaveBeenCalledWith(fake.view)
    expect(fake.webContents.close).toHaveBeenCalledOnce()
    expect(harness.onViewClosed).toHaveBeenCalledOnce()
    expect(harness.onViewClosed).toHaveBeenCalledWith(fake.view)
  })

  it('loadURL 전에 navigation/window/permission/download 가드를 설치한다', async () => {
    const fake = makeView()
    const harness = makeHarness({ views: [fake] })
    await harness.fetch(PRODUCT_URL, HTML_FETCH_POLICY, {})

    expect(fake.webContents.on.mock.invocationCallOrder[0]).toBeLessThan(
      fake.webContents.loadURL.mock.invocationCallOrder[0],
    )
    for (const eventName of ['will-navigate', 'will-redirect', 'will-frame-navigate']) {
      expect(fake.webContentsHandlers.has(eventName)).toBe(true)
    }
    expect(fake.webContents.setWindowOpenHandler).toHaveBeenCalled()
    expect(fake.webContents.setWindowOpenHandler.mock.calls[0][0]({ url: 'https://example.com' })).toEqual({ action: 'deny' })

    const deniedNavigation = {
      preventDefault: vi.fn(),
      url: 'https://example.com/vp/products/123',
      isMainFrame: true,
    }
    fake.webContentsHandlers.get('will-navigate')(deniedNavigation)
    expect(deniedNavigation.preventDefault).toHaveBeenCalled()

    const allowedNavigation = {
      preventDefault: vi.fn(),
      url: 'https://challenge.coupang.com/check',
      isMainFrame: true,
    }
    fake.webContentsHandlers.get('will-redirect')(allowedNavigation)
    expect(allowedNavigation.preventDefault).not.toHaveBeenCalled()

    const subframeNavigation = {
      preventDefault: vi.fn(),
      url: 'https://example.com/frame',
      isMainFrame: false,
    }
    fake.webContentsHandlers.get('will-frame-navigate')(subframeNavigation)
    expect(subframeNavigation.preventDefault).not.toHaveBeenCalled()

    const permissionCallback = vi.fn()
    fake.session.setPermissionRequestHandler.mock.calls[0][0](null, null, permissionCallback)
    expect(permissionCallback).toHaveBeenCalledWith(false)
    const downloadEvent = { preventDefault: vi.fn() }
    const downloadHandler = fake.session.on.mock.calls.find(([event]) => event === 'will-download')[1]
    downloadHandler(downloadEvent)
    expect(downloadEvent.preventDefault).toHaveBeenCalled()
    expect(fake.session.removeListener).toHaveBeenCalledWith('will-download', downloadHandler)
  })

  it('15초 readiness 실패 뒤 challenge를 알리고 1초 간격으로 전환해 계속 폴링한다', async () => {
    vi.useFakeTimers()
    let elapsed = 0
    const fake = makeView({ readiness: [false, false, false, true] })
    const harness = makeHarness({
      views: [fake],
      now: () => elapsed,
      pollIntervalMs: 500,
      challengeAfterMs: 15_000,
    })
    const promise = harness.fetch(PRODUCT_URL, HTML_FETCH_POLICY, {})

    await vi.advanceTimersByTimeAsync(500)
    expect(harness.statuses).toEqual(['loading'])
    elapsed = 14_999
    await vi.advanceTimersByTimeAsync(500)
    expect(harness.statuses).toEqual(['loading'])
    elapsed = 15_000
    await vi.advanceTimersByTimeAsync(500)
    expect(harness.statuses).toEqual(['loading', 'challenge'])
    expect(fake.webContents.close).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(999)
    expect(fake.webContents.close).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    await expect(promise).resolves.toMatchObject({ url: PRODUCT_URL })
    expect(harness.statuses).toEqual(['loading', 'challenge', 'extracting'])
  })

  it('loadURL ERR_ABORTED를 완료 신호로 취급하지 않고 readiness 성공까지 폴링한다', async () => {
    vi.useFakeTimers()
    const debug = vi.spyOn(console, 'debug').mockImplementation(() => {})
    const navigationError = Object.assign(new Error('ERR_ABORTED'), { code: 'ERR_ABORTED' })
    const fake = makeView({
      readiness: [true],
      loadURL: async () => { throw navigationError },
    })
    const harness = makeHarness({ views: [fake] })
    const promise = harness.fetch(PRODUCT_URL, HTML_FETCH_POLICY, {})

    await vi.advanceTimersByTimeAsync(1)

    await expect(promise).resolves.toMatchObject({ url: PRODUCT_URL })
    expect(harness.statuses).toEqual(['loading', 'extracting'])
    expect(debug).toHaveBeenCalledWith(
      '[Shopping crawl] loadURL rejected; readiness polling continues:',
      'ERR_ABORTED',
    )
  })

  it('loadURL 4xx response-code failure는 렌더된 challenge를 readiness로 판정한다', async () => {
    vi.useFakeTimers()
    const debug = vi.spyOn(console, 'debug').mockImplementation(() => {})
    const challengeResponse = Object.assign(new Error('ERR_HTTP_RESPONSE_CODE_FAILURE'), {
      code: 'ERR_HTTP_RESPONSE_CODE_FAILURE',
    })
    const fake = makeView({
      readiness: [true],
      loadURL: async () => { throw challengeResponse },
    })
    const harness = makeHarness({ views: [fake] })
    const promise = harness.fetch(PRODUCT_URL, HTML_FETCH_POLICY, {})
    let response
    let rejection
    promise.then((value) => { response = value }, (error) => { rejection = error })

    await vi.advanceTimersByTimeAsync(1)
    expect(rejection).toBeUndefined()
    expect(response).toMatchObject({ url: PRODUCT_URL })

    expect(harness.statuses).toEqual(['loading', 'extracting'])
    expect(debug).toHaveBeenCalledWith(
      '[Shopping crawl] loadURL rejected; readiness polling continues:',
      'ERR_HTTP_RESPONSE_CODE_FAILURE',
    )
  })

  it('code 없는 loadURL reject도 페이지 readiness가 성공하면 추출한다', async () => {
    vi.useFakeTimers()
    const debug = vi.spyOn(console, 'debug').mockImplementation(() => {})
    const fake = makeView({
      readiness: [true],
      loadURL: async () => { throw new Error('navigation rejected without code') },
    })
    const harness = makeHarness({ views: [fake] })
    const promise = harness.fetch(PRODUCT_URL, HTML_FETCH_POLICY, {})
    let response
    let rejection
    promise.then((value) => { response = value }, (error) => { rejection = error })

    await vi.advanceTimersByTimeAsync(1)
    expect(rejection).toBeUndefined()
    expect(response).toMatchObject({ url: PRODUCT_URL })

    expect(harness.statuses).toEqual(['loading', 'extracting'])
    expect(debug).toHaveBeenCalledWith(
      '[Shopping crawl] loadURL rejected; readiness polling continues:',
      'navigation rejected without code',
    )
  })

  it.each([
    'ERR_NAME_NOT_RESOLVED',
    'ERR_INTERNET_DISCONNECTED',
    'ERR_CONNECTION_REFUSED',
    'ERR_CONNECTION_RESET',
    'ERR_CONNECTION_CLOSED',
    'ERR_CONNECTION_TIMED_OUT',
    'ERR_TIMED_OUT',
    'ERR_ADDRESS_UNREACHABLE',
    'ERR_NETWORK_CHANGED',
    'ERR_CONNECTION_ABORTED',
    'ERR_CONNECTION_FAILED',
    'ERR_PROXY_CONNECTION_FAILED',
    'ERR_TUNNEL_CONNECTION_FAILED',
    'ERR_NAME_RESOLUTION_FAILED',
  ])('loadURL의 실제 네트워크 오류 %s는 첫 poll 전에 즉시 실패한다', async (code) => {
    vi.useFakeTimers()
    const debug = vi.spyOn(console, 'debug').mockImplementation(() => {})
    const networkError = Object.assign(new Error(code), { code })
    const fake = makeView({
      readiness: [true],
      loadURL: async () => { throw networkError },
    })
    const harness = makeHarness({ views: [fake] })
    const controller = new AbortController()
    const promise = harness.fetch(PRODUCT_URL, HTML_FETCH_POLICY, {
      signal: controller.signal,
    })
    let rejection
    promise.catch((error) => { rejection = error })

    try {
      await vi.advanceTimersByTimeAsync(0)
      expect(rejection).toMatchObject({
        name: 'Error',
        message: 'product-fetch-failed',
        code: 'product-fetch-failed',
        cause: networkError,
      })

      expect(fake.webContents.executeJavaScript).not.toHaveBeenCalled()
      expect(fake.webContents.close).toHaveBeenCalledOnce()
      expect(debug).not.toHaveBeenCalled()
    } finally {
      if (!rejection) {
        controller.abort()
        await promise.catch(() => {})
      }
    }
  })

  it('abort 시 즉시 AbortError를 던지고 동일 finally로 detach/close한다', async () => {
    vi.useFakeTimers()
    const fake = makeView({ readiness: [false] })
    const harness = makeHarness({ views: [fake] })
    const controller = new AbortController()
    const promise = harness.fetch(PRODUCT_URL, HTML_FETCH_POLICY, { signal: controller.signal })
    const rejected = expect(promise).rejects.toMatchObject({ name: 'AbortError' })

    await Promise.resolve()
    controller.abort()
    await rejected

    expect(harness.contentView.removeChildView).toHaveBeenCalledWith(fake.view)
    expect(fake.webContents.close).toHaveBeenCalledOnce()
  })

  it('loadURL이 끝나지 않아도 abort가 fetch promise를 즉시 끝낸다', async () => {
    const fake = makeView({ loadURL: () => new Promise(() => {}) })
    const harness = makeHarness({ views: [fake] })
    const controller = new AbortController()
    const promise = harness.fetch(PRODUCT_URL, HTML_FETCH_POLICY, { signal: controller.signal })
    const rejected = expect(promise).rejects.toMatchObject({ name: 'AbortError' })

    await Promise.resolve()
    controller.abort()
    await rejected

    expect(fake.webContents.close).toHaveBeenCalledOnce()
  })

  it('loadURL 완료를 기다리지 않고 500ms readiness 폴링을 시작한다', async () => {
    vi.useFakeTimers()
    const fake = makeView({
      readiness: [true],
      loadURL: () => new Promise(() => {}),
    })
    const harness = makeHarness({ views: [fake] })
    const controller = new AbortController()
    const promise = harness.fetch(PRODUCT_URL, HTML_FETCH_POLICY, { signal: controller.signal })
    let response
    let rejection
    promise.then((value) => { response = value }, (error) => { rejection = error })

    try {
      await vi.advanceTimersByTimeAsync(1)
      expect(rejection).toBeUndefined()
      expect(response).toMatchObject({ url: PRODUCT_URL })
    } finally {
      if (!response) {
        controller.abort()
        await promise.catch(() => {})
      }
    }
  })

  it('홈으로 이동한 동안 not-ready를 유지하고 상품 path로 돌아오면 추출한다', async () => {
    vi.useFakeTimers()
    let currentUrl = 'https://www.coupang.com/'
    const readinessFromLocation = (source) => runInNewContext(source, {
      location: { pathname: new URL(currentUrl).pathname },
      document: {
        querySelector: () => ({ content: '상품 제목' }),
        querySelectorAll: () => [],
      },
    })
    const fake = makeView({ readiness: [readinessFromLocation, readinessFromLocation] })
    const harness = makeHarness({ views: [fake] })
    const controller = new AbortController()
    const promise = harness.fetch(PRODUCT_URL, HTML_FETCH_POLICY, { signal: controller.signal })
    let response
    promise.then((value) => { response = value }, () => {})

    try {
      await vi.advanceTimersByTimeAsync(1)
      expect(fake.webContents.executeJavaScript.mock.calls[0][0]).toContain('location.pathname')
      expect(harness.statuses).toEqual(['loading'])
      currentUrl = PRODUCT_URL
      await vi.advanceTimersByTimeAsync(1)
      await expect(promise).resolves.toMatchObject({ url: PRODUCT_URL })
    } finally {
      if (!response) {
        controller.abort()
        await promise.catch(() => {})
      }
    }
  })

  it('첫 extraction DOM 실행이 실패하면 readiness부터 다시 poll한 뒤 재추출한다', async () => {
    vi.useFakeTimers()
    let extractionAttempts = 0
    const fake = makeView({
      readiness: [true, true],
      extraction: () => {
        extractionAttempts += 1
        if (extractionAttempts === 1) throw new Error('Execution context was destroyed')
        return productExtraction()
      },
    })
    const harness = makeHarness({ views: [fake] })
    const controller = new AbortController()
    const promise = harness.fetch(PRODUCT_URL, HTML_FETCH_POLICY, { signal: controller.signal })
    let response
    let rejection
    promise.then((value) => { response = value }, (error) => { rejection = error })

    try {
      await vi.advanceTimersByTimeAsync(1)
      expect(rejection).toBeUndefined()
      expect(extractionAttempts).toBe(1)
      expect(fake.webContents.close).not.toHaveBeenCalled()

      await vi.advanceTimersByTimeAsync(1)
      await expect(promise).resolves.toMatchObject({ url: PRODUCT_URL })
      expect(harness.statuses).toEqual(['loading', 'extracting', 'extracting'])
    } finally {
      if (!response) {
        controller.abort()
        await promise.catch(() => {})
      }
    }
  })

  it('hard timeout 경과 시 product-fetch-timeout으로 실패하고 뷰를 정리한다', async () => {
    vi.useFakeTimers()
    let elapsed = 0
    const fake = makeView({ readiness: [false, false] })
    const harness = makeHarness({
      views: [fake],
      now: () => elapsed,
      hardTimeoutMs: 10,
    })
    const controller = new AbortController()
    const promise = harness.fetch(PRODUCT_URL, HTML_FETCH_POLICY, { signal: controller.signal })
    let rejection
    promise.catch((error) => { rejection = error })

    try {
      await vi.advanceTimersByTimeAsync(1)
      elapsed = 10
      await vi.advanceTimersByTimeAsync(1)
      expect(rejection).toMatchObject({ message: 'product-fetch-timeout' })
      expect(fake.webContents.close).toHaveBeenCalledOnce()
    } finally {
      if (!rejection) {
        controller.abort()
        await promise.catch(() => {})
      }
    }
  })

  it('DOM 실행이 영구 pending이어도 hard timeout timer가 fetch를 끝낸다', async () => {
    vi.useFakeTimers()
    const fake = makeView({ readiness: [() => new Promise(() => {})] })
    const harness = makeHarness({ views: [fake], hardTimeoutMs: 10 })
    const promise = harness.fetch(PRODUCT_URL, HTML_FETCH_POLICY, {})
    const rejected = expect(promise).rejects.toMatchObject({
      message: 'product-fetch-timeout',
    })

    await vi.advanceTimersByTimeAsync(1)
    expect(fake.webContents.executeJavaScript).toHaveBeenCalledOnce()
    await vi.advanceTimersByTimeAsync(9)

    await rejected
    expect(fake.webContents.close).toHaveBeenCalledOnce()
  })

  it('모달이 먼저 열린 race에서는 0×0 bounds로 숨긴 채 crawl을 시작할 수 있다', async () => {
    const fake = makeView()
    const harness = makeHarness({
      views: [fake],
      getBounds: () => ({ x: 0, y: 0, width: 0, height: 0 }),
    })

    await expect(harness.fetch(PRODUCT_URL, HTML_FETCH_POLICY, {})).resolves.toMatchObject({
      url: PRODUCT_URL,
    })
    expect(fake.view.setBounds).toHaveBeenCalledWith({ x: 0, y: 0, width: 0, height: 0 })
  })

  it.each(['render-process-gone', 'crashed'])(
    '%s 이벤트 시 pending DOM 실행을 즉시 실패시키고 뷰를 정리한다',
    async (eventName) => {
      vi.useFakeTimers()
      const fake = makeView({ readiness: [() => new Promise(() => {})] })
      const harness = makeHarness({ views: [fake] })
      const controller = new AbortController()
      const promise = harness.fetch(PRODUCT_URL, HTML_FETCH_POLICY, { signal: controller.signal })
      const rejected = expect(promise).rejects.toMatchObject({
        message: 'product-render-process-gone',
      })
      let settled = false
      promise.catch(() => { settled = true })

      try {
        await vi.advanceTimersByTimeAsync(1)
        expect(fake.webContents.executeJavaScript).toHaveBeenCalledWith(
          expect.stringContaining('location.pathname'),
        )
        expect(fake.webContentsHandlers.has(eventName)).toBe(true)
        fake.webContentsHandlers.get(eventName)({}, { reason: 'crashed' })
        await rejected
        expect(fake.webContents.close).toHaveBeenCalledOnce()
      } finally {
        if (!settled) {
          controller.abort()
          await promise.catch(() => {})
        }
      }
    },
  )

  it('이전 lease의 늦은 finally가 새 뷰를 detach하거나 close하지 않는다', async () => {
    vi.useFakeTimers()
    let finishFirstLoad
    const first = makeView({
      readiness: [false],
      loadURL: () => new Promise((resolve) => { finishFirstLoad = resolve }),
    })
    const second = makeView({ readiness: [false] })
    const harness = makeHarness({ views: [first, second] })
    const secondController = new AbortController()
    const firstPromise = harness.fetch(PRODUCT_URL, HTML_FETCH_POLICY, {})
    const firstRejected = expect(firstPromise).rejects.toMatchObject({ name: 'AbortError' })

    await Promise.resolve()
    const secondPromise = harness.fetch(PRODUCT_URL, HTML_FETCH_POLICY, { signal: secondController.signal })
    const secondRejected = expect(secondPromise).rejects.toMatchObject({ name: 'AbortError' })
    await Promise.resolve()
    finishFirstLoad()
    await firstRejected

    expect(harness.contentView.removeChildView).not.toHaveBeenCalledWith(second.view)
    expect(second.webContents.close).not.toHaveBeenCalled()

    secondController.abort()
    await secondRejected
    expect(harness.contentView.removeChildView).toHaveBeenCalledWith(second.view)
    expect(second.webContents.close).toHaveBeenCalledOnce()
  })
})
