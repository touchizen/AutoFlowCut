import { describe, expect, it } from 'vitest'
import {
  FIXED_SCENE_ERROR_CODES,
  checkFixedSceneConsistency,
  validateFixedScenes,
} from '../../../electron/story/fixedScenes'

const copy = (value) => structuredClone(value)

const fixedScenes = () => [
  { storyId: 'story-1', rendererSceneId: 'scene_17', ordinal: 1 },
  { storyId: 'story-2', rendererSceneId: 'scene_23', ordinal: 2 },
]

const storyboardRows = () => [
  {
    sourceRowId: 'storyboard-row-1',
    sceneOrdinal: 1,
    prompt: 'Inside a quiet room',
    subtitle: '첫 번째 문장',
    speaker: 'narrator',
  },
  {
    sourceRowId: 'storyboard-row-2',
    sceneOrdinal: 2,
    prompt: 'A river at dawn',
    subtitle: '',
    speaker: '',
  },
]

const storyboardScenes = () => [
  {
    storyId: 'story-1',
    rendererSceneId: 'scene_17',
    sceneNo: 1,
    sourceRowIds: ['storyboard-row-1'],
    plannedMs: null,
    imagePrompt: 'Inside a quiet room',
    startSec: 0,
    endSec: 2,
    segments: [{
      id: 'seg-1',
      text: '첫 번째 문장',
      speaker: 'narrator',
      sourceRowId: 'storyboard-row-1',
    }],
  },
  {
    storyId: 'story-2',
    rendererSceneId: 'scene_23',
    sceneNo: 2,
    sourceRowIds: ['storyboard-row-2'],
    plannedMs: 2000,
    imagePrompt: 'A river at dawn',
    startSec: 2,
    endSec: 4,
    segments: [],
  },
]

const imageOnlyScenes = (lines = [['첫 줄'], ['둘째 줄']]) => fixedScenes().map((slot, index) => ({
  ...slot,
  sceneNo: index + 1,
  startSec: index * 2,
  endSec: (index + 1) * 2,
  segments: lines[index].map((text, segmentIndex) => ({
    id: `seg-${index + 1}-${segmentIndex + 1}`,
    text,
    speaker: 'narrator',
  })),
}))

const validateStoryboard = (overrides = {}) => validateFixedScenes({
  scenes: storyboardScenes(),
  fixedScenes: fixedScenes(),
  variant: 'storyboard',
  speakers: [],
  sourceRows: storyboardRows(),
  requireTiming: false,
  ...overrides,
})

const validateImageOnly = (overrides = {}) => validateFixedScenes({
  scenes: imageOnlyScenes(),
  fixedScenes: fixedScenes(),
  variant: 'image-only',
  speakers: [],
  sourceNarrationLines: ['첫 줄', '둘째 줄'],
  requireTiming: false,
  ...overrides,
})

function expectInvalid(result, code) {
  expect(result.success).toBe(false)
  expect(result.error).toBe('fixed-scenes-invalid')
  expect(result.violations.some((violation) => violation.code === code)).toBe(true)
}

function imageFirstState(overrides = {}) {
  return {
    sceneMode: 'image-first',
    imageFirstVariant: 'storyboard',
    fixedSceneRevision: 'revision-1',
    fixedScenes: fixedScenes(),
    ...overrides,
  }
}

describe('fixed scene public error codes', () => {
  it('structured-clone 가능한 고정 error code를 export한다', () => {
    expect(Object.isFrozen(FIXED_SCENE_ERROR_CODES)).toBe(true)
    expect(FIXED_SCENE_ERROR_CODES).toEqual({
      INVALID: 'fixed-scenes-invalid',
      SPEAKER_UNKNOWN: 'storyboard-speaker-unknown',
      STALE: 'fixed-scenes-stale',
    })
  })
})

