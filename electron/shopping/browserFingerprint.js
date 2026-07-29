// [[autoflowcut-preserve-agent-source]]
// Preserved reference only: client-hint warmup is unused after the Shopping CDP switch.
// Keep this source and its tests for historical comparison; do not wire it into main.js.
const DEFAULT_ACCEPT_LANGUAGE = 'ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7'
const INSTALLED_SESSIONS = new WeakSet()
const REPLACED_HEADER_NAMES = new Set([
  'user-agent',
  'sec-ch-ua',
  'sec-ch-ua-mobile',
  'sec-ch-ua-platform',
])

const PLATFORM_FINGERPRINTS = {
  darwin: {
    userAgentPlatform: 'Macintosh; Intel Mac OS X 10_15_7',
    clientHintPlatform: 'macOS',
  },
  win32: {
    userAgentPlatform: 'Windows NT 10.0; Win64; x64',
    clientHintPlatform: 'Windows',
  },
  linux: {
    userAgentPlatform: 'X11; Linux x86_64',
    clientHintPlatform: 'Linux',
  },
}

export function createChromeFingerprintHeaders({ chromeVersion, platform }) {
  if (typeof chromeVersion !== 'string' || !/^\d+(?:\.\d+){3}$/.test(chromeVersion)) {
    throw new TypeError('chromeVersion must be a four-part Chromium version')
  }
  const platformFingerprint = PLATFORM_FINGERPRINTS[platform]
  if (!platformFingerprint) throw new TypeError('unsupported Chrome fingerprint platform')

  const major = chromeVersion.split('.')[0]
  return {
    'User-Agent': `Mozilla/5.0 (${platformFingerprint.userAgentPlatform}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chromeVersion} Safari/537.36`,
    'sec-ch-ua': `"Chromium";v="${major}", "Google Chrome";v="${major}", "Not.A/Brand";v="99"`,
    'sec-ch-ua-mobile': '?0',
    'sec-ch-ua-platform': `"${platformFingerprint.clientHintPlatform}"`,
    'Accept-Language': DEFAULT_ACCEPT_LANGUAGE,
  }
}

export function applyChromeFingerprintHeaders(requestHeaders, fingerprintHeaders) {
  const applied = {}
  for (const [name, value] of Object.entries(requestHeaders || {})) {
    if (REPLACED_HEADER_NAMES.has(name.toLowerCase())) continue
    if (/electron/i.test(String(value))) continue
    applied[name] = value
  }

  applied['User-Agent'] = fingerprintHeaders['User-Agent']
  applied['sec-ch-ua'] = fingerprintHeaders['sec-ch-ua']
  applied['sec-ch-ua-mobile'] = fingerprintHeaders['sec-ch-ua-mobile']
  applied['sec-ch-ua-platform'] = fingerprintHeaders['sec-ch-ua-platform']
  const hasAcceptLanguage = Object.keys(applied)
    .some((name) => name.toLowerCase() === 'accept-language')
  if (!hasAcceptLanguage) applied['Accept-Language'] = fingerprintHeaders['Accept-Language']
  return applied
}

export function installShoppingSessionFingerprint(session, { chromeVersion, platform }) {
  if (!session || typeof session !== 'object') throw new TypeError('session is required')
  if (typeof session.webRequest?.onBeforeSendHeaders !== 'function') {
    throw new TypeError('session.webRequest.onBeforeSendHeaders is required')
  }
  if (INSTALLED_SESSIONS.has(session)) return false

  const fingerprintHeaders = createChromeFingerprintHeaders({ chromeVersion, platform })
  session.webRequest.onBeforeSendHeaders((details, callback) => {
    callback({
      requestHeaders: applyChromeFingerprintHeaders(
        details?.requestHeaders,
        fingerprintHeaders,
      ),
    })
  })
  INSTALLED_SESSIONS.add(session)
  return true
}
