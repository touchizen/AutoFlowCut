import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { SCENE_GENERATION_PATCH_SCHEMA } from '../../mcp-server/lib/sceneGenerationSchema.js'
import { openApiSpec } from '../../electron/api-docs.js'

const readRepoFile = (path) => readFileSync(resolve(process.cwd(), path), 'utf8')

describe('MCP scene generation schema synchronization', () => {
  it('exposes stage provider enums and model fields in the MCP patch schema', () => {
    const image = SCENE_GENERATION_PATCH_SCHEMA.properties.image
    const t2v = SCENE_GENERATION_PATCH_SCHEMA.properties.video.properties.t2v
    const i2v = SCENE_GENERATION_PATCH_SCHEMA.properties.video.properties.i2v

    expect(image.properties.provider.enum).toEqual(expect.arrayContaining(['google', 'openai', 'fal']))
    expect(t2v.properties.provider.enum).toEqual(expect.arrayContaining([
      'google', 'grok', 'fal', 'wavespeed', 'higgsfield',
    ]))
    expect(i2v.properties.provider.enum).toEqual(t2v.properties.provider.enum)
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

  it('the HTTP OpenAPI Scene and UpdateRequest schemas expose generation', () => {
    const schemas = openApiSpec.components.schemas
    expect(schemas.Scene.properties.generation).toEqual({ $ref: '#/components/schemas/SceneGeneration' })
    expect(schemas.UpdateRequest.properties.fields.properties.generation).toEqual({
      $ref: '#/components/schemas/SceneGeneration',
    })
    expect(schemas.SceneGeneration.properties.video.properties.t2v.properties.provider.enum)
      .toContain('grok')
    expect(schemas.SceneGeneration.properties.image.properties.model.nullable).toBe(true)
    expect(schemas.SceneGeneration.properties.video.properties.t2v.properties.model.nullable).toBe(true)
    expect(schemas.SceneGeneration.properties.video.properties.i2v.properties.model.nullable).toBe(true)
  })
})
