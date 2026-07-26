import { lookup as dnsLookup } from 'node:dns/promises'
import * as https from 'node:https'
import { isIP } from 'node:net'
import { createBrotliDecompress, createGunzip, createInflate } from 'node:zlib'

const IPV4_DENY_CIDRS = [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.31.196.0', 24],
  ['192.52.193.0', 24],
  ['192.88.99.0', 24],
  ['192.168.0.0', 16],
  ['192.175.48.0', 24],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
]

const IPV6_DENY_CIDRS = [
  ['::', 128],
  ['::1', 128],
  ['::ffff:0:0', 96],
  ['64:ff9b::', 96],
  ['64:ff9b:1::', 48],
  ['100::', 64],
  ['2001::', 23],
  ['2001:db8::', 32],
  ['2001:20::', 28],
  ['2002::', 16],
  ['2620:4f:8000::', 48],
  ['3ffe::', 16],
  ['3fff::', 20],
  ['fc00::', 7],
  ['fe80::', 10],
  ['ff00::', 8],
]

function parseIpv4(address) {
  return address.split('.').reduce((value, octet) => (value << 8n) | BigInt(octet), 0n)
}

function parseIpv6(address) {
  let normalized = address.toLowerCase()
  const dottedTail = normalized.match(/(?:^|:)(\d+\.\d+\.\d+\.\d+)$/)?.[1]
  if (dottedTail) {
    const ipv4 = Number(parseIpv4(dottedTail))
    const replacement = `${(ipv4 >>> 16).toString(16)}:${(ipv4 & 0xffff).toString(16)}`
    normalized = normalized.slice(0, -dottedTail.length) + replacement
  }

  const halves = normalized.split('::')
  const left = halves[0] ? halves[0].split(':') : []
  const right = halves[1] ? halves[1].split(':') : []
  const groups = halves.length === 2
    ? [...left, ...Array(8 - left.length - right.length).fill('0'), ...right]
    : left

  return groups.reduce((value, group) => (value << 16n) | BigInt(`0x${group || '0'}`), 0n)
}

function isInCidr(value, network, prefix, bits) {
  const shift = BigInt(bits - prefix)
  return (value >> shift) === (network >> shift)
}

export function isPublicAddress(address, family) {
  if (typeof address !== 'string' || address.includes('%') || isIP(address) !== family) return false
  const parse = family === 4 ? parseIpv4 : parseIpv6
  const bits = family === 4 ? 32 : 128
  const value = parse(address)
  if (family === 6 && !isInCidr(value, parseIpv6('2000::'), 3, 128)) return false
  const denyCidrs = family === 4 ? IPV4_DENY_CIDRS : IPV6_DENY_CIDRS
  return !denyCidrs.some(([network, prefix]) => isInCidr(value, parse(network), prefix, bits))
}

export const HTML_FETCH_POLICY = Object.freeze({
  kind: 'html',
  hostAllow: (hostname) => hostname === 'coupang.com' || hostname === 'www.coupang.com',
  maxBytes: 2 * 1024 * 1024,
})

export const IMAGE_FETCH_POLICY = Object.freeze({
  kind: 'image',
  hostAllow: (hostname) => hostname === 'coupangcdn.com' || hostname.endsWith('.coupangcdn.com'),
  maxBytes: 10 * 1024 * 1024,
})

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36'
const DEADLINE_MS = 15_000
const MAX_REDIRECTS = 3

function validatePolicy(policy) {
  if (
    !policy
    || !['html', 'image'].includes(policy.kind)
    || typeof policy.hostAllow !== 'function'
    || !Number.isSafeInteger(policy.maxBytes)
    || policy.maxBytes <= 0
  ) {
    throw new Error('invalid safe fetch policy')
  }
}

