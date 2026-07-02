/**
 * @vitest/environment node
 */
import { describe, it, expect, vi } from 'vitest'
import { generateScript, splitScenes, writePrompts } from '../../../../electron/api/llm/llmGemini.js'

// SSE 응답 mock: streamGenerateContent는 "data: {json}\n\n" 라인 스트림
function sseResponse(chunks) {
  const body = chunks
    .map((text) => `data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }] })}\n\n`)
    .join('')
  return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } })
}
function jsonResponse(obj) {
  return new Response(
    JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(obj) }] } }] }),
    { status: 200 },
  )
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
})

describe('writePrompts', () => {
  it('sceneNo로 매칭해 프롬프트를 채운다', async () => {
    const scenes = [{ storyId: 'u1', sceneNo: 1, segments: [] }]
    const fetchImpl = vi.fn(async () => jsonResponse({ scenes: [{ sceneNo: 1, imagePrompt: 'IMG', videoPrompt: 'VID' }] }))
    const r = await writePrompts(scenes, { scriptMd: '#', style: null }, OPTS, { fetchImpl })
    expect(r.scenes[0]).toMatchObject({ storyId: 'u1', imagePrompt: 'IMG', videoPrompt: 'VID' })
  })
})
