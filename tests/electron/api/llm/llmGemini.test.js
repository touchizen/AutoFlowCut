/**
 * @vitest-environment node
 */
import { describe, it, expect, vi } from 'vitest'
import { generateScript, splitScenes, writePrompts, reviewScript, reviseScript } from '../../../../electron/api/llm/llmGemini.js'

// SSE 응답 mock: streamGenerateContent는 "data: {json}\n\n" 라인 스트림
function sseResponse(chunks) {
  const body = chunks
    .map((text) => `data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }] })}\n\n`)
    .join('')
  return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } })
}
// SSE 라인 경계가 청크에 걸치도록 임의 지점에서 잘라 여러 ReadableStream 청크로 나눠 보내는 mock
function chunkedSseResponse(rawChunks) {
  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    async start(controller) {
      for (const chunk of rawChunks) {
        controller.enqueue(encoder.encode(chunk))
        await Promise.resolve()
      }
      controller.close()
    },
  })
  return new Response(stream, { status: 200, headers: { 'content-type': 'text/event-stream' } })
}
function jsonResponse(obj) {
  return new Response(
    JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(obj) }] } }] }),
    { status: 200 },
  )
}
function httpErrorResponse(status, body = 'err') {
  return new Response(body, { status })
}

const OPTS = { apiKey: 'test-key', model: 'gemini-2.5-pro', language: 'ko' }

describe('generateScript', () => {
  it('SSE 조각을 onDelta로 중계하고 전체를 반환한다', async () => {
    const fetchImpl = vi.fn(async () => sseResponse(['# 제목\n', '본문1', '본문2']))
    const deltas = []
    const r = await generateScript({ type: 'title', title: '운수 좋은 날' }, OPTS, {
      onDelta: (t) => deltas.push(t), fetchImpl,
    })
    expect(r.scriptMd).toBe('# 제목\n본문1본문2')
    expect(deltas).toEqual(['# 제목\n', '본문1', '본문2'])
    const url = fetchImpl.mock.calls[0][0]
    expect(url).toContain('streamGenerateContent')
    expect(url).not.toContain('test-key')  // 키는 헤더로 (URL 노출 금지)
    expect(fetchImpl.mock.calls[0][1].headers['x-goog-api-key']).toBe('test-key')
  })

  it('스트림이 끝나기 전에 onDelta가 진행형으로 호출된다 (전체 버퍼링 금지)', async () => {
    let controllerRef
    const encoder = new TextEncoder()
    const stream = new ReadableStream({
      start(controller) { controllerRef = controller },
    })
    const res = new Response(stream, { status: 200, headers: { 'content-type': 'text/event-stream' } })
    const fetchImpl = vi.fn(async () => res)
    const deltas = []
    const promise = generateScript({ type: 'title', title: 't' }, OPTS, {
      onDelta: (t) => deltas.push(t), fetchImpl,
    })

    controllerRef.enqueue(encoder.encode(
      `data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text: '첫부분' }] } }] })}\n\n`,
    ))
    // 스트림이 아직 닫히지 않았는데도 첫 delta가 이미 도착해야 한다
    await vi.waitFor(() => expect(deltas).toEqual(['첫부분']))

    controllerRef.enqueue(encoder.encode(
      `data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text: '둘째부분' }] } }] })}\n\n`,
    ))
    controllerRef.close()

    const r = await promise
    expect(r.scriptMd).toBe('첫부분둘째부분')
    expect(deltas).toEqual(['첫부분', '둘째부분'])
  })

  it('청크 경계에 걸친 SSE 라인도 정확히 파싱된다', async () => {
    const line = `data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text: '경계테스트' }] } }] })}\n\n`
    const cut = Math.floor(line.length / 2)
    const fetchImpl = vi.fn(async () => chunkedSseResponse([line.slice(0, cut), line.slice(cut)]))
    const deltas = []
    const r = await generateScript({ type: 'title', title: 't' }, OPTS, {
      onDelta: (t) => deltas.push(t), fetchImpl,
    })
    expect(r.scriptMd).toBe('경계테스트')
    expect(deltas).toEqual(['경계테스트'])
  })
})

