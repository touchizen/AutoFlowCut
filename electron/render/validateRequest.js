// 순수 IPC 요청 검증 — resolve/temp 이전. 스펙 §3.
const MODES = new Set(['preview', 'final'])
const FORMATS = new Set(['portrait', 'landscape'])
const SCALE_MODES = new Set(['fill', 'fit', 'none'])
const KB_MODES = new Set(['random', 'pattern'])
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
  for (const s of scenes) {
    if (typeof s.id !== 'string' || !s.id) return fail('scene id missing')
    if (ids.has(s.id)) return fail(`duplicate scene id: ${s.id}`)
    ids.add(s.id)
    if (!finitePos(s.duration)) return fail(`bad scene duration: ${s.id}`)
  }
  for (const sfx of (cr.sfxItems || [])) {
    if (!ids.has(sfx.sceneId)) return fail(`sfx references unknown scene: ${sfx.sceneId}`)
    if (!finitePos(sfx.duration)) return fail(`bad sfx duration: ${sfx.filename}`)
  }
  for (const t of (cr.audioTracks || [])) {
    if (t.timecodeMs != null && !finiteNonNeg(t.timecodeMs)) return fail(`bad audioTrack timecode: ${t.filename}`)
    if (t.durationMs != null && !finitePos(t.durationMs)) return fail(`bad audioTrack duration: ${t.filename}`)
  }
  return { ok: true }
}