function hasForbiddenRawUrlSyntax(rawUrl) {
  const text = String(rawUrl)
  const authority = text.match(/^(?:[a-z][a-z\d+.-]*:)?\/\/([^/?#]*)/i)?.[1]
  return text.includes('\\') || text.includes('#') || authority?.includes('@') === true
}

function validateUrl(rawUrl, policy) {
  if (hasForbiddenRawUrlSyntax(rawUrl)) throw new Error('URL not allowed')
  let url
  try {
    url = new URL(rawUrl)
  } catch {
    throw new Error('URL not allowed: invalid URL')
  }

  const hostname = url.hostname.toLowerCase().replace(/\.$/, '')
  const ipCandidate = hostname.startsWith('[') && hostname.endsWith(']')
    ? hostname.slice(1, -1)
    : hostname
  if (
    url.protocol !== 'https:'
    || (url.port && url.port !== '443')
    || url.username
    || url.password
    || url.hash
    || !hostname
    || isIP(ipCandidate) !== 0
    || typeof policy?.hostAllow !== 'function'
    || !policy.hostAllow(hostname)
  ) {
    throw new Error('URL not allowed')
  }

  url.hostname = hostname
  return url
}

async function defaultResolveDns(hostname) {
  return dnsLookup(hostname, { all: true, verbatim: true })
}

function defaultCreateRequest(urlString, options, onResponse) {
  return https.request(urlString, options, onResponse)
}

function selectPinnedAddress(answers) {
  if (!Array.isArray(answers) || answers.length === 0) {
    throw new Error('empty DNS answer')
  }
  if (answers.some(({ address, family }) => !isPublicAddress(address, family))) {
    throw new Error('non-public DNS address')
  }

  return [...answers].sort((a, b) => {
    if (a.family !== b.family) return a.family - b.family
    const parse = a.family === 4 ? parseIpv4 : parseIpv6
    const left = parse(a.address)
    const right = parse(b.address)
    return left < right ? -1 : left > right ? 1 : 0
  })[0]
}

function fixedHeaders(hostname, kind) {
  return {
    Host: hostname,
    'User-Agent': USER_AGENT,
    Accept: kind === 'image'
      ? 'image/avif,image/webp,image/png,image/jpeg,*/*;q=0.8'
      : 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8',
    'Accept-Encoding': 'gzip, br',
    'Accept-Language': 'ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7',
  }
}

function deadlineError() {
  return new Error('safe fetch deadline exceeded')
}

function remainingTime(deadline, now) {
  const remaining = deadline - now()
  if (remaining <= 0) throw deadlineError()
  return Math.ceil(remaining)
}

function abortable(promise, signal) {
  if (signal.aborted) return Promise.reject(signal.reason || deadlineError())
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      signal.removeEventListener('abort', onAbort)
      reject(signal.reason || deadlineError())
    }
    signal.addEventListener('abort', onAbort, { once: true })
    promise.then(
      (value) => {
        signal.removeEventListener('abort', onAbort)
        resolve(value)
      },
      (error) => {
        signal.removeEventListener('abort', onAbort)
        reject(error)
      },
    )
  })
}

function openPinnedRequest(url, policy, pinned, createRequest, timeout, signal) {
  return new Promise((resolve, reject) => {
    const options = {
      method: 'GET',
      agent: false,
      autoSelectFamily: false,
      rejectUnauthorized: true,
      lookup: (_hostname, _options, callback) => {
        queueMicrotask(() => callback(null, pinned.address, pinned.family))
      },
      servername: url.hostname,
      headers: fixedHeaders(url.hostname, policy.kind),
      timeout,
    }
    let request
    const cleanup = () => signal.removeEventListener('abort', onAbort)
    const onAbort = () => {
      const error = signal.reason || deadlineError()
      request?.destroy(error)
      reject(error)
    }
    request = createRequest(url.toString(), options, (response) => {
      cleanup()
      resolve(response)
    })
    request.once('error', (error) => {
      cleanup()
      reject(error)
    })
    request.once('timeout', () => request.destroy(deadlineError()))
    signal.addEventListener('abort', onAbort, { once: true })
    if (signal.aborted) {
      onAbort()
      return
    }
    request.end()
  })
}

function discardResponse(response) {
  response.destroy?.()
}

function headerValue(headers, name) {
  const value = headers?.[name]
  return typeof value === 'string' ? value : ''
}

function canonicalContentType(response) {
  return headerValue(response.headers, 'content-type').split(';')[0].trim().toLowerCase()
}

