import { EventEmitter } from 'node:events'
import { Readable } from 'node:stream'
import { brotliCompressSync, deflateSync, gzipSync } from 'node:zlib'
import { describe, expect, it, vi } from 'vitest'
import {
  HTML_FETCH_POLICY,
  IMAGE_FETCH_POLICY,
  isPublicAddress,
  safeHttpFetch,
} from '../../../../electron/api/net/safeHttpFetch.js'

const ONE_BY_ONE_PNG = Buffer.from(
  '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489',
  'hex',
)

const SMALL_HTML_POLICY = Object.freeze({ ...HTML_FETCH_POLICY, maxBytes: 32 })

function makePng(width, height) {
  const png = Buffer.from(ONE_BY_ONE_PNG)
  png.writeUInt32BE(width, 16)
  png.writeUInt32BE(height, 20)
  return png
}

function makeJpeg(width, height) {
  return Buffer.from([
    0xff, 0xd8,
    0xff, 0xc0, 0x00, 0x11, 0x08,
    (height >>> 8) & 0xff, height & 0xff,
    (width >>> 8) & 0xff, width & 0xff,
    0x03,
    0x01, 0x11, 0x00,
    0x02, 0x11, 0x00,
    0x03, 0x11, 0x00,
    0xff, 0xd9,
  ])
}

function makeWebp(width, height) {
  const webp = Buffer.alloc(30)
  webp.write('RIFF', 0, 'ascii')
  webp.writeUInt32LE(webp.length - 8, 4)
  webp.write('WEBP', 8, 'ascii')
  webp.write('VP8X', 12, 'ascii')
  webp.writeUInt32LE(10, 16)
  webp.writeUIntLE(width - 1, 24, 3)
  webp.writeUIntLE(height - 1, 27, 3)
  return webp
}

function makeResponse({ statusCode = 200, headers = {}, chunks = [] } = {}) {
  const response = Readable.from(chunks)
  response.statusCode = statusCode
  response.headers = Object.fromEntries(
    Object.entries(headers).map(([name, value]) => [name.toLowerCase(), value]),
  )
  return response
}

function makeTransport(responses, { regularLookup, connected, afterResponse } = {}) {
  let responseIndex = 0
  return vi.fn((urlString, options, onResponse) => {
    const request = new EventEmitter()
    request.destroy = vi.fn((error) => {
      if (error) queueMicrotask(() => request.emit('error', error))
    })
    request.end = vi.fn(() => {
      queueMicrotask(() => {
        const lookup = options.lookup || regularLookup
        if (!lookup) {
          request.emit('error', new Error('no connection lookup'))
          return
        }
        lookup(new URL(urlString).hostname, {}, (error, address, family) => {
          if (error) {
            request.emit('error', error)
            return
          }
          connected?.({ address, family, options, urlString })
          const response = responses[responseIndex++]
          onResponse(typeof response === 'function' ? response() : response)
          afterResponse?.()
        })
      })
    })
    return request
  })
}

function htmlResponse(body = '<html>ok</html>') {
  return makeResponse({
    headers: { 'content-type': 'text/html; charset=utf-8' },
    chunks: [Buffer.from(body)],
  })
}

function imageResponse(body = ONE_BY_ONE_PNG) {
  return makeResponse({
    headers: { 'content-type': 'image/png' },
    chunks: [body],
  })
}

function redirectResponse(location, statusCode = 302) {
  return makeResponse({
    statusCode,
    headers: location == null ? {} : { location },
  })
}

