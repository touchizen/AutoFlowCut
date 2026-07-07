const PRIVATE_RE = /^(10\.|127\.|0\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|::1|fc|fd|fe80)/i

export function isPreviewUrlAllowed(rawUrl) {
  let u
  try { u = new URL(rawUrl) } catch { return false }
  if (u.protocol !== 'https:') return false
  if (PRIVATE_RE.test(u.hostname)) return false
  const host = u.hostname
  // storage.googleapis.com: ElevenLabs public preview CDN (exact match).
  // elevenlabs.io + regional API subdomains (e.g. api.us.elevenlabs.io) serve preview_urls too.
  return host === 'storage.googleapis.com' || host === 'elevenlabs.io' || host.endsWith('.elevenlabs.io')
}

const MAX_BYTES = 5 * 1024 * 1024
const MAX_REDIRECTS = 5

function sniffAudioMime(buf) {
  if (!buf || buf.length < 4) return null
  if (buf.subarray(0, 3).toString('latin1') === 'ID3') return 'audio/mpeg'
  if (buf[0] === 0xff && (buf[1] & 0xe0) === 0xe0) return 'audio/mpeg'
  if (buf.length >= 12 && buf.subarray(0, 4).toString('latin1') === 'RIFF' && buf.subarray(8, 12).toString('latin1') === 'WAVE') return 'audio/wav'
  if (buf.subarray(0, 4).toString('latin1') === 'OggS') return 'audio/ogg'
  if (buf.length >= 12 && buf.subarray(4, 8).toString('latin1') === 'ftyp') return 'audio/mp4'
  return null
}

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
    let mimeType = rawCt.split(';')[0].trim().toLowerCase()
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
    if (!/^audio\//.test(mimeType)) {
      const sniffed = sniffAudioMime(buf)
      if (!sniffed) throw new Error('unexpected content-type')
      mimeType = sniffed
    }
    return { audio: buf, mimeType }
  } finally { clearTimeout(t) }
}