describe('validateFixedScenes fixed count/order/identity (D24-C1)', () => {
  it('fixed slot N과 index identity가 정확하면 통과한다', () => {
    expect(validateStoryboard()).toEqual({ success: true })
  })

  it('scene count를 fixed N보다 pad하면 독립적으로 거부한다', () => {
    const scenes = storyboardScenes()
    scenes.push({
      storyId: 'story-3',
      rendererSceneId: 'scene_99',
      sceneNo: 3,
      sourceRowIds: [],
      plannedMs: 1000,
      imagePrompt: 'extra',
      segments: [],
    })

    expectInvalid(validateStoryboard({ scenes }), 'scene-count-mismatch')
  })

  it('scene을 drop하면 fixed N에서 다시 N을 만들지 않고 거부한다', () => {
    expectInvalid(validateStoryboard({ scenes: storyboardScenes().slice(0, 1) }), 'scene-count-mismatch')
  })

  it('scene storyId 중복을 독립적으로 거부한다', () => {
    const scenes = storyboardScenes()
    scenes[1].storyId = scenes[0].storyId

    expectInvalid(validateStoryboard({ scenes }), 'scene-story-id-duplicate')
  })

  it('scene rendererSceneId 중복을 독립적으로 거부한다', () => {
    const scenes = storyboardScenes()
    scenes[1].rendererSceneId = scenes[0].rendererSceneId

    expectInvalid(validateStoryboard({ scenes }), 'scene-renderer-id-duplicate')
  })

  it('scene 순서를 바꾸면 identity 재부착 없이 거부한다', () => {
    const scenes = storyboardScenes().reverse().map((scene, index) => ({ ...scene, sceneNo: index + 1 }))

    expectInvalid(validateStoryboard({ scenes }), 'scene-story-id-mismatch')
  })

  it('fixed ordinal이 non-contiguous면 거부한다', () => {
    const slots = fixedScenes()
    slots[1].ordinal = 3

    expectInvalid(validateStoryboard({ fixedScenes: slots }), 'fixed-slot-ordinal-mismatch')
  })

  it('sceneNo가 index+1과 다르면 거부한다', () => {
    const scenes = storyboardScenes()
    scenes[1].sceneNo = 3

    expectInvalid(validateStoryboard({ scenes }), 'scene-number-mismatch')
  })

  it('fixed storyId가 blank면 거부한다', () => {
    const slots = fixedScenes()
    slots[0].storyId = '  '

    expectInvalid(validateStoryboard({ fixedScenes: slots }), 'fixed-story-id-empty')
  })

  it('fixed rendererSceneId가 blank면 거부한다', () => {
    const slots = fixedScenes()
    slots[0].rendererSceneId = ''

    expectInvalid(validateStoryboard({ fixedScenes: slots }), 'fixed-renderer-id-empty')
  })

  it('fixed storyId 중복을 거부한다', () => {
    const slots = fixedScenes()
    slots[1].storyId = slots[0].storyId

    expectInvalid(validateStoryboard({ fixedScenes: slots }), 'fixed-story-id-duplicate')
  })

  it('fixed rendererSceneId 중복을 거부한다', () => {
    const slots = fixedScenes()
    slots[1].rendererSceneId = slots[0].rendererSceneId

    expectInvalid(validateStoryboard({ fixedScenes: slots }), 'fixed-renderer-id-duplicate')
  })

  it('scene storyId가 같은 index의 fixed slot과 다르면 거부한다', () => {
    const scenes = storyboardScenes()
    scenes[0].storyId = 'reissued-story-id'

    expectInvalid(validateStoryboard({ scenes }), 'scene-story-id-mismatch')
  })

  it('scene rendererSceneId가 같은 index의 fixed slot과 다르면 거부한다', () => {
    const scenes = storyboardScenes()
    scenes[0].rendererSceneId = 'scene_reissued'

    expectInvalid(validateStoryboard({ scenes }), 'scene-renderer-id-mismatch')
  })

  it('scene storyId가 blank면 identity mismatch와 별개로 shape 오류를 보고한다', () => {
    const scenes = storyboardScenes()
    scenes[0].storyId = ''

    expectInvalid(validateStoryboard({ scenes }), 'scene-story-id-empty')
  })

  it('scene rendererSceneId가 blank면 identity mismatch와 별개로 shape 오류를 보고한다', () => {
    const scenes = storyboardScenes()
    scenes[0].rendererSceneId = ''

    expectInvalid(validateStoryboard({ scenes }), 'scene-renderer-id-empty')
  })

  it('blank fixed identity 여러 개를 duplicate identity로 중복 보고하지 않는다', () => {
    const slots = fixedScenes()
    slots[0].storyId = ''
    slots[1].storyId = ''

    const result = validateStoryboard({ fixedScenes: slots })
    expectInvalid(result, 'fixed-story-id-empty')
    expect(result.violations.filter(({ code }) => code === 'fixed-story-id-duplicate')).toEqual([])
  })

  it('fixed N이 0인 빈 이미지 세트를 통과시키지 않는다', () => {
    expectInvalid(validateStoryboard({ scenes: [], fixedScenes: [], sourceRows: [] }), 'fixed-scenes-empty')
  })

  it('scenes가 array가 아니면 빈 scene list로 조용히 낮추지 않는다', () => {
    expectInvalid(validateStoryboard({ scenes: null }), 'scenes-not-array')
  })
})

describe('validateFixedScenes variant content (D24-C2)', () => {
  it('D24a subtitle 없는 slot은 non-empty prompt와 positive plannedMs가 있으면 통과한다', () => {
    expect(validateStoryboard()).toEqual({ success: true })
  })

  it('D24a visual-only slot의 prompt가 비면 거부한다', () => {
    const scenes = storyboardScenes()
    scenes[1].imagePrompt = ' '

    expectInvalid(validateStoryboard({ scenes }), 'visual-only-prompt-empty')
  })

  it('D24a visual-only slot의 plannedMs가 없으면 거부한다', () => {
    const scenes = storyboardScenes()
    scenes[1].plannedMs = null

    expectInvalid(validateStoryboard({ scenes }), 'visual-only-planned-ms-invalid')
  })

  it('D24a spoken slot이 비면 거부한다', () => {
    const scenes = storyboardScenes()
    scenes[0].segments = []

    expectInvalid(validateStoryboard({ scenes }), 'storyboard-spoken-source-mismatch')
  })

  it('D24a narration text가 blank면 sourceRowId coverage와 별개로 거부한다', () => {
    const scenes = storyboardScenes()
    scenes[0].segments[0].text = ' '

    expectInvalid(validateStoryboard({ scenes }), 'narration-text-empty')
  })

  it('D24b 모든 slot에 non-empty narration이 있으면 통과한다', () => {
    expect(validateImageOnly()).toEqual({ success: true })
  })

  it('D24b narration text가 blank면 거부한다', () => {
    const scenes = imageOnlyScenes([[' '], ['둘째 줄']])

    expectInvalid(validateImageOnly({ scenes }), 'narration-text-empty')
  })

  it('D24b slot이 SFX-only면 coverage에서 제외하고 거부한다', () => {
    const scenes = imageOnlyScenes()
    scenes[0].segments = [{ id: 'sfx-1', type: 'sfx', description: 'boom', speaker: '' }]

    expectInvalid(validateImageOnly({ scenes }), 'image-only-narration-empty')
  })

  it('D24b slot의 segments가 비면 거부한다', () => {
    const scenes = imageOnlyScenes()
    scenes[1].segments = []

    expectInvalid(validateImageOnly({ scenes }), 'image-only-narration-empty')
  })

  it('allowlist 밖 segment type은 subtitle에 섞이기 전에 거부한다', () => {
    const scenes = storyboardScenes()
    scenes[0].segments.push({
      id: 'seg-smuggled',
      type: 'foo',
      text: 'SMUGGLED TEXT',
      speaker: 'ghost',
    })

    expectInvalid(validateStoryboard({ scenes }), 'segment-type-invalid')
  })
})

