import { describe, it, expect } from 'vitest'
import { resolveAndValidateInputs } from '../../../electron/render/resolveInputs.js'

const deps = (present = ['/img1.png', '/sfx1.wav', '/nar.mp3']) => ({
  existsSync: (p) => present.includes(p),
  probeDurationMs: async () => 30000,
  decodeDataUrl: async () => { throw new Error('not used') },
})

const prepared = () => ({
  cloudRequest: { audioDurationSec: null, scenes: [{ id: 'scene_1' }], audioTracks: [] },
  mediaFiles: [
    { sceneId: 'scene_1', type: 'image', filename: 's1.png', path: '/img1.png' },
    { sceneId: 'scene_1', type: 'video', filename: 's1.mp4', path: '/vid1.mp4' }, // excluded
  ],
  sfxFiles: [{ sceneId: 'scene_1', filename: 'sfx1.wav', path: '/sfx1.wav' }],
  audioFiles: [{ type: 'narration', filename: 'nar.mp3', path: '/nar.mp3' }],
})

describe('resolveAndValidateInputs', () => {
  it('resolves images/sfx/audio and excludes video media', async () => {
    const r = await resolveAndValidateInputs(prepared(), deps())
    expect(r.images.get('scene_1')).toBe('/img1.png')
    expect(r.sfx.get('scene_1')).toBe('/sfx1.wav')
    expect(r.audio.get('nar.mp3')).toBe('/nar.mp3')
  })
  it('throws fail-closed when an image is missing', async () => {
    await expect(resolveAndValidateInputs(prepared(), deps(['/sfx1.wav', '/nar.mp3'])))
      .rejects.toThrow(/scene_1/)
  })
  it('rejects ambiguous duplicate audio filename', async () => {
    const p = prepared()
    p.audioFiles.push({ type: 'sfx', filename: 'nar.mp3', path: '/other.mp3' })
    await expect(resolveAndValidateInputs(p, deps(['/img1.png', '/sfx1.wav', '/nar.mp3', '/other.mp3'])))
      .rejects.toThrow(/ambiguous|nar\.mp3/)
  })
  it('probes legacy narration length when audioDurationSec is null', async () => {
    const r = await resolveAndValidateInputs(prepared(), deps())
    expect(await r.narrationDurationMs('nar.mp3')).toBe(30000)
  })
  it('uses audioDurationSec*1000 when present', async () => {
    const p = prepared(); p.cloudRequest.audioDurationSec = 12.5
    const r = await resolveAndValidateInputs(p, { ...deps(), probeDurationMs: async () => 0 })
    expect(await r.narrationDurationMs('nar.mp3')).toBe(12500)
  })

  it('decodes a data: URL image to a temp file and tracks it for cleanup', async () => {
    const p = prepared()
    p.mediaFiles[0] = { sceneId: 'scene_1', type: 'image', filename: 's1.png', path: 'data:image/png;base64,AAAA' }
    const decodeDataUrl = async (spec, name) => `/tmp/decoded_${name}.png`
    const r = await resolveAndValidateInputs(p, { ...deps(['/sfx1.wav', '/nar.mp3']), decodeDataUrl })
    expect(r.images.get('scene_1')).toBe('/tmp/decoded_scene_1_s1_png.png')
    expect(r.tempFiles).toContain('/tmp/decoded_scene_1_s1_png.png')
  })

  it('decodes from base64 fallback when path is absent (parity with other exporters)', async () => {
    const p = prepared()
    p.mediaFiles[0] = { sceneId: 'scene_1', type: 'image', filename: 's1.png', path: undefined, fallback: 'data:image/jpeg;base64,BBBB' }
    const decodeDataUrl = async () => '/tmp/fb.jpg'
    const r = await resolveAndValidateInputs(p, { ...deps(['/sfx1.wav', '/nar.mp3']), decodeDataUrl })
    expect(r.images.get('scene_1')).toBe('/tmp/fb.jpg')
    expect(r.tempFiles).toContain('/tmp/fb.jpg')
  })
})
