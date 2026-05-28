export const VIDEO_POSTER_CACHE_LIMIT = 100

const posterCache = new Map()
let posterQueue = Promise.resolve()

function cleanupVideo(video) {
  // detached element는 GC되지만, 진행 중인 metadata fetch는 src 제거만으론
  // abort 보장이 약하다. pause → removeAttribute → load 순으로 호출해
  // 브라우저에 명시적 reset 신호를 보낸다 (MDN 권장 패턴).
  try { video.pause?.() } catch {}
  try { video.removeAttribute?.('src') } catch {}
  try { video.load?.() } catch {}
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

function rememberPosterEntry(videoSrc, entry) {
  if (posterCache.has(videoSrc)) posterCache.delete(videoSrc)
  posterCache.set(videoSrc, entry)

  while (posterCache.size > VIDEO_POSTER_CACHE_LIMIT) {
    const oldestKey = posterCache.keys().next().value
    posterCache.delete(oldestKey)
  }
}

// Cache entry는 소비자 signal과 독립.
// signals: 등록된 소비자들의 AbortSignal 집합 (참조 카운팅 — 모두 abort되어야 entry 폐기)
// hasUnsignaled: signal 없이 들어온 소비자가 1명이라도 있으면 true (영구 interest)
// 두 조건 중 하나라도 충족되면 extraction 진행, 둘 다 깨지면 큐 시점에 스킵.
function anyConsumerAlive(entry) {
  if (entry.hasUnsignaled) return true
  for (const s of entry.signals) {
    if (!s.aborted) return true
  }
  return false
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

  let entry = posterCache.get(videoSrc)
  if (entry) {
    // Cache hit — LRU touch + 이 소비자의 interest를 entry에 등록
    posterCache.delete(videoSrc)
    posterCache.set(videoSrc, entry)
    if (signal) entry.signals.add(signal)
    else entry.hasUnsignaled = true
  } else {
    // New entry — extraction promise는 entry.signals/hasUnsignaled를 큐 시점에 평가.
    // 어떤 소비자의 signal도 entry.promise 자체에는 묶이지 않음 → 공유 캐시 안전.
    const newEntry = {
      signals: new Set(),
      hasUnsignaled: !signal,
    }
    if (signal) newEntry.signals.add(signal)

    newEntry.promise = posterQueue
      .then(() => {
        // 큐 시점에 살아있는 소비자가 한 명도 없으면 extraction 스킵 (큐 최적화 유지)
        if (!anyConsumerAlive(newEntry)) return null
        return extractVideoPoster(videoSrc, null)
      })
      .then((poster) => {
        if (!poster) posterCache.delete(videoSrc)
        return poster
      })
      .catch(() => {
        posterCache.delete(videoSrc)
        return null
      })

    rememberPosterEntry(videoSrc, newEntry)
    posterQueue = newEntry.promise.catch(() => null).then(() => undefined)
    entry = newEntry
  }

  // Consumer wrapper — signal abort는 이 소비자의 resolve에만 영향, entry.promise는 무관.
  if (!signal) return entry.promise
  return new Promise((resolve) => {
    if (signal.aborted) { resolve(null); return }
    const onAbort = () => resolve(null)
    signal.addEventListener('abort', onAbort, { once: true })
    entry.promise.then((poster) => {
      signal.removeEventListener('abort', onAbort)
      resolve(poster)
    })
  })
}

export function clearVideoPosterCacheForTests() {
  posterCache.clear()
  posterQueue = Promise.resolve()
}
