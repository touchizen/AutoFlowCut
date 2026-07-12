import { describe, expect, it } from 'vitest'
import { parseStoryboardCSVRows } from '../../../src/utils/parsers'
import { validateStoryboardRows } from '../../../electron/story/storyboardInput'

const validate = (body, options) => validateStoryboardRows(parseStoryboardCSVRows(body), options)

const corruptedHeaders = {
  scene: [
    ['full-width', 'ｓｃｅｎｅ'],
    ['internal ZWSP', 'sce\u200Bne'],
    ['Cyrillic homoglyph', 's\u0441ene'],
    ['word joiner', 'scene\u2060'],
    ['internal TAB', 'sce\tne'],
    ['SHY', 'sce\u00ADne'],
  ],
  subtitle: [
    ['full-width', 'ｓｕｂｔｉｔｌｅ'],
    ['internal ZWSP', 'sub\u200Btitle'],
    ['Cyrillic homoglyph', 'subt\u0456tle'],
    ['word joiner', 'subtitle\u2060'],
    ['internal TAB', 'sub\ttitle'],
    ['SHY', 'sub\u00ADtitle'],
  ],
  prompt: [
    ['full-width', 'ｐｒｏｍｐｔ'],
    ['internal ZWSP', 'pro\u200Bmpt'],
    ['Cyrillic homoglyph', '\u0440rompt'],
    ['word joiner', 'prompt\u2060'],
    ['internal TAB', 'pro\tmpt'],
    ['SHY', 'pro\u00ADmpt'],
  ],
}

describe('validateStoryboardRows header shape (D24a-1)', () => {
  it.each(corruptedHeaders.scene)(
    '%s scene header를 positional fallback으로 해석하지 않고 storyboard-header-unknown으로 거부한다',
    (_label, header) => {
      const csv = `${header},prompt,subtitle,speaker\n1,Cabin,Hello,narrator\n1,Cabin,World,narrator\n2,River,Bye,narrator`

      expect(validate(csv)).toEqual({
        success: false,
        error: 'storyboard-header-unknown',
        sourceRowIds: [],
      })
    },
  )

  it.each(corruptedHeaders.subtitle)(
    '%s subtitle header를 visual-only fallback으로 해석하지 않고 storyboard-header-unknown으로 거부한다',
    (_label, header) => {
      const csv = `scene,prompt,${header},speaker,duration\n1,Cabin,Hello,narrator,2\n2,River,Bye,narrator,2`

      expect(validate(csv)).toEqual({
        success: false,
        error: 'storyboard-header-unknown',
        sourceRowIds: [],
      })
    },
  )

  it.each(corruptedHeaders.prompt)(
    '%s prompt header를 empty prompt fallback으로 해석하지 않고 storyboard-header-unknown으로 거부한다',
    (_label, header) => {
      const csv = `scene,${header},subtitle,speaker\n1,Cabin,Hello,narrator\n2,River,Bye,narrator`

      expect(validate(csv)).toEqual({
        success: false,
        error: 'storyboard-header-unknown',
        sourceRowIds: [],
      })
    },
  )

  it('author-supplied unbindable column이 absent-column success path로 들어가지 않는 shape를 보장한다', () => {
    const parsed = parseStoryboardCSVRows('scene,prompt,sub\u200Btitle,speaker,duration\n1,P,S,narrator,2')

    expect(parsed.unknownHeaders).toEqual(['sub\u200Btitle'])
    expect(validateStoryboardRows(parsed).error).toBe('storyboard-header-unknown')
  })

  it.each(['constructor', '__proto__'])(
    'Object prototype name %s를 allowlist own alias로 오인하지 않고 거부한다',
    (header) => {
      const parsed = parseStoryboardCSVRows(`scene,prompt,subtitle,speaker,${header}\n1,P,S,narrator,private`)

      expect(parsed.unknownHeaders).toEqual([header])
      expect(validateStoryboardRows(parsed).error).toBe('storyboard-header-unknown')
    },
  )

  it.each([
    ['prompt/prompt_en', 'scene,prompt,prompt_en,subtitle,speaker\n1,P,P2,S,narrator'],
    ['subtitle/subtitle_ko', 'scene,prompt,subtitle,subtitle_ko,speaker\n1,P,S,S2,narrator'],
    ['characters/character', 'scene,prompt,subtitle,speaker,characters,character\n1,P,S,narrator,A,B'],
    ['scene_tag/background', 'scene,prompt,subtitle,speaker,scene_tag,background\n1,P,S,narrator,A,B'],
  ])('%s alias pair가 같은 bound field를 중복 정의하면 거부한다', (_label, csv) => {
    expect(validate(csv)).toEqual({
      success: false,
      error: 'storyboard-header-duplicate',
      sourceRowIds: [],
    })
  })

  it.each([
    ['math-bold', '𝐬𝐜𝐞𝐧𝐞'],
    ['Greek epsilon', 'scεne'],
    ['small Roman numeral d NFKC fold', 'ⅾuration'],
    ['circled s NFKC fold', 'ⓢcene'],
    ['ligature NFKC fold', 'proﬁle'],
    ['Turkish dotted I', 'duratİon'],
  ])('%s header를 exact ASCII allowlist identity로 복구하지 않는다', (_label, header) => {
    const parsed = parseStoryboardCSVRows(`scene,prompt,subtitle,speaker,${header}\n1,P,S,narrator,private`)

    expect(parsed.unknownHeaders).toEqual([header])
    expect(validateStoryboardRows(parsed).error).toBe('storyboard-header-unknown')
  })
})

