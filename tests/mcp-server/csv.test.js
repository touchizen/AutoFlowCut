/**
 * mcp-server csv.js — R2 review fix: isNewSceneCSVFormat + bundleSceneCSVRows
 *
 * Renderer 의 parseSceneCSVToTracks 와 동등한 결과 emit 확인.
 */
import { describe, it, expect } from 'vitest'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  isNewSceneCSVFormat,
  bundleSceneCSVRows,
  nestSceneGenerationColumns,
  loadCSV,
  saveCSV,
} from '../../mcp-server/lib/csv.js'

const countGenerationStages = (generation) => (
  (generation?.image !== undefined ? 1 : 0)
  + (generation?.video?.t2v !== undefined ? 1 : 0)
  + (generation?.video?.i2v !== undefined ? 1 : 0)
)

describe('isNewSceneCSVFormat', () => {
  it('scene 컬럼 + 정수값 → true', () => {
    expect(isNewSceneCSVFormat(['scene', 'subtitle'], [{ scene: '1', subtitle: 'a' }])).toBe(true)
  })

  it('scene 컬럼 없으면 false', () => {
    expect(isNewSceneCSVFormat(['prompt'], [{ prompt: 'x' }])).toBe(false)
  })

  it('scene 컬럼 비정수 → false (옛 scene_tag alias 케이스)', () => {
    expect(isNewSceneCSVFormat(['scene'], [{ scene: 'courtyard' }])).toBe(false)
  })

  it('빈 rows → false', () => {
    expect(isNewSceneCSVFormat(['scene'], [])).toBe(false)
  })
})

