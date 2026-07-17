import { describe, it, expect, beforeEach } from 'vitest'
import { setClaudeUsageSink, __tapQueryForTest } from '../../../../electron/api/llm/llmClaude.js'

/**
 * tap 은 defaultQuery(= SDK query 를 감싸는 얇은 제너레이터) 한 곳에 있다.
 * llmClaude 에는 `for await (const m of queryImpl(...))` 루프가 11개고, 파서를 찌르면
 * 11곳을 봐야 하며 새 루프가 생기면 조용히 샌다 — 이 기능의 유일한 실패 모드.
 * 그 11개가 전부 이 제너레이터를 지난다.
 */
describe('claude usage tap', () => {
  beforeEach(() => setClaudeUsageSink(null))

  const results = (...ms) => (async function* () { for (const m of ms) yield m })()

  it('result 메시지의 usage 를 sink 에 흘린다', async () => {
    const seen = []
    setClaudeUsageSink((u) => seen.push(u))
    const out = []
    const tapped = __tapQueryForTest(() => results(
      { type: 'stream_event' },
      {
        type: 'result',
        subtype: 'success',
        result: 'ok',
        usage: { input_tokens: 10, cache_read_input_tokens: 90, output_tokens: 4 },
      },
    ))
    for await (const m of tapped({})) out.push(m)

    expect(seen).toEqual([{ input: 100, output: 4 }])
    expect(out).toHaveLength(2) // tap 은 스트림을 소비하지 않고 통과시킨다
  })

  it('실패 result 의 usage 도 흘린다 — 파서가 throw 하기 전에 지나간다', async () => {
    const seen = []
    setClaudeUsageSink((u) => seen.push(u))
    const tapped = __tapQueryForTest(() => results(
      { type: 'result', subtype: 'error_during_execution', is_error: true, usage: { input_tokens: 7, output_tokens: 2 } },
    ))
    for await (const _m of tapped({})) { /* drain */ }
    expect(seen).toEqual([{ input: 7, output: 2 }])
  })

  it('구조화 재시도 — 두 query 모두 과금되므로 둘 다 흘린다', async () => {
    const seen = []
    setClaudeUsageSink((u) => seen.push(u))
    const tapped = __tapQueryForTest(() => results(
      { type: 'result', subtype: 'error_max_structured_output_retries', usage: { input_tokens: 50, output_tokens: 10 } },
    ))
    for await (const _m of tapped({})) { /* 1차 */ }
    const tapped2 = __tapQueryForTest(() => results(
      { type: 'result', subtype: 'success', result: '{}', usage: { input_tokens: 60, output_tokens: 20 } },
    ))
    for await (const _m of tapped2({})) { /* 폴백 */ }
    expect(seen).toEqual([{ input: 50, output: 10 }, { input: 60, output: 20 }])
  })

  it('sink 가 없으면 조용히 통과한다', async () => {
    const out = []
    const tapped = __tapQueryForTest(() => results({ type: 'result', usage: { input_tokens: 1, output_tokens: 1 } }))
    for await (const m of tapped({})) out.push(m)
    expect(out).toHaveLength(1)
  })

  it('sink 가 던져도 스트림을 깨지 않는다 — 계측이 제품을 죽이면 안 된다', async () => {
    setClaudeUsageSink(() => { throw new Error('boom') })
    const out = []
    const tapped = __tapQueryForTest(() => results({ type: 'result', usage: { input_tokens: 1, output_tokens: 1 } }))
    for await (const m of tapped({})) out.push(m)
    expect(out).toHaveLength(1)
  })
})
