// @vitest-environment node
import { access, readFile } from 'node:fs/promises'
import { constants as fsConstants } from 'node:fs'
import path from 'node:path'

import { JSDOM } from 'jsdom'
import { beforeAll, describe, expect, it, vi } from 'vitest'

import {
  createBrowserExecutableFinder,
  createCdpProductFetch,
  validateCoupangProductUrl,
} from '../../../electron/shopping/cdpProductFetch.js'

const PRODUCT_URL = 'https://www.coupang.com/vp/products/123?itemId=456'
const HOME_URL = 'https://www.coupang.com/'
let renderedProductHtml
let renderedErrorHtml

beforeAll(async () => {
  const fixtureDirectory = path.join(process.cwd(), 'tests', 'fixtures', 'shopping')
  ;[renderedProductHtml, renderedErrorHtml] = await Promise.all([
    readFile(path.join(fixtureDirectory, 'coupang-rendered-product.html'), 'utf8'),
    readFile(path.join(fixtureDirectory, 'coupang-rendered-error.html'), 'utf8'),
  ])
})

function evaluateHtml(pageFunction, html, currentUrl) {
  const dom = new JSDOM(html, { url: currentUrl, runScripts: 'outside-only' })
  return dom.window.eval(`(${pageFunction.toString()})()`)
}

function createBrowserHarness(html = renderedProductHtml) {
  let currentUrl = HOME_URL
  let launchOptions
  const events = []
  const page = {
    goto: vi.fn(async (url, options) => {
      currentUrl = url
      events.push({ type: 'goto', url, at: Date.now(), options })
    }),
    evaluate: vi.fn(async (pageFunction) => {
      events.push({ type: 'evaluate', at: Date.now() })
      return evaluateHtml(pageFunction, html, currentUrl)
    }),
  }
  const browser = {
    newPage: vi.fn(async () => page),
    close: vi.fn(async () => {}),
  }
  const launchBrowser = vi.fn(async (options) => {
    launchOptions = options
    return browser
  })
  return {
    browser,
    events,
    launchBrowser,
    page,
    getLaunchOptions: () => launchOptions,
  }
}

describe('validateCoupangProductUrl', () => {
  it.each([
    'https://www.coupang.com/vp/products/123',
    'https://coupang.com/vp/products/123/',
    'https://www.coupang.com/vp/products/123?itemId=456&vendorItemId=789',
  ])('admits an exact Coupang product URL: %s', (value) => {
    expect(validateCoupangProductUrl(value).toString()).toBe(value)
  })

  it.each([
    'http://www.coupang.com/vp/products/123',
    'https://m.coupang.com/vp/products/123',
    'https://www.coupang.com.attacker.test/vp/products/123',
    'https://www.coupang.com:444/vp/products/123',
    'https://user@www.coupang.com/vp/products/123',
    'https://@www.coupang.com/vp/products/123',
    'https://www.coupang.com/vp/products/not-a-number',
    'https://www.coupang.com/vp/products/123/other',
    'https://www.coupang.com/vp/products/123#facts',
    'https://www.coupang.com/vp/products/123#',
    String.raw`https:\\@www.coupang.com/vp/products/123`,
  ])('rejects a non-admitted URL before browser launch: %s', (value) => {
    expect(() => validateCoupangProductUrl(value)).toThrow('URL not allowed')
  })
})

