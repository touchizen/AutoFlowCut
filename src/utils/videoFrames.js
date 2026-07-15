/**
 * 비디오 다중 프레임 추출 (스펙 D12).
 *
 * 🔴 기존 poster 단발 로직(`videoPoster.js`)을 늘리지 않는다 — 시각 산출과 추출을 분리한다.
 *    이 앱엔 sharp/jimp/ffmpeg 가 없어(D11) 실제 decode 는 Chromium `<video>`+canvas 뿐이라
 *    renderer 에서만 돈다. 순수 `frameTimes` 만 `[U]`, 추출은 `[P]`.
 */

/**
 * n개 프레임을 균등 간격 `(i+1)/(n+1)*duration` 초에 배치한다.
 * 양끝(0초/끝)은 검은 프레임/페이드가 잦아 피한다.
 *
 * @returns {number[]} 초 단위 시각. duration 이 유한 양수가 아니거나 n<=0 이면 빈 배열.
 */
export function frameTimes(duration, n) {
  if (!Number.isFinite(duration) || duration <= 0 || !Number.isInteger(n) || n <= 0) return []
  return Array.from({ length: n }, (_v, i) => ((i + 1) / (n + 1)) * duration)
}

/**
 * off-DOM `<video>` + canvas 로 n개 프레임을 JPEG data 로 뽑는다 (Chromium 전용).
 * duration 은 로드 후에야 알 수 있으므로 `frameTimes(duration, n)` 을 내부에서 계산한다.
 * 긴 변이 maxEdge 를 넘으면 aspect 보존 축소. `[P]` 로 검증한다 (slice 37).
 *
 * @param {string} src file:///앱 프로토콜 URL.
 * @param {{n:number, maxEdge:number}} opts
 * @returns {Promise<Array<{timeMs:number, data:string, mimeType:string}>>} base64 JPEG.
 */
export async function extractVideoFrames(src, { n = 0, maxEdge = 768 } = {}) {
  if (!src || !Number.isInteger(n) || n <= 0) return []
  const video = document.createElement('video')
  video.muted = true
  video.preload = 'auto'
  video.src = src

  await new Promise((resolve, reject) => {
    video.onloadedmetadata = () => resolve()
    video.onerror = () => reject(new Error('video-load-failed'))
  })

  const times = frameTimes(video.duration, n)
  if (times.length === 0) { video.src = ''; return [] }

  const { videoWidth: w, videoHeight: h } = video
  const scale = Math.max(w, h) > maxEdge ? maxEdge / Math.max(w, h) : 1
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(w * scale)
  canvas.height = Math.round(h * scale)
  const ctx = canvas.getContext('2d')

  const seekTo = (t) => new Promise((resolve, reject) => {
    video.onseeked = () => resolve()
    video.onerror = () => reject(new Error('video-seek-failed'))
    video.currentTime = t
  })

  const frames = []
  for (const t of times) {
    await seekTo(t)
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
    const dataUrl = canvas.toDataURL('image/jpeg', 0.85)
    frames.push({ timeMs: Math.round(t * 1000), data: dataUrl.split(',')[1], mimeType: 'image/jpeg' })
  }
  video.src = ''
  return frames
}
