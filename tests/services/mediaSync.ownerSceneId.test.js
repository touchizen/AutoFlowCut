import { describe, it, expect } from 'vitest'
import { syncVideosIntoScenes } from '../../src/services/mediaSync'

describe('syncVideosIntoScenes — ownerSceneId binding', () => {
  it('binds video to ownerSceneId, not startSceneId, when they differ', () => {
    // The exact regression: user picked scene_3 as the start image for a row that
    // owns scene_2. The video must land on scene_2.
    const scenes = [
      { id: 'scene_1' },
      { id: 'scene_2' },
      { id: 'scene_3' },
    ]
    const framePairs = [
      {
        id: 'fp_1',
        ownerSceneId: 'scene_2',
        startSceneId: 'scene_3',   // user changed start image
        endSceneId: 'scene_3',
        status: 'complete',
        videoPath: '/tmp/v.mp4',
        duration: 8,
      },
    ]

    const synced = syncVideosIntoScenes(scenes, [], framePairs)

    expect(synced).toBe(true)
    expect(scenes.find(s => s.id === 'scene_2').videoI2VPath).toBe('/tmp/v.mp4')
    expect(scenes.find(s => s.id === 'scene_3').videoI2VPath).toBeUndefined()
  })

  it('skips framePairs with no ownerSceneId (gallery-rooted)', () => {
    const scenes = [{ id: 'scene_1' }]
    const framePairs = [
      {
        id: 'fp_1',
        ownerSceneId: null,
        startSceneId: 'gallery::abc',
        status: 'complete',
        videoPath: '/tmp/v.mp4',
      },
    ]
    const synced = syncVideosIntoScenes(scenes, [], framePairs)
    expect(synced).toBe(false)
    expect(scenes[0].videoI2VPath).toBeUndefined()
  })
})