describe('validateFixedScenes storyboard source coverage (D24-C3)', () => {
  const rows = () => [
    { sourceRowId: 'row-1', sceneOrdinal: 1, subtitle: '하나', speaker: 'narrator', prompt: 'P1' },
    { sourceRowId: 'row-2', sceneOrdinal: 1, subtitle: '둘', speaker: 'narrator', prompt: '' },
    { sourceRowId: 'row-3', sceneOrdinal: 2, subtitle: '', speaker: '', prompt: 'P2' },
  ]
  const scenes = () => [
    {
      storyId: 'story-1', rendererSceneId: 'scene_17', sceneNo: 1,
      sourceRowIds: ['row-1', 'row-2'], plannedMs: null, imagePrompt: 'P1',
      segments: [
        { id: 'a', text: '하나', speaker: 'narrator', sourceRowId: 'row-1' },
        { id: 'b', text: '둘', speaker: 'narrator', sourceRowId: 'row-2' },
      ],
    },
    {
      storyId: 'story-2', rendererSceneId: 'scene_23', sceneNo: 2,
      sourceRowIds: ['row-3'], plannedMs: 1000, imagePrompt: 'P2', segments: [],
    },
  ]
  const validate = (nextScenes, nextRows = rows()) => validateStoryboard({ scenes: nextScenes, sourceRows: nextRows })
  const expectGlobalCoverageMismatch = (result, expected, actual) => {
    expectInvalid(result, 'storyboard-source-coverage-mismatch')
    expect(result.violations.find((violation) => (
      violation.code === 'storyboard-source-coverage-mismatch' && violation.index === -1
    ))).toEqual({
      code: 'storyboard-source-coverage-mismatch',
      index: -1,
      ordinal: 0,
      expected,
      actual,
    })
  }

  it('parsed board row 순서와 slot/order를 정확히 한 번 덮으면 통과한다', () => {
    expect(validate(scenes())).toEqual({ success: true })
  })

  it('sceneOrdinal 값이 아니라 distinct ordinal 등장 순서로 fixed slot을 소비한다', () => {
    const nextRows = rows()
    nextRows[0].sceneOrdinal = 10
    nextRows[1].sceneOrdinal = 10
    nextRows[2].sceneOrdinal = 20

    expect(validate(scenes(), nextRows)).toEqual({ success: true })
  })

  it('scene sourceRowIds에서 row를 drop하면 거부한다', () => {
    const next = scenes()
    next[0].sourceRowIds = ['row-1']

    const result = validate(next)
    expectInvalid(result, 'storyboard-source-coverage-mismatch')
    expect(result.violations).toContainEqual({
      code: 'storyboard-source-coverage-mismatch',
      index: 0,
      ordinal: 1,
      expected: ['row-1', 'row-2'],
      actual: ['row-1'],
    })
  })

  it('scene sourceRowIds에서 row를 duplicate하면 거부한다', () => {
    const next = scenes()
    next[0].sourceRowIds = ['row-1', 'row-1', 'row-2']

    expectInvalid(validate(next), 'storyboard-source-coverage-mismatch')
  })

  it('scene sourceRowIds 순서를 바꾸면 거부한다', () => {
    const next = scenes()
    next[0].sourceRowIds = ['row-2', 'row-1']

    expectInvalid(validate(next), 'storyboard-source-coverage-mismatch')
  })

  it('interleaved ordinal을 slot별로 모아 원본 파일 순서를 바꾸면 global coverage로 거부한다', () => {
    const nextRows = [
      { sourceRowId: 'r1', sceneOrdinal: 1, subtitle: 'a', speaker: 'narrator', prompt: 'p' },
      { sourceRowId: 'r2', sceneOrdinal: 2, subtitle: 'b', speaker: 'narrator', prompt: 'p' },
      { sourceRowId: 'r3', sceneOrdinal: 1, subtitle: 'c', speaker: 'narrator', prompt: 'p' },
    ]
    const nextScenes = [
      {
        storyId: 'story-1', rendererSceneId: 'scene_17', sceneNo: 1,
        sourceRowIds: ['r1', 'r3'], imagePrompt: 'p', plannedMs: 1000,
        segments: [
          { id: 'a', text: 'a', speaker: 'narrator', sourceRowId: 'r1' },
          { id: 'c', text: 'c', speaker: 'narrator', sourceRowId: 'r3' },
        ],
      },
      {
        storyId: 'story-2', rendererSceneId: 'scene_23', sceneNo: 2,
        sourceRowIds: ['r2'], imagePrompt: 'p', plannedMs: 1000,
        segments: [{ id: 'b', text: 'b', speaker: 'narrator', sourceRowId: 'r2' }],
      },
    ]

    expectGlobalCoverageMismatch(
      validate(nextScenes, nextRows),
      ['r1', 'r2', 'r3'],
      ['r1', 'r3', 'r2'],
    )
  })

  it('마지막 scene이 통째로 drop되면 global coverage가 누락 row를 보고한다', () => {
    expectGlobalCoverageMismatch(
      validate(scenes().slice(0, 1)),
      ['row-1', 'row-2', 'row-3'],
      ['row-1', 'row-2'],
    )
  })

  it('duplicated source row가 interleaved되면 slot-local 일치와 별개로 global coverage가 거부한다', () => {
    const nextRows = [
      { sourceRowId: 'r1', sceneOrdinal: 1, subtitle: 'a', speaker: 'narrator', prompt: 'p' },
      { sourceRowId: 'r2', sceneOrdinal: 2, subtitle: 'b', speaker: 'narrator', prompt: 'p' },
      { sourceRowId: 'r1', sceneOrdinal: 1, subtitle: 'c', speaker: 'narrator', prompt: 'p' },
    ]
    const nextScenes = [
      {
        storyId: 'story-1', rendererSceneId: 'scene_17', sceneNo: 1,
        sourceRowIds: ['r1', 'r1'], imagePrompt: 'p', plannedMs: 1000,
        segments: [
          { id: 'a', text: 'a', speaker: 'narrator', sourceRowId: 'r1' },
          { id: 'c', text: 'c', speaker: 'narrator', sourceRowId: 'r1' },
        ],
      },
      {
        storyId: 'story-2', rendererSceneId: 'scene_23', sceneNo: 2,
        sourceRowIds: ['r2'], imagePrompt: 'p', plannedMs: 1000,
        segments: [{ id: 'b', text: 'b', speaker: 'narrator', sourceRowId: 'r2' }],
      },
    ]

    expectGlobalCoverageMismatch(
      validate(nextScenes, nextRows),
      ['r1', 'r2', 'r1'],
      ['r1', 'r1', 'r2'],
    )
  })

  it('spoken segment sourceRowId를 drop하면 거부한다', () => {
    const next = scenes()
    delete next[0].segments[1].sourceRowId

    expectInvalid(validate(next), 'storyboard-spoken-source-mismatch')
  })

  it('spoken segment sourceRowId를 duplicate하면 거부한다', () => {
    const next = scenes()
    next[0].segments[1].sourceRowId = 'row-1'

    expectInvalid(validate(next), 'storyboard-spoken-source-mismatch')
  })

  it('spoken segment sourceRowId 순서를 바꾸면 거부한다', () => {
    const next = scenes()
    next[0].segments[0].sourceRowId = 'row-2'
    next[0].segments[1].sourceRowId = 'row-1'

    expectInvalid(validate(next), 'storyboard-spoken-source-mismatch')
  })

  it('distinct sceneOrdinal 수가 fixed N보다 많으면 overflow row id로 거부한다', () => {
    const nextRows = rows()
    nextRows.push({
      sourceRowId: 'row-4', sceneOrdinal: 30, subtitle: '', speaker: '', prompt: 'P3',
    })

    const result = validate(scenes(), nextRows)
    expectInvalid(result, 'storyboard-source-slot-mismatch')
    const violation = result.violations.find(({ code }) => code === 'storyboard-source-slot-mismatch')
    expect(violation).toEqual({
      code: 'storyboard-source-slot-mismatch',
      sourceRowId: 'row-4',
      expected: 2,
      actual: 3,
    })
    expect(violation).not.toHaveProperty('index')
    expect(violation).not.toHaveProperty('ordinal')
  })

  it('distinct sceneOrdinal 수가 fixed N보다 적으면 missing slot index로 거부한다', () => {
    const result = validate(scenes(), rows().slice(0, 2))

    expectInvalid(result, 'storyboard-source-slot-mismatch')
    expect(result.violations).toContainEqual({
      code: 'storyboard-source-slot-mismatch',
      index: 1,
      ordinal: 2,
      expected: 2,
      actual: 1,
    })
  })

  it('blank sourceRowId를 coverage mismatch와 별개로 row-scoped 오류로 보고한다', () => {
    const nextRows = rows()
    nextRows[0].sourceRowId = ''
    const nextScenes = scenes()
    nextScenes[0].sourceRowIds[0] = ''
    nextScenes[0].segments[0].sourceRowId = ''

    const result = validate(nextScenes, nextRows)
    expectInvalid(result, 'storyboard-source-id-empty')
    expect(result.violations).toContainEqual({
      code: 'storyboard-source-id-empty',
      sourceRowId: '',
      expected: 'non-empty string',
      actual: '',
    })
  })

  it('duplicate sourceRowId를 sequence가 일치해도 row-scoped 오류로 보고한다', () => {
    const nextRows = rows()
    nextRows[1].sourceRowId = 'row-1'
    const nextScenes = scenes()
    nextScenes[0].sourceRowIds[1] = 'row-1'
    nextScenes[0].segments[1].sourceRowId = 'row-1'

    const result = validate(nextScenes, nextRows)
    expectInvalid(result, 'storyboard-source-id-duplicate')
    expect(result.violations).toContainEqual({
      code: 'storyboard-source-id-duplicate',
      sourceRowId: 'row-1',
      actual: 'row-1',
    })
  })
})