describe('validateStoryboardRows tagged payload shape', () => {
  const validRows = parseStoryboardCSVRows('scene,prompt,subtitle,speaker\n1,P,S,narrator').rows

  it.each([
    ['bare array', validRows],
    ['partial object', { rows: validRows }],
    ['string markers', { rows: validRows, duplicateHeaders: '', unknownHeaders: '' }],
    ['undefined', undefined],
    ['null', null],
  ])('%s를 fail-closed scene-invalid로 거부한다', (_label, parsed) => {
    expect(validateStoryboardRows(parsed)).toEqual({
      success: false,
      error: 'storyboard-scene-invalid',
      sourceRowIds: [],
    })
  })
})

describe('validateStoryboardRows scene grouping (D24a-1)', () => {
  it('duplicate scene header를 storyboard-header-duplicate로 거부한다', () => {
    const csv = `scene,prompt,subtitle,speaker,duration,scene
1,p1,s1,narrator,1,
1,p2,s2,narrator,1,
3,p3,s3,narrator,1,`

    expect(validate(csv)).toEqual({
      success: false,
      error: 'storyboard-header-duplicate',
      sourceRowIds: [],
    })
  })

  it('case가 다른 scene/Scene duplicate header를 storyboard-header-duplicate로 거부한다', () => {
    const csv = `scene,prompt,subtitle,speaker,duration,Scene
1,p1,s1,narrator,1,
1,p2,s2,narrator,1,
3,p3,s3,narrator,1,`

    expect(validate(csv)).toEqual({
      success: false,
      error: 'storyboard-header-duplicate',
      sourceRowIds: [],
    })
  })

  it('scene-only row가 있는 duplicate scene header도 phantom row 해석 전에 거부한다', () => {
    const csv = `scene,prompt,subtitle,speaker,duration,scene
1,p1,s1,narrator,1,
2,,,,,
3,p3,s3,narrator,1,`

    expect(validate(csv)).toEqual({
      success: false,
      error: 'storyboard-header-duplicate',
      sourceRowIds: [],
    })
  })

  it.each([
    ['다른 필수 컬럼', 'scene,prompt,subtitle,speaker,duration,subtitle\n1,p1,s1,narrator,1,shadow'],
    ['주변 공백', 'scene,prompt,subtitle,speaker,duration, subtitle \n1,p1,s1,narrator,1,shadow'],
    ['header-only CSV', 'scene,prompt,scene'],
  ])('%s duplicate header를 canonical identity로 거부한다', (_label, csv) => {
    expect(validate(csv)).toEqual({
      success: false,
      error: 'storyboard-header-duplicate',
      sourceRowIds: [],
    })
  })

  it('scene 컬럼의 중간 빈 셀은 직전 ordinal을 carry-forward한다', () => {
    const csv = 'scene,prompt,subtitle,speaker,duration\n1,P1,S1,narrator,2\n,,S2,narrator,2\n2,P2,S3,narrator,2'
    const result = validate(csv)

    expect(result.success).toBe(true)
    expect(result.slots.map((slot) => ({
      sceneOrdinal: slot.sceneOrdinal,
      sourceRowIds: slot.sourceRowIds,
      plannedMs: slot.plannedMs,
    }))).toEqual([
      { sceneOrdinal: 1, sourceRowIds: ['storyboard-row-1', 'storyboard-row-2'], plannedMs: 4000 },
      { sceneOrdinal: 2, sourceRowIds: ['storyboard-row-3'], plannedMs: 2000 },
    ])
  })

  it('scene 컬럼의 첫 data row가 빈 셀이면 storyboard-scene-invalid로 거부한다', () => {
    const result = validate('scene,prompt,subtitle,speaker\n,P,S,narrator\n1,P2,S2,narrator')

    expect(result).toEqual({
      success: false,
      error: 'storyboard-scene-invalid',
      sourceRowIds: ['storyboard-row-1'],
    })
  })

  it('legacy scene_tag alias 형태의 비정수 scene 셀은 storyboard-scene-invalid로 거부한다', () => {
    const result = validate('scene,prompt,subtitle,speaker\ncourtyard,P,S,narrator')

    expect(result).toEqual({
      success: false,
      error: 'storyboard-scene-invalid',
      sourceRowIds: ['storyboard-row-1'],
    })
  })

  it('중간 scene-only two 행을 보존해 storyboard-scene-invalid로 거부한다', () => {
    const csv = 'scene,prompt,subtitle,speaker,duration\n1,p1,a,narrator,2\ntwo,,,,\n,,b,narrator,2\n2,p2,c,narrator,2'
    const parsed = parseStoryboardCSVRows(csv)
    const rows = parsed.rows

    expect(rows.map((row) => row.sceneOrdinal)).toEqual([1, null, 1, 2])
    expect(validateStoryboardRows(parsed)).toEqual({
      success: false,
      error: 'storyboard-scene-invalid',
      sourceRowIds: ['storyboard-row-2'],
    })
  })

  it('중간 scene-only 2.0 행을 보존해 storyboard-scene-invalid로 거부한다', () => {
    const csv = 'scene,prompt,subtitle,speaker,duration\n1,p1,a,narrator,2\n2.0,,,,\n,,b,narrator,2'
    const parsed = parseStoryboardCSVRows(csv)
    const rows = parsed.rows

    expect(rows.map((row) => row.sceneOrdinal)).toEqual([1, null, 1])
    expect(validateStoryboardRows(parsed)).toEqual({
      success: false,
      error: 'storyboard-scene-invalid',
      sourceRowIds: ['storyboard-row-2'],
    })
  })

  it('첫 data row의 non-integer scene-only 행을 보존해 storyboard-scene-invalid로 거부한다', () => {
    const csv = 'scene,prompt,subtitle,speaker,duration\ntwo,,,,\n1,p1,a,narrator,2'
    const parsed = parseStoryboardCSVRows(csv)
    const rows = parsed.rows

    expect(rows.map((row) => row.sceneOrdinal)).toEqual([null, 1])
    expect(validateStoryboardRows(parsed)).toEqual({
      success: false,
      error: 'storyboard-scene-invalid',
      sourceRowIds: ['storyboard-row-1'],
    })
  })

  it('2^53 경계에서 서로 다른 scene 값이 같은 Number로 collapse돼도 거부한다', () => {
    const csv = `scene,prompt,subtitle,speaker,duration
9007199254740992,p1,s1,narrator,1
9007199254740993,p2,s2,narrator,1`

    expect(validate(csv)).toEqual({
      success: false,
      error: 'storyboard-scene-invalid',
      sourceRowIds: ['storyboard-row-1', 'storyboard-row-2'],
    })
  })

  it('30자리 scene 정수를 안전하지 않은 ordinal로 거부한다', () => {
    const csv = `scene,prompt,subtitle,speaker,duration
999999999999999999999999999999,p1,s1,narrator,1`

    expect(validate(csv)).toEqual({
      success: false,
      error: 'storyboard-scene-invalid',
      sourceRowIds: ['storyboard-row-1'],
    })
  })

  it('row 순서에서 scene ordinal이 감소하면 storyboard-scene-order-invalid로 거부한다', () => {
    const csv = 'scene,prompt,subtitle,speaker\n1,P1,S1,narrator\n2,P2,S2,narrator\n1,,S3,narrator'
    const result = validate(csv)

    expect(result).toEqual({
      success: false,
      error: 'storyboard-scene-order-invalid',
      sourceRowIds: ['storyboard-row-3'],
    })
  })
})

