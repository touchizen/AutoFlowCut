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
      { id: 1, prompt: 'p1', image: 'data:image/png;base64,abc' },
      { id: 2, prompt: 'p2' },
    ]
    expect(filterPendingScenes(scenes).map(s => s.id)).toEqual([2])
  })

  it('excludes scenes that have an imagePath (saved to disk)', () => {
    const scenes = [
      { id: 1, prompt: 'p1', imagePath: '/tmp/scene_1.png' },
      { id: 2, prompt: 'p2' },
    ]
    expect(filterPendingScenes(scenes).map(s => s.id)).toEqual([2])
  })

  it('includes scenes with prompt and no image regardless of status', () => {
    const scenes = [{ id: 1, prompt: 'p1' }, { id: 2, prompt: 'p2', status: undefined }]
    expect(filterPendingScenes(scenes)).toEqual(scenes)
  })

  it('includes scenes explicitly marked pending or error (even if other fields oddly set)', () => {
    const scenes = [
      { id: 1, prompt: 'p1', image: 'has-image-but-status-pending', status: 'pending' },
      { id: 2, prompt: 'p2', imagePath: '/tmp/x.png', status: 'error' },
      { id: 3, prompt: 'p3', image: 'has-image', status: 'done' },
    ]
    const result = filterPendingScenes(scenes).map(s => s.id)
    expect(result).toEqual([1, 2])
  })

  it('matches the exact contract used by useAutomation.runConcurrentQueue (regression guard)', () => {
    const scenes = [
      { id: 1, prompt: 'p1', image: 'done-1', status: 'done' },
      { id: 2, prompt: 'p2', image: 'done-2', status: 'done' },
      { id: 3, prompt: 'p3', status: 'pending' },
      { id: 4, prompt: 'p4', status: 'error' },
      { id: 5, prompt: 'p5' },
    ]
    expect(filterPendingScenes(scenes).map(s => s.id)).toEqual([3, 4, 5])
  })

  // ─── P1 regression: video-only scenes ────────────────────
  it('excludes scenes that have only videoT2VPrompt (no image prompt)', () => {
    // ep02-style 시연: 6번 씬만 video-text 탭에서 prompt 입력 → 다른 씬은 prompt=''
    // 이미지 생성 시 prompt 빈 씬은 제외되어야 한다.
    const scenes = [
      { id: 1, prompt: '', videoT2VPrompt: '비디오 프롬프트' },
      { id: 2, prompt: 'image only' },
      { id: 3, prompt: '', videoT2VPrompt: '비디오만 2' },
      { id: 4, prompt: 'image with video', videoT2VPrompt: '둘 다' },
    ]
    expect(filterPendingScenes(scenes).map(s => s.id)).toEqual([2, 4])
  })

  it('excludes scenes with null/undefined prompt regardless of status', () => {
    const scenes = [
      { id: 1, prompt: null, status: 'pending' },
      { id: 2, prompt: undefined, status: 'error' },
      { id: 3, prompt: '', status: 'pending' },
      { id: 4, prompt: 'real prompt', status: 'pending' },
    ]
    expect(filterPendingScenes(scenes).map(s => s.id)).toEqual([4])
  })
})
