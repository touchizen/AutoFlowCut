import { describe, expect, it } from 'vitest'
import { parseStoryboardCSVRows } from '../../../src/utils/parsers'
import {
  buildStoryboardArtifacts,
  validateStoryboardRows,
} from '../../../electron/story/storyboardInput'
import { validateFixedScenes } from '../../../electron/story/fixedScenes'

const fixedScenes = () => [
  { storyId: 'fixed-story-alpha', rendererSceneId: 'renderer_A', ordinal: 1 },
  { storyId: 'fixed-story-beta', rendererSceneId: 'renderer_B', ordinal: 2 },
]

function validatedBoard() {
  const csv = [
    'scene,prompt,subtitle,speaker,duration',
    '10,"  First prompt  "," first line ",narrator,1',
    '10,"  First prompt  ",second line,narrator,2',
    '20,Visual only,,,2',
    '20,Visual only,,,3',
  ].join('\n')
  const result = validateStoryboardRows(parseStoryboardCSVRows(csv), { roster: [] })
  expect(result.success).toBe(true)
  return result
}

function validateArtifacts(artifacts, validated = validatedBoard(), overrides = {}) {
  return validateFixedScenes({
    scenes: artifacts.scenes,
    fixedScenes: fixedScenes(),
    variant: 'storyboard',
    speakers: validated.speakers,
    sourceRows: validated.rows,
    requireTiming: false,
    ...overrides,
  })
}

function expectViolation(result, code) {
  expect(result.success).toBe(false)
  expect(result.error).toBe('fixed-scenes-invalid')
  expect(result.violations.some((violation) => violation.code === code)).toBe(true)
}

describe('buildStoryboardArtifacts deterministic adapter (D24a-1/2/4)', () => {
  it('has only the validated storyboard and fixed identity list as inputs', () => {
    expect(buildStoryboardArtifacts).toHaveLength(2)
  })

  it('builds script.md rows and fixed scenes without minting identity or indexing by CSV labels', () => {
    const validated = validatedBoard()
    const result = buildStoryboardArtifacts(validated, fixedScenes())

    expect(result).toEqual({
      scriptMd: [
        '[VISUAL]   First prompt  ',
        '[narrator]  first line ',
        '[VISUAL]   First prompt  ',
        '[narrator] second line',
        '[VISUAL] Visual only',
        '[VISUAL] Visual only',
      ].join('\n'),
      scenes: [
        {
          storyId: 'fixed-story-alpha',
          rendererSceneId: 'renderer_A',
          sceneNo: 1,
          segments: [
            {
              id: 'sb-1-1',
              text: ' first line ',
              speaker: 'narrator',
              type: 'narration',
              sourceRowId: 'storyboard-row-1',
            },
            {
              id: 'sb-1-2',
              text: 'second line',
              speaker: 'narrator',
              type: 'narration',
              sourceRowId: 'storyboard-row-2',
            },
          ],
          imagePrompt: '  First prompt  ',
          sourceRowIds: ['storyboard-row-1', 'storyboard-row-2'],
          plannedMs: 3000,
        },
        {
          storyId: 'fixed-story-beta',
          rendererSceneId: 'renderer_B',
          sceneNo: 2,
          segments: [],
          imagePrompt: 'Visual only',
          sourceRowIds: ['storyboard-row-3', 'storyboard-row-4'],
          plannedMs: 5000,
        },
      ],
    })
  })

  it('emits globally unique filename-safe ids for every audio-bearing segment', () => {
    const { scenes } = buildStoryboardArtifacts(validatedBoard(), fixedScenes())
    const ids = scenes.flatMap((scene) => scene.segments.map((segment) => segment.id))

    expect(new Set(ids).size).toBe(ids.length)
    ids.forEach((id) => expect(id).toMatch(/^[A-Za-z0-9_-]+$/))
  })

  it('feeds its output directly into the independent fixed-scene validator', () => {
    const validated = validatedBoard()
    const artifacts = buildStoryboardArtifacts(validated, fixedScenes())

    expect(validateArtifacts(artifacts, validated)).toEqual({ success: true })
  })

  it('keeps legal absences explicit: spoken prompt/timing may be empty and visual-only rows emit no audio', () => {
    const parsed = parseStoryboardCSVRows([
      'scene,prompt,subtitle,speaker,duration',
      '7,,spoken only,narrator,',
      '9,visual only,,,2',
    ].join('\n'))
    const validated = validateStoryboardRows(parsed, { roster: [] })
    const artifacts = buildStoryboardArtifacts(validated, fixedScenes())

    expect(artifacts.scriptMd).toBe('[narrator] spoken only\n[VISUAL] visual only')
    expect(artifacts.scenes[0]).toMatchObject({ imagePrompt: '', plannedMs: null })
    expect(artifacts.scenes[1].segments).toEqual([])
    expect(validateArtifacts(artifacts, validated)).toEqual({ success: true })
  })
})

