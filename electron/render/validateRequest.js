// 순수 IPC 요청 검증 — resolve/temp 이전. 스펙 §3.
const MODES = new Set(['preview', 'final'])
const FORMATS = new Set(['portrait', 'landscape'])
const SCALE_MODES = new Set(['fill', 'fit', 'none'])
const KB_MODES = new Set(['random', 'pattern'])
const VIDEO_SOURCES = new Set(['i2v', 't2v'])
const FONT_MAX = 100

const fail = (error) => ({ ok: false, error })
const finitePos = (n) => Number.isFinite(n) && n > 0
const finiteNonNeg = (n) => Number.isFinite(n) && n >= 0

export function validateRenderRequest(request) {
  if (!request || typeof request !== 'object') return fail('request missing')
  const { prepared, options, jobId } = request
  if (typeof jobId !== 'string' || !jobId) return fail('jobId missing')
  if (!options || !MODES.has(options.renderMode)) return fail(`bad renderMode: ${options?.renderMode}`)
  if (typeof options.renderBurnSubtitle !== 'boolean') return fail('renderBurnSubtitle must be boolean')

  const cr = prepared?.cloudRequest
  if (!cr || typeof cr !== 'object') return fail('cloudRequest missing')
  if (!FORMATS.has(cr.format)) return fail(`bad format: ${cr.format}`)
  if (!SCALE_MODES.has(cr.scaleMode)) return fail(`bad scaleMode: ${cr.scaleMode}`)
  if (!finitePos(cr.subtitleFontSize) || cr.subtitleFontSize > FONT_MAX) return fail(`bad subtitleFontSize: ${cr.subtitleFontSize}`)

  const kb = cr.kenBurns || {}
  if (kb.enabled) {
    if (!KB_MODES.has(kb.mode)) return fail(`bad kenBurns.mode: ${kb.mode}`)
    if (!finitePos(kb.scaleMin) || !finitePos(kb.scaleMax)) return fail('bad kenBurns scale')
  }

  const scenes = Array.isArray(cr.scenes) ? cr.scenes : null
  if (!scenes || scenes.length === 0) return fail('no scenes')
  const ids = new Set()
  const sceneDurations = new Map()
  for (const s of scenes) {
    if (typeof s.id !== 'string' || !s.id) return fail('scene id missing')
    if (ids.has(s.id)) return fail(`duplicate scene id: ${s.id}`)
    ids.add(s.id)
    if (!finitePos(s.duration)) return fail(`bad scene duration: ${s.id}`)
    sceneDurations.set(s.id, s.duration)
  }
  // optional 컬렉션은 생략 가능하지만 값이 있으면 배열만 받아 IPC rejection 을 막는다.
  if (cr.sfxItems != null && !Array.isArray(cr.sfxItems)) return fail('sfxItems must be an array')
  for (const sfx of (cr.sfxItems || [])) {
    if (!ids.has(sfx.sceneId)) return fail(`sfx references unknown scene: ${sfx.sceneId}`)
    if (!finitePos(sfx.duration)) return fail(`bad sfx duration: ${sfx.filename}`)
  }
  const AUDIO_TYPES = new Set(['narration', 'story_narration', 'voice', 'sfx_timed'])
  const TIMED_TYPES = new Set(['story_narration', 'voice', 'sfx_timed'])
  if (cr.audioTracks != null && !Array.isArray(cr.audioTracks)) return fail('audioTracks must be an array')
  for (const t of (cr.audioTracks || [])) {
    if (!AUDIO_TYPES.has(t.type)) return fail(`unknown audioTrack type: ${t.type} (${t.filename})`)
    if (TIMED_TYPES.has(t.type)) {
      // 타임코드/길이 없으면 atrim=duration=0 → 무음. 필수로 강제(fail-closed).
      if (!finiteNonNeg(t.timecodeMs)) return fail(`audioTrack "${t.filename}" (${t.type}) missing/invalid timecodeMs`)
      if (!finitePos(t.durationMs)) return fail(`audioTrack "${t.filename}" (${t.type}) missing/invalid durationMs`)
    }
    // legacy 'narration' 은 타임코드 없이 전체 길이 → 검증 제외.
  }

  let videoSegments = []
  if (prepared.renderVideoSegments != null) {
    if (!Array.isArray(prepared.renderVideoSegments)) return fail('renderVideoSegments must be an array')
    videoSegments = prepared.renderVideoSegments
    const seenSceneIds = new Set()
    const mediaFiles = Array.isArray(prepared.mediaFiles) ? prepared.mediaFiles : []

    for (const segment of videoSegments) {
      if (!VIDEO_SOURCES.has(segment?.source)) return fail(`bad video segment source: ${segment?.source}`)
      if (!sceneDurations.has(segment?.sceneId)) return fail(`video segment references unknown scene: ${segment?.sceneId}`)
      if (seenSceneIds.has(segment.sceneId)) return fail(`duplicate video segment scene: ${segment.sceneId}`)
      seenSceneIds.add(segment.sceneId)

      const sceneDur = sceneDurations.get(segment.sceneId)
      if (!Number.isFinite(segment.inSec)
          || !Number.isFinite(segment.outSec)
          || segment.inSec < 0
          || segment.inSec >= segment.outSec
          || segment.outSec > sceneDur) {
        return fail(`bad video segment bounds: ${segment.sceneId}`)
      }

      const mediaMatches = mediaFiles.filter(file => (
        file?.type === 'video'
        && file.sceneId === segment.sceneId
        && file.source === segment.source
      ))
      if (mediaMatches.length !== 1) {
        return fail(`video segment mediaFile match must be exactly 1: ${segment.sceneId}:${segment.source} (found ${mediaMatches.length})`)
      }
    }
  }

  const sceneMeta = prepared.renderSceneMeta
  if (sceneMeta != null) {
    if (typeof sceneMeta !== 'object' || Array.isArray(sceneMeta)) return fail('renderSceneMeta must be an object')
    for (const sceneId of Object.keys(sceneMeta)) {
      if (!ids.has(sceneId)) return fail(`renderSceneMeta references unknown scene: ${sceneId}`)
    }
    for (const sceneId of ids) {
      if (!Object.prototype.hasOwnProperty.call(sceneMeta, sceneId)) return fail(`renderSceneMeta missing scene: ${sceneId}`)
      if (typeof sceneMeta[sceneId]?.hasVideo !== 'boolean') {
        return fail(`renderSceneMeta.hasVideo must be boolean: ${sceneId}`)
      }
    }
  }

  if (videoSegments.length > 0) {
    if (sceneMeta == null) return fail('renderSceneMeta required for video segments')
    for (const segment of videoSegments) {
      if (sceneMeta[segment.sceneId].hasVideo !== true) {
        return fail(`renderSceneMeta.hasVideo must be true for video segment: ${segment.sceneId}`)
      }
    }
  }
  return { ok: true }
}