describe('validateFixedScenes image-only narration sequence (D24-C3)', () => {
  const validateLines = (sourceNarrationLines, lines) => validateImageOnly({
    sourceNarrationLines,
    scenes: imageOnlyScenes(lines),
  })

  it('trim/collapsed whitespace만 normalize하고 line sequence를 보존하면 통과한다', () => {
    expect(validateLines(['  첫\n줄  ', '둘째 줄'], [['첫 줄'], ['둘째 줄']])).toEqual({ success: true })
  })

  it('SFX는 narration line coverage에서 제외한다', () => {
    const scenes = imageOnlyScenes()
    scenes[0].segments.splice(1, 0, { id: 'sfx-1', type: 'sfx', description: 'wind' })

    expect(validateImageOnly({ scenes })).toEqual({ success: true })
  })

  it('source narration line을 drop하면 거부한다', () => {
    expectInvalid(validateLines(['A', 'B', 'C'], [['A'], ['B']]), 'image-only-narration-sequence-mismatch')
  })

  it('blank source narration line을 result sequence mismatch와 별개로 거부한다', () => {
    expectInvalid(validateLines([' ', '둘째 줄'], [[' '], ['둘째 줄']]), 'source-narration-line-empty')
  })

  it('result narration line을 duplicate하면 거부한다', () => {
    expectInvalid(validateLines(['A', 'B', 'C'], [['A', 'A'], ['C']]), 'image-only-narration-sequence-mismatch')
  })

  it('result narration line을 reorder하면 거부한다', () => {
    expectInvalid(validateLines(['A', 'B', 'C'], [['B', 'A'], ['C']]), 'image-only-narration-sequence-mismatch')
  })

  it('한 source line을 split하면 거부한다', () => {
    expectInvalid(validateLines(['A B', 'C'], [['A', 'B'], ['C']]), 'image-only-narration-sequence-mismatch')
  })

  it('두 source line을 merge하면 거부한다', () => {
    expectInvalid(validateLines(['A', 'B', 'C'], [['A B'], ['C']]), 'image-only-narration-sequence-mismatch')
  })

  it('source line을 paraphrase하면 거부한다', () => {
    expectInvalid(validateLines(['원문', '둘째'], [['바꾼 문장'], ['둘째']]), 'image-only-narration-sequence-mismatch')
  })
})

