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

  // 실시간 진행 표시: message_delta 는 끝에 한 번뿐이라(실측) 스트리밍 텍스트/thinking 델타
  // 길이로 output 을 추정해 pending 채널로 올리고, result 에서 pending 제거 + 확정치 커밋.
  const se = (event) => ({ type: 'stream_event', event })
  it('message_start 입력 + 텍스트 델타로 pending output 상승, result 에서 clear+commit', async () => {
    const seen = []
    setClaudeUsageSink((u) => seen.push(u))
    const tapped = __tapQueryForTest(() => results(
      se({ type: 'message_start', message: { usage: { input_tokens: 2, cache_creation_input_tokens: 2253, cache_read_input_tokens: 0 } } }),
      se({ type: 'content_block_delta', delta: { type: 'thinking_delta', thinking: 'x'.repeat(30) } }), // 30자 → ~10토큰
      se({ type: 'content_block_delta', delta: { type: 'text_delta', text: 'y'.repeat(60) } }),          // 누적 90자 → ~30토큰
      { type: 'result', subtype: 'success', result: 'ok', usage: { input_tokens: 2, cache_creation_input_tokens: 2253, output_tokens: 359 } },
    ))
    for await (const _m of tapped({})) { /* drain */ }

    // 첫 3개는 같은 pendingKey 로 pending 상승, 마지막은 pending 제거+확정 가산을 겸한 commit(원샷).
    const key = seen[0].pendingKey
    expect(key).toBeTruthy()
    expect(seen[0]).toEqual({ pendingKey: key, input: 2255, output: 0 })   // message_start: 입력 즉시, 출력 0
    expect(seen[1]).toEqual({ pendingKey: key, input: 2255, output: 10 })  // thinking 30자 → 10
    expect(seen[2]).toEqual({ pendingKey: key, input: 2255, output: 30 })  // +text 60자 → 90자 → 30
    expect(seen[3]).toEqual({ pendingKey: key, commit: true, input: 2255, output: 359 }) // clear+addDelta 원샷
    expect(seen).toHaveLength(4)
  })

  it('result 없이 스트림 종료(abort/EOF) 시 pending 을 clear 로 정리 — 추정치가 합계에 안 남는다', async () => {
    const seen = []
    setClaudeUsageSink((u) => seen.push(u))
    const tapped = __tapQueryForTest(() => results(
      se({ type: 'message_start', message: { usage: { input_tokens: 2, cache_creation_input_tokens: 100, cache_read_input_tokens: 0 } } }),
      se({ type: 'content_block_delta', delta: { type: 'text_delta', text: 'z'.repeat(30) } }),
      // result 없음 — 스트림이 그냥 끝난다(중단/EOF 재현)
    ))
    for await (const _m of tapped({})) { /* drain */ }
    const key = seen[0].pendingKey
    expect(seen[0]).toEqual({ pendingKey: key, input: 102, output: 0 })
    expect(seen[1]).toEqual({ pendingKey: key, input: 102, output: 10 })
    expect(seen[2]).toEqual({ pendingKey: key, clear: true }) // finally 가 pending 정리
    expect(seen).toHaveLength(3)
  })

  it('소비자가 중간에 break 해도(early return) finally 가 pending 을 정리한다', async () => {
    const seen = []
    setClaudeUsageSink((u) => seen.push(u))
    const tapped = __tapQueryForTest(() => results(
      se({ type: 'message_start', message: { usage: { input_tokens: 5, cache_read_input_tokens: 0 } } }),
      se({ type: 'content_block_delta', delta: { type: 'text_delta', text: 'yy' } }),
      se({ type: 'content_block_delta', delta: { type: 'text_delta', text: 'more text here' } }),
    ))
    for await (const _m of tapped({})) { break } // 첫 메시지 뒤 중단 → generator.return() → finally
    const key = seen[0].pendingKey
    expect(seen.some((s) => s.pendingKey === key && s.clear)).toBe(true) // pending 이 정리됨
  })

  it('스트림 usage 가 전혀 없으면 pending 을 안 만들고 result 만 커밋 — 기존 경로 불변', async () => {
    const seen = []
    setClaudeUsageSink((u) => seen.push(u))
    const tapped = __tapQueryForTest(() => results(
      { type: 'stream_event' }, // event 없음
      { type: 'result', subtype: 'success', result: 'ok', usage: { input_tokens: 10, cache_read_input_tokens: 90, output_tokens: 4 } },
    ))
    for await (const _m of tapped({})) { /* drain */ }
    expect(seen).toEqual([{ input: 100, output: 4 }]) // clear 없음, commit 하나
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
