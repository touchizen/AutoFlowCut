// @vitest-environment node
//
// Tool Core의 inventory가 실제 adapter 변환을 통과한 뒤에도 인자를 받을 수 있어야 한다.
// 얇은 fixture를 env에 싣는 테스트만으로는 모든 MCP 툴이 `{}`가 되는 조립 버그를 못 잡는다.
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { build } from 'esbuild'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { ElicitRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import * as adapterEntry from '../../../electron/agent/codexAdapterEntry.js'
import { createToolCore } from '../../../electron/agent/toolCore.js'
import { zodFromJson as sharedZodFromJson } from '../../../electron/agent/jsonSchemaToZod.js'

const asSchema = (converted) => (typeof converted?.safeParse === 'function' ? converted : z.object(converted))

const START_STEP_PARAM_KEYS = {
  script: ['continue', 'options', 'pastedScript', 'review', 'reviewOnly', 'scriptOverride', 'synopsis', 'title'],
  scenes: ['options', 'review', 'reviewOnly', 'scriptOverride', 'title'],
  audio: ['regenerate', 'sfxSources'],
  prompts: ['options', 'review', 'reviewOnly', 'style'],
}

function arraysWithoutItems(node, schemaPath = '$') {
  if (!node || typeof node !== 'object') return []
  const missing = node.type === 'array' && !node.items ? [schemaPath] : []
  for (const [key, value] of Object.entries(node)) {
    if (!value || typeof value !== 'object') continue
    if (Array.isArray(value)) {
      value.forEach((item, index) => missing.push(...arraysWithoutItems(item, `${schemaPath}.${key}[${index}]`)))
    } else {
      missing.push(...arraysWithoutItems(value, `${schemaPath}.${key}`))
    }
  }
  return missing
}

describe('Tool Core MCP inventory 조립', () => {
  it('adapter와 main이 같은 JSON-Schema 변환기 함수를 공유한다', () => {
    expect(adapterEntry.zodFromJson).toBe(sharedZodFromJson)
  })

  it.each([
    ['지원하지 않는 integer', { type: 'integer' }],
    ['오타 type', { type: 'strnig' }],
    ['type 누락', {}],
    ['빈 oneOf', { oneOf: [] }],
  ])('JSON-Schema 변환은 %s 구성을 string으로 강등하지 않고 즉시 거부한다', (_label, schema) => {
    expect(() => sharedZodFromJson(schema)).toThrow(/지원하지 않는 JSON Schema|unsupported JSON Schema/i)
  })

  it('실제 Tool Core inventory의 모든 schema는 fail-closed 변환기를 통과한다', () => {
    for (const tool of createToolCore().list()) {
      expect(() => sharedZodFromJson(tool.inputSchema), tool.name).not.toThrow()
      expect(typeof sharedZodFromJson(tool.inputSchema)?.safeParse, tool.name).toBe('function')
    }
  })

  it('story_start_step 설명은 input identity의 UI 소유권과 synopsis 주제 전달 경로를 명시한다', () => {
    const tool = createToolCore().list().find((candidate) => candidate.name === 'story_start_step')

    expect(tool.description).toMatch(/프로젝트 입력 유형\/제목 identity.*앱 UI.*소유/)
    expect(tool.description).toMatch(/주제.*synopsis.*전달/)
  })

  it('실제 list()의 모든 설명과 인자형 툴의 non-empty zod shape를 adapter까지 보존한다', () => {
    expect(typeof adapterEntry.zodFromJson).toBe('function')

    const expectedKeys = {
      story_get_state: [],
      list_scenes: [],
      wait_batch: ['type'],
      wait_videos: ['operationId'],
      generate_videos: ['sceneNumbers'],
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
      wait_videos: { operationId: 'video-op-1' },
      generate_videos: { sceneNumbers: [1, 3] },
      story_confirm_synopsis: { synopsisMd: '# 확정', characters: [] },
      story_set_speakers: { speakers: [] },
      story_start_step: { step: 'script', params: { pastedScript: '붙여넣기', title: 'T' } },
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

    expect(schema.parse({ step: 'script', params: { pastedScript: '붙여넣기', title: 'T', synopsis: '줄거리' } }))
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
    expect(() => schema.parse({ step: 'script', params: { input: { type: 'manual' } } }), 'input identity 교체가 열렸다')
      .toThrow()
  })

  it('실제 MCP tools/list가 story_start_step의 step별 params schema를 광고한다', async () => {
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
      const variants = listed.inputSchema.properties.params.anyOf
      expect(variants, 'params가 모든 step의 합집합이라 모델이 step별 허용 키를 모른다').toHaveLength(4)
      for (const [step, keys] of Object.entries(START_STEP_PARAM_KEYS)) {
        const variant = variants.find((candidate) => candidate.description?.includes(`step="${step}"`))
        expect(variant, `${step} params 설명이 실제 tools/list에서 유실됐다`).toBeTruthy()
        expect(Object.keys(variant.properties ?? {}).sort(), `${step} params 허용 키`).toEqual(keys)
      }
    } finally {
      await client.close()
      await server.close()
    }
  })
})

// 🔴 **모델은 스키마가 말해주지 않은 것을 추측한다. 그리고 그 추측은 사람의 승인을 태운다.**
//
//    실앱 실측 (패키징): `speakers: { type:'array' }` — 배열 **안에** 뭐가 들어가야 하는지 한 마디도
//    안 했다. 모델이 `id` 를 빼먹고 호출 → 사람이 **승인** → S1 의 shape 검증이 거부 → 모델이 스스로
//    고쳐서 재호출 → 사람이 **또 승인**. 승인 창이 두 번 떴고, 첫 승인은 그냥 타버렸다.
//
//    S2(enum 이 Codex 에 도달 안 함 → 모델이 step 을 추측 → 승인 태움)와 **정확히 같은 부류**다.
//    스키마가 검증보다 약하면, 그 차이만큼 사람의 승인이 낭비된다.
describe('스키마는 검증만큼 말해야 한다 — 안 그러면 모델이 추측하고 승인이 탄다', () => {
  it('research 8개 schema가 converter 지원 문법과 확정된 fail-closed 계약만 사용한다', () => {
    const research = Object.fromEntries(createToolCore().list()
      .filter((tool) => tool.name.startsWith('story_research_'))
      .map((tool) => [tool.name, tool.inputSchema]))
    const forbidden = []
    const walk = (node, path = '$') => {
      if (!node || typeof node !== 'object') return
      for (const key of ['minimum', 'maximum', 'maxItems', 'minProperties']) {
        if (Object.hasOwn(node, key)) forbidden.push(`${path}.${key}`)
      }
      if (node.type === 'integer') forbidden.push(`${path}.type=integer`)
      for (const [key, value] of Object.entries(node)) {
        if (Array.isArray(value)) value.forEach((child, index) => walk(child, `${path}.${key}[${index}]`))
        else walk(value, `${path}.${key}`)
      }
    }

    expect(Object.keys(research).sort()).toEqual([
      'story_research_analyze',
      'story_research_commit',
      'story_research_factcheck',
      'story_research_fetch_transcripts',
      'story_research_search',
      'story_research_select',
      'story_research_skip',
      'story_research_video_details',
    ])
    for (const [name, schema] of Object.entries(research)) {
      expect(schema.additionalProperties, name).toBe(false)
      expect(() => sharedZodFromJson(schema), name).not.toThrow()
      walk(schema, name)
    }
    expect(forbidden).toEqual([])

    expect(research.story_research_search.properties.keyword).toMatchObject({ minLength: 1, pattern: '\\S' })
    expect(research.story_research_search.properties.maxResults.type).toBe('number')
    expect(research.story_research_search.properties.dateFilter.enum).toEqual(['none', 'week', 'month'])
    expect(research.story_research_fetch_transcripts.properties.videoIds.minItems).toBe(1)
    expect(Object.keys(research.story_research_commit.properties)).toEqual(['adoptedIndices'])
    expect(research.story_research_skip.properties).toEqual({})
  })

  it('research video id와 manual card shape가 adapter 뒤에도 그대로 검증된다', () => {
    const tools = Object.fromEntries(createToolCore().list().map((tool) => [tool.name, tool]))
    const selectSchema = tools.story_research_select.inputSchema
    const manual = selectSchema.properties.manualVideos.items
    const select = asSchema(adapterEntry.zodFromJson(selectSchema))
    const fetch = asSchema(adapterEntry.zodFromJson(tools.story_research_fetch_transcripts.inputSchema))

    expect(manual.required).toEqual(['videoId'])
    expect(manual.additionalProperties).toBe(false)
    expect(Object.keys(manual.properties).sort()).toEqual([
      'channelTitle', 'durationSec', 'thumbnailUrl', 'title', 'uploadDate', 'videoId', 'viewCount',
    ])
    expect(manual.properties.videoId.pattern).toBe('^[A-Za-z0-9_-]+$')
    expect(select.parse({
      selectedVideoIds: ['vid_A-1'],
      manualVideos: [{
        videoId: 'manual_1', title: '수동', channelTitle: '', viewCount: null,
        thumbnailUrl: 'https://example.test/t.jpg', durationSec: 0, uploadDate: '',
      }],
    })).toMatchObject({ selectedVideoIds: ['vid_A-1'] })
    expect(fetch.parse({ videoIds: ['vid_A-1'], options: { language: 'ko' } }))
      .toEqual({ videoIds: ['vid_A-1'], options: { language: 'ko' } })
    expect(() => select.parse({ selectedVideoIds: ['a;rm -rf'] })).toThrow()
    expect(() => fetch.parse({ videoIds: [] })).toThrow()
    expect(() => select.parse({ manualVideos: [{ videoId: 'vidA', invented: true }] })).toThrow()
  })

  it('speakers 배열의 item 이 무엇인지 말한다 — id/name 이 필수임을 모델이 알 수 있어야 한다', () => {
    const tool = createToolCore().list().find((t) => t.name === 'story_set_speakers')
    const speakers = tool.inputSchema.properties.speakers

    expect(speakers.items, 'speakers 배열의 item 스키마가 없다 — 모델이 무엇을 넣을지 추측한다').toBeTruthy()
    expect(speakers.items.required, 'item 의 필수 필드를 안 알려준다').toEqual(expect.arrayContaining(['id', 'name']))
  })

  it('adapter 를 통과한 뒤에도 id 없는 speaker 를 거부한다 — 검증과 스키마가 어긋나면 안 된다', () => {
    const tool = createToolCore().list().find((t) => t.name === 'story_set_speakers')
    const schema = asSchema(adapterEntry.zodFromJson(tool.inputSchema))

    // 실앱에서 모델이 실제로 보낸 것 — id 가 없다.
    expect(() => schema.parse({ speakers: [{ name: '나레이션', role: 'narrator' }] }),
      'id 없는 speaker 가 adapter 를 통과했다 — 사람의 승인을 태우고 나서야 거부된다').toThrow()

    // 제대로 된 것은 통과해야 한다.
    expect(schema.parse({ speakers: [{ id: 'narration', name: '나레이션' }] }))
      .toEqual({ speakers: [{ id: 'narration', name: '나레이션' }] })
  })

  it('모든 array 선언은 items를 가진다 — 새 툴도 배열 내부 계약을 생략할 수 없다', () => {
    const missing = createToolCore().list().flatMap((tool) =>
      arraysWithoutItems(tool.inputSchema, tool.name))

    expect(missing, `items 없는 array schema: ${missing.join(', ')}`).toEqual([])
  })

  it('speaker item은 setSpeakers의 정적 계약과 같은 필드·non-empty 문자열·voice 구조를 말한다', () => {
    const tool = createToolCore().list().find((t) => t.name === 'story_set_speakers')
    const item = tool.inputSchema.properties.speakers.items
    const schema = asSchema(adapterEntry.zodFromJson(tool.inputSchema))

    expect(Object.keys(item.properties ?? {}).sort()).toEqual([
      'age', 'appearance', 'gender', 'id', 'name', 'role', 'voice',
    ])
    expect(item.additionalProperties).toBe(false)
    expect(item.properties.gender.enum).toEqual(['male', 'female', 'unknown'])
    expect(item.properties.voice.oneOf).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'object' }),
      expect.objectContaining({ type: 'null' }),
    ]))
    const voiceObject = item.properties.voice.oneOf.find((candidate) => candidate.type === 'object')
    expect(voiceObject.properties.provider.enum).toEqual(['typecast', 'gemini', 'elevenlabs'])

    expect(schema.parse({ speakers: [{
      id: 'narrator',
      name: '나레이션',
      gender: 'unknown',
      voice: { provider: 'gemini', voiceId: 'Kore' },
    }] })).toMatchObject({ speakers: [{ id: 'narrator', name: '나레이션' }] })
    expect(schema.parse({ speakers: [{ id: 'narrator', name: '나레이션', voice: null }] }))
      .toMatchObject({ speakers: [{ voice: null }] })
    expect(() => schema.parse({ speakers: [{ id: ' ', name: '나레이션' }] }), '공백 id가 승인을 열 수 있다')
      .toThrow()
    expect(() => schema.parse({ speakers: [{ id: 'narrator', name: '', invented: true }] }), '빈 name/미지 필드가 열렸다')
      .toThrow()
    expect(() => schema.parse({
      speakers: [{ id: 'narrator', name: '나레이션', voice: { provider: 'guessed', voiceId: 'x' } }],
    }), '지원하지 않는 voice provider가 열렸다').toThrow()
  })

  it('confirmSynopsis schema는 character shape와 image-first enum을 모델에게 그대로 말한다', () => {
    const tool = createToolCore().list().find((t) => t.name === 'story_confirm_synopsis')
    const props = tool.inputSchema.properties
    const item = props.characters.items
    const schema = asSchema(adapterEntry.zodFromJson(tool.inputSchema))

    expect(Object.keys(item.properties ?? {}).sort()).toEqual([
      'age', 'appearance', 'ethnicity', 'gender', 'id', 'name', 'role',
    ])
    expect(item.required).toContain('name')
    expect(item.additionalProperties).toBe(false)
    expect(item.properties.gender.enum).toEqual(['male', 'female', 'unknown'])
    expect(props.sceneMode.enum).toEqual(['image-first'])
    expect(props.imageFirstVariant.enum).toEqual(['storyboard', 'image-only'])

    expect(schema.parse({
      synopsisMd: '확정',
      characters: [{ name: '강리안', gender: 'female', ethnicity: '한국인' }],
      sceneMode: 'image-first',
      imageFirstVariant: 'storyboard',
      fixedSceneRevision: 'fixed-r1',
    })).toMatchObject({ characters: [{ name: '강리안' }] })
    expect(() => schema.parse({ characters: [{ name: '강리안', gender: 'robot' }] })).toThrow()
    expect(() => schema.parse({ sceneMode: 'audio-first' })).toThrow()
    expect(() => schema.parse({ imageFirstVariant: 'video-first' })).toThrow()
    expect(() => schema.parse({ fixedSceneRevision: ' ' })).toThrow()
  })

  it('story_start_step 선언 자체가 step별 params variant와 대응 관계를 가진다', () => {
    const tool = createToolCore().list().find((t) => t.name === 'story_start_step')
    const variants = tool.inputSchema.properties.params.anyOf

    expect(variants).toHaveLength(4)
    for (const [step, keys] of Object.entries(START_STEP_PARAM_KEYS)) {
      const variant = variants.find((candidate) => candidate.description?.includes(`step="${step}"`))
      expect(variant, `${step} params variant가 없다`).toBeTruthy()
      expect(variant.additionalProperties).toBe(false)
      expect(Object.keys(variant.properties ?? {}).sort()).toEqual(keys)
    }

    const schema = asSchema(adapterEntry.zodFromJson(tool.inputSchema))
    expect(schema.parse({ step: 'audio', params: { sfxSources: { 's1-1': 'library' } } }))
      .toMatchObject({ step: 'audio' })
    expect(() => schema.parse({ step: 'audio', params: { sfxSources: { 's1-1': 'guessed' } } }),
      '지원하지 않는 SFX provider가 adapter를 통과했다').toThrow()
  })

  it('🔴 실제 출하 entry를 번들링한 stdio adapter tools/list에 전체 계약이 도달한다', async () => {
    const tempDir = await mkdtemp(path.join(tmpdir(), 'autoflowcut-adapter-schema-'))
    const bundlePath = path.join(tempDir, 'codex-adapter.mjs')
    let client

    try {
      // package.json의 build:agent-adapter와 같은 entry/options를 쓰되 산출물은 /tmp에 둔다.
      // 소스 zod만 검사하면 번들러·SDK tools/list 경계에서 schema가 소실되는 회귀를 못 잡는다.
      await build({
        entryPoints: ['electron/agent/codexAdapterMain.js'],
        bundle: true,
        format: 'esm',
        platform: 'node',
        outfile: bundlePath,
      })

      const transport = new StdioClientTransport({
        command: process.execPath,
        args: [bundlePath],
        env: {
          AUTOFLOWCUT_RPC_URL: 'http://127.0.0.1:1',
          AUTOFLOWCUT_RPC_TOKEN: 'schema-test-token',
          AUTOFLOWCUT_TOOLS: JSON.stringify(createToolCore().list()),
          AUTOFLOWCUT_APPROVAL_TIMEOUT_MS: '60000',
        },
        stderr: 'pipe',
      })
      let elicitationCount = 0
      client = new Client(
        { name: 'bundled-schema-client', version: '1.0.0' },
        { capabilities: { elicitation: {} } },
      )
      client.setRequestHandler(ElicitRequestSchema, async () => {
        elicitationCount += 1
        return { action: 'decline' }
      })
      await client.connect(transport)
      const listed = Object.fromEntries((await client.listTools()).tools.map((tool) => [tool.name, tool]))

      // 이 호출이 handler까지 가면 바로 elicitationCount가 오른다. 실제 번들 MCP validation이
      // 먼저 막는 순서를 schema 내용 assertion보다 앞에서 직접 측정한다.
      const malformed = await client.callTool({
        name: 'story_set_speakers',
        arguments: { speakers: [{ name: '나레이션', role: 'narrator' }] },
      })
      expect(elicitationCount, 'schema validation이 handler보다 늦어 사람에게 승인부터 물었다').toBe(0)
      expect(malformed.isError, 'malformed speaker가 실제 bundled adapter validation을 통과했다').toBe(true)

      const speakerItems = listed.story_set_speakers.inputSchema.properties.speakers.items
      expect(speakerItems.required).toEqual(expect.arrayContaining(['id', 'name']))
      expect(speakerItems.properties.id).toMatchObject({ type: 'string', minLength: 1 })
      expect(speakerItems.properties.name).toMatchObject({ type: 'string', minLength: 1 })
      expect(speakerItems.properties.voice.anyOf.map((node) => node.type).sort()).toEqual(['null', 'object'])
      const bundledVoice = speakerItems.properties.voice.anyOf.find((node) => node.type === 'object')
      expect(bundledVoice.properties.provider.enum).toEqual(['typecast', 'gemini', 'elevenlabs'])

      const confirm = listed.story_confirm_synopsis.inputSchema.properties
      expect(confirm.characters.items.required).toContain('name')
      expect(confirm.characters.items.properties.gender.enum).toEqual(['male', 'female', 'unknown'])
      expect(confirm.sceneMode.enum).toEqual(['image-first'])
      expect(confirm.imageFirstVariant.enum).toEqual(['storyboard', 'image-only'])
      expect(confirm.fixedSceneRevision).toMatchObject({ type: 'string', minLength: 1 })

      expect(listed.wait_batch.inputSchema.properties.type.enum).toEqual(['scene', 'ref'])
      expect(listed.story_start_step.inputSchema.properties.step.enum)
        .toEqual(['script', 'scenes', 'audio', 'prompts'])

      const paramsVariants = listed.story_start_step.inputSchema.properties.params.anyOf
      expect(paramsVariants).toHaveLength(4)
      for (const [step, keys] of Object.entries(START_STEP_PARAM_KEYS)) {
        const variant = paramsVariants.find((candidate) => candidate.description?.includes(`step="${step}"`))
        expect(variant, `${step} params가 bundled tools/list에서 유실됐다`).toBeTruthy()
        expect(Object.keys(variant.properties ?? {}).sort()).toEqual(keys)
      }
      const bundledAudio = paramsVariants.find((candidate) => candidate.description?.includes('step="audio"'))
      expect(bundledAudio.properties.sfxSources.additionalProperties.enum).toEqual(['elevenlabs', 'library'])

      const missing = Object.values(listed).flatMap((tool) =>
        arraysWithoutItems(tool.inputSchema, tool.name))
      expect(missing, `bundled tools/list의 items 없는 array: ${missing.join(', ')}`).toEqual([])
    } finally {
      await client?.close?.()
      await rm(tempDir, { recursive: true, force: true })
    }
  }, 30_000)
})