describe('isPublicAddress', () => {
  it.each([
    ['0.0.0.0', 4],
    ['0.255.255.255', 4],
    ['10.0.0.1', 4],
    ['100.64.0.0', 4],
    ['100.127.255.255', 4],
    ['127.255.255.255', 4],
    ['169.254.1.1', 4],
    ['172.16.0.0', 4],
    ['172.31.255.255', 4],
    ['192.0.0.1', 4],
    ['192.0.2.1', 4],
    ['192.31.196.1', 4],
    ['192.52.193.1', 4],
    ['192.168.1.1', 4],
    ['198.18.0.0', 4],
    ['198.19.255.255', 4],
    ['198.51.100.1', 4],
    ['203.0.113.1', 4],
    ['192.88.99.1', 4],
    ['192.175.48.1', 4],
    ['224.0.0.1', 4],
    ['239.255.255.255', 4],
    ['240.0.0.1', 4],
    ['255.255.255.255', 4],
  ])('rejects non-public IPv4 %s', (address, family) => {
    expect(isPublicAddress(address, family)).toBe(false)
  })

  it.each([
    ['::', 6],
    ['::1', 6],
    ['::ffff:8.8.8.8', 6],
    ['64:ff9b::808:808', 6],
    ['64:ff9b:1::1', 6],
    ['100::1', 6],
    ['2001:db8::1', 6],
    ['2001:20::1', 6],
    ['2001::1', 6],
    ['2002::1', 6],
    ['3ffe::1', 6],
    ['3fff::1', 6],
    ['4000::1', 6],
    ['2620:4f:8000::1', 6],
    ['fc00::1', 6],
    ['fdff:ffff::1', 6],
    ['fe80::1', 6],
    ['febf:ffff::1', 6],
    ['fec0::1', 6],
    ['ff02::1', 6],
  ])('rejects non-public IPv6 %s', (address, family) => {
    expect(isPublicAddress(address, family)).toBe(false)
  })

  it.each([
    ['1.1.1.1', 4],
    ['8.8.8.8', 4],
    ['100.63.255.255', 4],
    ['100.128.0.0', 4],
    ['172.15.255.255', 4],
    ['172.32.0.0', 4],
    ['2001:4860:4860::8888', 6],
    ['2606:4700:4700::1111', 6],
  ])('accepts public address %s', (address, family) => {
    expect(isPublicAddress(address, family)).toBe(true)
  })

  it('rejects invalid addresses and family mismatches', () => {
    expect(isPublicAddress('999.1.1.1', 4)).toBe(false)
    expect(isPublicAddress('1.1.1.1', 6)).toBe(false)
    expect(isPublicAddress('2001:4860::1', 4)).toBe(false)
    expect(isPublicAddress('not-an-ip', 6)).toBe(false)
    expect(isPublicAddress('fe80::1%lo0', 6)).toBe(false)
  })
})