describe('validateStoryboardRows empty CSV rows (D24-C3)', () => {
  it('spoken slot의 scene 값만 있는 빈 row를 drop하고 sourceRowId를 재발급한다', () => {
    const csv = 'scene,prompt,subtitle,speaker\n1,P1,S1,narrator\n1,,,\n2,P2,S2,narrator'
    const result = validate(csv)

    expect(result.success).toBe(true)
    expect(result.rows.map((row) => row.sourceRowId)).toEqual(['storyboard-row-1', 'storyboard-row-2'])
    expect(result.slots.map((slot) => slot.sourceRowIds)).toEqual([
      ['storyboard-row-1'],
      ['storyboard-row-2'],
    ])
  })

  it.each([
    ['빈 문자열', ''],
    ['header-only CSV', 'scene,prompt,subtitle,speaker'],
  ])('%s는 success가 아니라 storyboard-scene-invalid로 거부한다', (_label, csv) => {
    expect(validate(csv)).toEqual({
      success: false,
      error: 'storyboard-scene-invalid',
      sourceRowIds: [],
    })
  })
})

describe('validateStoryboardRows timing (D24a-4)', () => {
  it('raw timing이 전혀 없는 spoken slot은 plannedMs null이고 3000을 만들지 않는다', () => {
    const result = validate('scene,prompt,subtitle,speaker\n1,P,S,narrator')

    expect(result.success).toBe(true)
    expect(result.slots[0].plannedMs).toBeNull()
  })

  it('셀에 명시한 duration 3초만 plannedMs 3000으로 쓴다', () => {
    const result = validate('scene,prompt,subtitle,speaker,duration\n1,P,S,narrator,3')

    expect(result.success).toBe(true)
    expect(result.slots[0].plannedMs).toBe(3000)
  })

  it('single row의 유효한 start/end 차이를 duration보다 우선한다', () => {
    const result = validate('scene,prompt,subtitle,speaker,duration,start_time,end_time\n1,P,S,narrator,9,1.5,4')

    expect(result.success).toBe(true)
    expect(result.slots[0].plannedMs).toBe(2500)
  })

  it('group의 모든 row가 monotonic start/end면 lastEnd-firstStart를 쓴다', () => {
    const csv = 'scene,prompt,subtitle,speaker,start_time,end_time\n1,P,S1,narrator,1,2\n1,,S2,narrator,2.5,5'
    const result = validate(csv)

    expect(result.success).toBe(true)
    expect(result.slots[0].plannedMs).toBe(4000)
  })

  it('group의 monotonic start/end가 겹쳐도 별도 overlap 규칙을 만들지 않는다', () => {
    const csv = 'scene,prompt,subtitle,speaker,start_time,end_time\n1,P,S1,narrator,0,3\n1,,S2,narrator,2,4'
    const result = validate(csv)

    expect(result.success).toBe(true)
    expect(result.slots[0].plannedMs).toBe(4000)
  })

  it('group의 모든 row가 positive duration이면 합을 쓴다', () => {
    const csv = 'scene,prompt,subtitle,speaker,duration\n1,P,S1,narrator,1.25\n1,,S2,narrator,2.75'
    const result = validate(csv)

    expect(result.success).toBe(true)
    expect(result.slots[0].plannedMs).toBe(4000)
  })

  it('명시 duration 0을 storyboard-time-invalid로 거부한다', () => {
    const result = validate('scene,prompt,subtitle,speaker,duration\n1,P,S,narrator,0')

    expect(result).toEqual({
      success: false,
      error: 'storyboard-time-invalid',
      sourceRowIds: ['storyboard-row-1'],
    })
  })

  it('명시 duration NaN을 storyboard-time-invalid로 거부한다', () => {
    const result = validate('scene,prompt,subtitle,speaker,duration\n1,P,S,narrator,NaN')

    expect(result).toEqual({
      success: false,
      error: 'storyboard-time-invalid',
      sourceRowIds: ['storyboard-row-1'],
    })
  })

  it('hex duration을 storyboard-time-invalid로 거부한다', () => {
    const result = validate('scene,prompt,subtitle,speaker,duration\n1,P,S,narrator,0x10')

    expect(result).toEqual({
      success: false,
      error: 'storyboard-time-invalid',
      sourceRowIds: ['storyboard-row-1'],
    })
  })

  it('exponential duration을 storyboard-time-invalid로 거부한다', () => {
    const result = validate('scene,prompt,subtitle,speaker,duration\n1,P,S,narrator,1e3')

    expect(result).toEqual({
      success: false,
      error: 'storyboard-time-invalid',
      sourceRowIds: ['storyboard-row-1'],
    })
  })

  it.each([
    ['hex', '0x10', '0x20'],
    ['exponential', '1e1', '1e3'],
    ['binary/octal', '0b11', '0o17'],
    ['octal/binary', '0o10', '0b10000'],
  ])('%s start/end를 storyboard-time-invalid로 거부한다', (_label, start, end) => {
    const result = validate(`scene,prompt,subtitle,speaker,start_time,end_time\n1,P,, ,${start},${end}`)

    expect(result).toEqual({
      success: false,
      error: 'storyboard-time-invalid',
      sourceRowIds: ['storyboard-row-1'],
    })
  })

  it('strict HH:MM:SS.mmm start/end는 계속 허용한다', () => {
    const result = validate('scene,prompt,subtitle,speaker,start_time,end_time\n1,P,,,00:00:03.000,00:00:05.500')

    expect(result.success).toBe(true)
    expect(result.slots[0].plannedMs).toBe(2500)
  })

  it('reversed start/end를 storyboard-time-invalid로 거부한다', () => {
    const result = validate('scene,prompt,subtitle,speaker,start_time,end_time\n1,P,S,narrator,4,1')

    expect(result).toEqual({
      success: false,
      error: 'storyboard-time-invalid',
      sourceRowIds: ['storyboard-row-1'],
    })
  })

  it('음수 start_time을 storyboard-time-invalid로 거부한다', () => {
    const result = validate('scene,prompt,subtitle,speaker,start_time,end_time\n1,P,S,narrator,-5,0')

    expect(result).toEqual({
      success: false,
      error: 'storyboard-time-invalid',
      sourceRowIds: ['storyboard-row-1'],
    })
  })

  it('start_time만 있는 partial pair를 storyboard-time-invalid로 거부한다', () => {
    const result = validate('scene,prompt,subtitle,speaker,start_time,end_time\n1,P,S,narrator,1,')

    expect(result).toEqual({
      success: false,
      error: 'storyboard-time-invalid',
      sourceRowIds: ['storyboard-row-1'],
    })
  })

  it('end_time만 있는 partial pair를 storyboard-time-invalid로 거부한다', () => {
    const result = validate('scene,prompt,subtitle,speaker,start_time,end_time\n1,P,S,narrator,,2')

    expect(result).toEqual({
      success: false,
      error: 'storyboard-time-invalid',
      sourceRowIds: ['storyboard-row-1'],
    })
  })

  it('group 안의 start/end와 duration 혼합을 storyboard-time-invalid로 거부한다', () => {
    const csv = 'scene,prompt,subtitle,speaker,duration,start_time,end_time\n1,P,S1,narrator,,0,1\n1,,S2,narrator,2,,'
    const result = validate(csv)

    expect(result).toEqual({
      success: false,
      error: 'storyboard-time-invalid',
      sourceRowIds: ['storyboard-row-1', 'storyboard-row-2'],
    })
  })

  it('group start/end가 row 순서에서 단조롭지 않으면 storyboard-time-invalid로 거부한다', () => {
    const csv = 'scene,prompt,subtitle,speaker,start_time,end_time\n1,P,S1,narrator,2,3\n1,,S2,narrator,1,4'
    const result = validate(csv)

    expect(result).toEqual({
      success: false,
      error: 'storyboard-time-invalid',
      sourceRowIds: ['storyboard-row-1', 'storyboard-row-2'],
    })
  })
})

