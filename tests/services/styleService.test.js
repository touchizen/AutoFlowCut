import { describe, it, expect } from 'vitest'
import { previewStyleMatching, normalizeStyleId, findAutoStyle } from '../../src/services/styleService'

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
      { id: 3, style_tag: 'gothic:moody' }  // 둘 다 ref/preset에 없음 — unmatched
    ]
    const refs = [{ id: 10, type: 'style', name: 'Noir', prompt: 'noir' }]
    // presets 명시 안 함 → STYLE_PRESETS 사용. scene 1/2는 ref Noir 매칭 우선,
    // scene 3는 둘 다 토큰이 ref에도 preset에도 없음 → unmatched.
    const result = previewStyleMatching(scenes, refs, { presets: [] })
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

  it('matches preset by token in multi-tag style_tag (P2 fix)', () => {
    // 사용자가 dropdown으로 cinematic + noir 두 토큰 입력. 한 토큰만 preset 매칭이어도 적용돼야.
    const scenes = [{ id: 1, style_tag: 'cinematic, noir' }]
    const result = previewStyleMatching(scenes, [], {
      presets: [{ id: 'cinematic', name_ko: '시네마틱', name_en: 'Cinematic' }]
    })
    expect(result.matches).toEqual([
      { sceneId: 1, styleName: '시네마틱', source: 'preset' }
    ])
  })

  it('matches preset by token regardless of order (multi-tag)', () => {
    const scenes = [{ id: 1, style_tag: 'noir, cinematic' }]
    const result = previewStyleMatching(scenes, [], {
      presets: [{ id: 'cinematic', name_ko: '시네마틱', name_en: 'Cinematic' }]
    })
    expect(result.matches).toEqual([
      { sceneId: 1, styleName: '시네마틱', source: 'preset' }
    ])
  })

  it('matches preset by name_ko token in multi-tag', () => {
    const scenes = [{ id: 1, style_tag: 'noir, 시네마틱' }]
    const result = previewStyleMatching(scenes, [], {
      presets: [{ id: 'cinematic', name_ko: '시네마틱', name_en: 'Cinematic' }]
    })
    expect(result.matches).toEqual([
      { sceneId: 1, styleName: '시네마틱', source: 'preset' }
    ])
  })
})

describe('normalizeStyleId', () => {
  it('returns null for null/undefined/empty', () => {
    expect(normalizeStyleId(null)).toBeNull()
    expect(normalizeStyleId(undefined)).toBeNull()
    expect(normalizeStyleId('')).toBeNull()
  })

  it('passes through ref:* unchanged', () => {
    expect(normalizeStyleId('ref:1773499846144')).toBe('ref:1773499846144')
    expect(normalizeStyleId('ref:abc')).toBe('ref:abc')
  })

  it('passes through preset:* unchanged (no double-wrap)', () => {
    expect(normalizeStyleId('preset:korean-ani')).toBe('preset:korean-ani')
    expect(normalizeStyleId('preset:noir')).toBe('preset:noir')
  })

  it('wraps plain id in preset: (legacy MCP backward compat)', () => {
    expect(normalizeStyleId('korean-ani')).toBe('preset:korean-ani')
    expect(normalizeStyleId('cinematic')).toBe('preset:cinematic')
  })

  it('coerces non-string ids to string before checking prefix', () => {
    expect(normalizeStyleId(12345)).toBe('preset:12345')
  })
})

describe('findAutoStyle', () => {
  it('returns null when no style refs exist', () => {
    expect(findAutoStyle([])).toBeNull()
    expect(findAutoStyle([{ id: 1, type: 'character', mediaId: 'm-1' }])).toBeNull()
  })

  it('finds style ref with mediaId', () => {
    const refs = [{ id: 10, type: 'style', mediaId: 'm-10' }]
    expect(findAutoStyle(refs)).toBe('ref:10')
  })

  it('finds style ref with prompt only (no mediaId) — production parity', () => {
    // Production applyStyle/_prepareStyleRefs apply prompt-only style refs.
    // findAutoStyle must surface those, otherwise MCP auto-fallback silently
    // skips a usable style card just because no image was uploaded.
    const refs = [{ id: 20, type: 'style', prompt: 'noir vibes' /* no mediaId */ }]
    expect(findAutoStyle(refs)).toBe('ref:20')
  })

  it('returns null for style refs with neither prompt nor mediaId (truly empty)', () => {
    const refs = [{ id: 30, type: 'style', name: 'placeholder' }]
    expect(findAutoStyle(refs)).toBeNull()
  })

  it('returns the first matching style ref (array order)', () => {
    const refs = [
      { id: 1, type: 'character', mediaId: 'm-1' },
      { id: 2, type: 'style', prompt: 'first' },
      { id: 3, type: 'style', mediaId: 'm-3' },
    ]
    expect(findAutoStyle(refs)).toBe('ref:2')
  })
})
