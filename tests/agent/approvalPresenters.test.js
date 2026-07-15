import { describe, expect, it } from 'vitest'
import { createToolCore } from '../../electron/agent/toolCore.js'
import { STORY_STEP_DOWNSTREAM } from '../../electron/story/stepMachine.js'
import ko from '../../src/locales/ko.js'
import en from '../../src/locales/en.js'
import * as approvalPresenterModule from '../../src/agent/approvalPresenters.js'
import {
  APPROVAL_KEY_DECISIONS,
  leafPaths,
  presentApproval,
  residualPaths,
} from '../../src/agent/approvalPresenters.js'

function makeT(locale) {
  return (key, params = {}) => {
    const value = key.split('.').reduce((node, part) => node?.[part], locale)
    if (typeof value !== 'string') return key
    return value.replace(/\{(\w+)\}/g, (match, name) => (
      params[name] !== undefined ? String(params[name]) : match
    ))
  }
}

const koT = makeT(ko)
const enT = makeT(en)

function decodePointer(path) {
  if (path === '') return []
  return path.slice(1).split('/').map((token) => token.replace(/~1/g, '/').replace(/~0/g, '~'))
}

function valueAt(value, path) {
  let current = value
  for (const token of decodePointer(path)) {
    if (current === null || typeof current !== 'object' || !Object.hasOwn(current, token)) {
      return { exists: false, value: undefined }
    }
    current = current[token]
  }
  return { exists: true, value: current }
}