describe('safeHttpFetch URL policy', () => {
  it.each([
    ['http://www.coupang.com/vp/products/1', HTML_FETCH_POLICY],
    ['ftp://www.coupang.com/vp/products/1', HTML_FETCH_POLICY],
    ['https://user:secret@www.coupang.com/vp/products/1', HTML_FETCH_POLICY],
    ['https://www.coupang.com/vp/products/1#reviews', HTML_FETCH_POLICY],
    ['https://www.coupang.com/vp/products/1#', HTML_FETCH_POLICY],
    ['https://@www.coupang.com/vp/products/1', HTML_FETCH_POLICY],
    [String.raw`https:\\@www.coupang.com/vp/products/1`, HTML_FETCH_POLICY],
    ['https://127.0.0.1/vp/products/1', HTML_FETCH_POLICY],
    ['https://[2606:4700:4700::1111]/image.png', IMAGE_FETCH_POLICY],
    ['https://www.coupang.com:444/vp/products/1', HTML_FETCH_POLICY],
    ['https://', HTML_FETCH_POLICY],
    ['https://link.coupang.com/a/short', HTML_FETCH_POLICY],
    ['https://m.coupang.com/vp/products/1', HTML_FETCH_POLICY],
    ['https://www.coupang.com.attacker.test/vp/products/1', HTML_FETCH_POLICY],
    ['https://coupangcdn.com.attacker.test/image.png', IMAGE_FETCH_POLICY],
  ])('rejects disallowed input %s before DNS', async (url, policy) => {
    const resolveDns = vi.fn()
    await expect(safeHttpFetch(url, policy, { resolveDns, createRequest: vi.fn() }))
      .rejects.toThrow(/URL not allowed/)
    expect(resolveDns).not.toHaveBeenCalled()
  })

  it.each([
    ['https://coupang.com/vp/products/1', HTML_FETCH_POLICY],
    ['https://www.coupang.com:443/vp/products/1', HTML_FETCH_POLICY],
    ['https://coupangcdn.com/image.png', IMAGE_FETCH_POLICY],
    ['https://thumbnail.coupangcdn.com/image.png', IMAGE_FETCH_POLICY],
  ])('allows policy host %s', async (url, policy) => {
    const createRequest = makeTransport([
      policy.kind === 'html' ? htmlResponse() : imageResponse(),
    ])
    await expect(safeHttpFetch(url, policy, {
      resolveDns: vi.fn(async () => [{ address: '93.184.216.34', family: 4 }]),
      createRequest,
    })).resolves.toMatchObject({ statusCode: 200 })
  })

  it('normalizes a trailing dot before allowlist, DNS, SNI, and Host checks', async () => {
    const resolveDns = vi.fn(async () => [{ address: '93.184.216.34', family: 4 }])
    const createRequest = makeTransport([htmlResponse()])

    await safeHttpFetch('https://www.coupang.com./vp/products/1', HTML_FETCH_POLICY, {
      resolveDns,
      createRequest,
    })

    expect(resolveDns).toHaveBeenCalledWith('www.coupang.com')
    const [urlString, options] = createRequest.mock.calls[0]
    expect(new URL(urlString).hostname).toBe('www.coupang.com')
    expect(options.servername).toBe('www.coupang.com')
    expect(options.headers.Host).toBe('www.coupang.com')
  })
})

describe('safeHttpFetch DNS and socket pinning', () => {
  it('rejects an empty DNS answer', async () => {
    await expect(safeHttpFetch('https://www.coupang.com/x', HTML_FETCH_POLICY, {
      resolveDns: vi.fn(async () => []),
      createRequest: vi.fn(),
    })).rejects.toThrow(/DNS answer/)
  })

  it('rejects the whole mixed A/AAAA answer when any address is non-public', async () => {
    const createRequest = vi.fn()
    await expect(safeHttpFetch('https://www.coupang.com/x', HTML_FETCH_POLICY, {
      resolveDns: vi.fn(async () => [
        { address: '93.184.216.34', family: 4 },
        { address: 'fd00::1', family: 6 },
      ]),
      createRequest,
    })).rejects.toThrow(/non-public DNS address/)
    expect(createRequest).not.toHaveBeenCalled()
  })

  it('selects one public address deterministically and pins the socket to it', async () => {
    const connected = vi.fn()
    const createRequest = makeTransport([htmlResponse()], { connected })
    await safeHttpFetch('https://www.coupang.com/x', HTML_FETCH_POLICY, {
      resolveDns: vi.fn(async () => [
        { address: '2606:4700:4700::1111', family: 6 },
        { address: '93.184.216.35', family: 4 },
        { address: '93.184.216.34', family: 4 },
      ]),
      createRequest,
    })

    const [, options] = createRequest.mock.calls[0]
    expect(options.autoSelectFamily).toBe(false)
    expect(options.agent).toBe(false)
    expect(options.rejectUnauthorized).toBe(true)
    expect(options.servername).toBe('www.coupang.com')
    expect(options.headers.Host).toBe('www.coupang.com')
    expect(connected).toHaveBeenCalledWith(expect.objectContaining({
      address: '93.184.216.34',
      family: 4,
    }))
  })

  it('never calls a general connection lookup after validating DNS (rebinding defense)', async () => {
    const regularLookup = vi.fn((_host, _options, callback) => {
      callback(null, '127.0.0.1', 4)
    })
    const connected = vi.fn()
    const createRequest = makeTransport([htmlResponse()], { regularLookup, connected })

    await safeHttpFetch('https://www.coupang.com/x', HTML_FETCH_POLICY, {
      resolveDns: vi.fn(async () => [{ address: '93.184.216.34', family: 4 }]),
      createRequest,
    })

    expect(regularLookup).toHaveBeenCalledTimes(0)
    expect(connected).toHaveBeenCalledWith(expect.objectContaining({
      address: '93.184.216.34',
      family: 4,
    }))
  })

  it.each([
    ['html', HTML_FETCH_POLICY, htmlResponse()],
    ['image', IMAGE_FETCH_POLICY, imageResponse()],
  ])('uses the same primitive and injected transport for %s', async (_kind, policy, response) => {
    const resolveDns = vi.fn(async () => [{ address: '93.184.216.34', family: 4 }])
    const createRequest = makeTransport([response])
    const url = policy.kind === 'html'
      ? 'https://www.coupang.com/product'
      : 'https://image.coupangcdn.com/product.png'

    const result = await safeHttpFetch(url, policy, { resolveDns, createRequest })

    expect(resolveDns).toHaveBeenCalledTimes(1)
    expect(createRequest).toHaveBeenCalledTimes(1)
    expect(result.body).toBeInstanceOf(Buffer)
  })

  it('sends only fixed browser-like headers without ambient credentials', async () => {
    const createRequest = makeTransport([htmlResponse()])
    await safeHttpFetch('https://www.coupang.com/x', HTML_FETCH_POLICY, {
      resolveDns: vi.fn(async () => [{ address: '93.184.216.34', family: 4 }]),
      createRequest,
    })

    const headers = createRequest.mock.calls[0][1].headers
    expect(headers['User-Agent']).toMatch(/Mozilla/)
    expect(headers).not.toHaveProperty('Cookie')
    expect(headers).not.toHaveProperty('Authorization')
    expect(headers).not.toHaveProperty('Referer')
  })
})

