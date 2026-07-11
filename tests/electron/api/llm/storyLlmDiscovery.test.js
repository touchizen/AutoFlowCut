// @vitest-environment node
//
// story > 설정 > "생성 AI" 목록을 하드코딩 대신 엔진에서 받아 만든다.
//  - Claude: Agent SDK `query().supportedModels()` → ModelInfo[]
//  - Codex : app-server `model/list` → { id, supportedReasoningEfforts }[]
// 여기 있는 건 전부 순수 함수 — 프로세스를 안 띄운다.
import { describe, it, expect } from 'vitest'
import {
  buildClaudeStoryLlmOptions,
  buildCodexStoryLlmOptions,
  resolveStoryLlmCatalog,
} from '../../../../electron/api/llm/storyLlmDiscovery'

// 2026-07-10 실제 supportedModels() 응답에서 발췌.
const CLAUDE_MODELS = [
  {
    value: 'default',
    resolvedModel: 'claude-opus-4-8[1m]',
    displayName: 'Default (recommended)',
    description: 'Opus 4.8 with 1M context',
    supportsEffort: true,
    supportedEffortLevels: ['low', 'medium', 'high', 'xhigh', 'max'],
    supportsAdaptiveThinking: true,
  },
  {
    value: 'opus[1m]',
    resolvedModel: 'claude-opus-4-8[1m]',
    displayName: 'Opus',
    description: 'Opus 4.8 with 1M context',
    supportsEffort: true,
    supportedEffortLevels: ['low', 'medium', 'high', 'xhigh', 'max'],
    supportsAdaptiveThinking: true,
  },
  {
    value: 'claude-fable-5[1m]',
    resolvedModel: 'claude-fable-5',
    displayName: 'Fable',
    description: 'Most capable',
    supportsEffort: true,
    supportedEffortLevels: ['low', 'medium', 'high', 'xhigh', 'max'],
    supportsAdaptiveThinking: true,
  },
  {
    value: 'sonnet',
    resolvedModel: 'claude-sonnet-5',
    displayName: 'Sonnet',
    description: 'Efficient',
    supportsEffort: true,
    supportedEffortLevels: ['low', 'medium', 'high', 'xhigh', 'max'],
    supportsAdaptiveThinking: true,
  },
  // haiku 는 effort/adaptive 필드가 아예 없다 — 4.6 이전 세대.
  {
    value: 'haiku',
    resolvedModel: 'claude-haiku-4-5-20251001',
    displayName: 'Haiku',
    description: 'Fastest',
  },
]

describe('buildClaudeStoryLlmOptions', () => {
  it('alias 행 "default"는 버린다 (opus[1m]과 같은 모델을 두 번 보여주면 안 된다)', () => {
    const opts = buildClaudeStoryLlmOptions(CLAUDE_MODELS)
    expect(opts.map((o) => o.model)).not.toContain('default')
  })

  it('같은 resolvedModel 을 가진 행은 하나만 남긴다', () => {
    const resolved = buildClaudeStoryLlmOptions(CLAUDE_MODELS).map((o) => o.resolvedModel)
    expect(new Set(resolved).size).toBe(resolved.length)
  })

  it('model 은 SDK 호출용 value 를, resolvedModel 은 정규 id 를 담는다', () => {
    const opus = buildClaudeStoryLlmOptions(CLAUDE_MODELS).find((o) => o.model === 'opus[1m]')
    expect(opus).toBeTruthy()
    expect(opus.resolvedModel).toBe('claude-opus-4-8[1m]')
    expect(opus.id).toBe('claude:opus[1m]')
    expect(opus.engine).toBe('claude')
  })

  it('xhigh 를 버리지 않는다 (기존 하드코딩 CLAUDE_SDK_EFFORTS 의 버그)', () => {
    const opus = buildClaudeStoryLlmOptions(CLAUDE_MODELS).find((o) => o.model === 'opus[1m]')
    expect(opus.reasoningEfforts).toContain('xhigh')
  })

  it('thinking 을 끌 수 있는 모델엔 off 를 맨 앞에 붙이고 기본값으로 쓴다', () => {
    const opus = buildClaudeStoryLlmOptions(CLAUDE_MODELS).find((o) => o.model === 'opus[1m]')
    expect(opus.reasoningEfforts[0]).toBe('off')
    expect(opus.defaultReasoningEffort).toBe('off')
  })

  // Fable 5 는 thinking: disabled 를 400 으로 거부한다. ModelInfo 로는 구분이 안 되므로
  // resolvedModel 로 판별해야 한다 — off 를 노출하면 사용자가 고를 수 없는 값을 고르게 된다.
  it('Fable 은 thinking 을 못 끄므로 off 가 없고 기본값이 high 다', () => {
    const fable = buildClaudeStoryLlmOptions(CLAUDE_MODELS).find((o) => o.model === 'claude-fable-5[1m]')
    expect(fable.reasoningEfforts).not.toContain('off')
    expect(fable.defaultReasoningEffort).toBe('high')
  })

  it('effort 를 안 받는 모델(haiku)은 목록이 비고 기본값이 빈 문자열이다', () => {
    const haiku = buildClaudeStoryLlmOptions(CLAUDE_MODELS).find((o) => o.model === 'haiku')
    expect(haiku.reasoningEfforts).toEqual([])
    expect(haiku.defaultReasoningEffort).toBe('')
  })

  it('라벨에 엔진을 붙인다 (codex 옵션과 같은 select 에 섞인다)', () => {
    const sonnet = buildClaudeStoryLlmOptions(CLAUDE_MODELS).find((o) => o.model === 'sonnet')
    expect(sonnet.label).toBe('Claude Sonnet')
  })

  it('비었거나 이상한 입력이면 빈 배열 — 폴백은 호출측이 정한다', () => {
    expect(buildClaudeStoryLlmOptions([])).toEqual([])
    expect(buildClaudeStoryLlmOptions(null)).toEqual([])
    expect(buildClaudeStoryLlmOptions([{ displayName: 'no value' }])).toEqual([])
  })
})

