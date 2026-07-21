// audioTracks 4형태 + sfxItems + 선택 비디오 오디오 → 렌더 클립 정규화. 스펙 §2.2/§4.6.
// 이 경계 뒤의 buildRenderPlan은 아래 shape을 재정규화하지 않고 그대로 소비한다.
// 반환: [{ filename?, path, startMs, durationMs, gain }]
import { createVideoAudioProbe } from './videoAudioProbe.js'

const NARRATION_GAIN = 1.0
const SFX_GAIN = 0.7
const VIDEO_GAIN = 1.0

export async function adaptAudioClips(cloudRequest, resolved, sceneStartsMs, opts = {}, deps = {}) {
  const clips = []

  for (const t of (cloudRequest.audioTracks || [])) {
    const path = resolved.audio.get(t.filename)
    if (!path) throw new Error(`render: audio track "${t.filename}" (${t.type}) has no resolved file — fail-closed`)
    if (t.type === 'narration') {
      // 레거시: 타임코드 없음 → start 0, 길이는 probe/audioDurationSec
      const durationMs = await resolved.narrationDurationMs(t.filename)
      clips.push({ filename: t.filename, path, startMs: 0, durationMs, gain: NARRATION_GAIN })
    } else if (t.type === 'story_narration' || t.type === 'voice') {
      clips.push({ filename: t.filename, path, startMs: t.timecodeMs, durationMs: t.durationMs, gain: NARRATION_GAIN })
    } else if (t.type === 'sfx_timed') {
      clips.push({ filename: t.filename, path, startMs: t.timecodeMs, durationMs: t.durationMs, gain: SFX_GAIN })
    }
  }

  for (const sfx of (cloudRequest.sfxItems || [])) {
    const path = resolved.sfx.get(sfx.sceneId)
    if (!path) throw new Error(`render: sfx for scene "${sfx.sceneId}" (${sfx.filename}) has no resolved file — fail-closed`)
    const startMs = sceneStartsMs[sfx.sceneId]
    if (startMs == null) throw new Error(`render: sfx scene "${sfx.sceneId}" has no timeline start — fail-closed`)
    clips.push({ filename: sfx.filename, path, startMs, durationMs: Math.round(sfx.duration * 1000), gain: SFX_GAIN })
  }

  const renderVideoSegments = Array.isArray(opts.renderVideoSegments) ? opts.renderVideoSegments : []
  if (renderVideoSegments.length > 0) {
    const probeVideoAudio = deps.probeVideoAudio || createVideoAudioProbe({
      ffmpegPath: opts.ffmpegPath,
      signal: opts.signal,
    })
    const probeMemo = new Map()
    const hasAudio = (videoPath) => {
      if (!probeMemo.has(videoPath)) {
        // 주입 probe도 동일 경로 1회 불변식을 지키도록 adapter 경계에서 한 번 더 memoize한다.
        probeMemo.set(videoPath, Promise.resolve().then(() => probeVideoAudio(videoPath)))
      }
      return probeMemo.get(videoPath)
    }

    for (const segment of renderVideoSegments) {
      const videoPath = resolved.videos?.get?.(`${segment.sceneId}:${segment.source}`)
      if (!videoPath) continue                     // 비주얼 overlay 도 함께 drop → A/V 일관(§5)
      if (!await hasAudio(videoPath)) continue
      // sfx 분기와 대칭: 타임라인 시작이 없으면 startMs=NaN → adelay=NaN 불투명 실패. fail-closed throw.
      const startMs = sceneStartsMs[segment.sceneId]
      if (startMs == null) throw new Error(`render: video audio scene "${segment.sceneId}" has no timeline start — fail-closed`)

      clips.push({
        path: videoPath,
        startMs: startMs + segment.inSec * 1000,
        durationMs: (segment.outSec - segment.inSec) * 1000,
        gain: VIDEO_GAIN,
      })
    }
  }

  return clips
}
