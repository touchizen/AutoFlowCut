import { describe, it, expect, vi } from 'vitest'
import { generateSynopsis } from '../../../../electron/api/llm/llmClaude.js'

const SYNOPSIS_BODY = '로그라인: 몰락한 가문의 비밀.\n도입과 전개, 전환과 결말을 담은 개요.'
const CHAR_JSON = '[{"name":"강리안","gender":"male","age":"20대","role":"주인공","ethnicity":"한국인","appearance":"tall man in hanbok"},{"name":"소월"}]'
const FULL = `${SYNOPSIS_BODY}\nCHARACTERS_JSON\n${CHAR_JSON}`

// stream_event 델타 N개 + 최종 result를 흘리는 가짜 query (llmClaude.generateScript 테스트 미러)
function fakeQuery(deltas, resultText) {
  return async function* () {
    for (const t of deltas) yield { type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: t } } }
    yield { type: 'result', subtype: 'success', is_error: false, result: resultText }
  }
}

describe('llmClaude.generateSynopsis (title)', () => {
  it('스트리밍 델타를 onDelta로 흘리고 완료 후 synopsisMd/characters로 분리 반환한다', async () => {
    const onDelta = vi.fn()
    const queryImpl = fakeQuery([SYNOPSIS_BODY, `\nCHARACTERS_JSON\n${CHAR_JSON}`], FULL)
    const r = await generateSynopsis({ type: 'title', title: 'T' }, { language: 'ko' }, { onDelta, queryImpl })
    expect(r.synopsisMd).toBe(SYNOPSIS_BODY)
    expect(r.characters).toEqual([
      { id: '강리안', name: '강리안', gender: 'male', age: '20대', role: '주인공', ethnicity: '한국인', appearance: 'tall man in hanbok' },
      { id: '소월', name: '소월', gender: 'unknown', age: '', role: '', ethnicity: '', appearance: '' },
    ])
    const streamed = onDelta.mock.calls.map((c) => c[0]).join('')
    expect(streamed).toContain('로그라인: 몰락한 가문의 비밀.')
    expect(streamed).not.toContain('CHARACTERS_JSON') // M4: JSON 파편은 델타로 노출 금지
    expect(streamed).not.toContain('강리안') // JSON 본문도 노출 금지
  })

  it('마커가 델타 경계에서 쪼개져도 마커/JSON 파편을 onDelta로 흘리지 않는다', async () => {
    const onDelta = vi.fn()
    const queryImpl = fakeQuery(['개요다. CHARACTERS', '_JSON\n[]'], '개요다. CHARACTERS_JSON\n[]')
    await generateSynopsis({ type: 'title', title: 'T' }, {}, { onDelta, queryImpl })
    const streamed = onDelta.mock.calls.map((c) => c[0]).join('')
    expect(streamed).toBe('개요다. ')
  })

  it('마커가 없으면 characters=[] 폴백하고 synopsisMd는 원문 유지', async () => {
    const queryImpl = fakeQuery(['개요만 있다'], '개요만 있다')
    const r = await generateSynopsis({ type: 'title', title: 'T' }, {}, { queryImpl })
    expect(r).toEqual({ synopsisMd: '개요만 있다', characters: [], charactersParsed: false })
  })

  it('마커 뒤 JSON이 깨져도 throw하지 않고 characters=[] 폴백, synopsisMd는 유지', async () => {
    const broken = '개요.\nCHARACTERS_JSON\n[{"name": broken'
    const queryImpl = fakeQuery([broken], broken)
    const r = await generateSynopsis({ type: 'title', title: 'T' }, {}, { queryImpl })
    expect(r.synopsisMd).toBe('개요.')
    expect(r.characters).toEqual([])
  })

  it('buildSynopsisPrompt를 사용하고 스트리밍 옵션(includePartialMessages)을 켠다', async () => {
    const queryImpl = vi.fn(async function* () {
      yield { type: 'result', subtype: 'success', is_error: false, result: FULL }
    })
    await generateSynopsis({ type: 'title', title: '왕의 비밀' }, { language: 'ko', model: 'claude-sonnet-5' }, { queryImpl })
    expect(queryImpl.mock.calls[0][0].prompt).toContain('제목: 왕의 비밀')
    expect(queryImpl.mock.calls[0][0].prompt).toContain('CHARACTERS_JSON')
    expect(queryImpl.mock.calls[0][0].options).toMatchObject({ model: 'claude-sonnet-5', includePartialMessages: true })
  })

  it('signal.aborted면 onDelta 방출을 멈추고 Aborted throw', async () => {
    const ac = new AbortController()
    const onDelta = vi.fn(() => ac.abort())
    const queryImpl = fakeQuery(['개요 첫 조각. ', '개요 둘째 조각.'], FULL)
    await expect(generateSynopsis({ type: 'title', title: 'T' }, {}, { onDelta, signal: ac.signal, queryImpl }))
      .rejects.toThrow('Aborted')
    expect(onDelta).toHaveBeenCalledTimes(1)
  })
})

describe('llmClaude.generateSynopsis (pasted)', () => {
  it('buildSynopsisFromScriptPrompt로 non-streaming 호출해 시놉시스+등장인물을 함께 역추출한다', async () => {
    const onDelta = vi.fn()
    const RESULT = `대본 시놉시스 개요.\nCHARACTERS_JSON\n${CHAR_JSON}`
    const queryImpl = vi.fn(async function* () {
      yield { type: 'result', subtype: 'success', is_error: false, result: RESULT }
    })
    const r = await generateSynopsis({ type: 'pasted', pastedScript: '# 붙여넣은 대본' }, { language: 'ko' }, { onDelta, queryImpl })
    expect(r.synopsisMd).toBe('대본 시놉시스 개요.')
    expect(r.characters.map((c) => c.name)).toEqual(['강리안', '소월'])
    expect(onDelta).not.toHaveBeenCalled() // pasted는 non-streaming
    expect(queryImpl.mock.calls[0][0].prompt).toContain('--- 대본 ---')
    expect(queryImpl.mock.calls[0][0].prompt).toContain('# 붙여넣은 대본')
  })

  it('pasted 등장인물 JSON이 깨져도 throw하지 않고 시놉시스는 유지·characters=[] 폴백', async () => {
    const queryImpl = vi.fn(async function* () {
      yield { type: 'result', subtype: 'success', is_error: false, result: '개요.\nCHARACTERS_JSON\n[{"name": broken' }
    })
    const r = await generateSynopsis({ type: 'pasted', pastedScript: 'S' }, {}, { queryImpl })
    expect(r.synopsisMd).toBe('개요.')
    expect(r.characters).toEqual([])
  })

  it('pasted도 signal abort 시 Aborted throw', async () => {
    const ac = new AbortController()
    ac.abort()
    const queryImpl = vi.fn(async function* () {
      throw new Error('boom')
    })
    await expect(generateSynopsis({ type: 'pasted', pastedScript: 'S' }, {}, { signal: ac.signal, queryImpl }))
      .rejects.toThrow('Aborted')
  })
})