describe('safeHttpFetch redirects', () => {
  it('resolves a relative redirect and reapplies URL and DNS policy to the next hop', async () => {
    const resolveDns = vi.fn(async () => [{ address: '93.184.216.34', family: 4 }])
    const redirect = new Readable({ read() {} })
    redirect.statusCode = 302
    redirect.headers = { location: '/vp/products/2?itemId=3' }
    const destroyRedirect = vi.spyOn(redirect, 'destroy')
    const createRequest = makeTransport([
      redirect,
      htmlResponse('<html>redirected</html>'),
    ])

    const result = await safeHttpFetch(
      'https://www.coupang.com/vp/products/1',
      HTML_FETCH_POLICY,
      { resolveDns, createRequest },
    )

    expect(resolveDns).toHaveBeenCalledTimes(2)
    expect(createRequest.mock.calls.map(([url]) => url)).toEqual([
      'https://www.coupang.com/vp/products/1',
      'https://www.coupang.com/vp/products/2?itemId=3',
    ])
    expect(result.url).toBe('https://www.coupang.com/vp/products/2?itemId=3')
    expect(destroyRedirect).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['http downgrade', 'http://www.coupang.com/insecure'],
    ['host exit', 'https://attacker.test/stolen'],
    ['userinfo', 'https://user@www.coupang.com/stolen'],
    ['empty userinfo', 'https://@www.coupang.com/stolen'],
    ['empty fragment', 'https://www.coupang.com/stolen#'],
    ['non-standard port', 'https://www.coupang.com:8443/stolen'],
  ])('rejects redirect %s before resolving its DNS', async (_case, location) => {
    const resolveDns = vi.fn(async () => [{ address: '93.184.216.34', family: 4 }])
    const createRequest = makeTransport([redirectResponse(location)])

    await expect(safeHttpFetch('https://www.coupang.com/start', HTML_FETCH_POLICY, {
      resolveDns,
      createRequest,
    })).rejects.toThrow(/URL not allowed/)

    expect(resolveDns).toHaveBeenCalledTimes(1)
    expect(createRequest).toHaveBeenCalledTimes(1)
  })

  it('rejects a redirect without Location', async () => {
    await expect(safeHttpFetch('https://www.coupang.com/start', HTML_FETCH_POLICY, {
      resolveDns: vi.fn(async () => [{ address: '93.184.216.34', family: 4 }]),
      createRequest: makeTransport([redirectResponse(null)]),
    })).rejects.toThrow(/redirect location/)
  })

  it('allows at most three redirects and rejects the fourth redirect response', async () => {
    const resolveDns = vi.fn(async () => [{ address: '93.184.216.34', family: 4 }])
    const createRequest = makeTransport([
      redirectResponse('/hop-1'),
      redirectResponse('/hop-2'),
      redirectResponse('/hop-3'),
      redirectResponse('/hop-4'),
    ])

    await expect(safeHttpFetch('https://www.coupang.com/start', HTML_FETCH_POLICY, {
      resolveDns,
      createRequest,
    })).rejects.toThrow(/too many redirects/)

    expect(resolveDns).toHaveBeenCalledTimes(4)
    expect(createRequest).toHaveBeenCalledTimes(4)
  })

  it('rejects a non-success final response', async () => {
    await expect(safeHttpFetch('https://www.coupang.com/start', HTML_FETCH_POLICY, {
      resolveDns: vi.fn(async () => [{ address: '93.184.216.34', family: 4 }]),
      createRequest: makeTransport([makeResponse({ statusCode: 503 })]),
    })).rejects.toThrow(/HTTP 503/)
  })
})

