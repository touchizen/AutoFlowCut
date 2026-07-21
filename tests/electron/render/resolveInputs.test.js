import { describe, it, expect, vi } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
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
  it('resolves images/sfx/audio and returns an empty videos Map for non-video renders', async () => {
    const r = await resolveAndValidateInputs(prepared(), deps())
    expect(r.images.get('scene_1')).toBe('/img1.png')
    expect(r.sfx.get('scene_1')).toBe('/sfx1.wav')
    expect(r.audio.get('nar.mp3')).toBe('/nar.mp3')
    expect(r.videos).toEqual(new Map())
  })

  it.each(['i2v', 't2v'])('resolves the selected %s video by canonical media key', async (source) => {
    const p = prepared()
    const videoPath = `/vid-${source}.mp4`
    p.renderVideoSegments = [{ sceneId: 'scene_1', source, inSec: 0, outSec: 1 }]
    p.mediaFiles[1] = { sceneId: 'scene_1', type: 'video', source, filename: `${source}.mp4`, path: videoPath }

    const r = await resolveAndValidateInputs(p, deps(['/img1.png', videoPath, '/sfx1.wav', '/nar.mp3']))

    expect(r.videos.get(`scene_1:${source}`)).toBe(videoPath)
  })

  it('does not resolve or decode an unselected video with a stale path', async () => {
    const p = prepared()
    p.renderVideoSegments = [{ sceneId: 'scene_1', source: 'i2v', inSec: 0, outSec: 1 }]
    p.mediaFiles[1] = { sceneId: 'scene_1', type: 'video', source: 'i2v', filename: 'i2v.mp4', path: '/selected.mp4' }
    p.mediaFiles.push({
      sceneId: 'scene_1',
      type: 'video',
      source: 't2v',
      filename: 't2v.mp4',
      path: '/stale/missing.mp4',
      fallback: 'data:video/mp4;base64,AQIDBA==',
    })
    const decodeDataUrl = vi.fn(async () => '/tmp/unused.mp4')

    const r = await resolveAndValidateInputs(p, {
      ...deps(['/img1.png', '/selected.mp4', '/sfx1.wav', '/nar.mp3']),
      decodeDataUrl,
    })

    expect(r.videos).toEqual(new Map([['scene_1:i2v', '/selected.mp4']]))
    expect(decodeDataUrl).not.toHaveBeenCalled()
  })

  it('decodes a selected data:video/mp4 URL to an mp4 temp file', async () => {
    const p = prepared()
    p.renderVideoSegments = [{ sceneId: 'scene_1', source: 'i2v', inSec: 0, outSec: 1 }]
    p.mediaFiles[1] = {
      sceneId: 'scene_1',
      type: 'video',
      source: 'i2v',
      filename: 'clip.mp4',
      path: 'data:video/mp4;base64,AQIDBA==',
    }

    const r = await resolveAndValidateInputs(p, {
      existsSync: (value) => ['/img1.png', '/sfx1.wav', '/nar.mp3'].includes(value),
      probeDurationMs: async () => 30000,
      jobId: 'video_mp4_test',
    })

    try {
      const video = r.videos.get('scene_1:i2v')
      expect(video).toMatch(/\.mp4$/)
      expect(r.tempFiles).toContain(video)
      expect(fs.readFileSync(video)).toEqual(Buffer.from([1, 2, 3, 4]))
    } finally {
      await Promise.all(r.tempFiles.map((file) => fs.promises.unlink(file).catch(() => {})))
    }
  })

  it('decodes selected raw WebM fallback to a webm temp file', async () => {
    const p = prepared()
    const webm = Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), Buffer.alloc(64)]).toString('base64')
    p.renderVideoSegments = [{ sceneId: 'scene_1', source: 't2v', inSec: 0, outSec: 1 }]
    p.mediaFiles[1] = {
      sceneId: 'scene_1',
      type: 'video',
      source: 't2v',
      filename: 'clip.webm',
      path: '/stale/clip.webm',
      fallback: webm,
    }

    const r = await resolveAndValidateInputs(p, {
      existsSync: (value) => ['/img1.png', '/sfx1.wav', '/nar.mp3'].includes(value),
      probeDurationMs: async () => 30000,
      jobId: 'video_webm_test',
    })

    try {
      const video = r.videos.get('scene_1:t2v')
      expect(video).toMatch(/\.webm$/)
      expect(r.tempFiles).toContain(video)
      expect(fs.readFileSync(video)).toEqual(Buffer.from(webm, 'base64'))
    } finally {
      await Promise.all(r.tempFiles.map((file) => fs.promises.unlink(file).catch(() => {})))
    }
  })

  it('throws fail-closed when a selected video cannot be resolved', async () => {
    const p = prepared()
    p.renderVideoSegments = [{ sceneId: 'scene_1', source: 'i2v', inSec: 0, outSec: 1 }]
    p.mediaFiles[1] = {
      sceneId: 'scene_1',
      type: 'video',
      source: 'i2v',
      filename: 'missing.mp4',
      path: '/missing.mp4',
    }

    await expect(resolveAndValidateInputs(p, deps()))
      .rejects.toThrow(/missing video.*scene_1:i2v/)
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

  it('keeps default image data URL decoding byte-identical with a png temp', async () => {
    const p = prepared()
    p.mediaFiles[0] = {
      sceneId: 'scene_1',
      type: 'image',
      filename: 's1.png',
      path: 'data:image/png;base64,AQIDBA==',
    }

    const r = await resolveAndValidateInputs(p, {
      existsSync: (value) => ['/sfx1.wav', '/nar.mp3'].includes(value),
      probeDurationMs: async () => 30000,
      jobId: 'image_png_regression',
    })

    try {
      const image = r.images.get('scene_1')
      expect(image).toMatch(/\.png$/)
      expect(fs.readFileSync(image)).toEqual(Buffer.from([1, 2, 3, 4]))
    } finally {
      await Promise.all(r.tempFiles.map((file) => fs.promises.unlink(file).catch(() => {})))
    }
  })

  it('decodes from base64 fallback when path is absent (parity with other exporters)', async () => {
    const p = prepared()
    p.mediaFiles[0] = { sceneId: 'scene_1', type: 'image', filename: 's1.png', path: undefined, fallback: 'data:image/jpeg;base64,BBBB' }
    const decodeDataUrl = async () => '/tmp/fb.jpg'
    const r = await resolveAndValidateInputs(p, { ...deps(['/sfx1.wav', '/nar.mp3']), decodeDataUrl })
    expect(r.images.get('scene_1')).toBe('/tmp/fb.jpg')
    expect(r.tempFiles).toContain('/tmp/fb.jpg')
  })

  it('accepts raw base64 that contains / (a valid base64 char, not a path)', async () => {
    const p = prepared()
    // Real PNG base64 starts with iVBOR..., contains '/' mid-string, never starts with '/'.
    p.mediaFiles[0] = { sceneId: 'scene_1', type: 'image', filename: 's1.png', path: 'iVBORw0KGgoAAA/NSUhEUgAAAAEAAA/AB+w0CAAAAB'.repeat(2) }
    const decodeDataUrl = async () => '/tmp/raw.png'
    const r = await resolveAndValidateInputs(p, { ...deps(['/sfx1.wav', '/nar.mp3']), decodeDataUrl })
    expect(r.images.get('scene_1')).toBe('/tmp/raw.png')
  })

  it('cleans up already-decoded temps when a later input throws (transactional)', async () => {
    const p = prepared()
    p.mediaFiles[0] = { sceneId: 'scene_1', type: 'image', filename: 's1.png', path: 'data:image/png;base64,QQ==' }
    const tmpPath = path.join(os.tmpdir(), 'resolveinputs_txn_test.png')
    if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath)
    const decodeDataUrl = async () => { fs.writeFileSync(tmpPath, 'x'); return tmpPath }
    // sfx1.wav 를 missing 으로 만들어 이미지 decode 이후 sfx 루프에서 throw 시킨다.
    await expect(resolveAndValidateInputs(p, {
      existsSync: (x) => x === '/nar.mp3',
      probeDurationMs: async () => 1,
      decodeDataUrl,
    })).rejects.toThrow(/sfx/)
    expect(fs.existsSync(tmpPath)).toBe(false) // decode 된 temp 가 정리됨
  })

  it('prefixes decoded temp names with jobId to avoid cross-project collisions', async () => {
    const p = prepared()
    p.mediaFiles[0] = { sceneId: 'scene_1', type: 'image', filename: 's1.png', path: 'data:image/png;base64,AAAA' }
    const seen = []
    const decodeDataUrl = async (_spec, name) => { seen.push(name); return `/tmp/${name}.png` }
    await resolveAndValidateInputs(p, { ...deps(['/sfx1.wav', '/nar.mp3']), decodeDataUrl, jobId: 'render_Proj_7' })
    expect(seen[0]).toMatch(/^render_Proj_7_/)
  })
})
