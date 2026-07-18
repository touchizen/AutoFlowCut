// audioTracks 4형태 + sfxItems → 렌더 클립 정규화. 스펙 §2.2/§4.6.
// 반환: [{ filename, path, startMs, durationMs, gain }]
const NARRATION_GAIN = 1.0
const SFX_GAIN = 0.7

export async function adaptAudioClips(cloudRequest, resolved, sceneStartsMs) {
  const clips = []

  for (const t of (cloudRequest.audioTracks || [])) {
    const path = resolved.audio.get(t.filename)
    if (!path) continue
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
    if (!path) continue
    const startMs = sceneStartsMs[sfx.sceneId]
    if (startMs == null) continue
    clips.push({ filename: sfx.filename, path, startMs, durationMs: Math.round(sfx.duration * 1000), gain: SFX_GAIN })
  }

  return clips
}