describe('createBrowserExecutableFinder', () => {
  it('searches macOS applications in Chrome, Brave, Edge, Chromium order', async () => {
    const brave = '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser'
    const attempted = []
    const accessExecutable = vi.fn(async (candidate) => {
      attempted.push(candidate)
      if (candidate !== brave) throw Object.assign(new Error('missing'), { code: 'ENOENT' })
    })
    const findBrowserExecutable = createBrowserExecutableFinder({
      platform: 'darwin',
      env: {},
      access: accessExecutable,
      which: vi.fn(),
    })

    await expect(findBrowserExecutable()).resolves.toBe(brave)
    expect(attempted).toEqual([
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      brave,
    ])
    expect(accessExecutable).toHaveBeenNthCalledWith(
      1,
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      fsConstants.X_OK,
    )
  })

  it('checks every Windows Chrome root before Brave', async () => {
    const brave = String.raw`C:\Program Files\BraveSoftware\Brave-Browser\Application\brave.exe`
    const attempted = []
    const findBrowserExecutable = createBrowserExecutableFinder({
      platform: 'win32',
      env: {
        PROGRAMFILES: String.raw`C:\Program Files`,
        'PROGRAMFILES(X86)': String.raw`C:\Program Files (x86)`,
        LOCALAPPDATA: String.raw`C:\Users\tester\AppData\Local`,
      },
      access: vi.fn(async (candidate) => {
        attempted.push(candidate)
        if (candidate !== brave) throw Object.assign(new Error('missing'), { code: 'ENOENT' })
      }),
      which: vi.fn(),
    })

    await expect(findBrowserExecutable()).resolves.toBe(brave)
    expect(attempted).toEqual([
      String.raw`C:\Program Files\Google\Chrome\Application\chrome.exe`,
      String.raw`C:\Program Files (x86)\Google\Chrome\Application\chrome.exe`,
      String.raw`C:\Users\tester\AppData\Local\Google\Chrome\Application\chrome.exe`,
      brave,
    ])
  })

  it('uses Linux PATH lookup in Chrome, Brave, Edge, Chromium order including chromium-browser', async () => {
    const which = vi.fn(async (command) => (
      command === 'chromium-browser' ? '/usr/bin/chromium-browser' : undefined
    ))
    const findBrowserExecutable = createBrowserExecutableFinder({
      platform: 'linux',
      env: {},
      access: vi.fn(),
      which,
    })

    await expect(findBrowserExecutable()).resolves.toBe('/usr/bin/chromium-browser')
    expect(which.mock.calls.map(([command]) => command)).toEqual([
      'google-chrome',
      'brave-browser',
      'microsoft-edge',
      'chromium',
      'chromium-browser',
    ])
  })

  it('throws no-browser-found when no supported executable exists', async () => {
    const findBrowserExecutable = createBrowserExecutableFinder({
      platform: 'darwin',
      env: {},
      access: vi.fn(async () => {
        throw Object.assign(new Error('missing'), { code: 'ENOENT' })
      }),
      which: vi.fn(),
    })

    await expect(findBrowserExecutable()).rejects.toMatchObject({
      message: 'no-browser-found',
      code: 'no-browser-found',
    })
  })
})