function validateResponseHeaders(response, policy) {
  const mimeType = canonicalContentType(response)
  if (policy.kind === 'html') {
    if (mimeType !== 'text/html') throw new Error('unexpected HTML content-type')
  } else if (policy.kind === 'image') {
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(mimeType)) {
      throw new Error('unexpected image content-type')
    }
  } else {
    throw new Error('unsupported fetch policy kind')
  }

  const rawLength = headerValue(response.headers, 'content-length').trim()
  const contentEncoding = headerValue(response.headers, 'content-encoding').trim().toLowerCase()
  const lengthIsDecoded = !contentEncoding || contentEncoding === 'identity'
  if (lengthIsDecoded && /^\d+$/.test(rawLength) && BigInt(rawLength) > BigInt(policy.maxBytes)) {
    throw new Error('response body too large')
  }

  return mimeType
}

function contentDecoder(encoding) {
  if (!encoding || encoding === 'identity') return null
  if (encoding === 'gzip' || encoding === 'x-gzip') return createGunzip()
  if (encoding === 'deflate') return createInflate()
  if (encoding === 'br') return createBrotliDecompress()
  throw new Error('unsupported content-encoding')
}

function readBody(response, signal, maxBytes) {
  return new Promise((resolve, reject) => {
    let decoder
    try {
      decoder = contentDecoder(headerValue(response.headers, 'content-encoding').trim().toLowerCase())
    } catch (error) {
      response.destroy?.()
      reject(error)
      return
    }

    const source = decoder || response
    const chunks = []
    let totalBytes = 0
    let settled = false
    const cleanup = () => signal.removeEventListener('abort', onAbort)
    const fail = (error) => {
      if (settled) return
      settled = true
      cleanup()
      if (source !== response) source.destroy?.()
      response.destroy?.()
      reject(error)
    }
    const onAbort = () => {
      const error = signal.reason || deadlineError()
      fail(error)
    }
    signal.addEventListener('abort', onAbort, { once: true })
    if (signal.aborted) {
      onAbort()
      return
    }
    source.on('data', (chunk) => {
      const buffer = Buffer.from(chunk)
      totalBytes += buffer.length
      if (totalBytes > maxBytes) {
        fail(new Error('response body too large'))
        return
      }
      chunks.push(buffer)
    })
    source.once('error', fail)
    response.once('aborted', () => fail(new Error('response aborted')))
    source.once('end', () => {
      if (settled) return
      settled = true
      cleanup()
      resolve(Buffer.concat(chunks))
    })
    if (decoder) {
      response.once('error', (error) => decoder.destroy(error))
      response.pipe(decoder)
    }
  })
}

function sniffImageMime(body) {
  if (body.length >= 8 && body.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))) {
    return 'image/png'
  }
  if (body.length >= 2 && body[0] === 0xff && body[1] === 0xd8) return 'image/jpeg'
  if (
    body.length >= 12
    && body.subarray(0, 4).toString('ascii') === 'RIFF'
    && body.subarray(8, 12).toString('ascii') === 'WEBP'
  ) {
    return 'image/webp'
  }
  return null
}

function pngDimensions(body) {
  if (body.length < 24 || body.subarray(12, 16).toString('ascii') !== 'IHDR') return null
  return { width: body.readUInt32BE(16), height: body.readUInt32BE(20) }
}

function jpegDimensions(body) {
  let offset = 2
  while (offset + 3 < body.length) {
    if (body[offset] !== 0xff) {
      offset += 1
      continue
    }
    while (body[offset] === 0xff) offset += 1
    const marker = body[offset++]
    if (marker === 0xd8 || marker === 0x01) continue
    if (marker === 0xd9 || marker === 0xda || offset + 1 >= body.length) break
    const segmentLength = body.readUInt16BE(offset)
    if (segmentLength < 2 || offset + segmentLength > body.length) return null
    const isStartOfFrame = marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)
    if (isStartOfFrame) {
      if (segmentLength < 7) return null
      return {
        height: body.readUInt16BE(offset + 3),
        width: body.readUInt16BE(offset + 5),
      }
    }
    offset += segmentLength
  }
  return null
}