describe('buildCodexStoryLlmOptions', () => {
  // 2026-07-10 실제 model/list 응답. gpt-5.6 sol/terra/luna 는 존재하지 않는다.
  const CODEX_MODELS = [
    { id: 'gpt-5.5', supportedReasoningEfforts: ['low', 'medium', 'high', 'xhigh'] },
    { id: 'gpt-5.4', supportedReasoningEfforts: ['low', 'medium', 'high', 'xhigh'] },
    { id: 'gpt-5.4-mini', supportedReasoningEfforts: ['low', 'medium', 'high'] },
  ]

  it('id/label/engine 을 채운다', () => {
    const [first] = buildCodexStoryLlmOptions(CODEX_MODELS)
    expect(first).toMatchObject({ id: 'codex:gpt-5.5', engine: 'codex', model: 'gpt-5.5', label: 'Codex gpt-5.5' })
  })

  it('effort 는 모델이 보고한 것만 쓴다 — minimal 은 어떤 모델도 지원하지 않는다', () => {
    for (const o of buildCodexStoryLlmOptions(CODEX_MODELS)) {
      expect(o.reasoningEfforts).not.toContain('minimal')
    }
  })

  // 서버 기본값(medium)을 존중한다 — 속도용 mini/짧은 숏폼에 xhigh 강제는 첫 토큰만 느리게 한다.
  // 단 이 픽스처엔 defaultReasoningEffort 가 없어 폴백(중간 단계)로 떨어진다.
  it('서버 기본값이 없으면 중간 단계를 기본값으로 (양극단 회피)', () => {
    const o = buildCodexStoryLlmOptions(CODEX_MODELS).find((x) => x.model === 'gpt-5.5')
    expect(o.defaultReasoningEffort).toBe('medium')
  })

  it('effort 를 안 주면 빈 목록', () => {
    const [o] = buildCodexStoryLlmOptions([{ id: 'x' }])
    expect(o.reasoningEfforts).toEqual([])
    expect(o.defaultReasoningEffort).toBe('')
  })

  it('비었거나 이상한 입력이면 빈 배열', () => {
    expect(buildCodexStoryLlmOptions([])).toEqual([])
    expect(buildCodexStoryLlmOptions(undefined)).toEqual([])
    expect(buildCodexStoryLlmOptions([{ supportedReasoningEfforts: [] }])).toEqual([])
  })
})

describe('resolveStoryLlmCatalog', () => {
  const CLAUDE = [{ id: 'claude:sonnet', engine: 'claude', model: 'sonnet' }]
  const CODEX = [{ id: 'codex:gpt-5.5', engine: 'codex', model: 'gpt-5.5' }]
  const FALLBACK = [
    { id: 'claude:claude-opus-4-8', engine: 'claude', model: 'claude-opus-4-8' },
    { id: 'codex:gpt-5.4', engine: 'codex', model: 'gpt-5.4' },
  ]

  it('두 엔진 다 조회되면 claude 먼저, codex 나중', () => {
    expect(resolveStoryLlmCatalog({ claude: CLAUDE, codex: CODEX, fallback: FALLBACK }).map((o) => o.id))
      .toEqual(['claude:sonnet', 'codex:gpt-5.5'])
  })

  // 엔진 하나가 죽었다고 다른 엔진까지 정적으로 되돌리면 안 된다 — 죽은 쪽만 정적으로 메운다.
  it('claude 조회 실패 시 claude 만 정적 폴백, codex 는 동적 유지', () => {
    expect(resolveStoryLlmCatalog({ claude: [], codex: CODEX, fallback: FALLBACK }).map((o) => o.id))
      .toEqual(['claude:claude-opus-4-8', 'codex:gpt-5.5'])
  })

  it('codex 조회 실패 시 codex 만 정적 폴백', () => {
    expect(resolveStoryLlmCatalog({ claude: CLAUDE, codex: [], fallback: FALLBACK }).map((o) => o.id))
      .toEqual(['claude:sonnet', 'codex:gpt-5.4'])
  })

  it('둘 다 실패하면 정적 카탈로그 그대로', () => {
    expect(resolveStoryLlmCatalog({ claude: [], codex: [], fallback: FALLBACK })).toEqual(FALLBACK)
  })

  it('결과가 완전히 비면 정적 카탈로그로 — 빈 select 를 보여주지 않는다', () => {
    expect(resolveStoryLlmCatalog({ claude: [], codex: [], fallback: [] })).toEqual([])
    expect(resolveStoryLlmCatalog({ fallback: FALLBACK })).toEqual(FALLBACK)
  })
})

