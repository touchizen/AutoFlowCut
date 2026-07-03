import { describe, it, expect, vi } from 'vitest'
import { generateTitle, continueScript } from '../../../../electron/api/llm/llmClaude.js'

const resultMsg = (text) => ({ type: 'result', subtype: 'success', is_error: false, result: text })
function fakeQuery(msgs) { return async function* () { for (const m of msgs) yield m } }

describe('generateTitle', () => {
  it('result 첫 줄을 title로 반환', async () => {
    const { title } = await generateTitle('대본', {}, { queryImpl: fakeQuery([resultMsg('멋진 제목\n군더더기')]) })
    expect(title).toBe('멋진 제목')
  })
})
describe('continueScript', () => {
  it('기존 대본 뒤에 이어붙인 전체를 반환하고 델타를 흘린다', async () => {
    const onDelta = vi.fn()
    const stream = { type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: '이어진' } } }
    const { scriptMd } = await continueScript('앞부분', {}, { onDelta, queryImpl: fakeQuery([stream, resultMsg('이어진 내용')]) })
    expect(onDelta).toHaveBeenCalledWith('이어진')
    expect(scriptMd).toBe('앞부분\n\n이어진 내용')
  })
  it('abort면 Aborted throw', async () => {
    const ac = new AbortController()
    const onDelta = vi.fn(() => ac.abort())
    const stream = { type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'x' } } }
    await expect(continueScript('앞', {}, { onDelta, signal: ac.signal, queryImpl: fakeQuery([stream, resultMsg('y')]) })).rejects.toThrow('Aborted')
  })
})