describe('validateFixedScenes speaker membership', () => {
  it('normalized roster id/name 중 하나와 일치하면 통과한다', () => {
    const scenes = imageOnlyScenes()
    scenes[0].segments[0].speaker = ' 강 리안 '
    scenes[1].segments[0].speaker = 'ALICE'

    expect(validateImageOnly({
      scenes,
      speakers: [
        { id: 'char-1', name: '강리안' },
        { id: 'alice', name: '앨리스' },
      ],
    })).toEqual({ success: true })
  })

  it('literal narrator는 roster가 비어도 통과한다', () => {
    expect(validateImageOnly()).toEqual({ success: true })
  })

  it('blank narration speaker는 빈 toast label을 만들지 않고 structural invalid로 거부한다', () => {
    const scenes = imageOnlyScenes()
    scenes[0].segments[0].speaker = '  '

    expectInvalid(validateImageOnly({ scenes }), 'narration-speaker-empty')
  })

  it.each(['해설', 'narration'])('canonical narrator alias %s도 literal narrator처럼 우회시키지 않는다', (alias) => {
    const scenes = imageOnlyScenes()
    scenes[0].segments[0].speaker = alias

    expect(validateImageOnly({
      scenes,
      speakers: [{ id: alias, name: alias }],
    })).toEqual({
      success: false,
      error: 'storyboard-speaker-unknown',
      speakers: [alias],
    })
  })

  it('unknown speaker를 순서대로 dedupe하고 D24a sourceRowIds를 싣는다', () => {
    const scenes = storyboardScenes()
    scenes[0].segments.push({
      id: 'seg-2', text: '추가 문장', speaker: '유령', sourceRowId: 'storyboard-row-1',
    })
    scenes[0].segments[0].speaker = '유령'
    const rows = storyboardRows()
    rows[0].subtitle = '첫 번째 문장'

    const result = validateStoryboard({ scenes, sourceRows: rows })

    expect(result.error).toBe('fixed-scenes-invalid')
    expect(result.violations.some((violation) => violation.code === 'storyboard-spoken-source-mismatch')).toBe(true)
  })

  it('unknown speaker 결과는 구조가 유효하면 sourceRowIds를 선택적으로 포함한다', () => {
    const scenes = storyboardScenes()
    scenes[0].segments[0].speaker = '유령'

    expect(validateStoryboard({ scenes })).toEqual({
      success: false,
      error: 'storyboard-speaker-unknown',
      speakers: ['유령'],
      sourceRowIds: ['storyboard-row-1'],
    })
  })
})