function webpDimensions(body) {
  if (body.length < 20) return null
  const chunk = body.subarray(12, 16).toString('ascii')
  if (chunk === 'VP8X' && body.length >= 30) {
    return {
      width: body.readUIntLE(24, 3) + 1,
      height: body.readUIntLE(27, 3) + 1,
    }
  }
  if (
    chunk === 'VP8 '
    && body.length >= 30
    && body[23] === 0x9d
    && body[24] === 0x01
    && body[25] === 0x2a
  ) {
    return {
      width: body.readUInt16LE(26) & 0x3fff,
      height: body.readUInt16LE(28) & 0x3fff,
    }
  }
  if (chunk === 'VP8L' && body.length >= 25 && body[20] === 0x2f) {
    const bits = body.readUInt32LE(21)
    return {
      width: (bits & 0x3fff) + 1,
      height: ((bits >>> 14) & 0x3fff) + 1,
    }
  }
  return null
}

function admitImage(body, mimeType) {
  if (sniffImageMime(body) !== mimeType) throw new Error('image magic does not match content-type')
  const dimensions = mimeType === 'image/png'
    ? pngDimensions(body)
    : mimeType === 'image/jpeg'
      ? jpegDimensions(body)
      : webpDimensions(body)
  if (
    !dimensions
    || dimensions.width <= 0
    || dimensions.height <= 0
    || dimensions.width > 10_000
    || dimensions.height > 10_000
    || dimensions.width * dimensions.height > 25_000_000
  ) {
    throw new Error('image dimensions not allowed')
  }
  return dimensions
}

export async function safeHttpFetch(rawUrl, policy, {
  signal: externalSignal,
  resolveDns = defaultResolveDns,
  createRequest = defaultCreateRequest,
  now = Date.now,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
} = {}) {
  validatePolicy(policy)
  if (externalSignal?.aborted) {
    throw externalSignal.reason || new DOMException('The operation was aborted', 'AbortError')
  }
  const deadline = now() + DEADLINE_MS
  const controller = new AbortController()
  const forwardExternalAbort = () => {
    controller.abort(
      externalSignal.reason || new DOMException('The operation was aborted', 'AbortError'),
    )
  }
  externalSignal?.addEventListener('abort', forwardExternalAbort, { once: true })
  if (externalSignal?.aborted) forwardExternalAbort()
  let deadlineTimer
  let currentUrl = rawUrl
  let redirects = 0

  try {
    deadlineTimer = setTimer(() => controller.abort(deadlineError()), DEADLINE_MS)
    while (true) {
      remainingTime(deadline, now)
      const url = validateUrl(currentUrl, policy)
      const answers = await abortable(Promise.resolve().then(() => resolveDns(url.hostname)), controller.signal)
      const pinned = selectPinnedAddress(answers)
      const response = await openPinnedRequest(
        url,
        policy,
        pinned,
        createRequest,
        remainingTime(deadline, now),
        controller.signal,
      )
      try {
        remainingTime(deadline, now)
      } catch (error) {
        response.destroy?.()
        throw error
      }

      const statusCode = response.statusCode || 0
      if (statusCode >= 300 && statusCode < 400) {
        discardResponse(response)
        const location = response.headers?.location
        if (typeof location !== 'string' || !location) throw new Error('missing redirect location')
        if (redirects >= MAX_REDIRECTS) throw new Error('too many redirects')
        if (hasForbiddenRawUrlSyntax(location)) throw new Error('URL not allowed: invalid redirect')
        try {
          currentUrl = new URL(location, url).toString()
        } catch {
          throw new Error('URL not allowed: invalid redirect')
        }
        redirects += 1
        continue
      }

      if (statusCode < 200 || statusCode >= 300) {
        discardResponse(response)
        throw new Error(`safe fetch HTTP ${statusCode}`)
      }

      let mimeType
      try {
        mimeType = validateResponseHeaders(response, policy)
      } catch (error) {
        response.destroy?.()
        throw error
      }
      const body = await readBody(response, controller.signal, policy.maxBytes)
      remainingTime(deadline, now)
      const dimensions = policy.kind === 'image' ? admitImage(body, mimeType) : {}
      return {
        body,
        headers: response.headers || {},
        mimeType,
        statusCode,
        url: url.toString(),
        ...dimensions,
      }
    }
  } finally {
    if (deadlineTimer !== undefined) clearTimer(deadlineTimer)
    externalSignal?.removeEventListener('abort', forwardExternalAbort)
  }
}