describe('safeHttpFetch policy validation', () => {
  it.each([
    [{ kind: 'audio', hostAllow: () => true, maxBytes: 32 }],
    [{ kind: 'html', hostAllow: null, maxBytes: 32 }],
    [{ kind: 'html', hostAllow: () => true, maxBytes: 0 }],
    [{ kind: 'image', hostAllow: () => true, maxBytes: Number.NaN }],
  ])('rejects an invalid policy before DNS or transport', async (policy) => {
    const resolveDns = vi.fn()
    const createRequest = vi.fn()

    await expect(safeHttpFetch('https://www.coupang.com/x', policy, {
      resolveDns,
      createRequest,
    })).rejects.toThrow(/fetch policy/)

    expect(resolveDns).not.toHaveBeenCalled()
    expect(createRequest).not.toHaveBeenCalled()
  })
})

describe('safeHttpFetch absolute deadline', () => {
  it('creates one 15-second timer for DNS, connect, redirects, and body', async () => {
    const setTimer = vi.fn(() => ({ fakeTimer: true }))
    const clearTimer = vi.fn()

    await safeHttpFetch('https://www.coupang.com/start', HTML_FETCH_POLICY, {
      resolveDns: vi.fn(async () => [{ address: '93.184.216.34', family: 4 }]),
      createRequest: makeTransport([htmlResponse()]),
      setTimer,
      clearTimer,
    })

    expect(setTimer).toHaveBeenCalledTimes(1)
    expect(setTimer.mock.calls[0][1]).toBe(15_000)
    expect(clearTimer).toHaveBeenCalledWith({ fakeTimer: true })
  })

  it('passes decreasing time remaining instead of resetting timeout per redirect hop', async () => {
    let currentTime = 1_000
    let connectionCount = 0
    const createRequest = makeTransport([
      redirectResponse('/hop-1'),
      redirectResponse('/hop-2'),
      htmlResponse(),
    ], {
      connected: () => {
        if (connectionCount++ < 2) currentTime += 6_000
      },
    })

    await safeHttpFetch('https://www.coupang.com/start', HTML_FETCH_POLICY, {
      resolveDns: vi.fn(async () => [{ address: '93.184.216.34', family: 4 }]),
      createRequest,
      now: () => currentTime,
    })

    expect(createRequest.mock.calls.map(([, options]) => options.timeout)).toEqual([
      15_000,
      9_000,
      3_000,
    ])
  })

  it('does not start another hop after the absolute deadline expires', async () => {
    let currentTime = 1_000
    const resolveDns = vi.fn(async () => [{ address: '93.184.216.34', family: 4 }])
    const response = new Readable({ read() {} })
    response.statusCode = 302
    response.headers = { location: '/too-late' }
    const destroyResponse = vi.spyOn(response, 'destroy')
    const createRequest = makeTransport([response], {
      connected: () => { currentTime += 15_001 },
    })

    await expect(safeHttpFetch('https://www.coupang.com/start', HTML_FETCH_POLICY, {
      resolveDns,
      createRequest,
      now: () => currentTime,
    })).rejects.toThrow(/deadline/)

    expect(resolveDns).toHaveBeenCalledTimes(1)
    expect(createRequest).toHaveBeenCalledTimes(1)
    expect(destroyResponse).toHaveBeenCalledTimes(1)
  })

  it('aborts a pending DNS resolution when the one absolute timer fires', async () => {
    let fireDeadline
    const setTimer = vi.fn((callback) => {
      fireDeadline = callback
      return { fakeTimer: true }
    })
    const createRequest = vi.fn()
    const promise = safeHttpFetch('https://www.coupang.com/x', HTML_FETCH_POLICY, {
      resolveDns: vi.fn(() => new Promise(() => {})),
      createRequest,
      setTimer,
      clearTimer: vi.fn(),
    })
    const rejection = expect(promise).rejects.toThrow(/deadline/)

    await vi.waitFor(() => expect(setTimer).toHaveBeenCalledTimes(1))
    fireDeadline()

    await rejection
    expect(createRequest).not.toHaveBeenCalled()
  })

  it('aborts and destroys a pending response body when the one absolute timer fires', async () => {
    let fireDeadline
    const setTimer = vi.fn((callback) => {
      fireDeadline = callback
      return { fakeTimer: true }
    })
    const response = new Readable({ read() {} })
    response.statusCode = 200
    response.headers = { 'content-type': 'text/html' }
    const destroyResponse = vi.spyOn(response, 'destroy')
    const createRequest = makeTransport([response])
    const promise = safeHttpFetch('https://www.coupang.com/x', HTML_FETCH_POLICY, {
      resolveDns: vi.fn(async () => [{ address: '93.184.216.34', family: 4 }]),
      createRequest,
      setTimer,
      clearTimer: vi.fn(),
    })
    const rejection = expect(promise).rejects.toThrow(/deadline/)

    await vi.waitFor(() => expect(response.listenerCount('data')).toBe(1))
    fireDeadline()

    await rejection
    expect(destroyResponse).toHaveBeenCalledTimes(1)
  })

  it('does not miss an abort fired between response callback and body listener setup', async () => {
    let fireDeadline
    const response = new Readable({ read() {} })
    response.statusCode = 200
    response.headers = { 'content-type': 'text/html' }
    const destroyResponse = vi.spyOn(response, 'destroy')
    const createRequest = makeTransport([response], {
      afterResponse: () => fireDeadline(),
    })
    const promise = safeHttpFetch('https://www.coupang.com/x', HTML_FETCH_POLICY, {
      resolveDns: vi.fn(async () => [{ address: '93.184.216.34', family: 4 }]),
      createRequest,
      setTimer: (callback) => {
        fireDeadline = callback
        return { fakeTimer: true }
      },
      clearTimer: vi.fn(),
    })

    const outcome = await Promise.race([
      promise.then(() => 'resolved', (error) => error.message),
      new Promise((resolve) => setImmediate(() => resolve('hung after abort'))),
    ])

    expect(outcome).toMatch(/deadline/)
    expect(destroyResponse).toHaveBeenCalledTimes(1)
  })
})