describe('validateFixedScenes prompt-sync timing', () => {
  it('prompt-sync 전에는 timing absence가 합법이다', () => {
    const scenes = imageOnlyScenes().map(({ startSec: _start, endSec: _end, ...scene }) => scene)

    expect(validateImageOnly({ scenes, requireTiming: false })).toEqual({ success: true })
  })

  it('prompt-sync에서 finite increasing timing이면 통과한다', () => {
    expect(validateImageOnly({ requireTiming: true })).toEqual({ success: true })
  })

  it('prompt-sync clock에 gap이 있으면 거부한다', () => {
    const scenes = imageOnlyScenes()
    scenes[0].startSec = 0
    scenes[0].endSec = 5
    scenes[1].startSec = 10
    scenes[1].endSec = 15

    expectInvalid(validateImageOnly({ scenes, requireTiming: true }), 'scene-timing-noncontiguous')
  })

  it('prompt-sync clock에 overlap이 있으면 거부한다', () => {
    const scenes = imageOnlyScenes()
    scenes[0].startSec = 0
    scenes[0].endSec = 5
    scenes[1].startSec = 4
    scenes[1].endSec = 9

    expectInvalid(validateImageOnly({ scenes, requireTiming: true }), 'scene-timing-noncontiguous')
  })

  it('decimal duration 누적의 부동소수점 오차를 gap으로 오인하지 않는다', () => {
    const slots = [
      { storyId: 'story-1', rendererSceneId: 'scene_1', ordinal: 1 },
      { storyId: 'story-2', rendererSceneId: 'scene_2', ordinal: 2 },
      { storyId: 'story-3', rendererSceneId: 'scene_3', ordinal: 3 },
    ]
    const scenes = slots.map((slot, index) => ({
      ...slot,
      sceneNo: index + 1,
      startSec: [0, 0.1, 0.3][index],
      endSec: [0.1, 0.3, 0.6][index],
      segments: [{ id: `seg-${index + 1}`, text: `line-${index + 1}`, speaker: 'narrator' }],
    }))

    expect(validateImageOnly({
      scenes,
      fixedScenes: slots,
      sourceNarrationLines: ['line-1', 'line-2', 'line-3'],
      requireTiming: true,
    })).toEqual({ success: true })
  })

  it('prompt-sync에서 startSec가 없으면 거부한다', () => {
    const scenes = imageOnlyScenes()
    delete scenes[0].startSec

    expectInvalid(validateImageOnly({ scenes, requireTiming: true }), 'scene-timing-invalid')
  })

  it('prompt-sync에서 endSec가 NaN이면 거부한다', () => {
    const scenes = imageOnlyScenes()
    scenes[0].endSec = Number.NaN

    expectInvalid(validateImageOnly({ scenes, requireTiming: true }), 'scene-timing-invalid')
  })

  it('prompt-sync에서 startSec/endSec가 역전되면 거부한다', () => {
    const scenes = imageOnlyScenes()
    scenes[0].startSec = 3
    scenes[0].endSec = 2

    expectInvalid(validateImageOnly({ scenes, requireTiming: true }), 'scene-timing-invalid')
  })

  it('prompt-sync에서 음수 startSec를 거부한다', () => {
    const scenes = imageOnlyScenes()
    scenes[0].startSec = -1

    expectInvalid(validateImageOnly({ scenes, requireTiming: true }), 'scene-timing-invalid')
  })
})

describe('validateFixedScenes fail-closed input absence', () => {
  it('fixedScenes가 없으면 scenes 길이를 N으로 재사용하지 않는다', () => {
    expectInvalid(validateFixedScenes({
      scenes: storyboardScenes(),
      variant: 'storyboard',
      sourceRows: storyboardRows(),
    }), 'fixed-scenes-not-array')
  })

  it('storyboard sourceRows가 없으면 coverage를 생략하지 않는다', () => {
    expectInvalid(validateStoryboard({ sourceRows: undefined }), 'storyboard-source-rows-not-array')
  })

  it('storyboard sourceRows가 빈 배열이어도 forged visual slot을 통과시키지 않는다', () => {
    const scenes = storyboardScenes().map((scene) => ({
      ...scene,
      sourceRowIds: [],
      segments: [],
      imagePrompt: 'forged visual prompt',
      plannedMs: 1000,
    }))

    expectInvalid(validateStoryboard({ scenes, sourceRows: [] }), 'storyboard-source-slot-empty')
  })

  it('image-only sourceNarrationLines가 없으면 sequence 검사를 생략하지 않는다', () => {
    expectInvalid(validateImageOnly({ sourceNarrationLines: undefined }), 'source-narration-lines-not-array')
  })

  it('segments가 array가 아니어도 throw하지 않고 content 오류로 거부한다', () => {
    const scenes = imageOnlyScenes()
    delete scenes[0].segments

    expectInvalid(validateImageOnly({ scenes }), 'image-only-narration-empty')
  })

  it('speaker roster가 없으면 narrator-only를 근거로 membership 검사를 생략하지 않는다', () => {
    expectInvalid(validateImageOnly({ speakers: undefined }), 'speaker-roster-not-array')
  })

  it('requireTiming flag가 없으면 pre-audio로 추정해 timing gate를 끄지 않는다', () => {
    expectInvalid(validateFixedScenes({
      scenes: imageOnlyScenes(),
      fixedScenes: fixedScenes(),
      variant: 'image-only',
      speakers: [],
      sourceNarrationLines: ['첫 줄', '둘째 줄'],
    }), 'require-timing-invalid')
  })

  // truthy non-boolean(1, 'yes')은 `=== true` 비교에서 탈락해 timing gate를 통째로 건너뛴다.
  // 즉 flag 오타 하나가 rule 6(finite clock) 전체를 조용히 끄는 fail-open이라 boolean만 받는다.
  it.each([1, 'yes', {}])('requireTiming이 boolean이 아니면(%p) timing gate를 조용히 끄지 않는다', (flag) => {
    const gapped = imageOnlyScenes()
    gapped[1].startSec = 999
    gapped[1].endSec = 1000
    expectInvalid(validateFixedScenes({
      scenes: gapped,
      fixedScenes: fixedScenes(),
      variant: 'image-only',
      speakers: [],
      sourceNarrationLines: ['첫 줄', '둘째 줄'],
      requireTiming: flag,
    }), 'require-timing-invalid')
  })

  it('알 수 없는 variant를 content rule 없는 success path로 보내지 않는다', () => {
    expectInvalid(validateStoryboard({ variant: 'unknown' }), 'fixed-variant-invalid')
  })

  it('violations는 enumerable plain structured-clone payload다', () => {
    const result = validateStoryboard({ fixedScenes: [] })

    expect(copy(result)).toEqual(result)
    expect(JSON.parse(JSON.stringify(result))).toEqual(result)
    expect(Object.keys(result.violations[0])).toContain('code')
    expect(Object.keys(result.violations[0])).toContain('index')
    expect(Object.keys(result.violations[0])).toContain('ordinal')
  })

  it('undefined와 non-finite violation detail을 JSON-safe 값으로 normalize한다', () => {
    const slots = fixedScenes()
    delete slots[0].storyId
    const undefinedResult = validateStoryboard({ fixedScenes: slots })
    expect(undefinedResult.violations.find(({ code }) => code === 'fixed-story-id-empty')?.actual).toBe(null)

    const scenes = storyboardScenes()
    scenes[1].plannedMs = Number.NaN
    const nonFiniteResult = validateStoryboard({ scenes })
    expect(nonFiniteResult.violations.find(({ code }) => code === 'visual-only-planned-ms-invalid')?.actual).toBe('NaN')
    expect(JSON.parse(JSON.stringify(nonFiniteResult))).toEqual(nonFiniteResult)
  })
})

