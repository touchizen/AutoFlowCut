import { describe, it, expect } from 'vitest'
import { SCENES_SCHEMA, validateScenesSegments } from '../../../../electron/api/llm/schemas.js'

describe('SCENES_SCHEMA speakers.appearance (V2 캐릭터 레퍼런스)', () => {
  it('speakers 아이템에 appearance 필드가 있고 required는 id/name만', () => {
    const sp = SCENES_SCHEMA.properties.speakers.items
    expect(sp.properties.appearance).toBeTruthy()
    expect(sp.required).toEqual(['id', 'name'])
  })
})

describe('SCENES_SCHEMA segment loosening (M2b-2)', () => {
  it('segment는 speaker/text를 required로 강제하지 않는다(sfx 세그먼트 수용)', () => {
    const segReq = SCENES_SCHEMA.properties.scenes.items.properties.segments.items.required
    // loose: required 없음(또는 speaker/text 미포함) — sfx는 speaker/text가 없다
    expect(segReq == null || (!segReq.includes('speaker') && !segReq.includes('text'))).toBe(true)
  })
  it('segment 스키마에 type/description 필드가 있다', () => {
    const props = SCENES_SCHEMA.properties.scenes.items.properties.segments.items.properties
    expect(props.type).toBeTruthy()
    expect(props.description).toBeTruthy()
  })
})

describe('validateScenesSegments (M2b-2 post-validation)', () => {
  const scene = (segments) => [{ sceneNo: 1, summary: 'S', segments }]

  it('narration은 speaker+text가 있으면 통과', () => {
    expect(() => validateScenesSegments(scene([{ speaker: 'narrator', text: 'hi' }]))).not.toThrow()
  })
  it('type 없는 세그먼트는 narration으로 취급 — text 없으면 throw', () => {
    expect(() => validateScenesSegments(scene([{ speaker: 'narrator' }]))).toThrow(/narration/)
  })
  it('narration에 speaker 없으면 throw', () => {
    expect(() => validateScenesSegments(scene([{ text: 'hi' }]))).toThrow(/narration/)
  })
  it('sfx는 description이 있으면 통과(speaker/text 불필요)', () => {
    expect(() => validateScenesSegments(scene([{ type: 'sfx', description: 'thunder' }]))).not.toThrow()
  })
  it('sfx에 description 없으면 throw', () => {
    expect(() => validateScenesSegments(scene([{ type: 'sfx' }]))).toThrow(/sfx/)
  })
  it('sfx description이 공백만이면 throw', () => {
    expect(() => validateScenesSegments(scene([{ type: 'sfx', description: '   ' }]))).toThrow(/sfx/)
  })
  it('알 수 없는 type이면 throw', () => {
    expect(() => validateScenesSegments(scene([{ type: 'music', description: 'x' }]))).toThrow(/unknown segment type/)
  })
  it('narration과 sfx가 섞여 있어도 각각 검증', () => {
    const scenes = scene([
      { speaker: 'narrator', text: '문이 열렸다' },
      { type: 'sfx', description: 'door creaking open' },
      { speaker: 'a', text: '누구세요?' },
    ])
    expect(() => validateScenesSegments(scenes)).not.toThrow()
  })
})
