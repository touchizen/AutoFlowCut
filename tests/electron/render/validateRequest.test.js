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

const goodWithVideo = () => {
  const request = good()
  request.prepared.renderVideoSegments = [
    { sceneId: 'scene_1', source: 'i2v', inSec: 0, outSec: 3 },
  ]
  request.prepared.renderSceneMeta = {
    scene_1: { hasVideo: true },
    scene_2: { hasVideo: false },
  }
  request.prepared.mediaFiles = [
    { type: 'video', sceneId: 'scene_1', source: 'i2v', path: '/i2v.mp4' },
  ]
  return request
}

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

  it('rejects a timed voice track missing timecodeMs/durationMs (silent-audio guard)', () => {
    const r = good(); r.prepared.cloudRequest.audioTracks = [{ type: 'voice', filename: 'v.wav' }]
    expect(validateRenderRequest(r).ok).toBe(false)
  })

  it('rejects a story_narration track with invalid durationMs', () => {
    const r = good(); r.prepared.cloudRequest.audioTracks = [{ type: 'story_narration', filename: 'n.wav', timecodeMs: 0, durationMs: 0 }]
    expect(validateRenderRequest(r).ok).toBe(false)
  })

  it('rejects an unknown audioTrack type', () => {
    const r = good(); r.prepared.cloudRequest.audioTracks = [{ type: 'bogus', filename: 'x' }]
    expect(validateRenderRequest(r).ok).toBe(false)
  })

  it('accepts a legacy narration track without timecode (whole-length)', () => {
    const r = good(); r.prepared.cloudRequest.audioTracks = [{ type: 'narration', filename: 'n.wav', path: '/n.wav' }]
    expect(validateRenderRequest(r)).toEqual({ ok: true })
  })

  it('accepts well-formed renderVideoSegments/renderSceneMeta', () => {
    expect(validateRenderRequest(goodWithVideo())).toEqual({ ok: true })
  })

  it('rejects renderVideoSegments when it is not an array', () => {
    const r = goodWithVideo(); r.prepared.renderVideoSegments = {}
    expect(validateRenderRequest(r)).toMatchObject({ ok: false, error: expect.stringMatching(/renderVideoSegments.*array/i) })
  })

  it('rejects a bad video segment source', () => {
    const r = goodWithVideo(); r.prepared.renderVideoSegments[0].source = 'video'
    expect(validateRenderRequest(r)).toMatchObject({ ok: false, error: expect.stringMatching(/source/i) })
  })

  it.each([
    ['negative inSec', { inSec: -1 }],
    ['empty range', { inSec: 2, outSec: 2 }],
    ['outSec past scene duration', { outSec: 3.1 }],
    ['non-finite inSec', { inSec: NaN }],
    ['non-finite outSec', { outSec: Infinity }],
  ])('rejects out-of-bounds video segment: %s', (_name, patch) => {
    const r = goodWithVideo(); Object.assign(r.prepared.renderVideoSegments[0], patch)
    expect(validateRenderRequest(r)).toMatchObject({ ok: false, error: expect.stringMatching(/bounds|range/i) })
  })

  it('rejects a video segment that references a missing scene', () => {
    const r = goodWithVideo(); r.prepared.renderVideoSegments[0].sceneId = 'scene_9'
    expect(validateRenderRequest(r)).toMatchObject({ ok: false, error: expect.stringMatching(/unknown scene/i) })
  })

  it('rejects duplicate video segments for one scene', () => {
    const r = goodWithVideo()
    r.prepared.renderVideoSegments.push({ sceneId: 'scene_1', source: 't2v', inSec: 0, outSec: 2 })
    r.prepared.mediaFiles.push({ type: 'video', sceneId: 'scene_1', source: 't2v', path: '/t2v.mp4' })
    expect(validateRenderRequest(r)).toMatchObject({ ok: false, error: expect.stringMatching(/duplicate|one.*scene/i) })
  })

  it.each([
    ['no mediaFile', []],
    ['duplicate mediaFiles', [
      { type: 'video', sceneId: 'scene_1', source: 'i2v', path: '/i2v-a.mp4' },
      { type: 'video', sceneId: 'scene_1', source: 'i2v', path: '/i2v-b.mp4' },
    ]],
  ])('rejects a segment without a 1:1 video mediaFile match: %s', (_name, mediaFiles) => {
    const r = goodWithVideo(); r.prepared.mediaFiles = mediaFiles
    expect(validateRenderRequest(r)).toMatchObject({ ok: false, error: expect.stringMatching(/mediaFile.*exactly 1|1:1/i) })
  })

  it('rejects renderSceneMeta when it is not an object', () => {
    const r = goodWithVideo(); r.prepared.renderSceneMeta = []
    expect(validateRenderRequest(r)).toMatchObject({ ok: false, error: expect.stringMatching(/renderSceneMeta.*object/i) })
  })

  it('rejects renderSceneMeta with a missing render scene entry', () => {
    const r = goodWithVideo(); delete r.prepared.renderSceneMeta.scene_2
    expect(validateRenderRequest(r)).toMatchObject({ ok: false, error: expect.stringMatching(/missing.*scene_2|scene count/i) })
  })

  it('rejects renderSceneMeta with an unknown scene key', () => {
    const r = goodWithVideo(); r.prepared.renderSceneMeta.scene_9 = { hasVideo: false }
    expect(validateRenderRequest(r)).toMatchObject({ ok: false, error: expect.stringMatching(/unknown scene.*scene_9/i) })
  })

  it('rejects a non-boolean renderSceneMeta.hasVideo', () => {
    const r = goodWithVideo(); r.prepared.renderSceneMeta.scene_1.hasVideo = 1
    expect(validateRenderRequest(r)).toMatchObject({ ok: false, error: expect.stringMatching(/hasVideo.*boolean/i) })
  })

  it('rejects a segment whose scene does not have hasVideo=true', () => {
    const r = goodWithVideo(); r.prepared.renderSceneMeta.scene_1.hasVideo = false
    expect(validateRenderRequest(r)).toMatchObject({ ok: false, error: expect.stringMatching(/hasVideo.*true/i) })
  })

  it('rejects segments when renderSceneMeta is absent', () => {
    const r = goodWithVideo(); delete r.prepared.renderSceneMeta
    expect(validateRenderRequest(r)).toMatchObject({ ok: false, error: expect.stringMatching(/renderSceneMeta|hasVideo/i) })
  })
})
