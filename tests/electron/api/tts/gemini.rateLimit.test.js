/**
 * Gemini TTS 분당 요청 제한 — 무료 티어는 분당 10회다. 어댑터는 호출마다 새로 만들어지므로
 * (createTtsAdapter) 한도는 인스턴스가 아니라 공유 리미터가 지켜야 배치·개별 재생성·미리듣기가
 * 같은 예산을 나눠 쓴다. 여기서는 리미터 자체와, 어댑터가 매 요청 전에 슬롯을 잡는지 본다.
 */
import { describe, it, expect, vi } from 'vitest'
import { createGeminiAdapter, createRateLimiter } from '../../../../electron/api/tts/gemini.js'

// 가짜 시계 — sleep 하면 시간이 그만큼 흐른다.
function fakeClock(start = 0) {
  let t = start
  return {
    now: () => t,
    sleep: async (ms) => { t += ms },
    advance: (ms) => { t += ms },
  }
}

const okAudio = () => ({
  ok: true,
  json: async () => ({
    candidates: [{ content: { parts: [{ inlineData: { data: Buffer.from('pcm').toString('base64'), mimeType: 'audio/L16;rate=24000' } }] } }],
  }),
})

describe('createRateLimiter', () => {
  it('한도까지는 기다리지 않는다', async () => {
    const clock = fakeClock()
    const limiter = createRateLimiter({ limit: 10, windowMs: 60000, ...clock })
    for (let i = 0; i < 10; i++) await limiter.acquire()
    expect(clock.now()).toBe(0)
  })

  it('한도를 넘는 요청은 창이 열릴 때까지 기다린다', async () => {
    const clock = fakeClock()
    const limiter = createRateLimiter({ limit: 10, windowMs: 60000, ...clock })
    for (let i = 0; i < 10; i++) await limiter.acquire()
    await limiter.acquire()                       // 11번째
    expect(clock.now()).toBe(60000)               // 첫 요청이 창에서 빠질 때까지
  })

  it('시간이 흘러 창이 비면 다시 즉시 통과한다', async () => {
    const clock = fakeClock()
    const limiter = createRateLimiter({ limit: 10, windowMs: 60000, ...clock })
    for (let i = 0; i < 10; i++) await limiter.acquire()
    clock.advance(60000)
    await limiter.acquire()
    expect(clock.now()).toBe(60000)               // 추가 대기 없음
  })

  it('분당 한도를 실제로 지킨다 — 25회 요청이 3개 창에 나뉜다', async () => {
    const clock = fakeClock()
    const limiter = createRateLimiter({ limit: 10, windowMs: 60000, ...clock })
    const stamps = []
    for (let i = 0; i < 25; i++) { await limiter.acquire(); stamps.push(clock.now()) }
    // 어떤 60초 창에도 10회를 넘지 않아야 한다.
    for (let i = 0; i < stamps.length; i++) {
      const inWindow = stamps.filter((t) => t > stamps[i] - 60000 && t <= stamps[i]).length
      expect(inWindow).toBeLessThanOrEqual(10)
    }
  })

  it('대기 중 중단되면 기다림을 멈추고 throw 한다', async () => {
    const clock = fakeClock()
    const limiter = createRateLimiter({ limit: 1, windowMs: 60000, ...clock })
    await limiter.acquire()
    const ctrl = new AbortController()
    ctrl.abort()
    await expect(limiter.acquire(ctrl.signal)).rejects.toThrow(/abort/i)
  })
})

describe('Gemini 어댑터가 리미터를 통과한다', () => {
  it('매 요청 전에 슬롯을 잡는다', async () => {
    const acquire = vi.fn().mockResolvedValue(undefined)
    const fetch = vi.fn().mockResolvedValue(okAudio())
    const a = createGeminiAdapter({ getKey: () => 'k', fetch, rateLimiter: { acquire } })
    await a.synthesize({ text: '안녕', voiceId: 'Kore' })
    expect(acquire).toHaveBeenCalledTimes(1)
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('재시도도 별도 요청이라 슬롯을 한 번 더 잡는다(할당량 정확도)', async () => {
    const acquire = vi.fn().mockResolvedValue(undefined)
    // 1차는 오디오 없이 텍스트만 → 재시도 유발
    const fetch = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: 'nope' }] } }] }) })
      .mockResolvedValueOnce(okAudio())
    const a = createGeminiAdapter({ getKey: () => 'k', fetch, rateLimiter: { acquire } })
    await a.synthesize({ text: '안녕', voiceId: 'Kore' })
    expect(fetch).toHaveBeenCalledTimes(2)
    expect(acquire).toHaveBeenCalledTimes(2)
  })

  it('키가 없으면 슬롯을 낭비하지 않는다', async () => {
    const acquire = vi.fn()
    const a = createGeminiAdapter({ getKey: () => null, fetch: vi.fn(), rateLimiter: { acquire } })
    await expect(a.synthesize({ text: 'x', voiceId: 'Kore' })).rejects.toThrow()
    expect(acquire).not.toHaveBeenCalled()
  })

  it('capabilities 가 분당 한도를 알려준다', () => {
    const a = createGeminiAdapter({ getKey: () => 'k', fetch: vi.fn() })
    expect(a.capabilities().requestsPerMinute).toBe(10)
  })
})
