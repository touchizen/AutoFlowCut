import { describe, expect, test } from 'vitest'

import { resolveSpecs } from '../../scripts/install-platform-binaries.cjs'

// @openai/codex 의 arch 패키지는 독립 패키지가 아니라 codex 자신의 버전 태그 별칭이다
//   "@openai/codex-darwin-x64": "npm:@openai/codex@0.142.5-darwin-x64"
// (npm 레지스트리에 @openai/codex-darwin-x64 라는 이름은 404 다 — 실측 확인)
// 반면 claude-agent-sdk 는 진짜 독립 패키지다.
// 두 형태를 섞어 쓰므로 spec 생성이 틀리면 조용히 엉뚱한 버전이 깔린다.

describe('resolveSpecs', () => {
  const versions = { codex: '0.142.5', agentSdk: '0.3.199' }

  test('codex 는 별칭(npm:) spec 으로, agent-sdk 는 일반 spec 으로 만든다', () => {
    expect(resolveSpecs({ platform: 'darwin', arch: 'x64', versions })).toEqual([
      {
        name: '@openai/codex-darwin-x64',
        spec: '@openai/codex-darwin-x64@npm:@openai/codex@0.142.5-darwin-x64',
      },
      {
        name: '@anthropic-ai/claude-agent-sdk-darwin-x64',
        spec: '@anthropic-ai/claude-agent-sdk-darwin-x64@0.3.199',
      },
    ])
  })

  test('arch 가 spec 전체에 반영된다', () => {
    const [codex, sdk] = resolveSpecs({ platform: 'darwin', arch: 'arm64', versions })
    expect(codex.spec).toBe('@openai/codex-darwin-arm64@npm:@openai/codex@0.142.5-darwin-arm64')
    expect(sdk.spec).toBe('@anthropic-ai/claude-agent-sdk-darwin-arm64@0.3.199')
  })

  test('버전이 비면 던진다 — 잘못된 버전이 조용히 깔리는 것보다 낫다', () => {
    expect(() => resolveSpecs({ platform: 'darwin', arch: 'x64', versions: { codex: '', agentSdk: '0.3.199' } }))
      .toThrow(/codex/i)
  })
})
