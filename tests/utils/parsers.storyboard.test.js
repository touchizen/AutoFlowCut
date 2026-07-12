import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  parseSceneCSVToTracks,
  parseStoryboardCSVRows,
} from '../../src/utils/parsers'
import { validateStoryboardRows } from '../../electron/story/storyboardInput'
import { resolveSkillsDir } from '../../electron/api/llm/metaPrompts'

const STORYBOARD_FIELDS = [
  'scene', 'prompt', 'prompt_ko', 'subtitle', 'speaker', 'characters', 'scene_tag',
  'style_tag', 'shot_type', 'duration', 'start_time', 'end_time', 'parent_scene',
]

const docSample = (filename) => {
  const doc = readFileSync(join(process.cwd(), 'docs', filename), 'utf8')
  return doc.match(/```csv\n([\s\S]*?)\n```/)?.[1] || ''
}

const docText = (filename) => readFileSync(join(process.cwd(), 'docs', filename), 'utf8')
const parseRows = (csv) => parseStoryboardCSVRows(csv).rows
const storyEngineDoc = (locale, wave) => readFileSync(
  join(resolveSkillsDir(), 'story-engine', 'docs', locale, `${wave}-${wave === 'W6' ? 'storyboard' : 'image-production'}.md`),
  'utf8',
)
const storyEngineW7Fields = (locale) => {
  const doc = storyEngineDoc(locale, 'W7')
  const fieldList = doc.match(/fields = \[([^\n]+)\]/)?.[1] || ''
  return [...fieldList.matchAll(/'([^']+)'/g)].map((match) => match[1])
}
const storyEngineW6Fields = (locale) => {
  const section = storyEngineDoc(locale, 'W6').match(/### 6-2\.[\s\S]*?(?=### (?:씬 분리 규칙|Scene splitting rules))/)?.[0] || ''
  return [...section.matchAll(/^\| `([^`]+)` \|/gm)].map((match) => match[1])
}

describe('parseStoryboardCSVRows (D24a-1)', () => {
  it('row별 필드와 timing raw/presence를 손실 없이 반환한다', () => {
    const csv = `scene,prompt,subtitle,speaker,characters,scene_tag,shot_type,duration,start_time,end_time
7,"첫 prompt","첫 자막",narrator,"장대인,소은",courtyard,scene,3,,
7,"둘째 prompt","둘째 자막",소은,소은,room,close-up,,00:00:03.000,00:00:05.500`

    expect(parseRows(csv)).toEqual([
      {
        sourceRowId: 'storyboard-row-1',
        sceneOrdinal: 7,
        prompt: '첫 prompt',
        prompt_ko: '',
        subtitle: '첫 자막',
        speaker: 'narrator',
        characters: '장대인,소은',
        scene_tag: 'courtyard',
        style_tag: '',
        shot_type: 'scene',
        parent_scene: '',
        durationRaw: '3',
        startTimeRaw: '',
        endTimeRaw: '',
        hasDuration: true,
        hasStartTime: false,
        hasEndTime: false,
      },
      {
        sourceRowId: 'storyboard-row-2',
        sceneOrdinal: 7,
        prompt: '둘째 prompt',
        prompt_ko: '',
        subtitle: '둘째 자막',
        speaker: '소은',
        characters: '소은',
        scene_tag: 'room',
        style_tag: '',
        shot_type: 'close-up',
        parent_scene: '',
        durationRaw: '',
        startTimeRaw: '00:00:03.000',
        endTimeRaw: '00:00:05.500',
        hasDuration: false,
        hasStartTime: true,
        hasEndTime: true,
      },
    ])
  })

  it('scene 컬럼이 없으면 행마다 다음 slot ordinal을 부여한다', () => {
    const rows = parseRows('prompt,subtitle,speaker\nP1,S1,narrator\nP2,S2,narrator')

    expect(rows.map((row) => row.sceneOrdinal)).toEqual([1, 2])
  })

  it('leading BOM과 quoted/case/주변 공백 header를 canonical name으로 허용한다', () => {
    const csv = '\uFEFF" Scene "," Prompt "," Subtitle "," Speaker "," Duration "\n1,P,S,narrator,2'
    const result = validateStoryboardRows(parseStoryboardCSVRows(csv))

    expect(result.success).toBe(true)
    expect(result.rows[0]).toMatchObject({
      sceneOrdinal: 1,
      prompt: 'P',
      subtitle: 'S',
      speaker: 'narrator',
      durationRaw: '2',
    })
  })

  it('empty/contentful unnamed header와 unknown header를 field binding 없이 허용하지 않는다', () => {
    const csv = 'scene,prompt,subtitle,speaker,duration,,custom\n1,P,S,narrator,2,unnamed,unknown'
    const result = validateStoryboardRows(parseStoryboardCSVRows(csv))

    expect(result).toEqual({
      success: false,
      error: 'storyboard-header-unknown',
      sourceRowIds: [],
    })
  })

  it('값이 든 empty header 하나만 있어도 storyboard-header-unknown으로 거부한다', () => {
    const parsed = parseStoryboardCSVRows('scene,prompt,subtitle,speaker,\n1,P,S,narrator,private')

    expect(parsed).toEqual({
      rows: [],
      duplicateHeaders: [],
      unknownHeaders: ['(empty column 5)'],
    })
    expect(validateStoryboardRows(parsed)).toEqual({
      success: false,
      error: 'storyboard-header-unknown',
      sourceRowIds: [],
    })
  })

  it('두 trailing empty header cell이 모두 content-free면 duplicate가 아니며 통과한다', () => {
    const csv = 'scene,prompt,subtitle,speaker,,\n1,P,S,narrator,,'

    expect(validateStoryboardRows(parseStoryboardCSVRows(csv)).success).toBe(true)
  })

  it('duplicate/unknown header marker가 structuredClone 뒤에도 보존된다', () => {
    const duplicate = structuredClone(parseStoryboardCSVRows('scene,prompt,scene'))
    const unknown = structuredClone(parseStoryboardCSVRows('scene,prompt,notes\n1,P,private'))

    expect(duplicate).toEqual({
      rows: [],
      duplicateHeaders: ['scene'],
      unknownHeaders: [],
    })
    expect(unknown).toEqual({
      rows: [],
      duplicateHeaders: [],
      unknownHeaders: ['notes'],
    })
  })

  it('marker 배열을 생략한 partial payload는 no-error로 default하지 않는다', () => {
    const { rows } = parseStoryboardCSVRows('scene,prompt,subtitle,speaker\n1,P,S,narrator')

    expect(validateStoryboardRows({ rows })).toEqual({
      success: false,
      error: 'storyboard-scene-invalid',
      sourceRowIds: [],
    })
  })

  it('header보다 짧은 row는 누락 셀을 빈 값으로 취급한다', () => {
    const parsed = parseStoryboardCSVRows('scene,prompt,subtitle,speaker,duration\n1,P,S,narrator')
    const rows = parsed.rows

    expect(rows[0]).toMatchObject({ durationRaw: '', hasDuration: false })
    expect(validateStoryboardRows(parsed).success).toBe(true)
  })

  it('header보다 긴 row의 초과 셀만 non-empty면 phantom board row로 보존하지 않는다', () => {
    const parsed = parseStoryboardCSVRows('scene,prompt,subtitle,speaker\n1,P,S,narrator\n1,,,,junk')

    expect(parsed).toEqual({
      rows: [],
      duplicateHeaders: [],
      unknownHeaders: ['(missing header column 5)'],
    })
    expect(validateStoryboardRows(parsed)).toEqual({
      success: false,
      error: 'storyboard-header-unknown',
      sourceRowIds: [],
    })
  })

  it('kept board row가 header 밖 non-empty 셀을 가지면 조용히 버리지 않고 거부한다', () => {
    const parsed = parseStoryboardCSVRows('scene,prompt,subtitle,speaker\n1,P,S,narrator,junk')

    expect(parsed).toEqual({
      rows: [],
      duplicateHeaders: [],
      unknownHeaders: ['(missing header column 5)'],
    })
    expect(validateStoryboardRows(parsed)).toEqual({
      success: false,
      error: 'storyboard-header-unknown',
      sourceRowIds: [],
    })
  })

  it.each([
    ['prompt_en', 'prompt', 'scene,prompt_en,subtitle,speaker\n1,P,S,narrator', 'P'],
    ['subtitle_ko', 'subtitle', 'scene,prompt,subtitle_ko,speaker\n1,P,S,narrator', 'S'],
    ['character', 'characters', 'scene,prompt,subtitle,speaker,character\n1,P,S,narrator,A', 'A'],
    ['background', 'scene_tag', 'scene,prompt,subtitle,speaker,background\n1,P,S,narrator,B', 'B'],
  ])('%s header를 documented %s bound field alias로 파싱한다', (_alias, field, csv, value) => {
    const parsed = parseStoryboardCSVRows(csv)

    expect(parsed.rows[0][field]).toBe(value)
    expect(parsed.unknownHeaders).toEqual([])
  })

  it('scene-only row의 ordinal을 다음 kept row carry-forward에 반영한 뒤 drop한다', () => {
    const csv = `scene,prompt,subtitle,speaker,duration
1,p1,a,narrator,2
2,,,,
,,b,narrator,2
2,p2,c,narrator,2`

    const parsed = parseStoryboardCSVRows(csv)
    const rows = parsed.rows

    expect(rows.map((row) => row.sceneOrdinal)).toEqual([1, 2, 2])
    expect(rows.map((row) => row.sourceRowId)).toEqual([
      'storyboard-row-1',
      'storyboard-row-2',
      'storyboard-row-3',
    ])
    const result = validateStoryboardRows(parsed)
    expect(result.success).toBe(true)
    expect(result.slots.map((slot) => ({
      sceneOrdinal: slot.sceneOrdinal,
      subtitles: slot.rows.map((row) => row.subtitle),
      plannedMs: slot.plannedMs,
    }))).toEqual([
      { sceneOrdinal: 1, subtitles: ['a'], plannedMs: 2000 },
      { sceneOrdinal: 2, subtitles: ['b', 'c'], plannedMs: 4000 },
    ])
  })

  it('scene 컬럼이 전부 비어 있으면 컬럼이 없는 것처럼 kept row별 ordinal을 부여한다', () => {
    const rows = parseRows('scene,prompt,subtitle,speaker\n,p1,hi,narrator\n,p2,bye,narrator')

    expect(rows.map((row) => row.sceneOrdinal)).toEqual([1, 2])
  })

  it('다음 adapter가 byte-for-byte 복사할 quoted prompt 경계 공백을 보존한다', () => {
    const rows = parseRows('prompt,subtitle,speaker\n"  keep edge spaces  ",S,narrator')

    expect(rows[0].prompt).toBe('  keep edge spaces  ')
  })

  it('D24-C3 drop: subtitle가 없어도 prompt/timing이 있는 visual-only row는 버리지 않는다', () => {
    const rows = parseRows('scene,prompt,subtitle,speaker,duration\n1,P1,S1,narrator,\n1,Visual only,,,2\n2,P2,S2,narrator,')

    expect(rows.map((row) => row.sourceRowId)).toEqual([
      'storyboard-row-1',
      'storyboard-row-2',
      'storyboard-row-3',
    ])
  })

  it('LF blank line은 sourceRowId를 받는 phantom row가 되지 않는다', () => {
    const rows = parseRows('scene,prompt,subtitle,speaker\n1,P,S,narrator\n\n')

    expect(rows.map((row) => row.sourceRowId)).toEqual(['storyboard-row-1'])
  })

  it('CRLF blank line은 sourceRowId를 받는 phantom row가 되지 않는다', () => {
    const rows = parseRows('scene,prompt,subtitle,speaker\r\n1,P,S,narrator\r\n\r\n')

    expect(rows.map((row) => row.sourceRowId)).toEqual(['storyboard-row-1'])
  })

  it('D24-C3 duplicate: 내용이 같은 두 행에도 서로 다른 sourceRowId를 준다', () => {
    const rows = parseRows('scene,prompt,subtitle,speaker\n1,P,S,narrator\n1,P,S,narrator')

    expect(rows).toHaveLength(2)
    expect(rows.map((row) => row.sourceRowId)).toEqual(['storyboard-row-1', 'storyboard-row-2'])
  })

  it('D24-C3 reorder: CSV 행 순서를 그대로 보존한다', () => {
    const rows = parseRows('scene,prompt,subtitle,speaker\n2,P2,S2,narrator\n1,P1,S1,narrator')

    expect(rows.map((row) => row.prompt)).toEqual(['P2', 'P1'])
    expect(rows.map((row) => row.sceneOrdinal)).toEqual([2, 1])
  })

  it('timing 컬럼이 없으면 raw presence가 false이고 기존 collapsed parser만 3초를 만든다', () => {
    const csv = 'scene,prompt,subtitle,speaker\n1,P,S,narrator'

    expect(parseRows(csv)[0]).toMatchObject({
      durationRaw: '',
      startTimeRaw: '',
      endTimeRaw: '',
      hasDuration: false,
      hasStartTime: false,
      hasEndTime: false,
    })
    expect(parseSceneCSVToTracks(csv).scenes[0].duration).toBe(3)
  })

  it('한글 문서 sample을 raw parser부터 row validator까지 그대로 import한다', () => {
    const result = validateStoryboardRows(parseStoryboardCSVRows(docSample('csv-scenes-schema.md')))

    expect(result.success).toBe(true)
    expect(result.slots[0].plannedMs).toBe(11830)
    expect(result.speakers).toEqual([])
  })

  it('영문 문서 sample을 raw parser부터 row validator까지 그대로 import한다', () => {
    const result = validateStoryboardRows(parseStoryboardCSVRows(docSample('csv-scenes-schema_en.md')))

    expect(result.success).toBe(true)
    expect(result.slots[0].plannedMs).toBe(11830)
    expect(result.speakers).toEqual([])
  })

  it.each(['ko', 'en'])('%s story-engine W6 table이 runtime skill source에서 13-field contract를 선언한다', (locale) => {
    expect(storyEngineW6Fields(locale)).toEqual(STORYBOARD_FIELDS)
  })

  it.each(['ko', 'en'])('%s story-engine W7 field list가 runtime skill source에서 parser/validator를 통과한다', (locale) => {
    const doc = storyEngineDoc(locale, 'W7')
    const fields = storyEngineW7Fields(locale)
    const values = fields.map((field) => ({
      scene: '1',
      prompt: 'A dark cabin',
      prompt_ko: '어두운 오두막',
      subtitle: 'Hello there',
      speaker: 'narrator',
      characters: '',
      scene_tag: 'cabin',
      style_tag: 'cinematic',
      shot_type: 'narration',
      duration: '2',
      start_time: '0',
      end_time: '2',
      parent_scene: 'S001',
    })[field] ?? '')

    expect(fields).toEqual(STORYBOARD_FIELDS)
    expect(doc).toContain('existing_rows = list(reader)')
    expect(doc).toContain('writer.writerows(existing_rows)')
    const parsed = parseStoryboardCSVRows(`${fields.join(',')}\n${values.join(',')}`)
    expect(parsed.rows[0]).toMatchObject({
      prompt_ko: '어두운 오두막',
      style_tag: 'cinematic',
      parent_scene: 'S001',
    })
    expect(validateStoryboardRows(parsed).success).toBe(true)
  })

  it('실제 docs example CSV가 13-field contract로 parser/validator를 통과한다', () => {
    const csv = readFileSync(join(process.cwd(), 'docs', 'examples', 'scenes_example.csv'), 'utf8')
    const header = csv.split(/\r?\n/, 1)[0].split(',')
    const result = validateStoryboardRows(parseStoryboardCSVRows(csv))

    expect(header).toEqual(STORYBOARD_FIELDS)
    expect(result.success).toBe(true)
    expect(result.slots.map((slot) => slot.sceneOrdinal)).toEqual([1, 2, 3])
  })
})

describe('storyboard schema documentation contracts', () => {
  it('KO/EN schema와 D24 spec이 canonical duplicate header의 typed rejection을 명시한다', () => {
    const spec = docText('superpowers/specs/2026-07-11-inapp-agent-orchestration-spec-v11.md')

    expect(docText('csv-scenes-schema.md')).toContain('두 header가 같은 bound field를 가리키면')
    expect(docText('csv-scenes-schema_en.md')).toContain('Two headers that bind the same field')
    expect(spec).toContain('`storyboard-header-duplicate`')
  })

  it('KO/EN schema와 D24 spec이 exact canonical/alias allowlist와 unknown rejection을 명시한다', () => {
    const ko = docText('csv-scenes-schema.md')
    const en = docText('csv-scenes-schema_en.md')
    const spec = docText('superpowers/specs/2026-07-11-inapp-agent-orchestration-spec-v11.md')

    for (const token of ['prompt_en', 'subtitle_ko', 'character', 'background']) {
      expect(ko).toContain(`\`${token}\``)
      expect(en).toContain(`\`${token}\``)
      expect(spec).toContain(`\`${token}\``)
    }
    expect(ko).toContain('`storyboard-header-unknown`')
    expect(en).toContain('`storyboard-header-unknown`')
    expect(spec).toContain('`storyboard-header-unknown`')
    expect(ko).toContain('개인 메모 열은 CSV에서 제거')
    expect(en).toContain('Remove private notes columns')
  })

  it('KO/EN schema와 D24 spec이 실제 trim+lowercase exact lookup 메커니즘을 명시한다', () => {
    const ko = docText('csv-scenes-schema.md')
    const en = docText('csv-scenes-schema_en.md')
    const spec = docText('superpowers/specs/2026-07-11-inapp-agent-orchestration-spec-v11.md')

    expect(ko).toContain('주변 공백 제거와 소문자화 후 ASCII-keyed exact allowlist lookup')
    expect(en).toContain('exact lookup in the ASCII-keyed allowlist after surrounding-whitespace trimming and lowercasing')
    expect(spec).toContain('주변 공백 제거 + 소문자화 뒤 ASCII-keyed exact allowlist lookup')
    expect(ko).not.toContain('NFKC')
    expect(en).not.toContain('NFKC')
    expect(spec).not.toContain('NFKC')
  })

  it('KO/EN schema와 D24 spec이 scene ordinal의 safe-integer 범위를 명시한다', () => {
    const spec = docText('superpowers/specs/2026-07-11-inapp-agent-orchestration-spec-v11.md')

    expect(docText('csv-scenes-schema.md')).toContain('JavaScript safe integer')
    expect(docText('csv-scenes-schema_en.md')).toContain('JavaScript safe integer')
    expect(spec).toContain('`Number.isSafeInteger`')
  })

  it('KO/EN schema가 prompt 동일성을 surrounding whitespace 포함 byte-identical로 정의한다', () => {
    expect(docText('csv-scenes-schema.md')).toContain('공백까지 포함해 byte-identical')
    expect(docText('csv-scenes-schema_en.md')).toContain('byte-identical, including surrounding whitespace')
  })

  it('KO/EN schema가 consecutive/EOF scene-only 행의 빈 declared scene 소실을 명시한다', () => {
    expect(docText('csv-scenes-schema.md')).toContain('연속 scene-only 행이나 EOF의 scene-only 행')
    expect(docText('csv-scenes-schema_en.md')).toContain('Consecutive scene-only rows or a scene-only row at EOF')
  })

  it('D24a spec이 slot을 ordinal 값이 아니라 등장 순서로 소비한다고 명시한다', () => {
    const spec = docText('superpowers/specs/2026-07-11-inapp-agent-orchestration-spec-v11.md')

    expect(spec).toContain('slot은 등장 순서대로 소비하며 `sceneOrdinal` 값을 `scenes[]`의 1-based index로 사용하지 않는다')
  })
})
