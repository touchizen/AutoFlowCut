const posterCache = new Map()
let posterQueue = Promise.resolve()

function cleanupVideo(video) {
  try { video.pause?.() } catch {}
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

function extractVideoPoster(videoSrc) {
  return new Promise((resolve) => {
    if (!videoSrc || typeof document === 'undefined') {
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
      cleanupVideo(video)
      resolve(poster || null)
    }

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
    video.addEventListener('loadedmetadata', () => {
      const duration = Number.isFinite(video.duration) ? video.duration : 0
      targetTime = duration > 0 ? Math.min(0.1, duration / 2) : 0
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

export function getVideoPoster(videoSrc) {
  if (!videoSrc) return Promise.resolve(null)
  if (posterCache.has(videoSrc)) return posterCache.get(videoSrc)

  const promise = posterQueue
    .then(() => extractVideoPoster(videoSrc))
    .catch(() => null)

  posterCache.set(videoSrc, promise)
  posterQueue = promise.catch(() => null).then(() => undefined)
  return promise
}

export function clearVideoPosterCacheForTests() {
  posterCache.clear()
  posterQueue = Promise.resolve()
}
