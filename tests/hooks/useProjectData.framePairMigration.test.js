import { describe, it, expect } from 'vitest'
import { backfillFramePairOwner } from '../../src/hooks/useProjectData'

describe('backfillFramePairOwner — framePair schema migration', () => {
  it('passes through framePairs that already have ownerSceneId', () => {
    const fp = { id: 'fp_1', startSceneId: 'scene_2', ownerSceneId: 'scene_1' }
    expect(backfillFramePairOwner(fp)).toEqual(fp)
  })

  it('backfills ownerSceneId from startSceneId when missing (legacy data)', () => {
    const fp = { id: 'fp_1', startSceneId: 'scene_2', endSceneId: 'scene_3' }
    const out = backfillFramePairOwner(fp)
    expect(out.ownerSceneId).toBe('scene_2')
    expect(out.startSceneId).toBe('scene_2')  // unchanged
    expect(out.endSceneId).toBe('scene_3')    // unchanged
  })

  it('sets ownerSceneId to null for gallery-rooted rows', () => {
    const fp = { id: 'fp_1', startSceneId: 'gallery::abc123' }
    expect(backfillFramePairOwner(fp).ownerSceneId).toBeNull()
  })

  it('sets ownerSceneId to null when startSceneId is missing/empty', () => {
    expect(backfillFramePairOwner({ id: 'fp_1' }).ownerSceneId).toBeNull()
    expect(backfillFramePairOwner({ id: 'fp_1', startSceneId: '' }).ownerSceneId).toBeNull()
  })

  it('does NOT mutate the input', () => {
    const fp = { id: 'fp_1', startSceneId: 'scene_2' }
    backfillFramePairOwner(fp)
    expect(fp.ownerSceneId).toBeUndefined()
  })
})