describe('safeHttpFetch streaming and decoded byte caps', () => {
  it('uses the policy limits required for HTML and images', () => {
    expect(HTML_FETCH_POLICY.maxBytes).toBe(2 * 1024 * 1024)
    expect(IMAGE_FETCH_POLICY.maxBytes).toBe(10 * 1024 * 1024)
  })

  it('rejects an oversized Content-Length before attaching a data reader', async () => {
    const response = makeResponse({
      headers: {
        'content-type': 'text/html',
        'content-length': '33',
      },
      chunks: [Buffer.alloc(33)],
    })
    const on = vi.spyOn(response, 'on')

    await expect(safeHttpFetch('https://www.coupang.com/x', SMALL_HTML_POLICY, {
      resolveDns: vi.fn(async () => [{ address: '93.184.216.34', family: 4 }]),
      createRequest: makeTransport([response]),
    })).rejects.toThrow(/body too large/)

    expect(on.mock.calls.some(([event]) => event === 'data')).toBe(false)
  })

  it('rejects a lying small Content-Length when the streamed body crosses the cap', async () => {
    const response = makeResponse({
      headers: {
        'content-type': 'text/html',
        'content-length': '1',
      },
      chunks: [Buffer.alloc(33, 'a')],
    })

    await expect(safeHttpFetch('https://www.coupang.com/x', SMALL_HTML_POLICY, {
      resolveDns: vi.fn(async () => [{ address: '93.184.216.34', family: 4 }]),
      createRequest: makeTransport([response]),
    })).rejects.toThrow(/body too large/)
  })

  it('rejects chunked overflow as soon as cumulative decoded bytes cross the cap', async () => {
    const response = makeResponse({
      headers: { 'content-type': 'text/html', 'transfer-encoding': 'chunked' },
      chunks: [Buffer.alloc(20, 'a'), Buffer.alloc(13, 'b'), Buffer.alloc(20, 'c')],
    })

    await expect(safeHttpFetch('https://www.coupang.com/x', SMALL_HTML_POLICY, {
      resolveDns: vi.fn(async () => [{ address: '93.184.216.34', family: 4 }]),
      createRequest: makeTransport([response]),
    })).rejects.toThrow(/body too large/)
  })

  it('rejects a compression bomb based on bytes after content decoding', async () => {
    const decoded = Buffer.alloc(64, 'a')
    const encoded = gzipSync(decoded)
    expect(encoded.length).toBeLessThanOrEqual(SMALL_HTML_POLICY.maxBytes)
    const response = makeResponse({
      headers: {
        'content-type': 'text/html',
        'content-encoding': 'gzip',
        'content-length': String(encoded.length),
      },
      chunks: [encoded],
    })

    await expect(safeHttpFetch('https://www.coupang.com/x', SMALL_HTML_POLICY, {
      resolveDns: vi.fn(async () => [{ address: '93.184.216.34', family: 4 }]),
      createRequest: makeTransport([response]),
    })).rejects.toThrow(/body too large/)
  })

  it('does not compare encoded Content-Length against the decoded byte cap', async () => {
    const decoded = Buffer.from(Array.from({ length: 32 }, (_value, index) => index))
    const encoded = gzipSync(decoded)
    expect(encoded.length).toBeGreaterThan(SMALL_HTML_POLICY.maxBytes)
    const response = makeResponse({
      headers: {
        'content-type': 'text/html',
        'content-encoding': 'gzip',
        'content-length': String(encoded.length),
      },
      chunks: [encoded],
    })

    const result = await safeHttpFetch('https://www.coupang.com/x', SMALL_HTML_POLICY, {
      resolveDns: vi.fn(async () => [{ address: '93.184.216.34', family: 4 }]),
      createRequest: makeTransport([response]),
    })

    expect(result.body).toEqual(decoded)
  })

  it.each([
    ['gzip', gzipSync],
    ['deflate', deflateSync],
    ['br', brotliCompressSync],
  ])('decodes supported %s content before returning it', async (encoding, encode) => {
    const decoded = Buffer.from('<html>compressed</html>')
    const response = makeResponse({
      headers: {
        'content-type': 'text/html',
        'content-encoding': encoding,
      },
      chunks: [encode(decoded)],
    })

    const result = await safeHttpFetch('https://www.coupang.com/x', HTML_FETCH_POLICY, {
      resolveDns: vi.fn(async () => [{ address: '93.184.216.34', family: 4 }]),
      createRequest: makeTransport([response]),
    })

    expect(result.body).toEqual(decoded)
  })

  it('rejects unsupported or stacked content encodings', async () => {
    const response = makeResponse({
      headers: {
        'content-type': 'text/html',
        'content-encoding': 'gzip, br',
      },
      chunks: [Buffer.from('not decoded')],
    })

    await expect(safeHttpFetch('https://www.coupang.com/x', HTML_FETCH_POLICY, {
      resolveDns: vi.fn(async () => [{ address: '93.184.216.34', family: 4 }]),
      createRequest: makeTransport([response]),
    })).rejects.toThrow(/content-encoding/)
  })
})

