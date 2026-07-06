const ALLOW_HOSTS = [
  'api.elevenlabs.io',
  'storage.googleapis.com', // ElevenLabs public preview CDN
]
const PRIVATE_RE = /^(10\.|127\.|0\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|::1|fc|fd|fe80)/i

export function isPreviewUrlAllowed(rawUrl) {
  let u
  try { u = new URL(rawUrl) } catch { return false }
  if (u.protocol !== 'https:') return false
  if (PRIVATE_RE.test(u.hostname)) return false
  return ALLOW_HOSTS.includes(u.hostname)
}

const MAX_BYTES = 5 * 1024 * 1024
const MAX_REDIRECTS = 5

export async function ssrfSafeFetch(url, { fetch, timeoutMs = 15000, hops = 0 } = {}) {
  if (!isPreviewUrlAllowed(url)) throw new Error('preview url not allowed')
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const res = await fetch(url, { redirect: 'manual', signal: ctrl.signal })
    if (res.status >= 300 && res.status < 400) {
      if (hops >= MAX_REDIRECTS) throw new Error('too many redirects')
      const loc = res.headers.get('location')
      if (!loc || !isPreviewUrlAllowed(loc)) throw new Error('redirect not allowed')
      return ssrfSafeFetch(loc, { fetch, timeoutMs, hops: hops + 1 })
    }
    if (!res.ok) throw new Error(`preview fetch ${res.status}`)
    const rawCt = res.headers.get('content-type') || 'audio/mpeg'
    const mimeType = rawCt.split(';')[0].trim().toLowerCase()
    if (!/^audio\//.test(mimeType)) throw new Error('unexpected content-type')
    // Up-front check using content-length so we never buffer an oversized body.
    // Only honor a strictly-formed unsigned decimal integer; anything malformed
    // (non-numeric, negative, signed) falls through to the post-read backstop.
    const clRaw = res.headers.get('content-length')
    if (clRaw != null && /^\d+$/.test(clRaw.trim())) {
      const declaredLength = Number(clRaw.trim())
      if (declaredLength > MAX_BYTES) throw new Error('preview too large')
    }
    const buf = Buffer.from(await res.arrayBuffer())
    // Backstop for missing/lying content-length.
    if (buf.length > MAX_BYTES) throw new Error('preview too large')
    return { audio: buf, mimeType }
  } finally { clearTimeout(t) }
}
