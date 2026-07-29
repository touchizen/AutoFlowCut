const JSON_LD_LIMIT = 512 * 1024
const JSON_LD_COUNT_LIMIT = 32
const META_CONTENT_LIMIT = 5_000
const META_VALUES_PER_PROPERTY = 20
const SOURCE_URL_LIMIT = 2_048
const PARSER_HTML_LIMIT = 2 * 1024 * 1024
const PRODUCT_PATH = /^\/vp\/products\/\d+\/?$/
const FAIL_FAST_NETWORK_ERROR_CODES = new Set([
  'ERR_NAME_NOT_RESOLVED',
  'ERR_INTERNET_DISCONNECTED',
  'ERR_CONNECTION_REFUSED',
  'ERR_CONNECTION_RESET',
  'ERR_CONNECTION_CLOSED',
  'ERR_CONNECTION_ABORTED',
  'ERR_CONNECTION_FAILED',
  'ERR_CONNECTION_TIMED_OUT',
  'ERR_TIMED_OUT',
  'ERR_ADDRESS_UNREACHABLE',
  'ERR_NETWORK_CHANGED',
  'ERR_PROXY_CONNECTION_FAILED',
  'ERR_TUNNEL_CONNECTION_FAILED',
  'ERR_NAME_RESOLUTION_FAILED',
])

const META_PROPERTIES = new Set([
  'og:title',
  'og:description',
  'og:image',
  'product:price:amount',
  'product:price:currency',
  'og:url',
])
const META_ENTRY_LIMIT = META_PROPERTIES.size * META_VALUES_PER_PROPERTY

// These run inside the untrusted page. Keep them self-contained anonymous IIFEs:
// bundler/minifier symbol names from the main process must never leak into them.
const READINESS_PROBE = `(() => {
  try {
    if (!/^\\/vp\\/products\\/\\d+\\/?$/.test(location.pathname)) return false;
    if (document.querySelector('meta[property="og:title"][content]')) return true;
    return Array.from(document.querySelectorAll('script[type="application/ld+json"]'))
      .slice(0, 32)
      .some((element) => /["']@type["']\\s*:\\s*(?:["']Product["']|\\[[^\\]]*["']Product["'])/i
        .test((element.textContent || '').slice(0, 524288)));
  } catch {
    return false;
  }
})()`

const EXTRACTION_PROBE = `(() => {
  const properties = new Set([
    'og:title', 'og:description', 'og:image', 'product:price:amount',
    'product:price:currency', 'og:url'
  ]);
  const jsonLd = [];
  for (const element of document.querySelectorAll('script[type="application/ld+json"]')) {
    if (jsonLd.length >= 32) break;
    const text = element.textContent;
    if (typeof text === 'string' && text.length <= 524288) jsonLd.push(text);
  }
  const meta = [];
  const counts = Object.create(null);
  for (const element of document.querySelectorAll('meta[property][content]')) {
    const property = (element.getAttribute('property') || '').trim().toLowerCase();
    const content = element.getAttribute('content');
    if (!properties.has(property) || typeof content !== 'string' || content.length > 5000) continue;
    counts[property] = counts[property] || 0;
    if (counts[property] >= 20) continue;
    counts[property] += 1;
    meta.push({ property, content });
  }
  return {
    jsonLd,
    meta,
    url: String(location.href),
    readyState: String(document.readyState)
  };
})()`

function abortError(reason = 'The operation was aborted') {
  if (reason?.name === 'AbortError') return reason
  const message = typeof reason?.message === 'string' ? reason.message : String(reason)
  return new DOMException(message, 'AbortError')
}

function crawlFailure(code, cause) {
  const error = new Error(code)
  error.code = code
  if (cause !== undefined) error.cause = cause
  return error
}

function stoppedError(record, signal) {
  if (signal?.aborted) return abortError(signal.reason)
  const reason = record.controller.signal.reason
  return reason instanceof Error ? reason : abortError(reason)
}

