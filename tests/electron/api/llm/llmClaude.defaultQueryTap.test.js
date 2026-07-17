import { describe, it, expect, beforeEach, vi } from 'vitest'

/**
 * **defaultQuery 가 tap 을 실제로 쓰는지** 고정한다.
 *
 * llmClaude.usageTap.test.js 는 `__tapQueryForTest`(추출된 헬퍼)를 시험할 뿐이라,
 * defaultQuery 를 `yield* query(...)` 로 되돌리는 뮤테이션이 **살아남는다**(실측 확인).
 * 그러면 프로덕션에서 claude 토큰이 통째로 0 이 되는데 테스트는 전부 초록이다.
 *
 * 그래서 여기서는 SDK 를 목으로 잡고, queryImpl 을 주입하지 않은 채(= defaultQuery 경로)
 * 실제 export 함수를 부른다.
 */
vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: () => (async function* () {
    yield { type: 'stream_event' }
    yield {
      type: 'result',
      subtype: 'success',
      result: '제목',
      usage: { input_tokens: 30, cache_read_input_tokens: 70, output_tokens: 9 },
    }
  })(),
}))

const { generateTitle, setClaudeUsageSink } = await import('../../../../electron/api/llm/llmClaude.js')

describe('defaultQuery 가 usage tap 을 통과한다', () => {
  beforeEach(() => setClaudeUsageSink(null))

  it('queryImpl 을 주입하지 않은 실제 호출이 sink 에 usage 를 흘린다', async () => {
    const seen = []
    setClaudeUsageSink((u) => seen.push(u))

    // queryImpl 없음 → defaultQuery 사용 → tap 을 지나야 한다.
    await generateTitle('# 대본', {})

    expect(seen).toEqual([{ input: 100, output: 9 }])
  })

  it('sink 가 없으면 호출은 그대로 성공한다', async () => {
    await expect(generateTitle('# 대본', {})).resolves.toBeDefined()
  })
})