describe('bundleSceneCSVRows', () => {
  it('nests generation columns for legacy row-per-scene MCP load_csv rows', () => {
    const row = nestSceneGenerationColumns({
      prompt: 'P', image_provider: 'openai', image_model: 'gpt-image-1',
    })

    expect(row.generation).toEqual({
      image: { provider: 'openai', model: 'gpt-image-1' },
    })
  })

  it('같은 scene 번호 행이 1개 씬으로 묶임', () => {
    const rows = [
      { scene: '1', prompt: 'P1', subtitle: 'A', start_time: '0', end_time: '1' },
      { scene: '1', prompt: '', subtitle: 'B', start_time: '1', end_time: '2' },
      { scene: '2', prompt: 'P2', subtitle: 'C', start_time: '2', end_time: '3' },
    ]
    const result = bundleSceneCSVRows(rows)
    expect(result.scenes).toHaveLength(2)
    expect(result.scenes[0].srtLineIds).toHaveLength(2)
    expect(result.scenes[1].srtLineIds).toHaveLength(1)
    expect(result.srtTrack).toHaveLength(3)
    expect(result.srtTrack.map(l => l.text)).toEqual(['A', 'B', 'C'])
  })

  it('씬 속성은 첫 행에서만', () => {
    const rows = [
      { scene: '1', prompt: 'FIRST', subtitle: 'a' },
      { scene: '1', prompt: 'IGNORED', subtitle: 'b' },
    ]
    const result = bundleSceneCSVRows(rows)
    expect(result.scenes[0].prompt).toBe('FIRST')
  })

  it('빈 subtitle 행은 srtTrack 에 push 안 됨 (renderer 와 동일)', () => {
    const rows = [
      { scene: '1', subtitle: 'A' },
      { scene: '1', subtitle: '' },
      { scene: '1', subtitle: 'C' },
    ]
    const result = bundleSceneCSVRows(rows)
    expect(result.srtTrack).toHaveLength(2)
    expect(result.srtTrack.map(l => l.text)).toEqual(['A', 'C'])
  })

  it('씬에 _sceneNum 보존 (id-based merge 용)', () => {
    const rows = [{ scene: '5', prompt: 'P' }]
    const result = bundleSceneCSVRows(rows)
    expect(result.scenes[0]._sceneNum).toBe(5)
  })

  it('start_time/end_time 절대값 보존', () => {
    const rows = [{ scene: '1', subtitle: 'A', start_time: '5', end_time: '10' }]
    const result = bundleSceneCSVRows(rows)
    expect(result.srtTrack[0].startTime).toBe(5)
    expect(result.srtTrack[0].endTime).toBe(10)
    expect(result.scenes[0].startTime).toBe(5)
    expect(result.scenes[0].endTime).toBe(10)
  })

  it('generation CSV columns를 nested scene override로 묶는다', () => {
    const rows = [{
      scene: '1', prompt: 'P',
      image_provider: 'openai', image_model: 'gpt-image-1',
      t2v_provider: 'grok', t2v_model: 'grok-imagine-video-1.5',
      i2v_provider: 'google', i2v_model: 'veo-3.1-fast-generate-preview',
    }]

    expect(bundleSceneCSVRows(rows).scenes[0].generation).toEqual({
      image: { provider: 'openai', model: 'gpt-image-1' },
      video: {
        t2v: { provider: 'grok', model: 'grok-imagine-video-1.5' },
        i2v: { provider: 'google', model: 'veo-3.1-fast-generate-preview' },
      },
    })
  })

  it('G4/H2: production saveCSV/loadCSV round-trips all six columns and an explicit null stage', () => {
    const dir = mkdtempSync(join(tmpdir(), 'autoflowcut-m3-csv-'))
    const path = join(dir, 'scenes.csv')
    const headers = [
      'scene', 'prompt',
      'image_provider', 'image_model', 't2v_provider', 't2v_model', 'i2v_provider', 'i2v_model',
    ]

    saveCSV(path, headers, [
      {
        scene: '1', prompt: 'P',
        generation: {
          image: { provider: 'openai', model: 'gpt-image-1' },
          video: {
            t2v: { provider: 'grok', model: 'grok-imagine-video-1.5' },
            i2v: { provider: 'google', model: 'veo-3.1-fast-generate-preview' },
          },
        },
      },
      {
        scene: '2', prompt: 'clear i2v',
        generation: { video: { i2v: null } },
      },
    ])

    const loaded = loadCSV(path)
    const roundTripped = loaded.scenes.map(nestSceneGenerationColumns)

    expect(roundTripped[0].generation).toEqual({
      image: { provider: 'openai', model: 'gpt-image-1' },
      video: {
        t2v: { provider: 'grok', model: 'grok-imagine-video-1.5' },
        i2v: { provider: 'google', model: 'veo-3.1-fast-generate-preview' },
      },
    })
    expect(roundTripped[1].generation).toEqual({
      video: { i2v: null },
    })
    const overrideCount = roundTripped.reduce((count, scene) => (
      count
        + (scene.generation?.image !== undefined ? 1 : 0)
        + (scene.generation?.video?.t2v !== undefined ? 1 : 0)
        + (scene.generation?.video?.i2v !== undefined ? 1 : 0)
    ), 0)
    expect(overrideCount).toBe(4)
  })

  it('saveCSV preserves flat generation columns for legacy row-per-scene CSV rows', () => {
    const dir = mkdtempSync(join(tmpdir(), 'autoflowcut-m3-flat-csv-'))
    const path = join(dir, 'scenes.csv')
    const headers = ['prompt', 'image_provider', 'image_model']

    saveCSV(path, headers, [{
      prompt: 'P', image_provider: 'openai', image_model: 'gpt-image-1',
    }])

    expect(readFileSync(path, 'utf8')).toContain('P,openai,gpt-image-1')
  })

  it('F3: update_field(flat) 후 nestSceneGenerationColumns 재적용하면 saveCSV 가 갱신값을 쓴다', () => {
    // load_csv 는 nested 로 만든 뒤 flat 컬럼도 유지한다. update_field 가 flat 만 바꾸면 옛 nested 가
    // valueForHeader 에서 이겨 무시된다 — 재-nest 로 nested 를 갱신해야 왕복이 일관.
    const loaded = nestSceneGenerationColumns({
      scene: '1', prompt: 'P', image_provider: 'openai', image_model: 'gpt-image-1',
    })
    expect(loaded.generation.image.provider).toBe('openai')
    // update_field 가 flat 을 바꾸고 재-nest
    loaded.image_provider = 'google'
    const updated = nestSceneGenerationColumns(loaded)
    expect(updated.generation.image.provider).toBe('google')

    const dir = mkdtempSync(join(tmpdir(), 'autoflowcut-m3-updatefield-'))
    const path = join(dir, 'scenes.csv')
    saveCSV(path, ['scene', 'prompt', 'image_provider', 'image_model'], [updated])
    // 재-nest 안 하면(옛 nested openai) save 가 openai 를 쓴다 — google 이어야 통과.
    expect(readFileSync(path, 'utf8')).toContain('1,P,google,gpt-image-1')
  })

  it('G5: MCP re-nesting drops stale model-only generation when the model is __inherit__', () => {
    const loaded = nestSceneGenerationColumns({
      scene: '1', prompt: 'P', t2v_provider: '', t2v_model: 'grok-imagine-video-1.5',
    })
    expect(loaded.generation).toEqual({
      video: { t2v: { model: 'grok-imagine-video-1.5' } },
    })

    loaded.t2v_model = '__inherit__'
    const warnings = []
    const updated = nestSceneGenerationColumns(loaded, { warnings })

    expect(updated).not.toHaveProperty('generation')
    expect(warnings).toEqual([
      "Rejected invalid model '__inherit__' at generation.video.t2v.",
    ])
  })

  it('H1: sparse new-format generation update preserves sibling fields and untouched stages', () => {
    const scene = bundleSceneCSVRows([{
      scene: '1', prompt: 'P',
      image_provider: 'fal', image_model: 'fal-ai/flux-pro/v1.1-ultra',
      t2v_provider: 'grok', t2v_model: 'grok-imagine-video-1.5',
      i2v_provider: 'google', i2v_model: 'veo-3.1-fast-generate-preview',
    }]).scenes[0]

    scene.image_model = 'fal-ai/flux-pro/kontext/max'
    const updated = nestSceneGenerationColumns(scene)

    expect(updated.generation).toEqual({
      image: { provider: 'fal', model: 'fal-ai/flux-pro/kontext/max' },
      video: {
        t2v: { provider: 'grok', model: 'grok-imagine-video-1.5' },
        i2v: { provider: 'google', model: 'veo-3.1-fast-generate-preview' },
      },
    })
    expect(countGenerationStages(updated.generation)).toBe(3)
  })

  it('H1: __inherit__ model update drops only that model and preserves the remaining generation', () => {
    const scene = bundleSceneCSVRows([{
      scene: '1', prompt: 'P',
      image_provider: 'fal', image_model: 'fal-ai/flux-pro/v1.1-ultra',
      t2v_provider: 'grok', t2v_model: 'grok-imagine-video-1.5',
    }]).scenes[0]

    scene.image_model = '__inherit__'
    const warnings = []
    const updated = nestSceneGenerationColumns(scene, { warnings })

    expect(updated.generation).toEqual({
      image: { provider: 'fal' },
      video: { t2v: { provider: 'grok', model: 'grok-imagine-video-1.5' } },
    })
    expect(countGenerationStages(updated.generation)).toBe(2)
    expect(warnings).toEqual([
      "Rejected invalid model '__inherit__' at generation.image.",
    ])
  })

  it.each([
    {
      label: 'explicit empty',
      provider: '',
      expectedImage: { model: 'fal-ai/flux-pro/v1.1-ultra' },
      expectedWarnings: [],
      expectedCount: 3,
    },
    {
      label: '__inherit__',
      provider: '__inherit__',
      expectedImage: null,
      expectedWarnings: [],
      expectedCount: 3,
    },
    {
      label: 'unknown provider',
      provider: 'unknown-image',
      expectedImage: undefined,
      expectedWarnings: ["Rejected unknown provider 'unknown-image' at generation.image."],
      expectedCount: 2,
    },
  ])('H1: sparse provider update handles $label without touching other stages', ({
    provider, expectedImage, expectedWarnings, expectedCount,
  }) => {
    const scene = bundleSceneCSVRows([{
      scene: '1', prompt: 'P',
      image_provider: 'fal', image_model: 'fal-ai/flux-pro/v1.1-ultra',
      t2v_provider: 'grok', t2v_model: 'grok-imagine-video-1.5',
      i2v_provider: 'google', i2v_model: 'veo-3.1-fast-generate-preview',
    }]).scenes[0]

    scene.image_provider = provider
    const warnings = []
    const updated = nestSceneGenerationColumns(scene, { warnings })

    expect(updated.generation).toEqual({
      ...(expectedImage !== undefined ? { image: expectedImage } : {}),
      video: {
        t2v: { provider: 'grok', model: 'grok-imagine-video-1.5' },
        i2v: { provider: 'google', model: 'veo-3.1-fast-generate-preview' },
      },
    })
    expect(countGenerationStages(updated.generation)).toBe(expectedCount)
    expect(warnings).toEqual(expectedWarnings)
  })
})
