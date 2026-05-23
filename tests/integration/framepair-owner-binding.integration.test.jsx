/**
 * End-to-end: a row's ownerSceneId survives start-image dropdown changes,
 * and the generated video lands on the owner scene regardless of which start
 * image was picked.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { syncVideosIntoScenes } from '../../src/services/mediaSync'
import { backfillFramePairOwner } from '../../src/hooks/useProjectData'

describe('Integration — ownerSceneId end-to-end', () => {
  let logSpy
  beforeEach(() => { logSpy = vi.spyOn(console, 'log').mockImplementation(() => {}) })
  afterEach(() => { logSpy.mockRestore() })

  it('legacy project.json: backfilled framePair video lands on the original startSceneId', () => {
    // Legacy data: no ownerSceneId field
    const legacy = [
      { id: 'fp_1', startSceneId: 'scene_2', endSceneId: 'scene_2', status: 'complete', videoPath: '/tmp/v.mp4' },
    ]
    const migrated = legacy.map(backfillFramePairOwner)

    const scenes = [{ id: 'scene_1' }, { id: 'scene_2' }, { id: 'scene_3' }]
    syncVideosIntoScenes(scenes, [], migrated)

    // Legacy behavior preserved: video bound to scene_2 (the original startSceneId)
    expect(scenes.find(s => s.id === 'scene_2').videoI2VPath).toBe('/tmp/v.mp4')
  })

  it('new flow: user changes start image, video still lands on owner scene', () => {
    // Row was auto-added for scene_2 (ownerSceneId = scene_2).
    // User then changed the start image dropdown to scene_3 (so startSceneId = scene_3).
    // Generated video must still land on scene_2 — owner is immutable.
    const framePairs = [
      {
        id: 'fp_1',
        ownerSceneId: 'scene_2',
        startSceneId: 'scene_3',
        endSceneId: 'scene_3',
        status: 'complete',
        videoPath: '/tmp/v.mp4',
      },
    ]
    const scenes = [{ id: 'scene_1' }, { id: 'scene_2' }, { id: 'scene_3' }]
    syncVideosIntoScenes(scenes, [], framePairs)

    expect(scenes.find(s => s.id === 'scene_2').videoI2VPath).toBe('/tmp/v.mp4')
    expect(scenes.find(s => s.id === 'scene_3').videoI2VPath).toBeUndefined()
  })

  it('multiple rows on different scenes: no cross-contamination', () => {
    const framePairs = [
      { id: 'fp_1', ownerSceneId: 'scene_1', startSceneId: 'scene_2', status: 'complete', videoPath: '/v1.mp4' },
      { id: 'fp_2', ownerSceneId: 'scene_2', startSceneId: 'scene_3', status: 'complete', videoPath: '/v2.mp4' },
      { id: 'fp_3', ownerSceneId: 'scene_3', startSceneId: 'scene_1', status: 'complete', videoPath: '/v3.mp4' },
    ]
    const scenes = [{ id: 'scene_1' }, { id: 'scene_2' }, { id: 'scene_3' }]
    syncVideosIntoScenes(scenes, [], framePairs)

    expect(scenes.find(s => s.id === 'scene_1').videoI2VPath).toBe('/v1.mp4')
    expect(scenes.find(s => s.id === 'scene_2').videoI2VPath).toBe('/v2.mp4')
    expect(scenes.find(s => s.id === 'scene_3').videoI2VPath).toBe('/v3.mp4')
  })
})
