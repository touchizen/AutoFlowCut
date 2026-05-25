export const VIDEO_POSTER_CACHE_LIMIT = 100

const posterCache = new Map()
let posterQueue = Promise.resolve()

function cleanupVideo(video) {
  try { video.removeAttribute?.('src') } catch {}
}

function captureFrame(video) {
  if (!video.videoWidth || !video.videoHeight) return null

  const maxEdge = 320
  const scale = Math.min(1, maxEdge / Math.max(video.videoWidth, video.videoHeight))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(video.videoWidth * scale))
  canvas.height = Math.max(1, Math.round(video.videoHeight * scale))

  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
  return canvas.toDataURL('image/jpeg', 0.72)
}

function getCaptureTime(duration) {
  if (!Number.isFinite(duration) || duration <= 0) return 0
  const preferred = Math.min(1, Math.max(0.5, duration * 0.1))
  return Math.min(preferred, Math.max(0, duration - 0.05))
}

function rememberPosterPromise(videoSrc, promise, signal) {
  if (posterCache.has(videoSrc)) posterCache.delete(videoSrc)
  posterCache.set(videoSrc, { promise, signal })

  while (posterCache.size > VIDEO_POSTER_CACHE_LIMIT) {
    const oldestKey = posterCache.keys().next().value
    posterCache.delete(oldestKey)
  }
}

function extractVideoPoster(videoSrc, signal) {
  return new Promise((resolve) => {
    if (!videoSrc || signal?.aborted || typeof document === 'undefined') {
      resolve(null)
      return
    }

    const video = document.createElement('video')
    let settled = false
    let targetTime = 0
    let timeoutId = null

    const done = (poster) => {
      if (settled) return
      settled = true
      if (timeoutId) clearTimeout(timeoutId)
      signal?.removeEventListener?.('abort', abort)
      cleanupVideo(video)
      resolve(poster || null)
    }

    const abort = () => done(null)

    const capture = () => {
      try {
        done(captureFrame(video))
      } catch {
        done(null)
      }
    }

    video.muted = true
    video.playsInline = true
    video.preload = 'metadata'
    if (/^https?:\/\//i.test(videoSrc)) {
      video.crossOrigin = 'anonymous'
    }
    signal?.addEventListener?.('abort', abort, { once: true })
    video.addEventListener('loadedmetadata', () => {
      targetTime = getCaptureTime(video.duration)
      if (targetTime > 0.01) {
        try {
          video.currentTime = targetTime
        } catch {
          capture()
        }
      }
    }, { once: true })
    video.addEventListener('loadeddata', () => {
      if (targetTime <= 0.01) capture()
    }, { once: true })
    video.addEventListener('seeked', capture, { once: true })
    video.addEventListener('error', () => done(null), { once: true })

    timeoutId = setTimeout(() => done(null), 6000)
    video.src = videoSrc
  })
}

export function getVideoPoster(videoSrc, options = {}) {
  if (!videoSrc) return Promise.resolve(null)
  const { signal } = options
  if (signal?.aborted) return Promise.resolve(null)
  if (posterCache.has(videoSrc)) {
    const cached = posterCache.get(videoSrc)
    if (cached?.signal?.aborted) {
      posterCache.delete(videoSrc)
    } else {
      posterCache.delete(videoSrc)
      posterCache.set(videoSrc, cached)
      return cached.promise
    }
  }

  const promise = posterQueue
    .then(() => {
      if (signal?.aborted) return null
      return extractVideoPoster(videoSrc, signal)
    })
    .then((poster) => {
      if (!poster) posterCache.delete(videoSrc)
      return poster
    })
    .catch(() => {
      posterCache.delete(videoSrc)
      return null
    })

  rememberPosterPromise(videoSrc, promise, signal)
  posterQueue = promise.catch(() => null).then(() => undefined)
  return promise
}

export function clearVideoPosterCacheForTests() {
  posterCache.clear()
  posterQueue = Promise.resolve()
}