describe('checkFixedSceneConsistency legacy/mode/revision (D24-C5)', () => {
  it('양쪽 sceneMode가 없는 legacy state는 audio-first이며 fixed 검사를 skip한다', () => {
    expect(checkFixedSceneConsistency({}, {})).toEqual({
      success: true,
      mode: 'audio-first',
      status: 'audio-first',
      shouldValidate: false,
    })
  })

  it('양쪽 state 자체가 없어도 legacy audio-first다', () => {
    expect(checkFixedSceneConsistency(null, undefined)).toEqual({
      success: true,
      mode: 'audio-first',
      status: 'audio-first',
      shouldValidate: false,
    })
  })

  it('array state를 legacy audio-first로 낮추지 않고 stale로 거부한다', () => {
    expect(checkFixedSceneConsistency([], {})).toEqual({
      success: false,
      error: 'fixed-scenes-stale',
    })
  })

  it('project만 image-first면 stale이다', () => {
    expect(checkFixedSceneConsistency(imageFirstState(), {})).toEqual({
      success: false,
      error: 'fixed-scenes-stale',
    })
  })

  it('story만 image-first면 stale이다', () => {
    expect(checkFixedSceneConsistency({}, imageFirstState())).toEqual({
      success: false,
      error: 'fixed-scenes-stale',
    })
  })

  it('project revision이 blank면 stale이다', () => {
    expect(checkFixedSceneConsistency(
      imageFirstState({ fixedSceneRevision: ' ' }),
      imageFirstState(),
    )).toEqual({ success: false, error: 'fixed-scenes-stale' })
  })

  it('story revision이 없으면 stale이다', () => {
    expect(checkFixedSceneConsistency(
      imageFirstState(),
      imageFirstState({ fixedSceneRevision: undefined }),
    )).toEqual({ success: false, error: 'fixed-scenes-stale' })
  })

  it('revision이 다르면 stale이다', () => {
    expect(checkFixedSceneConsistency(
      imageFirstState(),
      imageFirstState({ fixedSceneRevision: 'revision-2' }),
    )).toEqual({ success: false, error: 'fixed-scenes-stale' })
  })

  it('mode/revision/variant/fixed list가 같으면 image-first consistent다', () => {
    expect(checkFixedSceneConsistency(imageFirstState(), imageFirstState())).toEqual({
      success: true,
      mode: 'image-first',
      status: 'consistent',
      shouldValidate: true,
    })
  })

  it('imageFirstVariant가 다르면 stale이다', () => {
    expect(checkFixedSceneConsistency(
      imageFirstState(),
      imageFirstState({ imageFirstVariant: 'image-only' }),
    )).toEqual({ success: false, error: 'fixed-scenes-stale' })
  })
})

