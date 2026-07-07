/**
 * @vitest-environment node
 */
import { describe, it, expect, vi } from 'vitest'
import { generateSynopsis } from '../../../../electron/api/llm/llmGemini.js'

const OPTS = { apiKey: 'test-key', model: 'gemini-2.5-pro', language: 'ko' }
const SYNOPSIS_BODY = '로그라인: 몰락한 가문의 비밀.\n도입과 전개, 전환과 결말을 담은 개요.'
const CHAR_JSON = '[{"name":"강리안","gender":"male","age":"20대","role":"주인공","ethnicity":"한국인","appearance":"tall man in hanbok"},{"name":"소월"}]'

// SSE 응답 mock (llmGemini.test.js 미러)
function sseResponse(chunks) {
  const body = chunks
    .map((text) => `data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }] })}\n\n`)
    .join('')
  return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } })
}
function textResponse(text) {
  return new Response(
    JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }] }),
    { status: 200 },
  )
}

describe('llmGemini.generateSynopsis (title)', () => {
  it('SSE 델타를 onDelta로 흘리고(마커 이후 차단) synopsisMd/characters로 분리 반환한다', async () => {
    const fetchImpl = vi.fn(async () => sseResponse([SYNOPSIS_BODY, '\nCHARACTERS', `_JSON\n${CHAR_JSON}`]))
    const deltas = []
    const r = await generateSynopsis({ type: 'title', title: '왕의 비밀' }, OPTS, {
      onDelta: (t) => deltas.push(t), fetchImpl,
    })
    expect(r.synopsisMd).toBe(SYNOPSIS_BODY)
    expect(r.characters).toEqual([
      { id: '강리안', name: '강리안', gender: 'male', age: '20대', role: '주인공', ethnicity: '한국인', appearance: 'tall man in hanbok' },
      { id: '소월', name: '소월', gender: 'unknown', age: '', role: '', ethnicity: '', appearance: '' },
    ])
    const streamed = deltas.join('')
    expect(streamed).toContain('로그라인: 몰락한 가문의 비밀.')
    expect(streamed).not.toContain('CHARACTERS_JSON') // M4: JSON 파편 델타 노출 금지
    const url = fetchImpl.mock.calls[0][0]
    expect(url).toContain('streamGenerateContent')
    expect(url).not.toContain('test-key')
    expect(fetchImpl.mock.calls[0][1].headers['x-goog-api-key']).toBe('test-key')
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body).contents[0].parts[0].text).toContain('제목: 왕의 비밀')
  })

  it('마커 없음/깨진 JSON은 throw 없이 characters=[] 폴백, synopsisMd는 유지', async () => {
    const noMarker = vi.fn(async () => sseResponse(['개요만 있다']))
    await expect(generateSynopsis({ type: 'title', title: 'T' }, OPTS, { fetchImpl: noMarker }))
      .resolves.toEqual({ synopsisMd: '개요만 있다', characters: [] })

    const broken = vi.fn(async () => sseResponse(['개요.\nCHARACTERS_JSON\n[{"name": broken']))
    await expect(generateSynopsis({ type: 'title', title: 'T' }, OPTS, { fetchImpl: broken }))
      .resolves.toEqual({ synopsisMd: '개요.', characters: [] })
  })

  it('HTTP 에러는 throw한다', async () => {
    const fetchImpl = vi.fn(async () => new Response('bad', { status: 400 }))
    await expect(generateSynopsis({ type: 'title', title: 'T' }, OPTS, { fetchImpl }))
      .rejects.toThrow(/400/)
  })
})

describe('llmGemini.generateSynopsis (pasted)', () => {
  it('non-streaming generateContent로 characters만 역추출한다', async () => {
    const fetchImpl = vi.fn(async () => textResponse(CHAR_JSON))
    const onDelta = vi.fn()
    const r = await generateSynopsis({ type: 'pasted', pastedScript: '# 붙여넣은 대본' }, OPTS, { fetchImpl, onDelta })
    expect(r.synopsisMd).toBe('')
    expect(r.characters.map((c) => c.name)).toEqual(['강리안', '소월'])
    expect(onDelta).not.toHaveBeenCalled() // M4: pasted는 non-streaming
    const url = fetchImpl.mock.calls[0][0]
    expect(url).toContain(':generateContent')
    expect(url).not.toContain('streamGenerateContent')
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body).contents[0].parts[0].text).toContain('# 붙여넣은 대본')
  })

  it('pasted 결과 JSON이 깨져도 throw하지 않고 characters=[] 폴백', async () => {
    const fetchImpl = vi.fn(async () => textResponse('not json at all'))
    await expect(generateSynopsis({ type: 'pasted', pastedScript: 'S' }, OPTS, { fetchImpl }))
      .resolves.toEqual({ synopsisMd: '', characters: [] })
  })
})