function validateHtmlPolicy(policy) {
  if (
    !policy
    || policy.kind !== 'html'
    || typeof policy.hostAllow !== 'function'
    || !Number.isSafeInteger(policy.maxBytes)
    || policy.maxBytes <= 0
  ) {
    throw new Error('invalid browser product fetch policy')
  }
}

export function validateInitialProductUrl(rawUrl, policy) {
  validateHtmlPolicy(policy)
  if (
    typeof rawUrl !== 'string'
    || rawUrl.length > SOURCE_URL_LIMIT
    || rawUrl.includes('\\')
    || rawUrl.includes('#')
  ) {
    throw new Error('URL not allowed')
  }

  const authority = rawUrl.match(/^https:\/\/([^/?#]+)/i)?.[1]?.toLowerCase()
  if (authority !== 'coupang.com' && authority !== 'www.coupang.com') {
    throw new Error('URL not allowed')
  }

  let url
  try {
    url = new URL(rawUrl)
  } catch {
    throw new Error('URL not allowed: invalid URL')
  }
  const hostname = url.hostname.toLowerCase()
  if (
    url.protocol !== 'https:'
    || url.port
    || url.username
    || url.password
    || url.hash
    || !policy.hostAllow(hostname)
    || !PRODUCT_PATH.test(url.pathname)
  ) {
    throw new Error('URL not allowed')
  }
  return url
}

function allowedNavigationUrl(rawUrl) {
  try {
    const url = new URL(rawUrl)
    const hostname = url.hostname.toLowerCase()
    return url.protocol === 'https:'
      && !url.port
      && !url.username
      && !url.password
      && (hostname === 'coupang.com' || hostname.endsWith('.coupang.com'))
  } catch {
    return false
  }
}

function escapeMetaContent(value) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

function validateExtraction(extraction) {
  let sourceUrl
  try {
    sourceUrl = new URL(extraction?.url)
  } catch {
    sourceUrl = null
  }
  if (
    !extraction
    || typeof extraction !== 'object'
    || Array.isArray(extraction)
    || !Array.isArray(extraction.jsonLd)
    || !Array.isArray(extraction.meta)
    || typeof extraction.url !== 'string'
    || extraction.url.length > SOURCE_URL_LIMIT
    || !['loading', 'interactive', 'complete'].includes(extraction.readyState)
    || !allowedNavigationUrl(extraction.url)
    || !PRODUCT_PATH.test(sourceUrl?.pathname)
  ) {
    throw new Error('invalid browser extraction')
  }

  const jsonLd = []
  for (const value of extraction.jsonLd.slice(0, JSON_LD_COUNT_LIMIT)) {
    if (
      typeof value !== 'string'
      || value.length > JSON_LD_LIMIT
    ) continue
    jsonLd.push(value)
  }

  const counts = new Map()
  const meta = []
  for (const entry of extraction.meta.slice(0, META_ENTRY_LIMIT)) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue
    const property = typeof entry.property === 'string' ? entry.property.toLowerCase() : ''
    const content = entry.content
    const count = counts.get(property) || 0
    if (
      !META_PROPERTIES.has(property)
      || typeof content !== 'string'
      || !content.trim()
      || content.length > META_CONTENT_LIMIT
      || count >= META_VALUES_PER_PROPERTY
    ) continue
    counts.set(property, count + 1)
    meta.push({ property, content })
  }

  return { jsonLd, meta, sourceUrl: sourceUrl.toString() }
}

export function buildMinimalProductHtml(extraction, maxBytes = PARSER_HTML_LIMIT) {
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) {
    throw new TypeError('maxBytes must be a positive safe integer')
  }
  const { jsonLd, meta } = validateExtraction(extraction)
  const admittedBytes = Math.min(maxBytes, PARSER_HTML_LIMIT)
  const opening = '<!doctype html><html><head>'
  const closing = '</head><body></body></html>'
  const pieces = [opening]
  let byteLength = Buffer.byteLength(opening) + Buffer.byteLength(closing)

  const appendWithinLimit = (piece) => {
    const pieceBytes = Buffer.byteLength(piece)
    if (byteLength + pieceBytes > admittedBytes) return false
    pieces.push(piece)
    byteLength += pieceBytes
    return true
  }

  for (const { property, content } of meta) {
    appendWithinLimit(`<meta property="${property}" content="${escapeMetaContent(content)}">`)
  }
  for (const value of jsonLd) {
    const safeJsonLd = value.replaceAll('<', '\\u003c')
    appendWithinLimit(`<script type="application/ld+json">${safeJsonLd}</script>`)
  }
  pieces.push(closing)
  return pieces.join('')
}

function chromeUserAgent() {
  const chromeVersion = process.versions.chrome
  if (typeof chromeVersion !== 'string' || !/^\d+(?:\.\d+){3}$/.test(chromeVersion)) {
    throw new Error('Chromium version unavailable')
  }
  const platform = process.platform === 'darwin'
    ? 'Macintosh; Intel Mac OS X 10_15_7'
    : process.platform === 'win32'
      ? 'Windows NT 10.0; Win64; x64'
      : 'X11; Linux x86_64'
  return `Mozilla/5.0 (${platform}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chromeVersion} Safari/537.36`
}

function normalizeBounds(bounds) {
  if (!bounds || typeof bounds !== 'object') throw new Error('crawl view bounds unavailable')
  const normalized = {}
  for (const key of ['x', 'y', 'width', 'height']) {
    if (!Number.isFinite(bounds[key])) throw new Error('invalid crawl view bounds')
    normalized[key] = Math.round(bounds[key])
  }
  if (
    normalized.x === 0
    && normalized.y === 0
    && normalized.width === 0
    && normalized.height === 0
  ) {
    return normalized
  }
  if (normalized.width <= 0 || normalized.height <= 0) throw new Error('invalid crawl view bounds')
  return normalized
}

function waitForPoll(ms, record, signal, isActive) {
  return new Promise((resolve, reject) => {
    let timer
    const cleanup = () => {
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
      record.controller.signal.removeEventListener('abort', onAbort)
    }
    const onAbort = () => {
      cleanup()
      reject(stoppedError(record, signal))
    }
    if (signal?.aborted || record.controller.signal.aborted || !isActive()) {
      onAbort()
      return
    }
    signal?.addEventListener('abort', onAbort, { once: true })
    record.controller.signal.addEventListener('abort', onAbort, { once: true })
    timer = setTimeout(() => {
      cleanup()
      if (!isActive()) reject(abortError('Crawl superseded'))
      else resolve()
    }, ms)
  })
}

function waitForOperation(operation, record, signal, isActive) {
  return new Promise((resolve, reject) => {
    let settled = false
    const cleanup = () => {
      signal?.removeEventListener('abort', onAbort)
      record.controller.signal.removeEventListener('abort', onAbort)
    }
    const finish = (handler, value) => {
      if (settled) return
      settled = true
      cleanup()
      handler(value)
    }
    const onAbort = () => finish(
      reject,
      stoppedError(record, signal),
    )
    if (signal?.aborted || record.controller.signal.aborted || !isActive()) {
      onAbort()
      return
    }
    signal?.addEventListener('abort', onAbort, { once: true })
    record.controller.signal.addEventListener('abort', onAbort, { once: true })
    Promise.resolve(operation).then(
      (value) => {
        if (!isActive()) finish(reject, abortError('Crawl superseded'))
        else finish(resolve, value)
      },
      (error) => finish(reject, error),
    )
  })
}

export function createBrowserProductFetch({
  getWindow,
  createView,
  getBounds,
  emitStatus,
  onViewClosed,
  now = Date.now,
  pollIntervalMs = 500,
  challengeAfterMs = 15_000,
  hardTimeoutMs = 120_000,
} = {}) {
  if (typeof getWindow !== 'function') throw new TypeError('getWindow must be a function')
  if (typeof createView !== 'function') throw new TypeError('createView must be a function')
  if (typeof getBounds !== 'function') throw new TypeError('getBounds must be a function')
  if (typeof emitStatus !== 'function') throw new TypeError('emitStatus must be a function')
  if (onViewClosed !== undefined && typeof onViewClosed !== 'function') {
    throw new TypeError('onViewClosed must be a function')
  }
  if (typeof now !== 'function') throw new TypeError('now must be a function')
  if (!Number.isFinite(pollIntervalMs) || pollIntervalMs <= 0) {
    throw new TypeError('pollIntervalMs must be positive')
  }
  if (!Number.isFinite(challengeAfterMs) || challengeAfterMs < 0) {
    throw new TypeError('challengeAfterMs must not be negative')
  }
  if (!Number.isFinite(hardTimeoutMs) || hardTimeoutMs <= 0) {
    throw new TypeError('hardTimeoutMs must be positive')
  }

  let lease = 0
  let activeRecord = null

  return async function browserProductFetch(rawUrl, policy, { signal } = {}) {
    if (signal?.aborted) throw abortError(signal.reason)
    const initialUrl = validateInitialProductUrl(rawUrl, policy)
    const startedAt = Number(now())
    if (!Number.isFinite(startedAt)) throw new TypeError('now() must return a timestamp')

    if (activeRecord) {
      activeRecord.controller.abort(abortError('Crawl superseded'))
      activeRecord.cleanup?.()
    }

    const record = {
      lease: ++lease,
      controller: new AbortController(),
      view: null,
      win: null,
      attached: false,
      cleaned: false,
      cleanup: null,
      downloadHandler: null,
      hardTimeoutTimer: null,
      renderCrashHandler: null,
    }
    activeRecord = record
    const isActive = () => activeRecord === record && record.lease === lease
    const throwIfStopped = () => {
      if (signal?.aborted) throw abortError(signal.reason)
      if (record.controller.signal.aborted || !isActive()) {
        throw stoppedError(record, signal)
      }
    }
    const remainingHardTimeout = () => {
      const currentTime = Number(now())
      if (!Number.isFinite(currentTime)) throw new TypeError('now() must return a timestamp')
      const remaining = hardTimeoutMs - (currentTime - startedAt)
      if (remaining <= 0) {
        const error = crawlFailure('product-fetch-timeout')
        if (!record.controller.signal.aborted) record.controller.abort(error)
        throw error
      }
      return remaining
    }
    const sendStatus = (status) => {
      throwIfStopped()
      emitStatus(status)
    }
    const cleanup = () => {
      if (record.cleaned) return
      record.cleaned = true
      clearTimeout(record.hardTimeoutTimer)
      if (!record.controller.signal.aborted) {
        record.controller.abort(abortError('Crawl closed'))
      }
      if (record.renderCrashHandler) {
        record.view?.webContents?.removeListener?.('render-process-gone', record.renderCrashHandler)
        record.view?.webContents?.removeListener?.('crashed', record.renderCrashHandler)
      }
      const session = record.view?.webContents?.session
      if (record.downloadHandler) {
        if (typeof session?.removeListener === 'function') {
          session.removeListener('will-download', record.downloadHandler)
        } else {
          session?.off?.('will-download', record.downloadHandler)
        }
      }
      if (record.attached) {
        try { record.win?.contentView?.removeChildView(record.view) } catch {}
        record.attached = false
      }
      try { record.view?.webContents?.close() } catch {}
      try { onViewClosed?.(record.view) } catch {}
      if (activeRecord === record) activeRecord = null
    }
    record.cleanup = cleanup
    record.hardTimeoutTimer = setTimeout(() => {
      if (record.cleaned) return
      const error = crawlFailure('product-fetch-timeout')
      record.controller.abort(error)
      cleanup()
    }, hardTimeoutMs)

    const onExternalAbort = () => {
      record.controller.abort(abortError(signal?.reason))
      cleanup()
    }
    signal?.addEventListener('abort', onExternalAbort, { once: true })

    try {
      record.win = getWindow()
      if (!record.win || record.win.isDestroyed?.() || !record.win.contentView) {
        throw new Error('main window unavailable')
      }
      record.view = createView()
      const webContents = record.view?.webContents
      if (!webContents) throw new Error('crawl view unavailable')

      record.renderCrashHandler = () => {
        if (record.cleaned) return
        const error = crawlFailure('product-render-process-gone')
        record.controller.abort(error)
        cleanup()
      }
      webContents.on('render-process-gone', record.renderCrashHandler)
      webContents.on('crashed', record.renderCrashHandler)

      const guardNavigation = (details) => {
        if (details.isMainFrame !== false && !allowedNavigationUrl(details.url)) {
          details.preventDefault()
        }
      }
      webContents.on('will-navigate', guardNavigation)
      webContents.on('will-redirect', guardNavigation)
      webContents.on('will-frame-navigate', guardNavigation)
      webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
      webContents.session?.setPermissionRequestHandler((_contents, _permission, callback) => {
        callback(false)
      })
      record.downloadHandler = (event) => event.preventDefault()
      webContents.session?.on?.('will-download', record.downloadHandler)

      webContents.setUserAgent(chromeUserAgent())
      record.view.setBounds(normalizeBounds(getBounds()))
      record.win.contentView.addChildView(record.view)
      record.attached = true
      sendStatus('loading')
      remainingHardTimeout()

      Promise.resolve()
        .then(() => webContents.loadURL(initialUrl.toString()))
        .catch((error) => {
          if (record.cleaned || record.controller.signal.aborted) return
          if (FAIL_FAST_NETWORK_ERROR_CODES.has(error?.code)) {
            const failure = crawlFailure('product-fetch-failed', error)
            record.controller.abort(failure)
            cleanup()
            return
          }
          // Unverified in this environment: Electron 36 is expected to reject rendered 4xx
          // pages, and Coupang may serve its usable challenge UI as 403/429. Readiness—not
          // loadURL—is therefore authoritative for every non-network rejection in this spike.
          console.debug(
            '[Shopping crawl] loadURL rejected; readiness polling continues:',
            error?.message,
          )
        })

      let challenged = false
      while (true) {
        const pollDelay = challenged ? 1_000 : pollIntervalMs
        await waitForPoll(
          Math.max(1, Math.min(pollDelay, Math.ceil(remainingHardTimeout()))),
          record,
          signal,
          isActive,
        )
        throwIfStopped()
        remainingHardTimeout()
        let ready = false
        try {
          ready = Boolean(await waitForOperation(
            webContents.executeJavaScript(READINESS_PROBE),
            record,
            signal,
            isActive,
          ))
        } catch {
          throwIfStopped()
        }
        throwIfStopped()
        remainingHardTimeout()
        if (!ready) {
          if (!challenged && Number(now()) - startedAt >= challengeAfterMs) {
            challenged = true
            sendStatus('challenge')
          }
          continue
        }

        remainingHardTimeout()
        sendStatus('extracting')
        let extraction
        try {
          extraction = await waitForOperation(
            webContents.executeJavaScript(EXTRACTION_PROBE),
            record,
            signal,
            isActive,
          )
        } catch {
          throwIfStopped()
          remainingHardTimeout()
          if (!challenged && Number(now()) - startedAt >= challengeAfterMs) {
            challenged = true
            sendStatus('challenge')
          }
          continue
        }
        throwIfStopped()
        remainingHardTimeout()
        const html = buildMinimalProductHtml(extraction, Math.min(policy.maxBytes, PARSER_HTML_LIMIT))
        const { sourceUrl } = validateExtraction(extraction)
        return { body: Buffer.from(html), url: sourceUrl }
      }
    } finally {
      signal?.removeEventListener('abort', onExternalAbort)
      cleanup()
    }
  }
}
