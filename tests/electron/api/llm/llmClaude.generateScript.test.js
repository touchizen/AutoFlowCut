import { describe, it, expect, vi } from 'vitest'
import { generateScript } from '../../../../electron/api/llm/llmClaude.js'

// stream_event 델타 2개 + 최종 result를 흘리는 가짜 query
function fakeQuery(deltas, resultText) {
  return async function* () {
    for (const t of deltas) yield { type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: t } } }
    yield { type: 'result', subtype: 'success', is_error: false, result: resultText }
  }
}

describe('llmClaude.generateScript', () => {
  it('델타를 onDelta로 흘리고 최종 result를 반환', async () => {
    const onDelta = vi.fn()
    const queryImpl = fakeQuery(['A', 'B'], 'ABC')
    const { scriptMd } = await generateScript({ title: 'T' }, { language: 'ko' }, { onDelta, signal: undefined, queryImpl })
    expect(onDelta.mock.calls.map((c) => c[0])).toEqual(['A', 'B'])
    expect(scriptMd).toBe('ABC')
  })

  it('reasoningEffort를 Claude SDK query options로 전달한다', async () => {
    const queryImpl = vi.fn(async function* () {
      yield { type: 'result', subtype: 'success', is_error: false, result: 'ABC' }
    })
    await generateScript({ title: 'T' }, { model: 'claude-sonnet-5', reasoningEffort: 'high' }, { queryImpl })
    expect(queryImpl.mock.calls[0][0].options).toMatchObject({
      model: 'claude-sonnet-5',
      thinking: { type: 'adaptive' },
      effort: 'high',
      includePartialMessages: true,
    })
    expect(queryImpl.mock.calls[0][0].options).not.toHaveProperty('reasoningEffort')
  })

  it('signal.aborted면 onDelta 방출을 멈추고 Aborted throw', async () => {
    const ac = new AbortController()
    const onDelta = vi.fn((t) => { if (t === 'A') ac.abort() })
    const queryImpl = fakeQuery(['A', 'B'], 'ABC')
    await expect(generateScript({ title: 'T' }, {}, { onDelta, signal: ac.signal, queryImpl })).rejects.toThrow('Aborted')
    expect(onDelta).toHaveBeenCalledTimes(1) // 'A'만, 'B'는 abort로 차단
  })
})
