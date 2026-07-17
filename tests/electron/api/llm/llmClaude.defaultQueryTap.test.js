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
// query 본문이 돌 때 실행할 훅 — 레이스 회귀 테스트가 여기서 sink 를 B 로 바꾼다.
let onQueryBody = null

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: () => (async function* () {
    onQueryBody?.() // 소비가 시작된 뒤 = defaultQuery 가 이미 sink 를 캡처했어야 하는 시점
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
  beforeEach(() => { setClaudeUsageSink(null); onQueryBody = null })

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

  // 소비가 시작된 뒤(query 본문 실행 중) 전역 sink 가 B 로 바뀌어도 usage 는 A 로 간다.
  // tapQuery 가 sink 를 파라미터로 받아 고정하기 때문 — 메시지마다 전역을 다시 읽지 않는다.
  //
  // 주의: 이건 "소비 중" 교체만 재현한다. Codex 2R-MEDIUM 이 지적한 진짜 창은 `await import`
  // 가 suspend 된 동안의 교체인데, mock 에선 import 가 즉시 resolve 되고 dynamic-import 타이밍은
  // 단위로 제어할 수 없어 재현 불가다. 코드는 import **전** 동기 지점에서 캡처해 그 창까지 닫았고
  // (llmClaude.js defaultQuery), 이 테스트는 그중 재현 가능한 절반만 고정한다.
  it('소비 중 전역 sink 가 바뀌어도 캡처된 sink 로 간다', async () => {
    const a = []
    const b = []
    setClaudeUsageSink((u) => a.push(u))
    onQueryBody = () => setClaudeUsageSink((u) => b.push(u))

    await generateTitle('# 대본', {})

    expect(a).toEqual([{ input: 100, output: 9 }])
    expect(b).toEqual([])
  })
})
