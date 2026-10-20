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
  preserveSceneRuntimeFields,
  nestSceneGenerationColumns,
  layoutSceneRowTimes,
  stripCSVTimeColumns,
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

  it('H1: sparse provider update handles __inherit__ without touching other stages', () => {
    const scene = bundleSceneCSVRows([{
      scene: '1', prompt: 'P',
      image_provider: 'fal', image_model: 'fal-ai/flux-pro/v1.1-ultra',
      t2v_provider: 'grok', t2v_model: 'grok-imagine-video-1.5',
      i2v_provider: 'google', i2v_model: 'veo-3.1-fast-generate-preview',
    }]).scenes[0]

    scene.image_provider = '__inherit__'
    const warnings = []
    const updated = nestSceneGenerationColumns(scene, { warnings })

    expect(updated.generation).toEqual({
      image: null,
      video: {
        t2v: { provider: 'grok', model: 'grok-imagine-video-1.5' },
        i2v: { provider: 'google', model: 'veo-3.1-fast-generate-preview' },
      },
    })
    expect(countGenerationStages(updated.generation)).toBe(3)
    expect(warnings).toEqual([])
  })

  it('J1: sparse empty provider clears a provider-bound model and preserves sibling stages', () => {
    const scene = bundleSceneCSVRows([{
      scene: '1', prompt: 'P',
      image_provider: 'fal', image_model: 'm0',
      t2v_provider: 'grok', t2v_model: 'grok-imagine-video-1.5',
    }]).scenes[0]

    scene.image_provider = ''
    const updated = nestSceneGenerationColumns(scene)

    expect(updated.generation).toEqual({
      video: { t2v: { provider: 'grok', model: 'grok-imagine-video-1.5' } },
    })
  })

  it('J1: sparse empty provider keeps a model-only existing override', () => {
    const scene = bundleSceneCSVRows([{
      scene: '1', prompt: 'P',
      image_provider: '', image_model: 'm0',
      t2v_provider: 'grok', t2v_model: 'grok-imagine-video-1.5',
    }]).scenes[0]

    scene.image_provider = ''
    const updated = nestSceneGenerationColumns(scene)

    expect(updated.generation).toEqual({
      image: { model: 'm0' },
      video: { t2v: { provider: 'grok', model: 'grok-imagine-video-1.5' } },
    })
  })

  it('I1: sparse provider-only change resets the previous provider model and preserves sibling stages', () => {
    const scene = bundleSceneCSVRows([{
      scene: '1', prompt: 'P',
      image_provider: 'fal', image_model: 'fal-ai/flux-pro/v1.1-ultra',
      t2v_provider: 'grok', t2v_model: 'grok-imagine-video-1.5',
    }]).scenes[0]

    scene.image_provider = 'google'
    const updated = nestSceneGenerationColumns(scene)

    expect(updated.generation).toEqual({
      image: { provider: 'google' },
      video: { t2v: { provider: 'grok', model: 'grok-imagine-video-1.5' } },
    })
  })

  it('I1: sparse provider-only restatement keeps the existing model', () => {
    const scene = bundleSceneCSVRows([{
      scene: '1', prompt: 'P',
      image_provider: 'fal', image_model: 'fal-ai/flux-pro/v1.1-ultra',
      t2v_provider: 'grok', t2v_model: 'grok-imagine-video-1.5',
    }]).scenes[0]

    scene.image_provider = 'fal'
    const updated = nestSceneGenerationColumns(scene)

    expect(updated.generation).toEqual({
      image: { provider: 'fal', model: 'fal-ai/flux-pro/v1.1-ultra' },
      video: { t2v: { provider: 'grok', model: 'grok-imagine-video-1.5' } },
    })
  })

  it('I2: sparse unknown-provider update warns and preserves existing and sibling stages', () => {
    const scene = bundleSceneCSVRows([{
      scene: '1', prompt: 'P',
      image_provider: 'fal', image_model: 'fal-ai/flux-pro/v1.1-ultra',
      t2v_provider: 'grok', t2v_model: 'grok-imagine-video-1.5',
    }]).scenes[0]

    scene.image_provider = 'unknown-image'
    const warnings = []
    const updated = nestSceneGenerationColumns(scene, { warnings })

    expect(updated.generation).toEqual({
      image: { provider: 'fal', model: 'fal-ai/flux-pro/v1.1-ultra' },
      video: { t2v: { provider: 'grok', model: 'grok-imagine-video-1.5' } },
    })
    expect(warnings).toEqual([
      "Rejected unknown provider 'unknown-image' at generation.image.",
    ])
  })

  it('I2: full-rebuild unknown provider still drops that stage', () => {
    const warnings = []
    const updated = nestSceneGenerationColumns({
      scene: '1', prompt: 'P',
      image_provider: 'unknown-image', image_model: 'ignored-image-model',
      t2v_provider: 'grok', t2v_model: 'grok-imagine-video-1.5',
      i2v_provider: '', i2v_model: '',
    }, { warnings })

    expect(updated.generation).toEqual({
      video: { t2v: { provider: 'grok', model: 'grok-imagine-video-1.5' } },
    })
    expect(warnings).toEqual([
      "Rejected unknown provider 'unknown-image' at generation.image.",
    ])
  })

  it('I2: unknown provider preserves the stage while explicit model __inherit__ still drops the model', () => {
    const scene = bundleSceneCSVRows([{
      scene: '1', prompt: 'P',
      image_provider: 'fal', image_model: 'fal-ai/flux-pro/v1.1-ultra',
      t2v_provider: 'grok', t2v_model: 'grok-imagine-video-1.5',
    }]).scenes[0]

    scene.image_provider = 'unknown-image'
    const firstWarnings = []
    const afterUnknownProvider = nestSceneGenerationColumns(scene, { warnings: firstWarnings })
    expect(afterUnknownProvider.generation.image).toEqual({
      provider: 'fal', model: 'fal-ai/flux-pro/v1.1-ultra',
    })
    expect(firstWarnings).toEqual([
      "Rejected unknown provider 'unknown-image' at generation.image.",
    ])

    afterUnknownProvider.image_model = '__inherit__'
    const secondWarnings = []
    const updated = nestSceneGenerationColumns(afterUnknownProvider, { warnings: secondWarnings })

    expect(updated.generation).toEqual({
      image: { provider: 'fal' },
      video: { t2v: { provider: 'grok', model: 'grok-imagine-video-1.5' } },
    })
    expect(secondWarnings).toEqual([
      "Rejected invalid model '__inherit__' at generation.image.",
      "Rejected unknown provider 'unknown-image' at generation.image.",
    ])
  })
})

