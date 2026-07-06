import nodeFs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'

const SAMPLE = { ko: '안녕하세요, 반갑습니다.', en: 'Hello, nice to meet you.' }
const EXT = { 'audio/wav': 'wav', 'audio/mpeg': 'mp3' }
const MIME = { wav: 'audio/wav', mp3: 'audio/mpeg' }

export function createVoicePreviewService({ cacheDir, fs = nodeFs, ttsFor, voiceMeta, ssrfSafeFetch, fetch }) {
  const inflight = new Map()

  function cachePath(provider, voiceId, language, ext) {
    const h = crypto.createHash('sha256').update(`${provider}:${voiceId}:${language}`).digest('hex')
    return path.join(cacheDir, `${h}.${ext}`)
  }

  async function produce({ provider, voiceId, language }) {
    const meta = voiceMeta(provider, voiceId) || {}
    const lang = language || meta.language || 'ko'
    // 1) disk cache (both ext)
    for (const ext of ['wav', 'mp3']) {
      const p = cachePath(provider, voiceId, lang, ext)
      if (fs.existsSync(p)) return { audioBase64: fs.readFileSync(p).toString('base64'), mimeType: MIME[ext] }
    }
    // 2) elevenlabs preview_url
    let audio, mimeType
    if (provider === 'elevenlabs' && meta.previewUrl) {
      const r = await ssrfSafeFetch(meta.previewUrl, { fetch })
      audio = r.audio; mimeType = r.mimeType
    } else {
      const r = await ttsFor(provider).synthesize({ text: SAMPLE[lang] || SAMPLE.ko, voiceId, emotion: 'normal' })
      audio = r.audio; mimeType = MIME[r.format] || 'audio/wav'
    }
    // 3) atomic write cache
    const ext = EXT[mimeType] || 'wav'
    const p = cachePath(provider, voiceId, lang, ext)
    try {
      fs.mkdirSync(cacheDir, { recursive: true })
      const tmp = p + '.tmp'
      fs.writeFileSync(tmp, audio)
      fs.renameSync(tmp, p)
    } catch { /* best-effort */ }
    return { audioBase64: audio.toString('base64'), mimeType }
  }

  async function getPreview({ provider, voiceId, language }) {
    const key = `${provider}:${voiceId}:${language}`
    if (inflight.has(key)) return inflight.get(key)
    const promise = produce({ provider, voiceId, language })
      .catch((e) => {
        const msg = String(e?.message || e)
        const error = /no .* key|No .* API key/i.test(msg) ? 'no-key' : /401|unauth/i.test(msg) ? 'unauthorized' : 'failed'
        return { error, provider }
      })
      .finally(() => inflight.delete(key))
    inflight.set(key, promise)
    return promise
  }

  return { getPreview }
}