describe('checkFixedSceneConsistency fixed slot equality', () => {
  it('fixed count가 다르면 stale이다', () => {
    const story = imageFirstState({ fixedScenes: fixedScenes().slice(0, 1) })

    expect(checkFixedSceneConsistency(imageFirstState(), story)).toEqual({
      success: false,
      error: 'fixed-scenes-stale',
    })
  })

  it('fixed order가 다르면 stale이다', () => {
    const slots = fixedScenes().reverse().map((slot, index) => ({ ...slot, ordinal: index + 1 }))

    expect(checkFixedSceneConsistency(imageFirstState(), imageFirstState({ fixedScenes: slots }))).toEqual({
      success: false,
      error: 'fixed-scenes-stale',
    })
  })

  it('fixed storyId가 다르면 stale이다', () => {
    const slots = fixedScenes()
    slots[0].storyId = 'different-story'

    expect(checkFixedSceneConsistency(imageFirstState(), imageFirstState({ fixedScenes: slots }))).toEqual({
      success: false,
      error: 'fixed-scenes-stale',
    })
  })

  it('fixed rendererSceneId가 다르면 stale이다', () => {
    const slots = fixedScenes()
    slots[0].rendererSceneId = 'scene_different'

    expect(checkFixedSceneConsistency(imageFirstState(), imageFirstState({ fixedScenes: slots }))).toEqual({
      success: false,
      error: 'fixed-scenes-stale',
    })
  })

  it('fixed ordinal이 다르면 stale이다', () => {
    const slots = fixedScenes()
    slots[1].ordinal = 3

    expect(checkFixedSceneConsistency(imageFirstState(), imageFirstState({ fixedScenes: slots }))).toEqual({
      success: false,
      error: 'fixed-scenes-stale',
    })
  })

  it('양쪽 fixed list가 똑같이 비어도 full fixed set이 아니므로 stale이다', () => {
    expect(checkFixedSceneConsistency(
      imageFirstState({ fixedScenes: [] }),
      imageFirstState({ fixedScenes: [] }),
    )).toEqual({ success: false, error: 'fixed-scenes-stale' })
  })

  it('양쪽 fixed identity가 똑같이 blank여도 stale이다', () => {
    const slots = fixedScenes()
    slots[0].storyId = ''

    expect(checkFixedSceneConsistency(
      imageFirstState({ fixedScenes: copy(slots) }),
      imageFirstState({ fixedScenes: copy(slots) }),
    )).toEqual({ success: false, error: 'fixed-scenes-stale' })
  })

  it('양쪽 fixed ordinal이 똑같이 non-contiguous여도 stale이다', () => {
    const slots = fixedScenes()
    slots[1].ordinal = 3

    expect(checkFixedSceneConsistency(
      imageFirstState({ fixedScenes: copy(slots) }),
      imageFirstState({ fixedScenes: copy(slots) }),
    )).toEqual({ success: false, error: 'fixed-scenes-stale' })
  })

  it('양쪽 fixed identity가 똑같이 duplicate여도 stale이다', () => {
    const slots = fixedScenes()
    slots[1].storyId = slots[0].storyId

    expect(checkFixedSceneConsistency(
      imageFirstState({ fixedScenes: copy(slots) }),
      imageFirstState({ fixedScenes: copy(slots) }),
    )).toEqual({ success: false, error: 'fixed-scenes-stale' })
  })
})

describe('checkFixedSceneConsistency committed-but-unstaged transition', () => {
  it('옵션이 없으면 project R + legacy story도 stale이다', () => {
    expect(checkFixedSceneConsistency(imageFirstState(), {})).toEqual({
      success: false,
      error: 'fixed-scenes-stale',
    })
  })

  it('project와 exact expected payload가 같고 story revision이 없을 때만 transition이다', () => {
    const project = imageFirstState()

    expect(checkFixedSceneConsistency(project, {}, {
      allowCommittedButUnstaged: true,
      expectedProjectState: copy(project),
    })).toEqual({
      success: true,
      mode: 'image-first',
      status: 'committed-but-unstaged',
      shouldValidate: true,
    })
  })

  it('transition 옵션만 있고 expected project payload가 없으면 stale이다', () => {
    expect(checkFixedSceneConsistency(imageFirstState(), {}, {
      allowCommittedButUnstaged: true,
    })).toEqual({ success: false, error: 'fixed-scenes-stale' })
  })

  it('expected project revision이 다르면 transition을 허용하지 않는다', () => {
    expect(checkFixedSceneConsistency(imageFirstState(), {}, {
      allowCommittedButUnstaged: true,
      expectedProjectState: imageFirstState({ fixedSceneRevision: 'other' }),
    })).toEqual({ success: false, error: 'fixed-scenes-stale' })
  })

  it('expected project fixed list가 다르면 transition을 허용하지 않는다', () => {
    const expected = imageFirstState()
    expected.fixedScenes[0].rendererSceneId = 'scene_other'

    expect(checkFixedSceneConsistency(imageFirstState(), {}, {
      allowCommittedButUnstaged: true,
      expectedProjectState: expected,
    })).toEqual({ success: false, error: 'fixed-scenes-stale' })
  })

  it('story에 non-empty old revision이 있으면 transition을 허용하지 않는다', () => {
    expect(checkFixedSceneConsistency(imageFirstState(), {
      fixedSceneRevision: 'old-revision',
    }, {
      allowCommittedButUnstaged: true,
      expectedProjectState: imageFirstState(),
    })).toEqual({ success: false, error: 'fixed-scenes-stale' })
  })

  it('story mode가 invalid면 revision이 없어도 transition을 허용하지 않는다', () => {
    expect(checkFixedSceneConsistency(imageFirstState(), {
      sceneMode: 'invalid-mode',
    }, {
      allowCommittedButUnstaged: true,
      expectedProjectState: imageFirstState(),
    })).toEqual({ success: false, error: 'fixed-scenes-stale' })
  })
})
