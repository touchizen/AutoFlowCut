import { describe, it, expect } from 'vitest'
import { filterPendingScenes } from '../../src/utils/sceneFilters'

describe('filterPendingScenes', () => {
  it('returns empty for non-array input', () => {
    expect(filterPendingScenes(null)).toEqual([])
    expect(filterPendingScenes(undefined)).toEqual([])
    expect(filterPendingScenes('not-array')).toEqual([])
  })

  it('excludes scenes that have an image (image field set)', () => {
    const scenes = [
      { id: 1, image: 'data:image/png;base64,abc' },
      { id: 2 },
    ]
    expect(filterPendingScenes(scenes).map(s => s.id)).toEqual([2])
  })

  it('excludes scenes that have an imagePath (saved to disk)', () => {
    const scenes = [
      { id: 1, imagePath: '/tmp/scene_1.png' },
      { id: 2 },
    ]
    expect(filterPendingScenes(scenes).map(s => s.id)).toEqual([2])
  })

  it('includes scenes with no image and no status', () => {
    const scenes = [{ id: 1 }, { id: 2, status: undefined }]
    expect(filterPendingScenes(scenes)).toEqual(scenes)
  })

  it('includes scenes explicitly marked pending or error (even if other fields oddly set)', () => {
    const scenes = [
      { id: 1, image: 'has-image-but-status-pending', status: 'pending' },
      { id: 2, imagePath: '/tmp/x.png', status: 'error' },
      { id: 3, image: 'has-image', status: 'done' },
    ]
    const result = filterPendingScenes(scenes).map(s => s.id)
    expect(result).toEqual([1, 2])
  })

  it('matches the exact contract used by useAutomation.runConcurrentQueue (regression guard)', () => {
    // 씬 5개: 2개 완료, 3개 미생성 (pending/error/blank)
    const scenes = [
      { id: 1, image: 'done-1', status: 'done' },
      { id: 2, image: 'done-2', status: 'done' },
      { id: 3, status: 'pending' },
      { id: 4, status: 'error' },
      { id: 5 },
    ]
    expect(filterPendingScenes(scenes).map(s => s.id)).toEqual([3, 4, 5])
  })
})
