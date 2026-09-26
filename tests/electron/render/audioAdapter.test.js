import { describe, it, expect, vi } from 'vitest'
import { adaptAudioClips } from '../../../electron/render/audioAdapter.js'

const resolved = {
  audio: new Map([['nar.wav', '/nar.wav'], ['sfxA.wav', '/sfxA.wav']]),
  sfx: new Map([['scene_2', '/scene2sfx.wav']]),
  narrationDurationMs: async () => 30000,
}
const sceneStartsMs = { scene_1: 0, scene_2: 3000 }

describe('adaptAudioClips', () => {
  it('maps story_narration with timecodeMs and gain 1.0', async () => {
    const cr = { audioTracks: [{ type: 'story_narration', filename: 'nar.wav', timecodeMs: 1000, durationMs: 2000, trackIndex: 0 }], sfxItems: [] }
    const [c] = await adaptAudioClips(cr, resolved, sceneStartsMs)
    expect(c).toMatchObject({ path: '/nar.wav', startMs: 1000, durationMs: 2000, gain: 1.0 })
  })
  it('maps sfx_timed with gain 0.7', async () => {
    const cr = { audioTracks: [{ type: 'sfx_timed', filename: 'sfxA.wav', timecodeMs: 500, durationMs: 800, category: 'story' }], sfxItems: [] }
    const [c] = await adaptAudioClips(cr, resolved, sceneStartsMs)
    expect(c.gain).toBe(0.7)
  })
  it('maps legacy narration with probed length and start 0', async () => {
    const cr = { audioTracks: [{ type: 'narration', filename: 'nar.wav', path: '/nar.wav' }], sfxItems: [] }
    const [c] = await adaptAudioClips(cr, resolved, sceneStartsMs)
    expect(c).toMatchObject({ startMs: 0, durationMs: 30000 })
  })
  it('converts sfxItems seconds→ms and places at scene cumulative start', async () => {
    const cr = { audioTracks: [], sfxItems: [{ sceneId: 'scene_2', filename: 'x', duration: 3 }] }
    const [c] = await adaptAudioClips(cr, resolved, sceneStartsMs)
    expect(c).toMatchObject({ path: '/scene2sfx.wav', startMs: 3000, durationMs: 3000, gain: 0.7 })
  })

  it('throws (fail-closed) when an audio track has no resolved file — no silent skip', async () => {
    const cr = { audioTracks: [{ type: 'story_narration', filename: 'missing.wav', timecodeMs: 0, durationMs: 1000 }], sfxItems: [] }
    await expect(adaptAudioClips(cr, resolved, sceneStartsMs)).rejects.toThrow(/missing\.wav|fail-closed/)
  })

  it('throws (fail-closed) when an sfx scene has no resolved file', async () => {
    const cr = { audioTracks: [], sfxItems: [{ sceneId: 'scene_9', filename: 'y', duration: 1 }] }
    await expect(adaptAudioClips(cr, resolved, sceneStartsMs)).rejects.toThrow(/scene_9|fail-closed/)
  })

  it('does not add a clip when the selected video has no audio stream', async () => {
    const probeVideoAudio = vi.fn(async () => false)
    const videoResolved = { ...resolved, videos: new Map([['scene_1:i2v', '/video/silent.mp4']]) }

    const clips = await adaptAudioClips(
      { audioTracks: [], sfxItems: [] },
      videoResolved,
      sceneStartsMs,
      { renderVideoSegments: [{ sceneId: 'scene_1', source: 'i2v', inSec: 0, outSec: 2 }] },
      { probeVideoAudio },
    )

    expect(clips).toEqual([])
    expect(probeVideoAudio).toHaveBeenCalledWith('/video/silent.mp4')
  })

  it('adds selected video audio at scene start plus segment offset with VIDEO_GAIN', async () => {
    const probeVideoAudio = vi.fn(async () => true)
    const videoResolved = { ...resolved, videos: new Map([['scene_2:t2v', '/video/audio.mp4']]) }

    const clips = await adaptAudioClips(
      { audioTracks: [], sfxItems: [] },
      videoResolved,
      sceneStartsMs,
      { renderVideoSegments: [{ sceneId: 'scene_2', source: 't2v', inSec: 0.5, outSec: 2.25 }] },
      { probeVideoAudio },
    )

    expect(clips).toEqual([{
      path: '/video/audio.mp4',
      startMs: 3500,
      durationMs: 1750,
      gain: 1.0,
    }])
  })

  it('throws fail-closed when a video segment scene has no timeline start', async () => {
    const probeVideoAudio = vi.fn(async () => true)
    const videoResolved = { ...resolved, videos: new Map([['scene_9:i2v', '/video/audio.mp4']]) }

    await expect(adaptAudioClips(
      { audioTracks: [], sfxItems: [] },
      videoResolved,
      sceneStartsMs,   // scene_9 없음 → startMs 없음
      { renderVideoSegments: [{ sceneId: 'scene_9', source: 'i2v', inSec: 0, outSec: 2 }] },
      { probeVideoAudio },
    )).rejects.toThrow(/scene_9|fail-closed/)
  })

  it('probes the same resolved video file only once for two segments', async () => {
    const probeVideoAudio = vi.fn(async () => true)
    const videoResolved = {
      ...resolved,
      videos: new Map([
        ['scene_1:i2v', '/video/reused.mp4'],
        ['scene_2:i2v', '/video/reused.mp4'],
      ]),
    }

    const clips = await adaptAudioClips(
      { audioTracks: [], sfxItems: [] },
      videoResolved,
      sceneStartsMs,
      { renderVideoSegments: [
        { sceneId: 'scene_1', source: 'i2v', inSec: 0, outSec: 1 },
        { sceneId: 'scene_2', source: 'i2v', inSec: 1, outSec: 2 },
      ] },
      { probeVideoAudio },
    )

    expect(clips).toHaveLength(2)
    expect(probeVideoAudio).toHaveBeenCalledTimes(1)
  })

  it('keeps legacy audio behavior when renderVideoSegments is absent or empty', async () => {
    const cr = {
      audioTracks: [{ type: 'story_narration', filename: 'nar.wav', timecodeMs: 1000, durationMs: 2000 }],
      sfxItems: [{ sceneId: 'scene_2', filename: 'x', duration: 3 }],
    }
    const probeVideoAudio = vi.fn(async () => true)

    const absent = await adaptAudioClips(cr, resolved, sceneStartsMs)
    const empty = await adaptAudioClips(
      cr,
      resolved,
      sceneStartsMs,
      { renderVideoSegments: [] },
      { probeVideoAudio },
    )

    expect(empty).toEqual(absent)
    expect(probeVideoAudio).not.toHaveBeenCalled()
  })

  it('skips a selected video segment safely when its resolved path is missing', async () => {
    const probeVideoAudio = vi.fn(async () => true)

    const clips = await adaptAudioClips(
      { audioTracks: [], sfxItems: [] },
      { ...resolved, videos: new Map() },
      sceneStartsMs,
      { renderVideoSegments: [{ sceneId: 'scene_1', source: 'i2v', inSec: 0, outSec: 2 }] },
      { probeVideoAudio },
    )

    expect(clips).toEqual([])
    expect(probeVideoAudio).not.toHaveBeenCalled()
  })
})
