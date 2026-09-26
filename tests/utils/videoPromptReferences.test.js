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

  // === M3-11(D15): Flow 모드 — @멘션은 인라인 멘션(레퍼런스 영상 r2v). @ 토큰은 프롬프트에 남기고(엔진 계획이 멘션 세그먼트로 만든다)
  //     멘션된 ref 를 referenceImages 로 넘긴다(타입 무관, 자르지 않는다 — 상한은 엔진 계획이 거부). segments 는 null(옛 칩 경로 퇴역) ===
  const king = { id: 'king-id', type: 'character', category: 'character', name: 'king', caption: 'King', data: 'data:image/png;base64,KING', entityId: 'ent-king', flowNameSyncStatus: 'failed' }
  const castle = { id: 'castle-id', type: 'scene', category: 'scene', name: 'castle', imagePath: 'references/castle.png' }

  it('Flow: @멘션된 ref → referenceImages(동기화 상태 무관), @ 토큰 유지, segments null, missing []', () => {
    const out = buildVideoPromptWithReferences('@king이 walks slowly', [king, ...refs], null, 'flow')
    expect(out.styledPrompt).toBe('@king이 walks slowly')
    expect(out.segments).toBeNull()
    expect(out.missing).toEqual([])
    expect(out.truncated).toBe(0)
    expect(out.referenceImages).toEqual([{ category: 'character', mediaId: null, caption: 'King', name: 'king', data: 'data:image/png;base64,KING', filePath: null }])
  })

  it('Flow: 타입 무관(scene ref 도) · imagePath 는 filePath 로 옮겨 싣는다(엔진이 그 경로로 읽는다)', () => {
    const out = buildVideoPromptWithReferences('at @castle', [castle], null, 'flow')
    expect(out.referenceImages).toEqual([{ category: 'scene', mediaId: null, caption: '', name: 'castle', data: null, filePath: 'references/castle.png' }])
  })

  it('Flow: 미해결 이름은 missing(App 이 시작을 막는다), 멘션 없으면 referenceImages []', () => {
    expect(buildVideoPromptWithReferences('@ghost walks', [king], null, 'flow').missing).toEqual(['ghost'])
    const plain = buildVideoPromptWithReferences('a quiet street at night', [king], null, 'flow')
    expect(plain.referenceImages).toEqual([])
    expect(plain.segments).toBeNull()
  })

  it('Flow: 자르지 않는다 — 유일 멘션 4개면 4개(상한은 엔진 계획의 flow-references-too-many)', () => {
    const four = ['a1', 'a2', 'a3', 'a4'].map((name) => ({ id: name, type: 'character', name, data: `data:image/png;base64,${name}` }))
    const out = buildVideoPromptWithReferences('@a1 @a2 @a3 @a4 @a1', four, null, 'flow')
    expect(out.referenceImages.map((r) => r.name)).toEqual(['a1', 'a2', 'a3', 'a4'])
    expect(out.truncated).toBe(0)
  })

  it('Flow: 스타일 텍스트는 뒤에 붙고 @ 토큰은 남는다', () => {
    const out = buildVideoPromptWithReferences('@king walks', [king, ...refs], 'ref:noir-id', 'flow')
    expect(out.styledPrompt).toBe('@king walks, film noir lighting')
    expect(out.referenceImages.map((r) => r.name)).toEqual(['king'])
  })

  // 원천 없는 멘션 ref 를 빼면 그 @토큰은(다른 멘션이 없을 때) 엔진 계획에서 평문이 되어 레퍼런스 없는 영상이 과금된다 —
  //   넘겨서 엔진이 클릭 전에 flow-reference-source-missing 으로 거부하게 한다.
  it('Flow: 이미지 원천이 없는 멘션 ref 도 넘긴다(엔진이 source-missing 으로 거부 — 평문으로 새지 않게)', () => {
    const out = buildVideoPromptWithReferences('@ghostcard waves', [{ id: 'g', type: 'character', name: 'ghostcard', mediaId: 'm-old' }], null, 'flow')
    expect(out.missing).toEqual([])
    expect(out.referenceImages).toEqual([{ category: undefined, mediaId: 'm-old', caption: '', name: 'ghostcard', data: null, filePath: null }])
  })

  it('#R36: API 모드(기본)는 기존대로 ref 이미지 + segments=null', () => {
    const out = buildVideoPromptWithReferences('@hero walks', refs, null, 'api')
    expect(out.segments).toBeNull()
    expect(out.referenceImages.map(r => r.name)).toEqual(['hero'])
  })

  it('Flow: buildVideoPromptScenes 가 씬에 referenceImages 를 붙이고 @ 토큰을 남긴다', () => {
    const [{ scene }] = buildVideoPromptScenes(
      [{ id: 1, prompt: '@king runs' }], [king], null, [], 'flow',
    )
    expect(scene.prompt).toBe('@king runs')
    expect(scene.referenceImages.map((r) => r.name)).toEqual(['king'])
    expect(scene).not.toHaveProperty('segments')
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
