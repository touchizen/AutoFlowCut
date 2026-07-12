import { describe, it, expect } from 'vitest'
import { parseStoryboardCSVRows } from '../../../src/utils/parsers.js'
import { validateStoryboardRows, buildStoryboardArtifacts } from '../../../electron/story/storyboardInput.js'
import { validateFixedScenes } from '../../../electron/story/fixedScenes.js'

// End-to-end, raw CSV bytes -> parser -> row validator -> adapter -> fixed validator.
// The adapter and the validator are independent implementations of the same contract.
const CSV = [
  'scene,prompt,subtitle,speaker,duration',
  // scene labels 10/20/30 — NOT 1/2/3. Legal per spec: ordinal is a label, not an index.
  '10,"a wide shot of the hall",안녕하세요,narrator,3',
  '10,,반갑습니다,철수,2',            // second row of the same slot, different speaker
  '20,"a close up, with ""quotes"" inside",,,4',   // visual-only slot + embedded quotes
  '30,"the final shot",끝났다,영희,5',
].join('\n')

const fixedScenes = [
  { storyId: 'uuid-a', rendererSceneId: 'scene_7', ordinal: 1 },
  { storyId: 'uuid-b', rendererSceneId: 'scene_8', ordinal: 2 },
  { storyId: 'uuid-c', rendererSceneId: 'scene_9', ordinal: 3 },
]
const roster = [{ id: '철수', name: '철수' }, { id: '영희', name: '영희' }]

describe('differential: adapter output must satisfy the independent fixed validator', () => {
  it('raw CSV -> scenes -> validateFixedScenes == success', () => {
    const parsed = parseStoryboardCSVRows(CSV)
    const validated = validateStoryboardRows(parsed, { rosterEnforced: false })
    expect(validated.success).toBe(true)

    const { scenes, scriptMd } = buildStoryboardArtifacts(validated, fixedScenes)
    console.log('scriptMd:\n' + scriptMd)
    console.log('scenes:', JSON.stringify(scenes, null, 1))

    // identity copied from slots, never minted
    expect(scenes.map((s) => s.storyId)).toEqual(['uuid-a', 'uuid-b', 'uuid-c'])
    expect(scenes.map((s) => s.rendererSceneId)).toEqual(['scene_7', 'scene_8', 'scene_9'])
    expect(scenes.map((s) => s.sceneNo)).toEqual([1, 2, 3])

    // byte-for-byte prompt copy, including the embedded quotes
    expect(scenes[1].imagePrompt).toBe('a close up, with "quotes" inside')

    // every sourceRowId exactly once, in file order
    expect(scenes.flatMap((s) => s.sourceRowIds)).toEqual(validated.rows.map((r) => r.sourceRowId))

    const res = validateFixedScenes({
      scenes, fixedScenes, variant: 'storyboard',
      speakers: roster, sourceRows: validated.rows, requireTiming: false,
    })
    expect(res).toEqual({ success: true })
  })

  it('segment ids are filename-safe and globally unique (they become audio/segments/<id>.mp3)', () => {
    const parsed = parseStoryboardCSVRows(CSV)
    const validated = validateStoryboardRows(parsed, { rosterEnforced: false })
    const { scenes } = buildStoryboardArtifacts(validated, fixedScenes)
    const ids = scenes.flatMap((s) => s.segments.map((g) => g.id))
    expect(ids.length).toBeGreaterThan(0)
    ids.forEach((id) => expect(id).toMatch(/^[A-Za-z0-9_-]+$/))
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('speaker roster is enforced end-to-end: an unknown speaker is rejected, not laundered', () => {
    const parsed = parseStoryboardCSVRows(CSV)
    const validated = validateStoryboardRows(parsed, { rosterEnforced: false })
    const { scenes } = buildStoryboardArtifacts(validated, fixedScenes)
    // roster missing 철수 -> validator must reject
    const res = validateFixedScenes({
      scenes, fixedScenes, variant: 'storyboard',
      speakers: [{ id: '영희', name: '영희' }], sourceRows: validated.rows, requireTiming: false,
    })
    expect(res.error).toBe('storyboard-speaker-unknown')
    expect(res.speakers).toContain('철수')
  })
})

describe('byte-for-byte imagePrompt', () => {
  // 스펙: CSV prompt 를 imagePrompt 로 byte-for-byte 복사한다. 기존 fixture 는 모두 이미
  // trim 된 prompt 라서 adapter 에 .trim() 을 넣어도 아무 테스트가 죽지 않았다 — 공백을
  // 실제로 가진 prompt 여야 이 불변식이 검증된다.
  it('preserves leading/trailing whitespace inside a quoted CSV prompt', () => {
    const csv = ['scene,prompt,subtitle,speaker,duration', '1,"  spaced prompt  ",hi,narrator,3'].join('\n')
    const validated = validateStoryboardRows(parseStoryboardCSVRows(csv), { rosterEnforced: false })
    expect(validated.success).toBe(true)

    const { scenes } = buildStoryboardArtifacts(validated, [
      { storyId: 'uuid-a', rendererSceneId: 'scene_1', ordinal: 1 },
    ])
    expect(scenes[0].imagePrompt).toBe('  spaced prompt  ')
  })
})
