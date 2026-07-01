import { describe, it, expect } from 'vitest'
import {
  VIDEO_REFERENCE_LIMIT,
  buildVideoPromptScenes,
  buildVideoPromptWithReferences,
  isUsableVideoReference,
} from '../../src/utils/videoPromptReferences'

const refs = [
  {
    id: 'hero-id',
    type: 'character',
    category: 'character',
    name: 'hero',
    caption: 'Hero card',
    data: 'data:image/png;base64,HERO',
  },
  {
    id: 'noir-id',
    type: 'style',
    category: 'style',
    name: 'noir-style',
    caption: 'Noir style',
    prompt: 'film noir lighting',
    data: 'data:image/jpeg;base64,STYLE',
  },
]

describe('videoPromptReferences', () => {
  it('strips known @mentions, preserves Hangul particles, and returns inline refs', () => {
    const out = buildVideoPromptWithReferences('@hero가 walks through rain', refs, null)

    expect(out.styledPrompt).toBe('hero가 walks through rain')
    expect(out.missing).toEqual([])
    expect(out.referenceImages).toEqual([
      {
        category: 'character',
        mediaId: null,
        caption: 'Hero card',
        name: 'hero',
        data: 'data:image/png;base64,HERO',
        filePath: null,
      },
    ])
  })

  it('applies selected style prompt without sending style images as Veo asset references', () => {
    const out = buildVideoPromptWithReferences('@hero walks', refs, 'ref:noir-id')

    expect(out.styledPrompt).toBe('hero walks, film noir lighting')
    expect(out.referenceImages.map(r => r.name)).toEqual(['hero'])
  })

  it('applies prompt-only style cards without adding a video reference image', () => {
    const promptOnlyStyle = {
      id: 'prompt-only-id',
      type: 'style',
      category: 'style',
      name: 'prompt-only',
      prompt: 'soft watercolor style',
    }

    const out = buildVideoPromptWithReferences('hero walks', [promptOnlyStyle], 'ref:prompt-only-id')

    expect(out.styledPrompt).toBe('hero walks, soft watercolor style')
    expect(out.referenceImages).toEqual([])
    expect(out.truncated).toBe(0)
  })

  // === #R36: Flow 모드 — @멘션을 ref 이미지가 아니라 컴포저 칩(segments)으로 ===
  const syncedRefs = [{
    id: 'king-id', type: 'character', category: 'character', name: 'king',
    data: 'data:image/png;base64,KING', entityId: 'ent-king', flowNameSyncStatus: 'synced',
  }]

  it('#R36: Flow 모드는 @멘션을 segments(칩)로 만들고 referenceImages 를 비운다', () => {
    const out = buildVideoPromptWithReferences('@king walks slowly', syncedRefs, null, 'flow')
    expect(out.referenceImages).toEqual([])          // ref 이미지 주입 안 함
    expect(Array.isArray(out.segments)).toBe(true)
    expect(out.segments.some(s => s.type === 'mention' && s.name === 'king')).toBe(true)
    expect(out.segments.some(s => s.type === 'text')).toBe(true)
  })

  it('#R36: Flow 모드 + 멘션 없으면 segments=null(일반 텍스트 T2V)', () => {
    const out = buildVideoPromptWithReferences('a quiet street at night', syncedRefs, null, 'flow')
    expect(out.segments).toBeNull()
    expect(out.referenceImages).toEqual([])
  })

  it('#R36: API 모드(기본)는 기존대로 ref 이미지 + segments=null', () => {
    const out = buildVideoPromptWithReferences('@hero walks', refs, null, 'api')
    expect(out.segments).toBeNull()
    expect(out.referenceImages.map(r => r.name)).toEqual(['hero'])
  })

  it('#R36: buildVideoPromptScenes 가 씬에 segments 를 붙인다(Flow)', () => {
    const [{ scene }] = buildVideoPromptScenes(
      [{ id: 1, prompt: '@king runs' }], syncedRefs, null, [], 'flow',
    )
    expect(scene.segments.some(s => s.type === 'mention' && s.name === 'king')).toBe(true)
    expect(scene.referenceImages).toEqual([])
  })

  it('does not send selected data-only style images as Veo asset references', () => {
    const dataOnlyStyle = {
      id: 'style-data-id',
      type: 'style',
      category: 'style',
      data: 'data:image/png;base64,STYLE_DATA',
    }

    const out = buildVideoPromptWithReferences('hero walks', [dataOnlyStyle], 'ref:style-data-id')

    expect(out.referenceImages).toEqual([])
    expect(out.truncated).toBe(0)
  })

  it('video @reference eligibility excludes style and legacy mediaId-only refs', () => {
    expect(isUsableVideoReference({ type: 'character', name: 'hero', filePath: '/refs/hero.png' })).toBe(true)
    expect(isUsableVideoReference({ type: 'scene', data: 'data:image/png;base64,SCENE' })).toBe(true)
    expect(isUsableVideoReference({ referenceType: 'style', name: 'noir', data: 'data:image/png;base64,STYLE' })).toBe(false)
    expect(isUsableVideoReference({ type: 'style', name: 'noir', filePath: '/refs/noir.png' })).toBe(false)
    expect(isUsableVideoReference({ category: 'style', name: 'noir', filePath: '/refs/noir.png' })).toBe(false)
    expect(isUsableVideoReference({ category: 'MEDIA_CATEGORY_STYLE', name: 'noir', filePath: '/refs/noir.png' })).toBe(false)
    expect(isUsableVideoReference({ type: 'character', name: 'legacy', mediaId: 'm-1' })).toBe(false)
  })

  it('preserves explicit asset reference metadata for downstream video validation', () => {
    const out = buildVideoPromptWithReferences('@hero walks', [
      {
        id: 'hero-id',
        category: 'character',
        referenceType: 'asset',
        name: 'hero',
        mimeType: 'image/png',
        data: 'data:image/png;base64,HERO',
      },
    ], null)

    expect(out.referenceImages[0]).toMatchObject({
      category: 'character',
      referenceType: 'asset',
      name: 'hero',
      mimeType: 'image/png',
    })
  })

  it('ignores name-only non-style refs that have no image source', () => {
    const placeholderRef = {
      id: 'placeholder-id',
      type: 'character',
      category: 'character',
      name: 'placeholder',
    }

    const out = buildVideoPromptWithReferences('@placeholder walks', [placeholderRef], null)

    expect(out.styledPrompt).toBe('@placeholder walks')
    expect(out.missing).toEqual(['placeholder'])
    expect(out.referenceImages).toEqual([])
    expect(out.truncated).toBe(0)
  })

  it('ignores legacy mediaId-only refs because GenAI cannot resolve mediaId', () => {
    const legacyRef = {
      id: 'legacy-id',
      type: 'character',
      category: 'character',
      name: 'legacy',
      mediaId: 'flow-media-id',
    }

    const out = buildVideoPromptWithReferences('@legacy runs', [legacyRef], null)

    expect(out.styledPrompt).toBe('@legacy runs')
    expect(out.missing).toEqual(['legacy'])
    expect(out.referenceImages).toEqual([])
  })

  it('keeps unknown @mentions visible and reports them', () => {
    const out = buildVideoPromptWithReferences('@hero meets @ghost', refs, null)

    expect(out.styledPrompt).toBe('hero meets @ghost')
    expect(out.missing).toEqual(['ghost'])
    expect(out.referenceImages.map(r => r.name)).toEqual(['hero'])
  })

  it('limits video reference images to the first three valid refs', () => {
    const manyRefs = ['a', 'b', 'c', 'd'].map(name => ({
      id: name,
      name,
      category: 'character',
      data: `data:image/png;base64,${name.toUpperCase()}`,
    }))

    const out = buildVideoPromptWithReferences('@a @b @c @d move', manyRefs, null)

    expect(VIDEO_REFERENCE_LIMIT).toBe(3)
    expect(out.styledPrompt).toBe('a b c @d move')
    expect(out.referenceImages.map(r => r.name)).toEqual(['a', 'b', 'c'])
    expect(out.truncated).toBe(1)
  })

  it('keeps @ prefix for truncated refs so the prompt shows they were not sent', () => {
    const manyRefs = ['a', 'b', 'c', 'd'].map(name => ({
      id: name,
      name,
      category: 'character',
      data: `data:image/png;base64,${name.toUpperCase()}`,
    }))

    const out = buildVideoPromptWithReferences('@a @b @c @d move', manyRefs, null)

    expect(out.styledPrompt).toContain('@d')
    expect(out.referenceImages.map(r => r.name)).toEqual(['a', 'b', 'c'])
  })

  it('does not let selected style images consume the Veo reference limit', () => {
    const manyRefs = ['a', 'b', 'c'].map(name => ({
      id: name,
      name,
      category: 'character',
      data: `data:image/png;base64,${name.toUpperCase()}`,
    }))
    const styleRef = {
      id: 'style-id',
      type: 'style',
      category: 'style',
      name: 'style-image',
      prompt: 'bold style',
      data: 'data:image/png;base64,STYLE',
    }

    const out = buildVideoPromptWithReferences('@a @b @c move', [...manyRefs, styleRef], 'ref:style-id')

    expect(out.styledPrompt).toBe('a b c move, bold style')
    expect(out.referenceImages.map(r => r.name)).toEqual(['a', 'b', 'c'])
    expect(out.truncated).toBe(0)
  })

  it('builds video scenes with cleaned prompt, references, and SRT-derived targetDuration', () => {
    const prepared = buildVideoPromptScenes(
      [{ id: 'v1', prompt: '@hero enters', srtLineIds: ['sub_1'] }],
      refs,
      'ref:noir-id',
      [{ id: 'sub_1', startTime: 10, endTime: 14.5, text: 'hero enters' }]
    )

    expect(prepared).toHaveLength(1)
    expect(prepared[0].missing).toEqual([])
    expect(prepared[0].truncated).toBe(0)
    expect(prepared[0].scene).toMatchObject({
      id: 'v1',
      prompt: 'hero enters, film noir lighting',
      targetDuration: 4.5,
    })
    expect(prepared[0].scene.referenceImages.map(r => r.name)).toEqual(['hero'])
  })
})
