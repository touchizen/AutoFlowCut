/**
 * E2E: scenes.length = max(image, video, F→V, SRT) across all combinations.
 * Verifies the user's spec by running real merge functions + trim.
 */
import { describe, it, expect } from 'vitest'
import { mergeTextIntoScenes, mergeSRTIntoScenes } from '../../src/utils/parsers'
import { trimTrailingEmptyScenes } from '../../src/utils/sceneTrim'

function merge(scenes, text, fieldName, framePairs = []) {
  const opts = { fieldName, truncateToIncoming: true }
  const afterMerge = mergeTextIntoScenes(scenes, text, 3, opts)
  return trimTrailingEmptyScenes(afterMerge, framePairs)
}

describe('Integration — scenes.length = max(image, video, F→V, SRT)', () => {
  it('image=2, video=1 → scenes=2', () => {
    let scenes = []
    scenes = merge(scenes, 'a\nb', 'prompt')
    scenes = merge(scenes, 'x', 'videoT2VPrompt')
    expect(scenes).toHaveLength(2)
    expect(scenes[0].prompt).toBe('a')
    expect(scenes[0].videoT2VPrompt).toBe('x')
    expect(scenes[1].prompt).toBe('b')
    expect(scenes[1].videoT2VPrompt).toBe('')  // line 2 has no video
  })

  it('image=1, video=2 → scenes=2', () => {
    let scenes = []
    scenes = merge(scenes, 'a', 'prompt')
    scenes = merge(scenes, 'x\ny', 'videoT2VPrompt')
    expect(scenes).toHaveLength(2)
    expect(scenes[0].prompt).toBe('a')
    expect(scenes[0].videoT2VPrompt).toBe('x')
    expect(scenes[1].prompt).toBe('')           // line 2 has no image
    expect(scenes[1].videoT2VPrompt).toBe('y')
  })

  it('shrinking image when video has content does NOT remove scene', () => {
    let scenes = []
    scenes = merge(scenes, 'a\nb\nc', 'prompt')
    scenes = merge(scenes, 'x\ny\nz', 'videoT2VPrompt')
    expect(scenes).toHaveLength(3)
    // User removes image line 3 (typing only 2 lines)
    scenes = merge(scenes, 'a\nb', 'prompt')
    expect(scenes).toHaveLength(3)            // scene 3 stays (video still there)
    expect(scenes[2].prompt).toBe('')
    expect(scenes[2].videoT2VPrompt).toBe('z')
  })

  it('shrinking BOTH below current trims scenes', () => {
    let scenes = []
    scenes = merge(scenes, 'a\nb\nc', 'prompt')
    scenes = merge(scenes, 'x\ny\nz', 'videoT2VPrompt')
    // User removes image AND video line 3
    scenes = merge(scenes, 'a\nb', 'prompt')
    scenes = merge(scenes, 'x\ny', 'videoT2VPrompt')
    expect(scenes).toHaveLength(2)
  })

  it('SRT-only scenes survive', () => {
    let scenes = []
    const srt = `1\n00:00:00,000 --> 00:00:03,000\nhello\n\n2\n00:00:03,000 --> 00:00:06,000\nworld\n`
    const after = mergeSRTIntoScenes(scenes, srt)
    const trimmed = trimTrailingEmptyScenes(after, [])
    expect(trimmed).toHaveLength(2)
    expect(trimmed[0].subtitle).toBe('hello')
    expect(trimmed[1].subtitle).toBe('world')
  })

  it('F→V owner keeps a scene alive even when all text fields are empty', () => {
    const scenes = [
      { id: 'scene_1', prompt: 'a', videoT2VPrompt: '', videoI2VPrompt: '', subtitle: '' },
      { id: 'scene_2', prompt: '', videoT2VPrompt: '', videoI2VPrompt: '', subtitle: '' },
    ]
    const framePairs = [{ id: 'fp_2', ownerSceneId: 'scene_2' }]
    const trimmed = trimTrailingEmptyScenes(scenes, framePairs)
    expect(trimmed).toHaveLength(2)  // scene_2 stays because F→V owns it
  })

  it('middle empty scene (gap) is preserved', () => {
    const scenes = [
      { id: 'scene_1', prompt: 'a' },
      { id: 'scene_2', prompt: '' },
      { id: 'scene_3', prompt: 'c' },
    ]
    expect(trimTrailingEmptyScenes(scenes, [])).toHaveLength(3)
  })
})