// app-server `model/list` 의 실제 응답 모양(2026-07-10, codex-cli 0.142.5).
// supportedReasoningEfforts 는 문자열이 아니라 { reasoningEffort, description } 객체 배열이다.
describe('buildCodexStoryLlmOptions — app-server 실제 응답 모양', () => {
  const REAL = [
    {
      id: 'gpt-5.5', model: 'gpt-5.5', displayName: 'GPT-5.5', hidden: false, isDefault: true,
      defaultReasoningEffort: 'medium',
      supportedReasoningEfforts: [
        { reasoningEffort: 'low', description: 'Fast' },
        { reasoningEffort: 'medium', description: 'Balanced' },
        { reasoningEffort: 'high', description: 'Deep' },
        { reasoningEffort: 'xhigh', description: 'Deepest' },
      ],
    },
    {
      id: 'gpt-5.4-mini', model: 'gpt-5.4-mini', displayName: 'GPT-5.4 mini', hidden: false,
      defaultReasoningEffort: 'medium',
      supportedReasoningEfforts: [{ reasoningEffort: 'low' }, { reasoningEffort: 'high' }],
    },
    { id: 'gpt-internal', displayName: 'Internal', hidden: true, supportedReasoningEfforts: [] },
  ]

  it('객체 배열 effort 를 문자열로 편다', () => {
    const o = buildCodexStoryLlmOptions(REAL).find((x) => x.model === 'gpt-5.5')
    expect(o.reasoningEfforts).toEqual(['low', 'medium', 'high', 'xhigh'])
  })

  it('hidden 모델은 목록에서 뺀다', () => {
    expect(buildCodexStoryLlmOptions(REAL).map((o) => o.model)).not.toContain('gpt-internal')
  })

  it('displayName 이 있으면 라벨에 쓴다', () => {
    expect(buildCodexStoryLlmOptions(REAL)[0].label).toBe('Codex GPT-5.5')
  })

  // 서버가 준 defaultReasoningEffort(medium)를 존중한다 — xhigh 강제는 속도용 모델·짧은 숏폼에서
  // 첫 토큰만 느리게 만든다(mini + 1분 숏폼 실사용에서 드러남). 더 깊은 추론은 설정에서 올린다.
  it('서버 기본값(medium)을 그대로 쓴다', () => {
    const o = buildCodexStoryLlmOptions(REAL).find((x) => x.model === 'gpt-5.5')
    expect(o.defaultReasoningEffort).toBe('medium')
  })

  it('서버 기본값이 high 면 high 를 쓴다', () => {
    const o = buildCodexStoryLlmOptions([
      { id: 'a', supportedReasoningEfforts: [{ reasoningEffort: 'low' }, { reasoningEffort: 'high' }], defaultReasoningEffort: 'high' },
    ])[0]
    expect(o.defaultReasoningEffort).toBe('high')
  })

  it('서버 기본값이 지원 목록에 없으면 중간 단계로 떨어진다', () => {
    const o = buildCodexStoryLlmOptions([
      { id: 'a', supportedReasoningEfforts: [{ reasoningEffort: 'low' }, { reasoningEffort: 'medium' }, { reasoningEffort: 'high' }], defaultReasoningEffort: 'turbo' },
    ])[0]
    expect(o.defaultReasoningEffort).toBe('medium')
  })

  it('서버 기본값이 없으면 medium (양극단 회피)', () => {
    const o = buildCodexStoryLlmOptions([{ id: 'a', supportedReasoningEfforts: [{ reasoningEffort: 'low' }, { reasoningEffort: 'medium' }, { reasoningEffort: 'high' }, { reasoningEffort: 'xhigh' }] }])[0]
    expect(o.defaultReasoningEffort).toBe('medium')
  })

  it('medium 이 없으면 중간 단계로 (양극단 회피)', () => {
    const o = buildCodexStoryLlmOptions([{ id: 'a', supportedReasoningEfforts: [{ reasoningEffort: 'low' }, { reasoningEffort: 'high' }, { reasoningEffort: 'xhigh' }] }])[0]
    expect(o.defaultReasoningEffort).toBe('high')
  })
})

// 정적 폴백(app-server 조회 실패 시)도 실제로 지원되는 effort 만 노출해야 한다.
// 'minimal'은 gpt-5.5/5.4/5.4-mini 어느 것도 지원하지 않는다(model/list 로 확인).
describe('정적 폴백 카탈로그의 codex effort', () => {
  it('minimal 을 노출하지 않는다', async () => {
    const { STORY_LLM_OPTIONS } = await import('../../../../src/utils/storyLlmCatalog')
    for (const o of STORY_LLM_OPTIONS.filter((x) => x.engine === 'codex')) {
      expect(o.reasoningEfforts).not.toContain('minimal')
    }
  })
})