describe('safeHttpFetch content admission', () => {
  it.each([
    ['', 'missing'],
    ['text/plain', 'plain text'],
    ['application/xhtml+xml', 'xhtml'],
  ])('rejects HTML response content-type %s (%s)', async (contentType) => {
    const response = makeResponse({
      headers: contentType ? { 'content-type': contentType } : {},
      chunks: [Buffer.from('<html>no</html>')],
    })

    await expect(safeHttpFetch('https://www.coupang.com/x', HTML_FETCH_POLICY, {
      resolveDns: vi.fn(async () => [{ address: '93.184.216.34', family: 4 }]),
      createRequest: makeTransport([response]),
    })).rejects.toThrow(/HTML content-type/)
  })

  it.each([
    ['image/png', makePng(320, 240), 320, 240],
    ['image/jpeg', makeJpeg(640, 480), 640, 480],
    ['image/webp', makeWebp(800, 600), 800, 600],
  ])('accepts matching %s magic and dimensions', async (mimeType, body, width, height) => {
    const response = makeResponse({
      headers: { 'content-type': `${mimeType}; cache=hit` },
      chunks: [body],
    })

    const result = await safeHttpFetch('https://image.coupangcdn.com/x', IMAGE_FETCH_POLICY, {
      resolveDns: vi.fn(async () => [{ address: '93.184.216.34', family: 4 }]),
      createRequest: makeTransport([response]),
    })

    expect(result).toMatchObject({ mimeType, width, height })
  })

  it.each([
    ['image/jpeg', makePng(1, 1), 'MIME/magic mismatch'],
    ['image/png', Buffer.from('<html>fake image</html>'), 'HTML masquerade'],
    ['image/svg+xml', Buffer.from('<svg/>'), 'SVG masquerade'],
  ])('rejects %s body (%s)', async (contentType, body) => {
    const response = makeResponse({
      headers: { 'content-type': contentType },
      chunks: [body],
    })

    await expect(safeHttpFetch('https://image.coupangcdn.com/x', IMAGE_FETCH_POLICY, {
      resolveDns: vi.fn(async () => [{ address: '93.184.216.34', family: 4 }]),
      createRequest: makeTransport([response]),
    })).rejects.toThrow(/image (content-type|magic)/)
  })

  it.each([
    ['width', makePng(10_001, 1)],
    ['height', makePng(1, 10_001)],
    ['total pixels', makePng(6_000, 5_000)],
  ])('rejects an image pixel bomb by %s', async (_case, body) => {
    const response = makeResponse({
      headers: { 'content-type': 'image/png' },
      chunks: [body],
    })

    await expect(safeHttpFetch('https://image.coupangcdn.com/x', IMAGE_FETCH_POLICY, {
      resolveDns: vi.fn(async () => [{ address: '93.184.216.34', family: 4 }]),
      createRequest: makeTransport([response]),
    })).rejects.toThrow(/image dimensions/)
  })

  it('rejects a supported image signature with a truncated dimension header', async () => {
    const response = makeResponse({
      headers: { 'content-type': 'image/png' },
      chunks: [ONE_BY_ONE_PNG.subarray(0, 20)],
    })

    await expect(safeHttpFetch('https://image.coupangcdn.com/x', IMAGE_FETCH_POLICY, {
      resolveDns: vi.fn(async () => [{ address: '93.184.216.34', family: 4 }]),
      createRequest: makeTransport([response]),
    })).rejects.toThrow(/image dimensions/)
  })
})
