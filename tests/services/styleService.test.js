import { describe, it, expect } from 'vitest'
import { previewStyleMatching } from '../../src/services/styleService'

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
})
