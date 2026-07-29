// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'

const CHROME_VERSION = '136.0.7103.113'
const ACCEPT_LANGUAGE = 'ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7'

async function loadSubject() {
  return import('../../../electron/shopping/browserFingerprint.js')
}

function makeSession() {
  return {
    webRequest: {
      onBeforeSendHeaders: vi.fn(),
    },
  }
}

describe('browserFingerprint', () => {
  it('Chrome version과 macOS platform으로 UA/client hints를 정확히 만든다', async () => {
    const { createChromeFingerprintHeaders } = await loadSubject()

    expect(createChromeFingerprintHeaders({
      chromeVersion: CHROME_VERSION,
      platform: 'darwin',
    })).toEqual({
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.7103.113 Safari/537.36',
      'sec-ch-ua': '"Chromium";v="136", "Google Chrome";v="136", "Not.A/Brand";v="99"',
      'sec-ch-ua-mobile': '?0',
      'sec-ch-ua-platform': '"macOS"',
      'Accept-Language': ACCEPT_LANGUAGE,
    })
  })

  it.each([
    ['win32', 'Windows NT 10.0; Win64; x64', '"Windows"'],
    ['linux', 'X11; Linux x86_64', '"Linux"'],
  ])('%s에서도 UA와 sec-ch-ua-platform을 같은 OS로 맞춘다', async (
    platform,
    uaPlatform,
    clientHintPlatform,
  ) => {
    const { createChromeFingerprintHeaders } = await loadSubject()

    const headers = createChromeFingerprintHeaders({ chromeVersion: CHROME_VERSION, platform })

    expect(headers['User-Agent']).toContain(`(${uaPlatform})`)
    expect(headers['sec-ch-ua-platform']).toBe(clientHintPlatform)
    expect(headers['sec-ch-ua']).toBe(
      '"Chromium";v="136", "Google Chrome";v="136", "Not.A/Brand";v="99"',
    )
  })

  it('Electron 값과 기존 UA/client hints를 제거하고 Chrome 값으로 치환한다', async () => {
    const {
      applyChromeFingerprintHeaders,
      createChromeFingerprintHeaders,
    } = await loadSubject()
    const fingerprint = createChromeFingerprintHeaders({
      chromeVersion: CHROME_VERSION,
      platform: 'darwin',
    })
    const requestHeaders = {
      'user-agent': 'Mozilla/5.0 Electron/36.9.5',
      'Sec-CH-UA': '"Chromium";v="136", "Electron";v="36"',
      'sec-ch-ua-mobile': '?1',
      'Sec-CH-UA-Platform': '"Unknown"',
      'X-Runtime': 'Electron 36',
      Accept: 'text/html',
      'Sec-Fetch-Site': 'none',
      'Sec-Fetch-Mode': 'navigate',
    }

    const applied = applyChromeFingerprintHeaders(requestHeaders, fingerprint)

    expect(applied).toEqual({
      Accept: 'text/html',
      'Sec-Fetch-Site': 'none',
      'Sec-Fetch-Mode': 'navigate',
      ...fingerprint,
    })
    expect(Object.values(applied).every((value) => !/electron/i.test(value))).toBe(true)
    expect(requestHeaders['X-Runtime']).toBe('Electron 36')
  })

  it('기존 Accept-Language와 Sec-Fetch 헤더는 보존한다', async () => {
    const {
      applyChromeFingerprintHeaders,
      createChromeFingerprintHeaders,
    } = await loadSubject()
    const fingerprint = createChromeFingerprintHeaders({
      chromeVersion: CHROME_VERSION,
      platform: 'linux',
    })

    const applied = applyChromeFingerprintHeaders({
      'accept-language': 'ja-JP,ja;q=0.9',
      'Sec-Fetch-Dest': 'document',
      'Sec-Fetch-Mode': 'navigate',
      'Sec-Fetch-Site': 'none',
      'Sec-Fetch-User': '?1',
    }, fingerprint)

    expect(applied['accept-language']).toBe('ja-JP,ja;q=0.9')
    expect(applied).not.toHaveProperty('Accept-Language')
    expect(applied).toMatchObject({
      'Sec-Fetch-Dest': 'document',
      'Sec-Fetch-Mode': 'navigate',
      'Sec-Fetch-Site': 'none',
      'Sec-Fetch-User': '?1',
    })
  })

  it('shopping Session에만 listener를 설치하고 같은 Session에는 한 번만 등록한다', async () => {
    const { installShoppingSessionFingerprint } = await loadSubject()
    const shoppingSession = makeSession()
    const flowSession = makeSession()
    const defaultSession = makeSession()

    expect(installShoppingSessionFingerprint(shoppingSession, {
      chromeVersion: CHROME_VERSION,
      platform: 'darwin',
    })).toBe(true)
    expect(installShoppingSessionFingerprint(shoppingSession, {
      chromeVersion: CHROME_VERSION,
      platform: 'darwin',
    })).toBe(false)

    expect(shoppingSession.webRequest.onBeforeSendHeaders).toHaveBeenCalledOnce()
    expect(flowSession.webRequest.onBeforeSendHeaders).not.toHaveBeenCalled()
    expect(defaultSession.webRequest.onBeforeSendHeaders).not.toHaveBeenCalled()
  })

  it('onBeforeSendHeaders callback으로 실제 requestHeaders를 교체한다', async () => {
    const { installShoppingSessionFingerprint } = await loadSubject()
    const shoppingSession = makeSession()
    installShoppingSessionFingerprint(shoppingSession, {
      chromeVersion: CHROME_VERSION,
      platform: 'darwin',
    })
    const listener = shoppingSession.webRequest.onBeforeSendHeaders.mock.calls[0][0]
    const callback = vi.fn()

    listener({
      requestHeaders: {
        'User-Agent': 'Electron/36.9.5',
        'sec-ch-ua': '"Electron";v="36"',
        'Sec-Fetch-Mode': 'navigate',
      },
    }, callback)

    expect(callback).toHaveBeenCalledWith({
      requestHeaders: expect.objectContaining({
        'User-Agent': expect.stringContaining('Chrome/136.0.7103.113'),
        'sec-ch-ua': '"Chromium";v="136", "Google Chrome";v="136", "Not.A/Brand";v="99"',
        'sec-ch-ua-mobile': '?0',
        'sec-ch-ua-platform': '"macOS"',
        'Accept-Language': ACCEPT_LANGUAGE,
        'Sec-Fetch-Mode': 'navigate',
      }),
    })
    const sentHeaders = callback.mock.calls[0][0].requestHeaders
    expect(Object.values(sentHeaders).every((value) => !/electron/i.test(value))).toBe(true)
  })
})