describe('validateStoryboardRows visual-only (D24a-4)', () => {
  it('subtitle 없는 prompt-only slot은 timing이 있으면 통과한다', () => {
    const result = validate('scene,prompt,subtitle,speaker,duration\n1,Visual only,,,2')

    expect(result.success).toBe(true)
    expect(result.slots[0].plannedMs).toBe(2000)
  })

  it('visual-only slot에 timing이 없으면 storyboard-duration-missing으로 거부한다', () => {
    const result = validate('scene,prompt,subtitle,speaker\n1,Visual only,,')

    expect(result).toEqual({
      success: false,
      error: 'storyboard-duration-missing',
      sourceRowIds: ['storyboard-row-1'],
    })
  })

  it('duration이 있어도 영문 prompt 없이 prompt_ko만 있는 visual-only slot은 storyboard-prompt-missing으로 거부한다', () => {
    const result = validate('scene,prompt,prompt_ko,subtitle,speaker,duration\n1,,한국어 prompt,,,4')

    expect(result).toEqual({
      success: false,
      error: 'storyboard-prompt-missing',
      sourceRowIds: ['storyboard-row-1'],
    })
  })

  it('한 slot에 prompt-bearing row가 둘이면 storyboard-prompt-ambiguous로 거부한다', () => {
    const csv = 'scene,prompt,subtitle,speaker,duration\n1,First,,,1\n1,Second,,,1'
    const result = validate(csv)

    expect(result).toEqual({
      success: false,
      error: 'storyboard-prompt-ambiguous',
      sourceRowIds: ['storyboard-row-1', 'storyboard-row-2'],
    })
  })

  it('동일한 prompt를 반복한 spoken slot은 하나의 prompt 값으로 취급한다', () => {
    const csv = 'scene,prompt,subtitle,speaker,duration\n1,P,line one,narrator,2\n1,P,line two,narrator,2'
    const result = validate(csv)

    expect(result.success).toBe(true)
    expect(result.slots[0].plannedMs).toBe(4000)
  })

  it('동일한 prompt를 반복한 visual-only slot도 prompt 누락으로 거부하지 않는다', () => {
    const csv = 'scene,prompt,subtitle,speaker,duration\n1,P,,,1\n1,P,,,1'
    const result = validate(csv)

    expect(result.success).toBe(true)
    expect(result.slots[0].plannedMs).toBe(2000)
  })

  it('visual-only group은 정확히 한 prompt row와 나머지 timing-only row를 허용한다', () => {
    const csv = 'scene,prompt,subtitle,speaker,duration\n1,HasPrompt,,,1\n1,,,,1'
    const result = validate(csv)

    expect(result.success).toBe(true)
    expect(result.slots[0].plannedMs).toBe(2000)
  })

  it.each([
    'prompt_ko',
    'characters',
    'scene_tag',
    'style_tag',
    'shot_type',
    'parent_scene',
  ])('slot collapse 대상 %s의 서로 다른 값을 storyboard-field-ambiguous로 거부한다', (field) => {
    const fields = ['scene', 'prompt', 'prompt_ko', 'subtitle', 'speaker', 'characters', 'scene_tag', 'style_tag', 'shot_type', 'parent_scene']
    const first = ['1', 'P', 'ko-1', 'line one', 'narrator', 'A', 'place-1', 'style-1', 'shot-1', 'parent-1']
    const second = ['1', 'P', 'ko-1', 'line two', 'narrator', 'A', 'place-1', 'style-1', 'shot-1', 'parent-1']
    second[fields.indexOf(field)] = `${second[fields.indexOf(field)]}-conflict`

    expect(validate(`${fields.join(',')}\n${first.join(',')}\n${second.join(',')}`)).toEqual({
      success: false,
      error: 'storyboard-field-ambiguous',
      fields: [field],
      sourceRowIds: ['storyboard-row-1', 'storyboard-row-2'],
    })
  })
})

