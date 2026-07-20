import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { SCENE_GENERATION_PATCH_SCHEMA } from '../../mcp-server/lib/sceneGenerationSchema.js'
import { bundleSceneCSVRows, nestSceneGenerationColumns } from '../../mcp-server/lib/csv.js'
import { openApiSpec } from '../../electron/api-docs.js'
import { IMAGE_MODELS, VIDEO_MODELS } from '../../src/config/genModels.js'
import { parseCSVToScenes, parseSceneCSVToTracks } from '../../src/utils/parsers.js'

const readRepoFile = (path) => readFileSync(resolve(process.cwd(), path), 'utf8')
const sorted = (values) => [...values].sort()
const imageProviderIds = [...new Set(IMAGE_MODELS.map(model => model.provider))]
const videoProviderIds = [...new Set(VIDEO_MODELS.map(model => model.provider))]
const countGenerationStages = (scenes) => scenes.reduce((count, scene) => {
  const generation = scene.generation
  if (!generation) return count
  if (Object.prototype.hasOwnProperty.call(generation, 'image')) count++
  if (Object.prototype.hasOwnProperty.call(generation.video || {}, 't2v')) count++
  if (Object.prototype.hasOwnProperty.call(generation.video || {}, 'i2v')) count++
  return count
}, 0)

describe('MCP scene generation schema synchronization', () => {
  it('F4: MCP provider enums exactly match catalog-derived provider ids', () => {
    const image = SCENE_GENERATION_PATCH_SCHEMA.properties.image
    const t2v = SCENE_GENERATION_PATCH_SCHEMA.properties.video.properties.t2v
    const i2v = SCENE_GENERATION_PATCH_SCHEMA.properties.video.properties.i2v

    expect(sorted(image.properties.provider.enum)).toEqual(sorted(imageProviderIds))
    expect(sorted(t2v.properties.provider.enum)).toEqual(sorted(videoProviderIds))
    expect(sorted(i2v.properties.provider.enum)).toEqual(sorted(videoProviderIds))
    expect(image.properties.model.type).toBe('string')
  })

  it.each([
    'docs/csv-scenes-schema.md',
    'docs/csv-scenes-schema_en.md',
    'mcp-server/README.md',
  ])('%s documents all six generation CSV columns', (path) => {
    const content = readRepoFile(path)
    for (const column of [
      'image_provider', 'image_model', 't2v_provider', 't2v_model', 'i2v_provider', 'i2v_model',
    ]) {
      expect(content).toContain(column)
    }
  })

  it('the app_update_scene MCP tool references the generation patch schema', () => {
    const source = readRepoFile('mcp-server/index.js')
    expect(source).toContain('generation: SCENE_GENERATION_PATCH_SCHEMA')
  })

  it('F4: api-docs SceneGeneration provider enums exactly match catalog-derived provider ids', () => {
    const schemas = openApiSpec.components.schemas
    expect(schemas.Scene.properties.generation).toEqual({ $ref: '#/components/schemas/SceneGeneration' })
    expect(schemas.UpdateRequest.properties.fields.properties.generation).toEqual({
      $ref: '#/components/schemas/SceneGeneration',
    })
    const image = schemas.SceneGeneration.properties.image
    const t2v = schemas.SceneGeneration.properties.video.properties.t2v
    const i2v = schemas.SceneGeneration.properties.video.properties.i2v
    expect(sorted(image.properties.provider.enum)).toEqual(sorted(imageProviderIds))
    expect(sorted(t2v.properties.provider.enum)).toEqual(sorted(videoProviderIds))
    expect(sorted(i2v.properties.provider.enum)).toEqual(sorted(videoProviderIds))
    expect(schemas.SceneGeneration.properties.image.properties.model.nullable).toBe(true)
    expect(schemas.SceneGeneration.properties.video.properties.t2v.properties.model.nullable).toBe(true)
    expect(schemas.SceneGeneration.properties.video.properties.i2v.properties.model.nullable).toBe(true)
  })

  it('F5: renderer and MCP CSV parsers identically drop unknown-provider stages and preserve exactly N valid overrides', () => {
    const csv = [
      'scene,prompt,image_provider,image_model,t2v_provider,t2v_model,i2v_provider,i2v_model',
      '1,one,openai,gpt-image-1,unknown-video,ignored,,model-only-i2v',
      '2,two,google,,grok,,__inherit__,',
      '3,three,unknown-image,ignored,unknown-video,ignored,unknown-video,ignored',
    ].join('\n')
    const mcpRows = [
      {
        scene: '1', prompt: 'one', image_provider: 'openai', image_model: 'gpt-image-1',
        t2v_provider: 'unknown-video', t2v_model: 'ignored', i2v_provider: '', i2v_model: 'model-only-i2v',
      },
      {
        scene: '2', prompt: 'two', image_provider: 'google', image_model: '',
        t2v_provider: 'grok', t2v_model: '', i2v_provider: '__inherit__', i2v_model: '',
      },
      {
        scene: '3', prompt: 'three', image_provider: 'unknown-image', image_model: 'ignored',
        t2v_provider: 'unknown-video', t2v_model: 'ignored', i2v_provider: 'unknown-video', i2v_model: 'ignored',
      },
    ]
    const expectedGeneration = [
      {
        image: { provider: 'openai', model: 'gpt-image-1' },
        video: { i2v: { model: 'model-only-i2v' } },
      },
      {
        image: { provider: 'google' },
        video: { t2v: { provider: 'grok' }, i2v: null },
      },
      undefined,
    ]
    const warningCollections = [[], [], [], []]
    const outputs = [
      parseCSVToScenes(csv, undefined, { warnings: warningCollections[0] }),
      parseSceneCSVToTracks(csv, { warnings: warningCollections[1] }).scenes,
      mcpRows.map(row => nestSceneGenerationColumns(row, { warnings: warningCollections[2] })),
      bundleSceneCSVRows(mcpRows, { warnings: warningCollections[3] }).scenes,
    ]
    const N = 5
    const expectedWarnings = [
      "Rejected unknown provider 'unknown-video' at generation.video.t2v.",
      "Rejected unknown provider 'unknown-image' at generation.image.",
      "Rejected unknown provider 'unknown-video' at generation.video.t2v.",
      "Rejected unknown provider 'unknown-video' at generation.video.i2v.",
    ]

    outputs.forEach((scenes, index) => {
      expect(countGenerationStages(scenes)).toBe(N)
      expect(scenes.map(scene => scene.generation)).toEqual(expectedGeneration)
      expect(warningCollections[index]).toEqual(expectedWarnings)
    })
  })
})
