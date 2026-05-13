import { describe, it, expect } from 'vitest'
import { previewStyleMatching, pickAutoStyleFallback } from '../../src/services/styleService'

describe('previewStyleMatching', () => {
  it('returns empty matches for no scenes', () => {
    const result = previewStyleMatching([], [])
    expect(result).toEqual({ matches: [], unmatched: [], styleSummary: [] })
  })

  it('matches scene style_tag to reference name (exact match)', () => {
    const scenes = [
      { id: 1, style_tag: '누아르' },
      { id: 2, style_tag: '누아르' },
      { id: 3, style_tag: '' }
    ]
    const refs = [
      { id: 10, type: 'style', name: '누아르', prompt: 'noir lighting' }
    ]
    const result = previewStyleMatching(scenes, refs)
    expect(result.matches).toEqual([
      { sceneId: 1, styleName: '누아르', source: 'ref' },
      { sceneId: 2, styleName: '누아르', source: 'ref' }
    ])
    expect(result.unmatched).toEqual([3])
    expect(result.styleSummary).toEqual([{ name: '누아르', count: 2 }])
  })

  it('falls back to STYLE_PRESETS when no reference matches', () => {
    const scenes = [{ id: 1, style_tag: 'cinematic' }]
    const refs = []
    const result = previewStyleMatching(scenes, refs, {
      presets: [{ id: 'cinematic', name_ko: '시네마틱', name_en: 'Cinematic', prompt_en: 'cinematic' }]
    })
    expect(result.matches).toEqual([
      { sceneId: 1, styleName: '시네마틱', source: 'preset' }
    ])
    expect(result.styleSummary).toEqual([{ name: '시네마틱', count: 1 }])
  })

  it('reference takes precedence over preset for same tag', () => {
    const scenes = [{ id: 1, style_tag: 'noir' }]
    const refs = [{ id: 10, type: 'style', name: 'noir', prompt: 'custom noir' }]
    const result = previewStyleMatching(scenes, refs, {
      presets: [{ id: 'noir', name_ko: '누아르', name_en: 'Noir' }]
    })
    expect(result.matches[0]).toMatchObject({ source: 'ref', styleName: 'noir' })
  })

  it('summarizes by descending count', () => {
    const scenes = [
      { id: 1, style_tag: 'A' },
      { id: 2, style_tag: 'B' },
      { id: 3, style_tag: 'A' },
      { id: 4, style_tag: 'A' },
      { id: 5, style_tag: 'B' }
    ]
    const refs = [
      { id: 10, type: 'style', name: 'A', prompt: 'a' },
      { id: 11, type: 'style', name: 'B', prompt: 'b' }
    ]
    const result = previewStyleMatching(scenes, refs)
    expect(result.styleSummary).toEqual([
      { name: 'A', count: 3 },
      { name: 'B', count: 2 }
    ])
  })

  it('handles missing style_tag gracefully', () => {
    const scenes = [{ id: 1 }, { id: 2, style_tag: null }]
    const result = previewStyleMatching(scenes, [])
    expect(result.matches).toEqual([])
    expect(result.unmatched).toEqual([1, 2])
  })

  it('matches case-insensitively (production parity)', () => {
    const scenes = [{ id: 1, style_tag: 'Noir' }]
    const refs = [{ id: 10, type: 'style', name: 'noir', prompt: 'noir' }]
    const result = previewStyleMatching(scenes, refs)
    expect(result.matches).toEqual([
      { sceneId: 1, styleName: 'noir', source: 'ref' }
    ])
  })

  it('handles multi-tag style_tag (comma/semicolon/colon split)', () => {
    const scenes = [
      { id: 1, style_tag: 'noir, cinematic' },
      { id: 2, style_tag: 'gothic;noir' },
      { id: 3, style_tag: 'cinematic:moody' }
    ]
    const refs = [{ id: 10, type: 'style', name: 'Noir', prompt: 'noir' }]
    const result = previewStyleMatching(scenes, refs)
    expect(result.matches).toEqual([
      { sceneId: 1, styleName: 'Noir', source: 'ref' },
      { sceneId: 2, styleName: 'Noir', source: 'ref' }
    ])
    expect(result.unmatched).toEqual([3])
  })

  it('takes only the first matching ref per scene', () => {
    const scenes = [{ id: 1, style_tag: 'noir, cinematic' }]
    const refs = [
      { id: 10, type: 'style', name: 'noir', prompt: 'a' },
      { id: 11, type: 'style', name: 'cinematic', prompt: 'b' }
    ]
    const result = previewStyleMatching(scenes, refs)
    expect(result.matches).toHaveLength(1)
    expect(result.matches[0]).toMatchObject({ sceneId: 1, source: 'ref' })
  })

  it('does not match style ref without prompt OR mediaId (truly empty)', () => {
    // Production applies a style ref via either prompt (resolveSceneStyle)
    // or mediaId (image ref injection). Refs with neither contribute nothing.
    const scenes = [{ id: 1, style_tag: '내 시그니처' }]
    const refs = [{ id: 10, type: 'style', name: '내 시그니처' /* no prompt, no mediaId */ }]
    const result = previewStyleMatching(scenes, refs)
    expect(result.matches).toEqual([])
    expect(result.unmatched).toEqual([1])
  })

  it('matches image-only style ref (mediaId without prompt)', () => {
    // Production injects image refs by mediaId even when prompt is empty.
    // Preview must reflect this so users who only upload an image see the match.
    const scenes = [{ id: 1, style_tag: '내 누아르' }]
    const refs = [{ id: 10, type: 'style', name: '내 누아르', mediaId: 'm-abc' /* no prompt */ }]
    const result = previewStyleMatching(scenes, refs)
    expect(result.matches).toEqual([
      { sceneId: 1, styleName: '내 누아르', source: 'ref' }
    ])
  })

  it('falls through to preset when matching ref has no prompt', () => {
    const scenes = [{ id: 1, style_tag: 'cinematic' }]
    const refs = [{ id: 10, type: 'style', name: 'cinematic' /* no prompt */ }]
    const result = previewStyleMatching(scenes, refs, {
      presets: [{ id: 'cinematic', name_ko: '시네마틱', name_en: 'Cinematic' }]
    })
    expect(result.matches).toEqual([
      { sceneId: 1, styleName: '시네마틱', source: 'preset' }
    ])
  })
})

describe('pickAutoStyleFallback', () => {
  const refWithMedia = { id: 1, type: 'style', mediaId: 'm-1' }

  it('returns first auto style when no scene has style_tag', () => {
    const scenes = [{ id: 1 }, { id: 2, style_tag: '' }, { id: 3, style_tag: '   ' }]
    expect(pickAutoStyleFallback(scenes, [refWithMedia])).toBe('ref:1')
  })

  it('returns null when at least one scene has style_tag (preserves auto-match intent)', () => {
    const scenes = [{ id: 1, style_tag: 'noir' }, { id: 2 }]
    expect(pickAutoStyleFallback(scenes, [refWithMedia])).toBeNull()
  })

  it('returns null when no style refs exist', () => {
    expect(pickAutoStyleFallback([{ id: 1 }], [])).toBeNull()
  })

  it('returns null for empty scenes (no work to do)', () => {
    expect(pickAutoStyleFallback([], [refWithMedia])).toBeNull()
  })
})
