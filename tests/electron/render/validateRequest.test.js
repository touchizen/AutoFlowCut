import { describe, it, expect } from 'vitest'
import { validateRenderRequest } from '../../../electron/render/validateRequest.js'

const good = () => ({
  jobId: 'job_1',
  options: { renderMode: 'final', renderBurnSubtitle: true },
  prepared: { cloudRequest: {
    format: 'portrait', scaleMode: 'fill', subtitleFontSize: 8,
    kenBurns: { enabled: true, mode: 'random', cycle: 5, scaleMin: 1.0, scaleMax: 1.3 },
    scenes: [{ id: 'scene_1', duration: 3 }, { id: 'scene_2', duration: 4 }],
    sfxItems: [{ sceneId: 'scene_1', filename: 'a.wav', duration: 2 }],
    audioTracks: [],
  } },
})

describe('validateRenderRequest', () => {
  it('accepts a well-formed request', () => {
    expect(validateRenderRequest(good())).toEqual({ ok: true })
  })
  it('rejects bad renderMode', () => {
    const r = good(); r.options.renderMode = 'ultra'
    expect(validateRenderRequest(r).ok).toBe(false)
  })
  it('rejects missing jobId', () => {
    const r = good(); delete r.jobId
    expect(validateRenderRequest(r).ok).toBe(false)
  })
  it('rejects duplicate scene ids', () => {
    const r = good(); r.prepared.cloudRequest.scenes[1].id = 'scene_1'
    expect(validateRenderRequest(r).ok).toBe(false)
  })
  it('rejects sfx referencing an unknown scene', () => {
    const r = good(); r.prepared.cloudRequest.sfxItems[0].sceneId = 'scene_9'
    expect(validateRenderRequest(r).ok).toBe(false)
  })
  it('rejects non-finite scene duration', () => {
    const r = good(); r.prepared.cloudRequest.scenes[0].duration = NaN
    expect(validateRenderRequest(r).ok).toBe(false)
  })
  it('rejects non-positive subtitleFontSize', () => {
    const r = good(); r.prepared.cloudRequest.subtitleFontSize = 0
    expect(validateRenderRequest(r).ok).toBe(false)
  })
})
