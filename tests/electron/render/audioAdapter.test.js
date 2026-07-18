import { describe, it, expect } from 'vitest'
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
})
