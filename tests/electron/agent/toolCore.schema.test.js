// @vitest-environment node
//
// Tool Core의 inventory가 실제 adapter 변환을 통과한 뒤에도 인자를 받을 수 있어야 한다.
// 얇은 fixture를 env에 싣는 테스트만으로는 모든 MCP 툴이 `{}`가 되는 조립 버그를 못 잡는다.
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import * as adapterEntry from '../../../electron/agent/codexAdapterEntry.js'
import { createToolCore } from '../../../electron/agent/toolCore.js'

const asSchema = (converted) => (typeof converted?.safeParse === 'function' ? converted : z.object(converted))

describe('Tool Core MCP inventory 조립', () => {
  it('실제 list()의 모든 설명과 인자형 툴의 non-empty zod shape를 adapter까지 보존한다', () => {
    expect(typeof adapterEntry.zodFromJson).toBe('function')

    const expectedKeys = {
      story_get_state: [],
      list_scenes: [],
      wait_batch: ['type'],
      story_confirm_synopsis: [
        'characters',
        'fixedSceneRevision',
        'imageFirstVariant',
        'sceneMode',
        'synopsisMd',
      ],
      story_set_speakers: ['speakers'],
      story_start_step: ['params', 'step'],
    }
    const tools = createToolCore().list()

    for (const [name, keys] of Object.entries(expectedKeys)) {
      const tool = tools.find((candidate) => candidate.name === name)
      expect(tool, `${name}이 실제 Tool Core inventory에 없다`).toBeTruthy()
      // 🔴 `not.toBe(name)` 만으로는 **없는 설명을 못 잡는다** — `undefined !== name` 이라 초록이다.
      //    (실측: `list()` 에서 `description` 을 통째로 빼도 이 테스트가 통과했다.)
      //    설명이 없으면 adapter 가 이름으로 fallback 하고, 모델은 툴이 무엇을 하는지 모른 채 고른다.
      expect(typeof tool.description, `${name} 설명이 없다 — adapter 가 이름으로 fallback 한다`).toBe('string')
      expect(tool.description.length, `${name} 설명이 비어 있다`).toBeGreaterThan(0)
      expect(tool.description, `${name} 설명이 이름 fallback에 기대고 있다`).not.toBe(name)
      const converted = adapterEntry.zodFromJson(tool.inputSchema)
      expect(typeof converted?.safeParse, `${name} zod schema`).toBe('function')
      const variants = tool.inputSchema.oneOf ?? [tool.inputSchema]
      expect([...new Set(variants.flatMap((variant) => Object.keys(variant.properties ?? {})))].sort(), `${name} schema keys`)
        .toEqual(keys)
    }
  })

  it('adapter zod shape가 각 툴의 실제 대표 인자를 파싱하고 그대로 보존한다', () => {
    const tools = Object.fromEntries(createToolCore().list().map((tool) => [tool.name, tool]))
    const examples = {
      wait_batch: { type: 'scene' },
      story_confirm_synopsis: { synopsisMd: '# 확정', characters: [] },
      story_set_speakers: { speakers: [] },
      story_start_step: { step: 'script', params: { input: { type: 'title', title: 'T' } } },
    }

    for (const [name, args] of Object.entries(examples)) {
      const schema = asSchema(adapterEntry.zodFromJson(tools[name].inputSchema))
      expect(schema.parse(args), `${name} 인자가 adapter schema에서 유실됐다`).toEqual(args)
    }
  })

  it.each([
    ['wait_batch', 'type', ['scene', 'ref'], 'banana'],
    ['story_start_step', 'step', ['script', 'scenes', 'audio', 'prompts'], 'images'],
  ])('%s enum은 adapter 뒤에도 허용값만 파싱한다', (name, key, allowed, invalid) => {
    const tool = createToolCore().list().find((candidate) => candidate.name === name)
    const schema = asSchema(adapterEntry.zodFromJson(tool.inputSchema))

    for (const value of allowed) {
      expect(schema.parse({ [key]: value }), `${name}.${key}의 허용값 ${value}가 유실됐다`)
        .toEqual({ [key]: value })
    }
    expect(() => schema.parse({ [key]: invalid }), `${name}.${key}가 금지값 ${invalid}를 허용했다`)
      .toThrow()
  })

  it('story_start_step params는 step별 whitelist만 adapter 뒤까지 허용한다', () => {
    const tool = createToolCore().list().find((candidate) => candidate.name === 'story_start_step')
    const schema = asSchema(adapterEntry.zodFromJson(tool.inputSchema))

    expect(schema.parse({ step: 'script', params: { input: { type: 'title', title: 'T' }, synopsis: '줄거리' } }))
      .toMatchObject({ step: 'script' })
    expect(schema.parse({ step: 'audio', params: { regenerate: ['seg-1'], sfxSources: { 'seg-2': 'elevenlabs' } } }))
      .toMatchObject({ step: 'audio' })
    expect(schema.parse({ step: 'prompts', params: { style: 'cinematic', reviewOnly: true } }))
      .toMatchObject({ step: 'prompts' })

    expect(() => schema.parse({ step: 'audio', params: { speakers: [] } }), 'D16 화자 설정 우회가 schema에서 열렸다')
      .toThrow()
    expect(() => schema.parse({ step: 'audio', params: { style: 'wrong-step' } }), '다른 step의 키가 섞였다')
      .toThrow()
    expect(() => schema.parse({ step: 'scenes', params: { arbitraryCommand: true } }), '미지 params가 열렸다')
      .toThrow()
  })

  it('실제 MCP tools/list가 story_start_step의 non-empty 입력 schema를 광고한다', async () => {
    const tool = createToolCore().list().find((candidate) => candidate.name === 'story_start_step')
    const server = new McpServer({ name: 'schema-test', version: '1.0.0' })
    server.registerTool(tool.name, {
      description: tool.description,
      inputSchema: adapterEntry.zodFromJson(tool.inputSchema),
    }, async () => ({ content: [{ type: 'text', text: '{}' }] }))
    const client = new Client({ name: 'schema-client', version: '1.0.0' })
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()

    try {
      await server.connect(serverTransport)
      await client.connect(clientTransport)
      const listed = (await client.listTools()).tools.find((candidate) => candidate.name === tool.name)

      expect(listed.inputSchema.properties, 'MCP SDK가 union을 빈 object schema로 접었다')
        .toHaveProperty('step')
      expect(listed.inputSchema.properties).toHaveProperty('params')
      expect(listed.inputSchema.properties.params.properties).toHaveProperty('regenerate')
    } finally {
      await client.close()
      await server.close()
    }
  })
})
