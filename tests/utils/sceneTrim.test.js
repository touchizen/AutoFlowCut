import { describe, it, expect } from 'vitest'
import { isSceneEmpty, trimTrailingEmptyScenes } from '../../src/utils/sceneTrim'

describe('isSceneEmpty', () => {
  it('returns true for scene with no content + no F→V owner', () => {
    expect(isSceneEmpty({ id: 'scene_1' }, [])).toBe(true)
    expect(isSceneEmpty(
      { id: 'scene_1', prompt: '', videoT2VPrompt: '', videoI2VPrompt: '', subtitle: '' },
      []
    )).toBe(true)
  })

  it('returns false when prompt has content', () => {
    expect(isSceneEmpty({ id: 'scene_1', prompt: 'a' }, [])).toBe(false)
  })

  it('returns false when videoT2VPrompt has content', () => {
    expect(isSceneEmpty({ id: 'scene_1', videoT2VPrompt: 'x' }, [])).toBe(false)
  })

  it('returns false when videoI2VPrompt has content', () => {
    expect(isSceneEmpty({ id: 'scene_1', videoI2VPrompt: 'y' }, [])).toBe(false)
  })

  it('returns false when subtitle has content', () => {
    expect(isSceneEmpty({ id: 'scene_1', subtitle: 'hello' }, [])).toBe(false)
  })

  it('returns false when a framePair owns this scene', () => {
    expect(isSceneEmpty(
      { id: 'scene_1' },
      [{ id: 'fp_1', ownerSceneId: 'scene_1' }]
    )).toBe(false)
  })

  it('ignores framePairs that own a different scene', () => {
    expect(isSceneEmpty(
      { id: 'scene_1' },
      [{ id: 'fp_1', ownerSceneId: 'scene_2' }]
    )).toBe(true)
  })

  it('ignores framePairs with null ownerSceneId (gallery-rooted)', () => {
    expect(isSceneEmpty(
      { id: 'scene_1' },
      [{ id: 'fp_1', ownerSceneId: null }]
    )).toBe(true)
  })

  it('treats whitespace-only fields as empty', () => {
    expect(isSceneEmpty(
      { id: 'scene_1', prompt: '   ', subtitle: '\n\t' },
      []
    )).toBe(true)
  })
})

describe('trimTrailingEmptyScenes', () => {
  it('returns input unchanged if last scene has content', () => {
    const scenes = [
      { id: 'scene_1', prompt: 'a' },
      { id: 'scene_2', prompt: 'b' },
    ]
    expect(trimTrailingEmptyScenes(scenes, [])).toEqual(scenes)
  })

  it('trims a single trailing empty scene', () => {
    const scenes = [
      { id: 'scene_1', prompt: 'a' },
      { id: 'scene_2', prompt: '' },
    ]
    expect(trimTrailingEmptyScenes(scenes, [])).toEqual([scenes[0]])
  })

  it('trims multiple trailing empty scenes', () => {
    const scenes = [
      { id: 'scene_1', prompt: 'a' },
      { id: 'scene_2', prompt: '' },
      { id: 'scene_3', prompt: '' },
      { id: 'scene_4', prompt: '' },
    ]
    expect(trimTrailingEmptyScenes(scenes, [])).toEqual([scenes[0]])
  })

  it('preserves middle empty scenes (gap)', () => {
    const scenes = [
      { id: 'scene_1', prompt: 'a' },
      { id: 'scene_2', prompt: '' },
      { id: 'scene_3', prompt: 'c' },
    ]
    expect(trimTrailingEmptyScenes(scenes, [])).toEqual(scenes)
  })

  it('preserves trailing scene when a framePair owns it', () => {
    const scenes = [
      { id: 'scene_1', prompt: 'a' },
      { id: 'scene_2', prompt: '' },
    ]
    const framePairs = [{ id: 'fp_2', ownerSceneId: 'scene_2' }]
    expect(trimTrailingEmptyScenes(scenes, framePairs)).toEqual(scenes)
  })

  it('preserves trailing scene with only subtitle', () => {
    const scenes = [
      { id: 'scene_1', prompt: 'a' },
      { id: 'scene_2', prompt: '', videoT2VPrompt: '', subtitle: 'hi' },
    ]
    expect(trimTrailingEmptyScenes(scenes, [])).toEqual(scenes)
  })

  it('returns empty array when all scenes are empty', () => {
    const scenes = [
      { id: 'scene_1', prompt: '' },
      { id: 'scene_2', prompt: '' },
    ]
    expect(trimTrailingEmptyScenes(scenes, [])).toEqual([])
  })

  it('does NOT mutate input', () => {
    const scenes = [
      { id: 'scene_1', prompt: 'a' },
      { id: 'scene_2', prompt: '' },
    ]
    trimTrailingEmptyScenes(scenes, [])
    expect(scenes).toHaveLength(2)
  })

  it('returns same reference when nothing changed (perf invariant)', () => {
    const scenes = [{ id: 'scene_1', prompt: 'a' }]
    expect(trimTrailingEmptyScenes(scenes, [])).toBe(scenes)
  })
})