describe('buildStoryboardArtifacts precondition boundary', () => {
  it('rejects a non-PASS validator result', () => {
    expect(() => buildStoryboardArtifacts({ success: false }, fixedScenes()))
      .toThrow(/validated storyboard PASS/)
  })

  it('rejects slot count that differs from authoritative fixed N', () => {
    const validated = validatedBoard()
    expect(() => buildStoryboardArtifacts(validated, fixedScenes().slice(0, 1)))
      .toThrow(/slot count/)
  })

  it('rejects malformed fixed identity instead of copying undefined into scenes', () => {
    const slots = fixedScenes()
    slots[0].storyId = ' '
    expect(() => buildStoryboardArtifacts(validatedBoard(), slots)).toThrow(/fixed scene/)
  })

  it('re-asserts sourceRowId uniqueness because the row validator currently does not', () => {
    const parsed = parseStoryboardCSVRows([
      'scene,prompt,subtitle,speaker',
      '1,P,one,narrator',
      '1,P,two,narrator',
      '2,Q,three,narrator',
    ].join('\n'))
    parsed.rows[1].sourceRowId = parsed.rows[0].sourceRowId
    const validated = validateStoryboardRows(parsed, { roster: [] })

    expect(validated.success).toBe(true)
    expect(() => buildStoryboardArtifacts(validated, fixedScenes())).toThrow(/sourceRowId/)
  })
})

describe('adapter output and fixed validator disagree loudly on forbidden mutations', () => {
  const setup = () => {
    const validated = validatedBoard()
    return { validated, artifacts: buildStoryboardArtifacts(validated, fixedScenes()) }
  }

  it('catches a freshly minted storyId', () => {
    const { validated, artifacts } = setup()
    artifacts.scenes[0].storyId = 'minted-story-id'
    expectViolation(validateArtifacts(artifacts, validated), 'scene-story-id-mismatch')
  })

  it('catches a freshly minted rendererSceneId', () => {
    const { validated, artifacts } = setup()
    artifacts.scenes[1].rendererSceneId = 'minted-renderer-id'
    expectViolation(validateArtifacts(artifacts, validated), 'scene-renderer-id-mismatch')
  })

  it('catches a scene number that is not fixed index + 1', () => {
    const { validated, artifacts } = setup()
    artifacts.scenes[0].sceneNo = 10
    expectViolation(validateArtifacts(artifacts, validated), 'scene-number-mismatch')
  })

  it('catches a visual-only row dropped from source ownership', () => {
    const { validated, artifacts } = setup()
    artifacts.scenes[1].sourceRowIds.pop()
    expectViolation(validateArtifacts(artifacts, validated), 'storyboard-source-coverage-mismatch')
  })

  it('catches a spoken segment that points at another row', () => {
    const { validated, artifacts } = setup()
    artifacts.scenes[0].segments[0].sourceRowId = 'storyboard-row-2'
    expectViolation(validateArtifacts(artifacts, validated), 'storyboard-spoken-source-mismatch')
  })

  it('catches a visual-only prompt removed after adaptation', () => {
    const { validated, artifacts } = setup()
    artifacts.scenes[1].imagePrompt = ''
    expectViolation(validateArtifacts(artifacts, validated), 'visual-only-prompt-empty')
  })

  it('catches visual-only timing removed after adaptation', () => {
    const { validated, artifacts } = setup()
    artifacts.scenes[1].plannedMs = null
    expectViolation(validateArtifacts(artifacts, validated), 'visual-only-planned-ms-invalid')
  })

  it('catches a narration speaker outside the validated roster', () => {
    const { validated, artifacts } = setup()
    artifacts.scenes[0].segments[0].speaker = 'ghost'

    expect(validateArtifacts(artifacts, validated)).toEqual({
      success: false,
      error: 'storyboard-speaker-unknown',
      speakers: ['ghost'],
      sourceRowIds: ['storyboard-row-1'],
    })
  })

  it('catches an unknown segment type that could otherwise evade narration coverage', () => {
    const { validated, artifacts } = setup()
    artifacts.scenes[0].segments[0].type = 'other'
    expectViolation(validateArtifacts(artifacts, validated), 'segment-type-invalid')
  })
})