describe('createCdpProductFetch', () => {
  it('warms the homepage before extracting rendered product facts in a real profile', async () => {
    const harness = createBrowserHarness()
    const findBrowserExecutable = vi.fn(async () => '/Applications/Google Chrome')
    const cdpProductFetch = createCdpProductFetch({
      launchBrowser: harness.launchBrowser,
      findBrowserExecutable,
      warmupMs: 10,
      navTimeoutMs: 12_345,
      extractTimeoutMs: 100,
    })

    const result = await cdpProductFetch(PRODUCT_URL, {})
    const launchOptions = harness.getLaunchOptions()

    expect(findBrowserExecutable).toHaveBeenCalledTimes(1)
    expect(launchOptions).toMatchObject({
      executablePath: '/Applications/Google Chrome',
      headless: false,
      args: [
        '--disable-blink-features=AutomationControlled',
        '--no-first-run',
        '--no-default-browser-check',
      ],
      ignoreDefaultArgs: ['--enable-automation'],
      userDataDir: expect.stringContaining('autoflowcut-coupang-'),
    })
    expect(harness.page.goto.mock.calls).toEqual([
      [HOME_URL, { waitUntil: 'domcontentloaded', timeout: 12_345 }],
      [PRODUCT_URL, { waitUntil: 'domcontentloaded', timeout: 12_345 }],
    ])
    expect(harness.events.map(({ type, url }) => url ? `${type}:${url}` : type)).toEqual([
      `goto:${HOME_URL}`,
      `goto:${PRODUCT_URL}`,
      'evaluate',
    ])
    expect(harness.events[1].at - harness.events[0].at).toBeGreaterThanOrEqual(5)
    expect(result).toEqual({
      status: 'ok',
      trust: 'untrusted-web-data',
      sourceUrl: PRODUCT_URL,
      product: {
        name: '오뚜기 컵누들 매콤한맛 37.8g, 6개',
        priceKrw: 7200,
        listPriceKrw: 9000,
        discountPercent: 20,
        currency: 'KRW',
      },
      sourceFacts: expect.arrayContaining([
        expect.objectContaining({
          field: 'name',
          value: '오뚜기 컵누들 매콤한맛 37.8g, 6개',
          sourceKind: 'dom',
          verification: 'page-rendered',
        }),
        expect.objectContaining({
          field: 'priceKrw',
          value: 7200,
          sourceKind: 'dom',
          verification: 'page-rendered',
        }),
      ]),
      imageUrls: [
        'https://thumbnail.coupangcdn.com/thumbnails/remote/492x492ex/image/retail/images/236629279350126-product-a.jpg',
        'https://thumbnail.coupangcdn.com/thumbnails/remote/492x492ex/image/retail/images/998877665544332-product-b.jpg',
        'https://thumbnail.coupangcdn.com/thumbnails/remote/292x292ex/image/vendor_inventory/88aa/product-c.jpg',
        'https://thumbnail.coupangcdn.com/image/retail/images/776655443322110-product-d.jpg',
        'https://thumbnail.coupangcdn.com/thumbnails/remote/360x360ex/image/retail/images/665544332211009-product-e.jpg',
      ],
    })
    expect(result.imageUrls).toHaveLength(5)
    expect(result.imageUrls.every((imageUrl) => (
      imageUrl.startsWith('https://')
      && !imageUrl.includes('assets.coupangcdn.com')
      && !imageUrl.includes('/image/coupang/common/')
      && !imageUrl.toLowerCase().includes('logo')
      && (
        imageUrl.includes('/thumbnails/remote/')
        || imageUrl.includes('/vendor_inventory/')
        || imageUrl.includes('/image/retail/images/')
      )
    ))).toBe(true)
    expect(harness.browser.close).toHaveBeenCalledTimes(1)
    await expect(access(launchOptions.userDataDir)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('returns unsupported for a rendered Coupang challenge page', async () => {
    const harness = createBrowserHarness(renderedErrorHtml)
    const cdpProductFetch = createCdpProductFetch({
      launchBrowser: harness.launchBrowser,
      findBrowserExecutable: async () => '/Applications/Google Chrome',
      warmupMs: 0,
      extractTimeoutMs: 0,
    })

    await expect(cdpProductFetch(PRODUCT_URL, {})).resolves.toEqual({
      status: 'unsupported',
      trust: 'untrusted-web-data',
      reason: 'Coupang blocked or error page rendered',
    })
    expect(harness.browser.close).toHaveBeenCalledTimes(1)
  })

  it('treats an initial error-page shell as provisional and succeeds after hydration', async () => {
    const harness = createBrowserHarness()
    const evaluateProduct = harness.page.evaluate.getMockImplementation()
    harness.page.evaluate
      .mockImplementationOnce(async (pageFunction) => (
        evaluateHtml(pageFunction, renderedErrorHtml, PRODUCT_URL)
      ))
      .mockImplementation(evaluateProduct)
    const cdpProductFetch = createCdpProductFetch({
      launchBrowser: harness.launchBrowser,
      findBrowserExecutable: async () => '/Applications/Google Chrome',
      warmupMs: 0,
      extractTimeoutMs: 900,
    })

    const result = await cdpProductFetch(PRODUCT_URL, {})

    expect(harness.page.evaluate).toHaveBeenCalledTimes(2)
    expect(result).toMatchObject({
      status: 'ok',
      product: { name: '오뚜기 컵누들 매콤한맛 37.8g, 6개' },
    })
  })

  it('polls again when the first rendered DOM is still empty', async () => {
    const harness = createBrowserHarness()
    const evaluateProduct = harness.page.evaluate.getMockImplementation()
    harness.page.evaluate
      .mockImplementationOnce(async (pageFunction) => evaluateHtml(
        pageFunction,
        '<!doctype html><html><head><title></title></head><body></body></html>',
        PRODUCT_URL,
      ))
      .mockImplementation(evaluateProduct)
    const cdpProductFetch = createCdpProductFetch({
      launchBrowser: harness.launchBrowser,
      findBrowserExecutable: async () => '/Applications/Google Chrome',
      warmupMs: 0,
      extractTimeoutMs: 900,
    })

    const result = await cdpProductFetch(PRODUCT_URL, {})

    expect(harness.page.evaluate).toHaveBeenCalledTimes(2)
    expect(result).toMatchObject({
      status: 'ok',
      product: { name: '오뚜기 컵누들 매콤한맛 37.8g, 6개' },
    })
  })

  it('uses only the first body price when provisional selectors are absent', async () => {
    const harness = createBrowserHarness(`
      <!doctype html><html><head><title></title></head><body>
        <h1>본문 가격 폴백 상품</h1>
        <p>리뷰 만족도 93%, 판매가 7,200원, 정상가 9,000원, 20% 할인, 무료배송 기준 19,800원</p>
        <img src="https://thumbnail.coupangcdn.com/image/product.jpg">
      </body></html>
    `)
    const cdpProductFetch = createCdpProductFetch({
      launchBrowser: harness.launchBrowser,
      findBrowserExecutable: async () => '/Applications/Google Chrome',
      warmupMs: 0,
      extractTimeoutMs: 10,
    })

    const result = await cdpProductFetch(PRODUCT_URL, {})

    expect(result).toEqual(expect.objectContaining({
      status: 'ok',
      product: {
        name: '본문 가격 폴백 상품',
        priceKrw: 7200,
        currency: 'KRW',
      },
    }))
    expect(result.product).not.toHaveProperty('listPriceKrw')
    expect(result.product).not.toHaveProperty('discountPercent')
  })

  it('derives the discount from selector-backed sale and list prices', async () => {
    const harness = createBrowserHarness(`
      <!doctype html><html><head><title>파생 할인 상품 | 쿠팡 - 생활용품</title></head><body>
        <strong class="total-price">7,200원</strong>
        <span class="origin-price">9,000원</span>
        <img src="https://thumbnail.coupangcdn.com/image/product.jpg">
      </body></html>
    `)
    const cdpProductFetch = createCdpProductFetch({
      launchBrowser: harness.launchBrowser,
      findBrowserExecutable: async () => '/Applications/Google Chrome',
      warmupMs: 0,
      extractTimeoutMs: 10,
    })

    const result = await cdpProductFetch(PRODUCT_URL, {})

    expect(result).toMatchObject({
      status: 'ok',
      product: {
        name: '파생 할인 상품',
        priceKrw: 7200,
        listPriceKrw: 9000,
        discountPercent: 20,
      },
    })
  })

  it('preserves a product name containing a spaced hyphen without a Coupang marker', async () => {
    const harness = createBrowserHarness(`
      <!doctype html><html><head><title>Apple - iPad</title></head><body>
        <strong class="total-price">1,000,000원</strong>
        <img src="https://thumbnail.coupangcdn.com/image/product.jpg">
      </body></html>
    `)
    const cdpProductFetch = createCdpProductFetch({
      launchBrowser: harness.launchBrowser,
      findBrowserExecutable: async () => '/Applications/Google Chrome',
      warmupMs: 0,
      extractTimeoutMs: 10,
    })

    const result = await cdpProductFetch(PRODUCT_URL, {})

    expect(result).toMatchObject({
      status: 'ok',
      product: { name: 'Apple - iPad' },
    })
  })

  it('promotes an http og:image product URL to absolute HTTPS', async () => {
    const harness = createBrowserHarness(`
      <!doctype html><html><head>
        <title>HTTP OG 상품</title>
        <meta property="og:image" content="http://thumbnail.coupangcdn.com/thumbnails/remote/492x492ex/image/retail/images/http-og-product.jpg">
      </head><body>
        <strong class="total-price">9,900원</strong>
      </body></html>
    `)
    const cdpProductFetch = createCdpProductFetch({
      launchBrowser: harness.launchBrowser,
      findBrowserExecutable: async () => '/Applications/Google Chrome',
      warmupMs: 0,
      extractTimeoutMs: 10,
    })

    const result = await cdpProductFetch(PRODUCT_URL, {})

    expect(result).toMatchObject({
      status: 'ok',
      imageUrls: [
        'https://thumbnail.coupangcdn.com/thumbnails/remote/492x492ex/image/retail/images/http-og-product.jpg',
      ],
    })
  })

  it('returns unsupported when rendered product data never appears before the deadline', async () => {
    const harness = createBrowserHarness('<!doctype html><html><head><title></title></head><body></body></html>')
    const cdpProductFetch = createCdpProductFetch({
      launchBrowser: harness.launchBrowser,
      findBrowserExecutable: async () => '/Applications/Google Chrome',
      warmupMs: 0,
      extractTimeoutMs: 0,
    })

    await expect(cdpProductFetch(PRODUCT_URL, {})).resolves.toEqual({
      status: 'unsupported',
      trust: 'untrusted-web-data',
      reason: 'Rendered product data could not be extracted',
    })
    expect(harness.page.evaluate).toHaveBeenCalledTimes(1)
    expect(harness.browser.close).toHaveBeenCalledTimes(1)
  })

  it('throws no-browser-found before launch when no installed browser exists', async () => {
    const launchBrowser = vi.fn()
    const cdpProductFetch = createCdpProductFetch({
      launchBrowser,
      findBrowserExecutable: async () => {
        throw Object.assign(new Error('no-browser-found'), { code: 'no-browser-found' })
      },
      warmupMs: 0,
    })

    await expect(cdpProductFetch(PRODUCT_URL, {})).rejects.toMatchObject({
      message: 'no-browser-found',
      code: 'no-browser-found',
    })
    expect(launchBrowser).not.toHaveBeenCalled()
  })

  it('closes the browser and removes its profile when aborted during warmup', async () => {
    const harness = createBrowserHarness()
    const controller = new AbortController()
    const cdpProductFetch = createCdpProductFetch({
      launchBrowser: harness.launchBrowser,
      findBrowserExecutable: async () => '/Applications/Google Chrome',
      warmupMs: 1_000,
    })

    const fetching = cdpProductFetch(PRODUCT_URL, { signal: controller.signal })
    await vi.waitFor(() => expect(harness.page.goto).toHaveBeenCalledTimes(1))
    const profileDirectory = harness.getLaunchOptions().userDataDir
    controller.abort(new Error('user cancelled'))

    await expect(fetching).rejects.toMatchObject({ name: 'AbortError', message: 'user cancelled' })
    expect(harness.browser.close).toHaveBeenCalledTimes(1)
    await expect(access(profileDirectory)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('closes a browser whose launch resolves after cancellation', async () => {
    const harness = createBrowserHarness()
    const controller = new AbortController()
    let resolveLaunch
    const launchBrowser = vi.fn((options) => {
      harness.launchBrowser(options)
      return new Promise((resolve) => { resolveLaunch = resolve })
    })
    const cdpProductFetch = createCdpProductFetch({
      launchBrowser,
      findBrowserExecutable: async () => '/Applications/Google Chrome',
      warmupMs: 0,
    })

    const fetching = cdpProductFetch(PRODUCT_URL, { signal: controller.signal })
    await vi.waitFor(() => expect(launchBrowser).toHaveBeenCalledTimes(1))
    const profileDirectory = harness.getLaunchOptions().userDataDir
    controller.abort(new Error('cancel launch'))
    resolveLaunch(harness.browser)

    await expect(fetching).rejects.toMatchObject({ name: 'AbortError' })
    expect(harness.browser.close).toHaveBeenCalledTimes(1)
    await expect(access(profileDirectory)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('uses the same cleanup path when product navigation throws', async () => {
    const harness = createBrowserHarness()
    harness.page.goto
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('navigation failed'))
    const cdpProductFetch = createCdpProductFetch({
      launchBrowser: harness.launchBrowser,
      findBrowserExecutable: async () => '/Applications/Google Chrome',
      warmupMs: 0,
    })

    await expect(cdpProductFetch(PRODUCT_URL, {})).rejects.toThrow('navigation failed')
    expect(harness.browser.close).toHaveBeenCalledTimes(1)
    await expect(access(harness.getLaunchOptions().userDataDir))
      .rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('does not let browser close rejection mask a successful extraction', async () => {
    const harness = createBrowserHarness()
    harness.browser.close.mockRejectedValueOnce(new Error('browser already closed'))
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const cdpProductFetch = createCdpProductFetch({
      launchBrowser: harness.launchBrowser,
      findBrowserExecutable: async () => '/Applications/Google Chrome',
      warmupMs: 0,
      extractTimeoutMs: 10,
    })

    await expect(cdpProductFetch(PRODUCT_URL, {})).resolves.toMatchObject({ status: 'ok' })
    expect(harness.browser.close).toHaveBeenCalledOnce()
    expect(warn).toHaveBeenCalledWith(
      '[Shopping CDP] browser cleanup failed:',
      'browser already closed',
    )
  })

  it('stops waiting for a hung browser close after five seconds', async () => {
    vi.useFakeTimers()
    try {
      const harness = createBrowserHarness()
      harness.browser.close.mockImplementation(() => new Promise(() => {}))
      vi.spyOn(console, 'warn').mockImplementation(() => {})
      const cdpProductFetch = createCdpProductFetch({
        launchBrowser: harness.launchBrowser,
        findBrowserExecutable: async () => '/Applications/Google Chrome',
        warmupMs: 0,
        extractTimeoutMs: 10,
      })
      let settled = false
      let result
      const fetching = cdpProductFetch(PRODUCT_URL, {}).then((value) => {
        settled = true
        result = value
      })

      await vi.waitFor(() => expect(harness.browser.close).toHaveBeenCalledOnce())
      await vi.advanceTimersByTimeAsync(5_000)
      await vi.waitFor(() => expect(settled).toBe(true), { timeout: 500 })

      expect(result).toMatchObject({ status: 'ok' })
      await fetching
    } finally {
      vi.useRealTimers()
    }
  })
})