function verbatim(value) {
  // 빈 문자열은 아무 문장에도 포함되므로 따옴표까지 실제로 보여야 coverage로 인정한다.
  if (value === '') return '""'
  if (value !== null && typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

function recordsOf(presentation) {
  return [
    ...presentation.lines.flatMap((line) => line.paths.map((path) => ({ path, text: line.text }))),
    ...presentation.blocks.map((block) => ({ path: block.path, text: block.text })),
  ]
}

function residualOf(tool, args) {
  const presentation = presentApproval(tool, args, koT)
  return residualPaths(args, recordsOf(presentation).map((record) => record.path))
}

function schemaFixture(schema = {}) {
  if (schema.oneOf) return schemaFixture(schema.oneOf[0])
  if (schema.anyOf) return schemaFixture(schema.anyOf[0])
  if (schema.type === 'string') return schema.enum?.[0] ?? 'fixture'
  if (schema.type === 'boolean') return true
  if (schema.type === 'number' || schema.type === 'integer') return 1
  if (schema.type === 'array') return []
  if (schema.type === 'null') return null
  if (schema.type === 'object' || schema.properties) {
    return Object.fromEntries(Object.entries(schema.properties || {}).map(([key, child]) => [key, schemaFixture(child)]))
  }
  return {}
}

const coverageFixtures = {
  story_set_speakers: [
    {
      speakers: [{
        id: 'kim', name: '김철수', voice: { provider: 'elevenlabs', voiceId: 'voice-A' },
        role: '형사', gender: 'male', age: '42', appearance: '검은 코트',
      }],
    },
    { speakers: [{ id: 'lee', name: '이영희', voice: null, futureField: 'RAW-SPEAKER' }], futureRoot: true },
    { speakers: [] },
  ],
  story_confirm_synopsis: [
    {
      synopsisMd: `BEGIN-${'긴'.repeat(5000)}-END`,
      characters: [{
        id: 'kim', name: '김철수', gender: 'male', age: '42', role: '형사',
        ethnicity: '한국인', appearance: '검은 코트',
      }],
      sceneMode: 'image-first', imageFirstVariant: 'storyboard', fixedSceneRevision: 'rev-1',
    },
    { synopsisMd: '', characters: [], futureRoot: { enabled: true } },
    { synopsisMd: 'characters 생략도 명단 교체다' },
  ],
  story_start_step: [
    {
      step: 'script',
      params: {
        options: {}, review: { enabled: true }, reviewOnly: true,
        scriptOverride: '기존 대본', continue: '이어 쓸 대본', pastedScript: '붙여넣은 대본', synopsis: '', title: '제목',
      },
    },
    {
      step: 'scenes',
      params: { options: {}, review: {}, reviewOnly: false, scriptOverride: '새 대본', title: '제목' },
    },
    {
      step: 'audio',
      params: {
        regenerate: ['seg-1', 'seg-2'],
        sfxSources: { 'fx/1': 'library', emptyFuture: 'elevenlabs' },
        speakers: [{ id: 'HIJACK' }],
      },
    },
    { step: 'audio', params: { regenerate: [], sfxSources: {} } },
    { step: 'audio', params: { regenerate: [''] } },
    { step: 'prompts', params: { options: {}, review: {}, reviewOnly: true, style: '수채화' } },
    { step: 'prompts', params: {} },
  ],
  update_visual_review: [
    { sceneNumbers: [1, 2], status: 'rejected', reason: '얼굴 왜곡' },
    { sceneNumbers: [3], status: 'ok' },
    { sceneNumbers: [5] },
  ],
}

const typeMismatchFixtures = [
  ['update_visual_review', { sceneNumbers: 'x' }],
  ['update_visual_review', { sceneNumbers: [1], status: 5 }],
  ['story_confirm_synopsis', { characters: null }],
  ['story_confirm_synopsis', { characters: 'x' }],
  ['story_set_speakers', { speakers: 'x' }],
  ['story_start_step', { step: 'script', params: [] }],
  ['story_start_step', { step: 3 }],
  ['story_start_step', { step: 'script', params: { reviewOnly: 1 } }],
  // 🔴 root 만 검사하면 **항목**의 계약 밖 shape 를 아는 척 서술한다. 배열 원소도 fail-closed 여야 한다.
  ['story_set_speakers', { speakers: [{ id: 1, name: '김철수' }] }],
  ['story_set_speakers', { speakers: [{ id: 'kim', name: '김철수', voice: 'typecast' }] }],
  ['story_set_speakers', { speakers: [{ id: 'kim' }] }],
  ['story_confirm_synopsis', { characters: [{ name: 3 }] }],
  ['story_confirm_synopsis', { characters: [{ name: '김철수', gender: [] }] }],
]

describe('approval presenter JSON path coverage', () => {
  it('모든 leaf를 JSON Pointer로 돌려주고 빈 배열·빈 객체도 값으로 센다', () => {
    expect(leafPaths({
      speakers: [],
      params: {
        empty: {},
        values: ['seg-1', null],
        'slash/key': { '~tilde': true },
      },
    })).toEqual([
      '/speakers',
      '/params/empty',
      '/params/values/0',
      '/params/values/1',
      '/params/slash~1key/~0tilde',
    ])
  })

  it('선언한 path의 subtree만 coverage로 빼고 형제 leaf는 residual로 남긴다', () => {
    const args = {
      step: 'audio',
      params: {
        regenerate: ['seg-1'],
        future: { enabled: true },
      },
    }

    expect(residualPaths(args, ['/step', '/params/regenerate'])).toEqual([
      '/params/future/enabled',
    ])
  })
})

describe('approval presenter 출하·coverage 게이트', () => {
  it('Tool Core의 모든 G/B 툴에는 presenter가 있다 — 미래 B 툴도 자동으로 이 게이트를 지난다', () => {
    const guarded = createToolCore().list().filter((tool) => tool.permission !== 'R')

    for (const tool of guarded) {
      expect(
        presentApproval(tool.name, schemaFixture(tool.inputSchema), koT),
        `${tool.name}은 승인 UI에 서술자가 없다`,
      ).not.toBeNull()
    }
  })

  it.each(Object.entries(coverageFixtures))('%s fixture의 모든 leaf는 서술되거나 residual raw에 남는다', (tool, fixtures) => {
    for (const args of fixtures) {
      const presentation = presentApproval(tool, args, koT)
      expect(presentation).not.toBeNull()
      const records = recordsOf(presentation)
      const covered = records.map((record) => record.path)
      const residual = new Set(residualPaths(args, covered))

      // 역방향도 본다. 존재하지 않는 path를 선언하면 presenter가 args에 없는 효과를 지어낼 수 있다.
      for (const record of records) {
        expect(valueAt(args, record.path).exists, `${tool}이 유령 path ${record.path}를 선언했다`).toBe(true)
        for (const leaf of leafPaths(args).filter((path) => path === record.path || path.startsWith(`${record.path}/`))) {
          const raw = valueAt(args, leaf).value
          expect(
            record.text.includes(verbatim(raw)),
            `${tool}의 ${record.path} 선언 문장에 ${leaf}=${verbatim(raw)} 값이 verbatim으로 없다`,
          ).toBe(true)
        }
      }

      for (const leaf of leafPaths(args)) {
        const raw = valueAt(args, leaf).value
        const described = records.some((record) => (
          (leaf === record.path || leaf.startsWith(`${record.path}/`))
          && record.text.includes(verbatim(raw))
        ))
        expect(
          described || residual.has(leaf),
          `${tool} ${leaf}=${verbatim(raw)}가 문장/block에도 residual에도 없다`,
        ).toBe(true)
      }
    }
  })

  it('모르는 툴은 presenter가 있다고 가장하지 않는다', () => {
    expect(presentApproval('generate_videos', { items: [1] }, koT)).toBeNull()
  })

  it.each(typeMismatchFixtures)('%s의 described 타입이 schema와 다르면 fail-closed한다', (tool, args) => {
    expect(presentApproval(tool, args, koT)).toBeNull()
  })

  // 🔴 선언 path 는 **그 subtree** 만 설명한 것이다. 접두사만 같은 **형제 키**를 덮은 것으로 치면
  //    미래에 추가된 키가 화면에서 통째로 사라진다 (`/step` 이 `/stepX` 를 삼킨다).
  it.each([
    ['root 형제 키', { step: 'audio', params: { regenerate: [] }, stepX: 'HIJACK' }, '/stepX'],
    ['params 형제 키', { step: 'audio', params: { regenerate: [], regenerateX: 'HIJACK' } }, '/params/regenerateX'],
  ])('%s를 접두사만으로 삼키지 않고 residual 로 남긴다', (_label, args, hidden) => {
    const presentation = presentApproval('story_start_step', args, koT)
    const covered = [
      ...presentation.lines.flatMap((line) => line.paths),
      ...presentation.blocks.map((block) => block.path),
    ]
    expect(residualPaths(args, covered)).toContain(hidden)
  })

  it.each([
    ['알 수 없는 step', 'story_start_step', { step: 'images', params: {} }],
    ['비객체 args', 'story_start_step', []],
  ])('%s은 빈 서술로 승인 가능하게 만들지 않는다', (_label, tool, args) => {
    expect(presentApproval(tool, args, koT)).toBeNull()
  })

  it('described로 결정한 schema 키는 실제 문장/block이 모두 덮는다', () => {
    const fixtures = [
      ['story_set_speakers', coverageFixtures.story_set_speakers[0]],
      ['story_confirm_synopsis', {
        synopsisMd: '시놉시스',
        characters: [{ id: 'kim', name: '김철수', gender: 'male', age: '42', role: '형사', ethnicity: '한국인', appearance: '코트' }],
      }],
      ['story_start_step', {
        step: 'script', params: { reviewOnly: true, scriptOverride: '대본', continue: '계속', pastedScript: '붙여넣기', synopsis: '' },
      }],
      ['story_start_step', {
        step: 'scenes', params: { reviewOnly: false, scriptOverride: '대본', title: '제목' },
      }],
      ['story_start_step', coverageFixtures.story_start_step[2]],
      ['story_start_step', { step: 'prompts', params: { reviewOnly: true, style: '수채화' } }],
    ]

    for (const [tool, args] of fixtures) {
      const withoutUnknown = tool === 'story_start_step' && args.step === 'audio'
        ? { step: args.step, params: { regenerate: args.params.regenerate, sfxSources: args.params.sfxSources } }
        : args
      expect(residualOf(tool, withoutUnknown), `${tool}/${args.step || 'root'} described 키가 raw로 샜다`).toEqual([])
    }
  })

  it('명시적 passthrough 키는 숨지 않고 residual로 남는다', () => {
    expect(residualOf('story_confirm_synopsis', {
      characters: [], sceneMode: 'image-first', imageFirstVariant: 'storyboard', fixedSceneRevision: 'rev-1',
    })).toEqual(['/sceneMode', '/imageFirstVariant', '/fixedSceneRevision'])
    expect(residualOf('story_start_step', {
      step: 'script', params: { options: {}, review: { enabled: true } },
    })).toEqual(['/params/options', '/params/review/enabled'])
  })
})

describe('approval presenter와 Tool Core inputSchema는 함께 바뀐다', () => {
  const guarded = Object.fromEntries(createToolCore().list()
    .filter((tool) => tool.permission !== 'R')
    .map((tool) => [tool.name, tool.inputSchema]))
  const decided = (node) => [...node.described, ...node.passthrough].sort()
  const schemaTypes = (schema = {}) => {
    const variants = schema.oneOf ?? schema.anyOf
    if (variants) return [...new Set(variants.flatMap(schemaTypes))].sort()
    return schema.type ? [schema.type] : []
  }

  function expectDecisionTypes(decisionNode, properties, label) {
    expect(Object.keys(decisionNode.types).sort(), `${label} expected type keys`)
      .toEqual(decisionNode.described.slice().sort())
    for (const key of decisionNode.described) {
      expect(decisionNode.types[key].slice().sort(), `${label}.${key} expected types`)
        .toEqual(schemaTypes(properties[key]))
    }
  }

  it('각 툴 최상위 키가 described/passthrough 중 하나로 결정돼 있다', () => {
    expect(Object.keys(APPROVAL_KEY_DECISIONS).sort()).toEqual(Object.keys(guarded).sort())
    for (const [tool, schema] of Object.entries(guarded)) {
      expect(decided(APPROVAL_KEY_DECISIONS[tool].root), tool)
        .toEqual(Object.keys(schema.properties || {}).sort())
      expectDecisionTypes(APPROVAL_KEY_DECISIONS[tool].root, schema.properties || {}, `${tool}.root`)
    }
  })

  it('speaker/character/voice item의 실제 schema 키도 전부 결정돼 있다', () => {
    const speaker = guarded.story_set_speakers.properties.speakers.items
    const voiceObject = speaker.properties.voice.oneOf.find((branch) => branch.type === 'object')
    const character = guarded.story_confirm_synopsis.properties.characters.items

    expect(decided(APPROVAL_KEY_DECISIONS.story_set_speakers.speaker))
      .toEqual(Object.keys(speaker.properties).sort())
    expect(decided(APPROVAL_KEY_DECISIONS.story_set_speakers.voice))
      .toEqual(Object.keys(voiceObject.properties).sort())
    expect(decided(APPROVAL_KEY_DECISIONS.story_confirm_synopsis.character))
      .toEqual(Object.keys(character.properties).sort())
    expectDecisionTypes(APPROVAL_KEY_DECISIONS.story_set_speakers.speaker, speaker.properties, 'speaker')
    expectDecisionTypes(APPROVAL_KEY_DECISIONS.story_set_speakers.voice, voiceObject.properties, 'voice')
    expectDecisionTypes(APPROVAL_KEY_DECISIONS.story_confirm_synopsis.character, character.properties, 'character')
  })

  it('start_step의 step별 params 키를 anyOf branch에서 파생해 presenter 결정과 비교한다', () => {
    const schema = guarded.story_start_step
    const schemaParams = Object.fromEntries(schema.properties.params.anyOf.map((branch) => {
      const step = branch.description.match(/step="([^"]+)"/)[1]
      return [step, Object.keys(branch.properties || {}).sort()]
    }))
    const presenterParams = Object.fromEntries(Object.entries(APPROVAL_KEY_DECISIONS.story_start_step.params)
      .map(([step, decision]) => [step, decided(decision)]))

    expect(presenterParams).toEqual(schemaParams)
    expect(Object.keys(presenterParams).sort()).toEqual(schema.properties.step.enum.slice().sort())
    for (const branch of schema.properties.params.anyOf) {
      const step = branch.description.match(/step="([^"]+)"/)[1]
      expectDecisionTypes(APPROVAL_KEY_DECISIONS.story_start_step.params[step], branch.properties, `params.${step}`)
    }
  })

  it('하류 초기화 경고의 step map은 stepMachine 실행 map과 같다', () => {
    expect(approvalPresenterModule.APPROVAL_DOWNSTREAM).toEqual(STORY_STEP_DOWNSTREAM)
  })
})