describe('layoutSceneRowTimes (옛 형식 CSV — load_csv 가 씬 시각을 채운다)', () => {
  // 시각 열 없이 duration 만 있는 CSV(툰 배치 CSV)를 load_csv 로 넣으면 시각 없는 행이 앱으로 가고, 렌더러
  //   normalizeScene 이 씬마다 startTime 0 을 넣어 전부 0~duration 에 겹쳤다(2026-10-20, 96씬이 0~4초).
  it('시각 열이 없으면 duration 으로 앞 씬 끝에 이어 붙인다', () => {
    const rows = [1, 2, 3].map((n) => ({ prompt: `p${n}`, scene_tag: `frame_v${n}`, duration: '4.000' }))
    const out = layoutSceneRowTimes(rows)
    expect(out.map((r) => [r.startTime, r.endTime, Number(r.duration)])).toEqual([[0, 4, 4], [4, 8, 4], [8, 12, 4]])
    expect(out[0]).toMatchObject({ prompt: 'p1', scene_tag: 'frame_v1' })
  })

  it('start_time/end_time 이 있으면 그 값(초·타임코드)을 쓰고, 없는 다음 행은 그 끝에서 이어진다', () => {
    const rows = [
      { prompt: 'a', start_time: '00:00:01,500', end_time: '3.5' },
      { prompt: 'b', duration: '2' },
    ]
    const out = layoutSceneRowTimes(rows)
    expect(out.map((r) => [r.startTime, r.endTime])).toEqual([[1.5, 3.5], [3.5, 5.5]])
  })

  it('duration 도 없으면 기본 길이(3초)', () => {
    const out = layoutSceneRowTimes([{ prompt: 'a' }, { prompt: 'b' }])
    expect(out.map((r) => [r.startTime, r.endTime])).toEqual([[0, 3], [3, 6]])
  })

  it('빈 start_time/end_time 칸이어도 camelCase 시각은 이어 붙이고, CSV 칸 자체는 건드리지 않는다(save_csv 왕복)', () => {
    const out = layoutSceneRowTimes([{ prompt: 'a', start_time: '', end_time: '', duration: '4' }, { prompt: 'b', start_time: '', end_time: '', duration: '4' }])
    expect(out.map((r) => [r.startTime, r.endTime])).toEqual([[0, 4], [4, 8]])
    expect(out.map((r) => [r.start_time, r.end_time, r.duration])).toEqual([['', '', '4'], ['', '', '4']])
  })

  it('stripCSVTimeColumns: 앱으로 보낼 씬에서 start_time/end_time 칸(대소문자 무관)만 뺀다 — 렌더러 normalizeScene 이 snake 키를 먼저 읽는다', () => {
    const out = stripCSVTimeColumns([{ prompt: 'a', start_time: '', End_Time: '4', startTime: 0, endTime: 4, duration: '4' }])
    expect(out).toEqual([{ prompt: 'a', startTime: 0, endTime: 4, duration: '4' }])
  })

  it('헤더 대소문자와 무관(가져오기 창 parseCSVToScenes 처럼) — Start_Time/End_Time/Duration', () => {
    const out = layoutSceneRowTimes([{ Prompt: 'a', Start_Time: '10', End_Time: '14' }, { Prompt: 'b', Duration: '4' }])
    expect(out.map((r) => [r.startTime, r.endTime])).toEqual([[10, 14], [14, 18]])
  })

  it('시각 열이 있는 옛 형식 CSV 는 load → layout → save 왕복에서 start_time/end_time/duration 칸이 그대로다', () => {
    const src = join(process.cwd(), 'docs/examples/scenes_example_legacy.csv')
    const before = loadCSV(src)
    const scenes = layoutSceneRowTimes(before.scenes.map((row) => nestSceneGenerationColumns(row, { warnings: [] })))
    const out = join(mkdtempSync(join(tmpdir(), 'afc-legacy-')), 'out.csv')
    saveCSV(out, before.headers, scenes)
    const after = loadCSV(out)
    const cols = (rows) => rows.map((r) => [r.start_time, r.end_time, r.duration])
    expect(cols(after.scenes)).toEqual(cols(before.scenes))
    expect(after.scenes.every((r) => r.start_time !== '' && r.end_time !== '')).toBe(true)
  })
})

describe('preserveSceneRuntimeFields', () => {
  const runtime = {
    mediaId: 'media-1',
    imagePath: '/project/scenes/scene_1.png',
    image_size: { width: 2048, height: 1152 },
    generatedAt: 1700000000000,
    upscaledAt: 1700000001000,
    status: 'done',
  }

  it('_sceneNum 매칭으로 이미지 런타임 필드를 보존한다', () => {
    const scenes = [{ id: 'fresh', _sceneNum: 7, prompt: 'new' }]
    const existing = [{ id: 'old', _sceneNum: 7, prompt: 'old', ...runtime }]

    expect(preserveSceneRuntimeFields(scenes, existing)[0]).toMatchObject(runtime)
  })

  it('_sceneNum이 없고 길이가 같으면 index fallback으로 보존한다', () => {
    const scenes = [{ id: 'fresh', prompt: 'new' }]
    const existing = [{ id: 'old', prompt: 'old', ...runtime }]

    expect(preserveSceneRuntimeFields(scenes, existing)[0]).toMatchObject(runtime)
  })
})