describe('splitScenes', () => {
  it('structured output을 파싱해 scenes/speakers 반환', async () => {
    const payload = {
      scenes: [{ sceneNo: 1, summary: 's', segments: [{ speaker: 'narrator', text: '옛날에', emotion: 'normal' }] }],
      speakers: [{ id: 'narrator', name: '나레이션' }],
    }
    const fetchImpl = vi.fn(async () => jsonResponse(payload))
    const r = await splitScenes('# 대본', OPTS, { fetchImpl })
    expect(r.scenes).toHaveLength(1)
    expect(r.speakers[0].id).toBe('narrator')
    const body = JSON.parse(fetchImpl.mock.calls[0][1].body)
    expect(body.generationConfig.responseMimeType).toBe('application/json')
    expect(body.generationConfig.responseSchema).toBeTruthy()
  })
  it('파싱 실패 시 1회 재요청', async () => {
    const good = { scenes: [], speakers: [] }
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: 'not-json' }] } }] }), { status: 200 }))
      .mockResolvedValueOnce(jsonResponse(good))
    const r = await splitScenes('# 대본', OPTS, { fetchImpl })
    expect(r.scenes).toEqual([])
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })
  it('429 응답은 1초 백오프 후 1회 재시도해 성공한다', async () => {
    const good = { scenes: [], speakers: [] }
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(httpErrorResponse(429, 'rate limited'))
      .mockResolvedValueOnce(jsonResponse(good))
    const delays = []
    const delay = vi.fn((ms) => { delays.push(ms); return Promise.resolve() })
    const r = await splitScenes('# 대본', OPTS, { fetchImpl, delay })
    expect(r.scenes).toEqual([])
    expect(fetchImpl).toHaveBeenCalledTimes(2)
    expect(delays).toEqual([1000]) // 백오프 존재 확인
  })
  it('400 등 재시도 불가 HTTP 에러는 재시도 없이 throw한다', async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(httpErrorResponse(400, 'bad request'))
    await expect(splitScenes('# 대본', OPTS, { fetchImpl })).rejects.toThrow(/400/)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })
})

describe('writePrompts', () => {
  it('sceneNo로 매칭해 프롬프트를 채운다', async () => {
    const scenes = [{ storyId: 'u1', sceneNo: 1, segments: [] }]
    const fetchImpl = vi.fn(async () => jsonResponse({ scenes: [{ sceneNo: 1, imagePrompt: 'IMG', videoPrompt: 'VID' }] }))
    const r = await writePrompts(scenes, { scriptMd: '#', style: null }, OPTS, { fetchImpl })
    expect(r.scenes[0]).toMatchObject({ storyId: 'u1', imagePrompt: 'IMG', videoPrompt: 'VID' })
  })
})

describe('reviewScript / reviseScript (M3)', () => {
  const textResponse = (text) => new Response(
    JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }] }), { status: 200 })

  it('reviewScript: responseSchema로 verdict/critique 반환', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ verdict: 'revise', critique: '도입 약함' }))
    const out = await reviewScript('대본', OPTS, { fetchImpl })
    expect(out).toEqual({ verdict: 'revise', critique: '도입 약함' })
  })
  it("reviewScript: verdict가 pass/revise 외면 'pass'로 정규화", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ verdict: 'x', critique: '' }))
    const out = await reviewScript('대본', OPTS, { fetchImpl })
    expect(out.verdict).toBe('pass')
  })
  it('reviseScript: 개선된 대본 텍스트 반환(non-streaming generateContent)', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(textResponse('개선된 대본'))
    const out = await reviseScript('원본', '도입 강화', OPTS, { fetchImpl })
    expect(out.scriptMd).toBe('개선된 대본')
    // streamGenerateContent(SSE)가 아니라 generateContent 호출
    expect(fetchImpl.mock.calls[0][0]).toContain(':generateContent')
    expect(fetchImpl.mock.calls[0][0]).not.toContain('streamGenerateContent')
  })
})

describe('splitScenes appearance 통과(V2)', () => {
  it('speakers[].appearance가 그대로 반환된다', async () => {
    const payload = { scenes: [{ sceneNo: 1, summary: 's', segments: [{ speaker: 'a', text: 'hi', emotion: 'normal' }] }], speakers: [{ id: 'a', name: '민수', appearance: 'tall man' }] }
    const fetchImpl = vi.fn(async () => jsonResponse(payload))
    const r = await splitScenes('# 대본', OPTS, { fetchImpl })
    expect(r.speakers[0].appearance).toBe('tall man')
  })
})