describe('stepMachine에서 검증한 실제 효과만 서술한다', () => {
  it('확정 명단 상태의 set_speakers는 필드 변경과 신규 인물이 반영되지 않을 수 있음을 경고한다', () => {
    const text = presentApproval('story_set_speakers', {
      speakers: [{ id: 'kim', name: '김철수', gender: 'male', role: '형사' }],
    }, koT).lines.map((line) => line.text).join('\n')

    expect(text).toMatch(/확정 명단/)
    expect(text).toMatch(/음성.*외모.*보강/)
    expect(text).toMatch(/기존 화자.*성별.*나이.*역할.*외모.*덮어써지지 않을 수/)
    expect(text).toMatch(/확정 명단.*이름 변경.*신규 화자.*반영되지 않/)
  })

  it.each([[koT, /병합/, /유지/], [enT, /merge/i, /kept/i]])('set_speakers는 저장이 아니라 merge라고 말한다', (t, merge, kept) => {
    const text = presentApproval('story_set_speakers', {
      speakers: [{ id: 'kim', name: '김철수', voice: null }],
    }, t).lines.map((line) => line.text).join('\n')

    expect(text).toMatch(merge)
    expect(text).toMatch(kept)
    expect(text).toContain('김철수')
    expect(text).toContain('null')
  })

  it('set_speakers는 부분 명단이 씬 참조 화자를 빠뜨리면 병합 전에 거부된다고 말한다', () => {
    const text = presentApproval('story_set_speakers', {
      speakers: [{ id: 'kim', name: '김철수' }],
    }, koT).lines.map((line) => line.text).join('\n')

    expect(text).toMatch(/씬.*참조.*빠뜨|장면.*참조.*누락/)
    expect(text).toMatch(/거부/)
  })

  it('화자/등장인물은 i18n 라벨로 읽히고 값은 verbatim이다', () => {
    const speaker = presentApproval('story_set_speakers', {
      speakers: [{
        id: 'kim', name: '김철수', voice: { provider: 'typecast', voiceId: 'tc_123' },
        gender: 'male', role: '형사', age: '42', appearance: '검은 코트',
      }],
    }, koT).lines.map((line) => line.text).join('\n')
    expect(speaker).toContain('김철수 (kim)')
    expect(speaker).toContain('음성: typecast / tc_123')
    expect(speaker).toContain('성별: male')
    expect(speaker).toContain('역할: 형사')
    expect(speaker).toContain('나이: 42')
    expect(speaker).toContain('외모: 검은 코트')
    expect(speaker).not.toMatch(/voice\.provider|voice\.voiceId|gender:|role:|age:|appearance:/)

    const character = presentApproval('story_confirm_synopsis', {
      characters: [{ name: '강리안', ethnicity: '한국인' }],
    }, koT).lines.map((line) => line.text).join('\n')
    expect(character).toContain('강리안')
    expect(character).toContain('민족: 한국인')
  })

  it('confirm_synopsis는 명단 교체·synopsis 덮어쓰기·하류 게이트 개방을 모두 말한다', () => {
    const presentation = presentApproval('story_confirm_synopsis', {
      synopsisMd: '새 시놉시스', characters: [{ name: '김철수' }],
    }, koT)
    const text = presentation.lines.map((line) => line.text).join('\n')

    expect(text).toMatch(/교체/)
    expect(text).toMatch(/제거/)
    expect(text).toMatch(/덮어/)
    expect(text).toMatch(/다음 단계/)
    expect(presentation.lines.filter((line) => line.danger)).toHaveLength(2)
    expect(presentation.blocks).toEqual([{ label: expect.any(String), path: '/synopsisMd', text: '새 시놉시스' }])
  })

  it('audio regenerate는 비용·강제 재합성·나머지 캐시 검증·prompts 초기화를 숨기지 않는다', () => {
    const presentation = presentApproval('story_start_step', {
      step: 'audio', params: { regenerate: ['seg-1', 'seg-2'] },
    }, koT)
    const text = presentation.lines.map((line) => line.text).join('\n')

    expect(text).toMatch(/비용/)
    expect(text).toMatch(/새로 합성.*진행.*외부 TTS\/SFX API/)
    expect(text).toMatch(/강제 재합성 2/)
    expect(text).toContain('seg-1')
    expect(text).toContain('seg-2')
    expect(text).toMatch(/유효하면 재사용/)
    expect(text).toMatch(/함께 새로 합성/)
    expect(text).toMatch(/프롬프트.*초기화/)
    expect(text).not.toMatch(/그 둘만|only (those|these)/i)
    expect(text).not.toMatch(/고유|입력 .*건/)
  })

  it.each([false, true])('prompts reviewOnly=%s는 모드에 따라 LLM 없이 고정 산출물을 저장할 수 있음을 말한다', (reviewOnly) => {
    const text = presentApproval('story_start_step', {
      step: 'prompts', params: { reviewOnly },
    }, koT).lines.map((line) => line.text).join('\n')

    expect(text).toMatch(/프로젝트 모드에 따라|일반 모드.*image-first|image-first.*일반 모드/)
    expect(text).toMatch(/image-first/)
    expect(text).toMatch(/LLM.*호출 없이|LLM 없이/)
    expect(text).toMatch(/scenes\.json.*manifest.*revision|고정 씬.*manifest.*revision/)
    expect(text).not.toMatch(/실제 변경이 생긴 경우에만 scenes\.json/)
  })

  it('script reviewOnly의 nonblank 후보는 검수 결과와 무관한 교체·하류 초기화 조건을 말한다', () => {
    const text = presentApproval('story_start_step', {
      step: 'script',
      params: { reviewOnly: true, scriptOverride: '에이전트 후보 대본', review: { script: { enabled: true } } },
    }, koT).lines.map((line) => line.text).join('\n')

    expect(text).toMatch(/후보 대본.*저장본.*다르면.*검수 결과와 무관.*script\.md.*덮어|검수 결과와 무관.*후보 대본.*저장본.*다르면.*script\.md.*덮어/)
    expect(text).toMatch(/후보 대본.*저장본.*다르거나.*검수.*변경.*하류 단계.*초기화/)
    expect(text).not.toMatch(/검수로 실제 변경이 생긴 경우에만 script\.md/)
    expect(text).not.toMatch(/검수로 실제 변경이 생긴 경우에만 하류 단계/)
  })

  it('script reviewOnly에 후보가 없을 때만 검수 변경을 덮어쓰기·하류 초기화 조건으로 말한다', () => {
    const text = presentApproval('story_start_step', {
      step: 'script', params: { reviewOnly: true },
    }, koT).lines.map((line) => line.text).join('\n')

    expect(text).toMatch(/검수로 실제 변경이 생긴 경우에만 script\.md/)
    expect(text).toMatch(/검수로 실제 변경이 생긴 경우에만 하류 단계/)
  })

  it('scenes reviewOnly의 scriptOverride는 원문만 보이고 script.md 교체 효과로 설명하지 않는다', () => {
    const presentation = presentApproval('story_start_step', {
      step: 'scenes', params: { reviewOnly: true, scriptOverride: '무시되는 후보' },
    }, koT)
    const text = presentation.lines.map((line) => line.text).join('\n')
    const override = presentation.lines.find((line) => line.paths.includes('/params/scriptOverride'))

    expect(text).toContain('무시되는 후보')
    expect(override.text).toMatch(/이번 실행에는 적용되지 않/)
    expect(text).not.toMatch(/script\.md.*덮어|덮어.*script\.md/)
    expect(text).toMatch(/확정 명단 밖 화자.*검수 변경이 없어도.*narrator.*scenes\.json.*저장/)
    expect(text).not.toMatch(/검수로 실제 변경이 생긴 경우에만 scenes\.json/)
  })

  it.each([
    ['reviewOnly가 continue보다 우선', { reviewOnly: true, continue: '무시될 이어쓰기' }, ['continue']],
    ['continue가 나머지 생성 인자보다 우선', {
      continue: '이어 쓸 시작점', pastedScript: '무시될 붙여넣기', synopsis: '무시될 시놉시스', title: '무시될 제목',
    }, ['pastedScript', 'synopsis', 'title']],
    ['비-pasted 생성의 title 제거', { synopsis: '사용할 시놉시스', title: '무시될 제목' }, ['title']],
  ])('script 승자 분기에서 %s 인자는 원문과 함께 미적용이라고 표시한다', (_label, params, ignoredKeys) => {
    const presentation = presentApproval('story_start_step', { step: 'script', params }, koT)

    for (const key of ignoredKeys) {
      const line = presentation.lines.find((entry) => entry.paths.includes(`/params/${key}`))
      expect(line.text).toContain(params[key])
      expect(line.text).toMatch(/이번 실행에는 적용되지 않/)
    }
  })

  it.each([
    ['reviewOnly 분기', { reviewOnly: true, scriptOverride: '무시될 후보', title: '무시될 제목' }, ['scriptOverride', 'title']],
    ['저장 대본 분리', { title: '무시될 제목' }, ['title']],
  ])('scenes %s의 패자 인자는 원문과 함께 미적용이라고 표시한다', (_label, params, ignoredKeys) => {
    const presentation = presentApproval('story_start_step', { step: 'scenes', params }, koT)

    for (const key of ignoredKeys) {
      const line = presentation.lines.find((entry) => entry.paths.includes(`/params/${key}`))
      expect(line.text).toContain(params[key])
      expect(line.text).toMatch(/이번 실행에는 적용되지 않/)
    }
  })

  it('실제로 적용되는 pasted title과 scenes override title은 미적용이라고 표시하지 않는다', () => {
    const applied = [
      presentApproval('story_start_step', {
        step: 'script', params: { pastedScript: '붙여넣기', title: '붙여넣기 제목' },
      }, koT),
      presentApproval('story_start_step', {
        step: 'scenes', params: { scriptOverride: '교체 대본', title: '씬 제목' },
      }, koT),
    ]

    for (const presentation of applied) {
      const title = presentation.lines.find((line) => line.paths.includes('/params/title'))
      expect(title.text).not.toMatch(/이번 실행에는 적용되지 않/)
    }
  })

  it('미래 step의 내부 dispatch는 prompts로 추측하지 않고 null로 닫힌다', () => {
    expect(typeof approvalPresenterModule.presentStartStep).toBe('function')
    expect(approvalPresenterModule.presentStartStep({ step: 'future', params: {} }, koT)).toBeNull()
  })

  it.each([false, true])('scenes reviewOnly=%s는 화자 명단 갱신 가능성을 말한다', (reviewOnly) => {
    const text = presentApproval('story_start_step', {
      step: 'scenes', params: { reviewOnly },
    }, koT).lines.map((line) => line.text).join('\n')

    expect(text).toMatch(/화자 명단.*갱신.*수/)
  })

  it('중복 regenerate ID는 실행부 Set과 같은 고유 개수로 말하되 입력값 두 개를 모두 그대로 보인다', () => {
    const presentation = presentApproval('story_start_step', {
      step: 'audio', params: { regenerate: ['seg-1', 'seg-1'] },
    }, koT)
    const line = presentation.lines.find((entry) => entry.paths.includes('/params/regenerate/0'))

    expect(line.text).toMatch(/고유.*1|1.*고유/)
    expect(line.text).toMatch(/입력.*2|2.*입력/)
    expect(line.text.match(/seg-1/g)).toHaveLength(2)
    expect(line.danger).toBe(true)
  })

  it('script/scenes의 상태 비의존 덮어쓰기를 danger 문장으로 말하고 원문 값을 그대로 넣는다', () => {
    const pastedScript = '짧은 붙여넣기 대본'
    const pasted = presentApproval('story_start_step', {
      step: 'script', params: { pastedScript },
    }, koT)
    const pastedLine = pasted.lines.find((line) => line.paths.includes('/params/pastedScript'))
    expect(pastedLine.text).toContain(pastedScript)
    expect(pastedLine.text).toMatch(/script\.md.*덮어|덮어.*script\.md/)
    expect(pastedLine.danger).toBe(true)

    const synopsis = presentApproval('story_start_step', {
      step: 'script', params: { synopsis: '새 시놉시스' },
    }, koT)
    const synopsisLine = synopsis.lines.find((line) => line.paths.includes('/params/synopsis'))
    expect(synopsisLine.text).toContain('새 시놉시스')
    expect(synopsisLine.text).toMatch(/synopsis\.md.*덮어|덮어.*synopsis\.md/)
    expect(synopsisLine.danger).toBe(true)

    const override = presentApproval('story_start_step', {
      step: 'scenes', params: { scriptOverride: '교체 대본' },
    }, koT)
    const overrideLine = override.lines.find((line) => line.paths.includes('/params/scriptOverride'))
    expect(overrideLine.text).toContain('교체 대본')
    expect(overrideLine.text).toMatch(/script\.md.*덮어|덮어.*script\.md/)
    expect(overrideLine.danger).toBe(true)
  })

  it('pastedScript는 등장인물 확정을 해제하고 하류 게이트를 다시 잠근다고 말한다', () => {
    const text = presentApproval('story_start_step', {
      step: 'script', params: { pastedScript: '새 대본' },
    }, koT).lines.map((line) => line.text).join('\n')

    expect(text).toMatch(/등장인물 확정.*해제/)
    expect(text).toMatch(/재확정.*하류 단계.*잠/)
  })

  it.each([
    ['continue', '이어 쓸 첫 줄\n둘째 줄'],
    ['pastedScript', '붙여넣을 첫 줄\n둘째 줄'],
    ['scriptOverride', '검수할 첫 줄\n둘째 줄'],
  ])('개행이 있는 %s 원문은 danger 문장 안이 아니라 block에 전부 둔다', (key, value) => {
    const presentation = presentApproval('story_start_step', {
      step: 'script', params: { reviewOnly: key === 'scriptOverride', [key]: value },
    }, koT)

    expect(presentation.lines.some((line) => line.text.includes(value))).toBe(false)
    expect(presentation.blocks).toContainEqual({ label: expect.any(String), path: `/params/${key}`, text: value })
  })

  it('짧은 값은 이질적인 수학 구분자 없이 인라인 따옴표로 보인다', () => {
    const presentation = presentApproval('story_start_step', {
      step: 'prompts', params: { style: '수채화' },
    }, koT)
    const line = presentation.lines.find((entry) => entry.paths.includes('/params/style'))

    expect(line.text).toContain('"수채화"')
    expect(line.text).not.toContain('⟦')
    expect(line.text).not.toContain('⟧')
  })

  it('script synopsis 원문은 verbatim으로 보이고 실제 저장값은 trim된다고 말한다', () => {
    const raw = '  새 시놉시스\n  '
    const presentation = presentApproval('story_start_step', {
      step: 'script', params: { synopsis: raw },
    }, koT)
    const line = presentation.lines.find((entry) => entry.danger && entry.text.includes('synopsis.md'))

    expect(line.text).not.toContain(raw)
    expect(line.text).toMatch(/앞뒤 공백.*제거|trim/i)
    expect(line.text).toMatch(/synopsis\.md.*덮어|덮어.*synopsis\.md/)
    expect(presentation.blocks).toContainEqual({ label: expect.any(String), path: '/params/synopsis', text: raw })
  })

  it('script review 비용은 변경 판정 전에 발생하고 후보 없는 저장은 검수 변경에만 묶인다', () => {
    const presentation = presentApproval('story_start_step', {
      step: 'script', params: { reviewOnly: true },
    }, koT)
    const effect = presentation.lines.find((line) => line.danger && line.text.includes('script.md'))

    expect(effect.text).toMatch(/활성화.*외부 LLM.*비용/)
    expect(effect.text).toMatch(/변경.*경우.*script\.md.*덮어|변경.*경우.*덮어.*script\.md/)
    expect(effect.text).not.toMatch(/실제 변경이 (?:생긴|있을) 경우에만.*비용/)
  })

  it('scenes review는 검수 pass여도 roster 후처리가 저장·하류 초기화를 일으킬 수 있다고 말한다', () => {
    const text = presentApproval('story_start_step', {
      step: 'scenes', params: { reviewOnly: true },
    }, koT).lines.map((line) => line.text).join('\n')

    expect(text).toMatch(/활성화.*외부 LLM.*비용/)
    expect(text).toMatch(/확정 명단 밖 화자.*검수 변경이 없어도.*narrator.*scenes\.json.*저장/)
    expect(text).toMatch(/확정 명단 밖 화자.*검수 변경이 없어도.*하류 단계.*초기화/)
    expect(text).not.toMatch(/검수로 실제 변경이 생긴 경우에만 (?:scenes\.json|하류 단계)/)
  })

  it('빈 덮어쓰기 인자는 실제 파일을 덮지 않으므로 값은 보이되 그 path를 danger로 단정하지 않는다', () => {
    const script = presentApproval('story_start_step', {
      step: 'script', params: { pastedScript: '', synopsis: '' },
    }, koT)
    for (const path of ['/params/pastedScript', '/params/synopsis']) {
      const line = script.lines.find((entry) => entry.paths.includes(path))
      expect(line.text).toContain('""')
      expect(line.danger).not.toBe(true)
    }

    const scenes = presentApproval('story_start_step', {
      step: 'scenes', params: { scriptOverride: '' },
    }, koT)
    const line = scenes.lines.find((entry) => entry.paths.includes('/params/scriptOverride'))
    expect(line.text).toContain('""')
    expect(line.danger).not.toBe(true)
    expect(scenes.lines.map((entry) => entry.text).join('\n')).not.toMatch(/외부 LLM|scenes\.json.*덮어|덮어.*scenes\.json/)
  })

  it('script 분기는 continue를 pastedScript/synopsis보다 먼저 소비한다고 정직하게 말한다', () => {
    const presentation = presentApproval('story_start_step', {
      step: 'script',
      params: { continue: '이어 쓸 시작점', pastedScript: '무시될 붙여넣기', synopsis: '무시될 시놉시스' },
    }, koT)
    const byPath = (path) => presentation.lines.find((line) => line.paths.includes(path))

    expect(byPath('/params/continue').text).toMatch(/외부 LLM/)
    expect(byPath('/params/continue').text).toMatch(/script\.md.*덮어|덮어.*script\.md/)
    expect(byPath('/params/continue').danger).toBe(true)
    expect(byPath('/params/pastedScript').danger).not.toBe(true)
    expect(byPath('/params/synopsis').danger).not.toBe(true)
  })

  it('whitespace-only confirm synopsisMd는 overwrite라고 하지 않고 실제 공백·개행을 escape 없이 보인다', () => {
    const synopsisMd = '  \n  '
    const presentation = presentApproval('story_confirm_synopsis', {
      synopsisMd, characters: [],
    }, koT)
    const text = presentation.lines.map((line) => line.text).join('\n')

    expect(text).not.toContain(synopsisMd)
    expect(text).toMatch(/공백.*덮어쓰지 않/)
    expect(presentation.blocks).toContainEqual({ label: expect.any(String), path: '/synopsisMd', text: synopsisMd })
  })

  it('params를 생략한 audio도 기본값 {}로 실행되므로 비용과 prompts 초기화를 말하되 유령 path는 선언하지 않는다', () => {
    const presentation = presentApproval('story_start_step', { step: 'audio' }, koT)
    const text = presentation.lines.map((line) => line.text).join('\n')

    expect(text).toMatch(/비용/)
    expect(text).toMatch(/프롬프트.*초기화/)
    expect(presentation.lines.flatMap((line) => line.paths)).not.toContain('/params')
  })

  it('params를 생략한 일반 script도 외부 LLM 비용과 script.md 덮어쓰기를 숨기지 않는다', () => {
    const presentation = presentApproval('story_start_step', { step: 'script' }, koT)
    const text = presentation.lines.map((line) => line.text).join('\n')

    expect(text).toMatch(/외부 LLM/)
    expect(text).toMatch(/script\.md.*덮어|덮어.*script\.md/)
    expect(presentation.lines.some((line) => line.danger)).toBe(true)
    expect(presentation.lines.flatMap((line) => line.paths)).not.toContain('/params')
  })

  it('scenes reviewOnly 하류 경고는 검수 변경만을 유일한 초기화 조건으로 단정하지 않는다', () => {
    const text = presentApproval('story_start_step', {
      step: 'scenes', params: { reviewOnly: true },
    }, koT).lines.map((line) => line.text).join('\n')

    expect(text).toMatch(/true/)
    expect(text).toMatch(/확정 명단 밖 화자.*검수 변경이 없어도.*하류 단계.*초기화/)
    expect(text).not.toMatch(/검수로 실제 변경이 생긴 경우에만 하류 단계/)
  })

  it('audio는 재그룹 시 scenes.json 재작성으로 기존 프롬프트와 요약이 소실될 수 있다고 경고한다', () => {
    const presentation = presentApproval('story_start_step', {
      step: 'audio', params: { regenerate: ['seg-3'] },
    }, koT)
    const warning = presentation.lines.find((line) => (
      line.text.includes('scenes.json') && line.text.includes('프롬프트')
    ))

    expect(warning?.text).toMatch(/오디오 실측.*씬 구성.*재그룹.*scenes\.json.*재작성/)
    expect(warning?.text).toMatch(/이미지.*비디오 프롬프트.*씬 요약.*소실될 수/)
    expect(warning?.danger).toBe(true)
  })

  it.each([
    ['둘 다 제출', { title: '야담 5화', options: { genre: 'yadam', language: 'ko' } }, false, false],
    ['둘 다 생략', {}, true, true],
    ['제목만 제출', { title: '야담 5화' }, false, true],
    ['옵션만 제출', { options: { genre: 'yadam' } }, true, false],
  ])('pastedScript 입력 교체는 %s에 맞춰 제목·옵션의 실제 값 또는 소거를 말한다', (
    _label, extra, clearsTitle, clearsOptions,
  ) => {
    const presentation = presentApproval('story_start_step', {
      step: 'script', params: { pastedScript: '수정 대본', ...extra },
    }, koT)
    const danger = presentation.lines.filter((line) => line.danger)
    const titleLine = danger.find((line) => line.paths.includes('/params/title'))
    const optionsLine = danger.find((line) => line.paths.includes('/params/options'))
    const text = danger.map((line) => line.text).join('\n')

    if (clearsTitle) {
      expect(titleLine).toBeUndefined()
      expect(text).toMatch(/title.*생략.*프로젝트 제목.*지워/)
    } else {
      expect(titleLine?.text).toContain(`"${extra.title}"`)
      expect(titleLine?.text).toMatch(/프로젝트 제목.*교체/)
    }
    if (clearsOptions) {
      expect(optionsLine).toBeUndefined()
      expect(text).toMatch(/options.*생략.*생성 옵션.*지워/)
    } else {
      expect(optionsLine?.text).toContain(JSON.stringify(extra.options))
      expect(optionsLine?.text).toMatch(/생성 옵션.*교체/)
    }
  })

  it('set_speakers는 기존 필드 보존과 확정 명단의 추가 제한을 별개로 경고한다', () => {
    const text = presentApproval('story_set_speakers', {
      speakers: [{
        id: 'kim', name: '김철수', gender: 'male', age: '40대', role: '장군', appearance: '갑옷',
      }],
    }, koT).lines.map((line) => line.text).join('\n')

    expect(text).toMatch(/기존 화자.*이미 설정된.*성별.*나이.*역할.*외모.*덮어써지지 않을 수/)
    expect(text).toMatch(/확정 명단 상태에서는.*추가로.*이름 변경.*명단 밖 신규 화자.*반영되지 않/)
  })

  it('confirm_synopsis는 명단 정규화에서 중복·나레이터 항목이 제외된다고 말한다', () => {
    const text = presentApproval('story_confirm_synopsis', {
      characters: [{ name: '나레이션' }, { name: '김철수' }, { name: '김철수' }],
    }, koT).lines.map((line) => line.text).join('\n')

    expect(text).toMatch(/정규화.*중복.*나레이터.*제외/)
  })
})