describe('validateStoryboardRows speaker (D24a-4)', () => {
  it('{roster}가 있으면 flag를 생략해도 roster 밖 speaker를 fail-closed로 거부한다', () => {
    const result = validate('scene,prompt,subtitle,speaker\n1,P,대사,소은', {
      roster: [{ id: 'X', name: 'X' }],
    })

    expect(result).toEqual({
      success: false,
      error: 'storyboard-speaker-unknown',
      speakers: ['소은'],
      sourceRowIds: ['storyboard-row-1'],
    })
  })

  it('options를 생략하면 explicit speaker를 self-promote한다', () => {
    const result = validate('scene,prompt,subtitle,speaker\n1,P,대사,리안')

    expect(result.success).toBe(true)
    expect(result.speakers).toEqual([{ id: '리안', name: '리안' }])
  })

  it('roster: []만 전달해도 enforced mode로 fail-closed한다', () => {
    const result = validate('scene,prompt,subtitle,speaker\n1,P,대사,ALICE', { roster: [] })

    expect(result).toEqual({
      success: false,
      error: 'storyboard-speaker-unknown',
      speakers: ['ALICE'],
      sourceRowIds: ['storyboard-row-1'],
    })
  })

  it.each([
    ['undefined', undefined],
    ['null', null],
  ])('roster: %s는 roster가 없는 pre-confirm call로 보고 self-promote한다', (_label, roster) => {
    const result = validate('scene,prompt,subtitle,speaker\n1,P,대사,ALICE', { roster })

    expect(result.success).toBe(true)
    expect(result.speakers).toEqual([{ id: 'ALICE', name: 'ALICE' }])
  })

  it('rosterEnforced: false를 명시하면 pre-confirm speaker를 self-promote한다', () => {
    const result = validate('scene,prompt,subtitle,speaker\n1,P,대사,ALICE', {
      roster: [],
      rosterEnforced: false,
    })

    expect(result.success).toBe(true)
    expect(result.speakers).toEqual([{ id: 'ALICE', name: 'ALICE' }])
  })

  it('legacy positional roster array options를 TypeError로 거부한다', () => {
    const csv = 'scene,prompt,subtitle,speaker\n1,P,대사,철수'

    expect(() => validate(csv, [{ id: '철수', name: '철수' }])).toThrow(TypeError)
  })

  it('truthy numeric rosterEnforced를 enforced mode로 처리한다', () => {
    const result = validate('scene,prompt,subtitle,speaker\n1,P,대사,ALICE', {
      roster: [],
      rosterEnforced: 1,
    })

    expect(result).toEqual({
      success: false,
      error: 'storyboard-speaker-unknown',
      speakers: ['ALICE'],
      sourceRowIds: ['storyboard-row-1'],
    })
  })

  it('truthy string rosterEnforced를 enforced mode로 처리한다', () => {
    const result = validate('scene,prompt,subtitle,speaker\n1,P,대사,ALICE', {
      roster: [],
      rosterEnforced: 'true',
    })

    expect(result).toEqual({
      success: false,
      error: 'storyboard-speaker-unknown',
      speakers: ['ALICE'],
      sourceRowIds: ['storyboard-row-1'],
    })
  })

  it('spoken row의 빈 speaker를 storyboard-speaker-missing으로 거부한다', () => {
    const result = validate('scene,prompt,subtitle,speaker\n1,P,말하는 자막,')

    expect(result).toEqual({
      success: false,
      error: 'storyboard-speaker-missing',
      sourceRowIds: ['storyboard-row-1'],
    })
  })

  it('characters와 shot_type에서 narrator를 추론하지 않는다', () => {
    const csv = 'scene,prompt,subtitle,speaker,characters,shot_type\n1,P,서술 자막,,장대인,narration'
    const result = validate(csv)

    expect(result).toEqual({
      success: false,
      error: 'storyboard-speaker-missing',
      sourceRowIds: ['storyboard-row-1'],
    })
  })

  it('normalized id/name이 두 roster card와 맞으면 storyboard-speaker-ambiguous로 거부한다', () => {
    const result = validate('scene,prompt,subtitle,speaker\n1,P,대사, 강 리안 ', {
      rosterEnforced: true,
      roster: [
        { id: '강리안', name: '리안' },
        { id: 'char-2', name: '강 리안' },
      ],
    })

    expect(result).toEqual({
      success: false,
      error: 'storyboard-speaker-ambiguous',
      sourceRowIds: ['storyboard-row-1'],
      speakers: ['강 리안'],
    })
  })

  it('roster 밖 explicit speaker를 storyboard-speaker-unknown으로 거부한다', () => {
    const result = validate('scene,prompt,subtitle,speaker\n1,P,대사,유령', {
      rosterEnforced: true,
      roster: [{ id: '리안', name: '강리안' }],
    })

    expect(result).toEqual({
      success: false,
      error: 'storyboard-speaker-unknown',
      speakers: ['유령'],
      sourceRowIds: ['storyboard-row-1'],
    })
  })

  it('explicit narrator는 roster card 없이 통과한다', () => {
    const result = validate('scene,prompt,subtitle,speaker\n1,P,서술,narrator', { roster: [] })

    expect(result.success).toBe(true)
  })

  it('narration alias를 narrator로 취급해 roster 검사를 우회하지 않는다', () => {
    const result = validate('scene,prompt,subtitle,speaker\n1,P,서술,narration', { roster: [] })

    expect(result).toEqual({
      success: false,
      error: 'storyboard-speaker-unknown',
      speakers: ['narration'],
      sourceRowIds: ['storyboard-row-1'],
    })
  })

  it.each(['해설', 'narration', '화자'])('%s narrator alias를 self-promote하지 않고 unknown으로 거부한다', (alias) => {
    const result = validate(`scene,prompt,subtitle,speaker\n1,P,서술,${alias}`)

    expect(result).toEqual({
      success: false,
      error: 'storyboard-speaker-unknown',
      speakers: [alias],
      sourceRowIds: ['storyboard-row-1'],
    })
  })

  it('enforced roster에 이름이 같은 카드가 있어도 해설 alias를 예약어로 거부한다', () => {
    const result = validate('scene,prompt,subtitle,speaker\n1,P,서술,해설', {
      rosterEnforced: true,
      roster: [{ id: '해설', name: '해설' }],
    })

    expect(result).toEqual({
      success: false,
      error: 'storyboard-speaker-unknown',
      speakers: ['해설'],
      sourceRowIds: ['storyboard-row-1'],
    })
  })

  it('unique non-narrator speaker만 roster로 승격하고 characters는 쓰지 않는다', () => {
    const csv = 'scene,prompt,subtitle,speaker,characters\n1,P,S1,리안,화면인물\n2,P2,S2, 리 안 ,다른인물\n3,P3,S3,narrator,또다른인물'
    const result = validate(csv)

    expect(result.success).toBe(true)
    expect(result.speakers).toEqual([{ id: '리안', name: '리안' }])
  })
})
