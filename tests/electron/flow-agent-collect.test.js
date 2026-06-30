// @vitest-environment node
import { describe, it, expect, vi } from 'vitest'
import { pickFreshImages, collectAgentDomImages, collectAgentDomVideos } from '../../electron/flow-agent-collect.js'

const noSleep = async () => {}
const fakeRes = (bytes = [1, 2, 3], ct = 'image/png', ok = true) => ({
  ok, status: ok ? 200 : 500,
  arrayBuffer: async () => new Uint8Array(bytes).buffer,
  headers: { get: () => ct },
})

describe('pickFreshImages', () => {
  it('스냅샷(existing)에 없는 새 이미지만, src/mediaId 있는 것만', () => {
    const scanned = [
      { mediaId: 'old', src: 'a' },           // 기존(캐릭터 등) — 제외
      { mediaId: 'new1', src: 'b' },          // 새 결과
      { mediaId: 'no-src' },                  // src 없음 — 제외
      { src: 'c' },                           // mediaId 없음 — 제외
    ]
    expect(pickFreshImages(scanned, ['old'])).toEqual([{ mediaId: 'new1', src: 'b' }])
  })
})

describe('collectAgentDomImages', () => {
  it('스냅샷 후 나타난 새 이미지를 폴링 수집 → base64 (캐릭터 등 기존 이미지 제외)', async () => {
    // 1회차 폴: 기존 이미지만 / 2회차 폴: 새 결과 이미지 등장
    const scan = vi.fn()
      .mockResolvedValueOnce([{ mediaId: 'char', src: 'char-src' }])
      .mockResolvedValueOnce([{ mediaId: 'char', src: 'char-src' }, { mediaId: 'result', src: 'result-src' }])
    const sessionFetch = vi.fn().mockResolvedValue(fakeRes())
    const r = await collectAgentDomImages({
      scan, sessionFetch, sleep: noSleep, existingMediaIds: ['char'], pollMs: 1, maxWaitMs: 100,
    })
    expect(r.success).toBe(true)
    expect(r.images).toHaveLength(1)
    expect(r.images[0].mediaId).toBe('result')
    expect(r.images[0].base64).toMatch(/^data:image\/png;base64,/)
    // 결과 이미지만 fetch — 캐릭터(char-src) 는 안 받음
    expect(sessionFetch).toHaveBeenCalledTimes(1)
    expect(sessionFetch).toHaveBeenCalledWith('result-src')
  })

  it('수집한 mediaId 를 markCollected 로 등록(공유 de-dup) — 다른 경로 중복 매칭 방지', async () => {
    const scan = vi.fn().mockResolvedValue([{ mediaId: 'result', src: 'result-src' }])
    const sessionFetch = vi.fn().mockResolvedValue(fakeRes())
    const collected = new Set()
    const r = await collectAgentDomImages({
      scan, sessionFetch, sleep: noSleep, existingMediaIds: [], pollMs: 1, maxWaitMs: 100,
      markCollected: (mid) => collected.add(mid),
    })
    expect(r.success).toBe(true)
    expect(collected.has('result')).toBe(true)
  })

  it('새 이미지가 안 뜨면 timeout 실패', async () => {
    const scan = vi.fn().mockResolvedValue([{ mediaId: 'char', src: 'char-src' }]) // 계속 기존만
    const sessionFetch = vi.fn()
    const r = await collectAgentDomImages({
      scan, sessionFetch, sleep: noSleep, existingMediaIds: ['char'], pollMs: 1, maxWaitMs: 5,
    })
    expect(r.success).toBe(false)
    expect(r.error).toMatch(/timeout/i)
    expect(sessionFetch).not.toHaveBeenCalled()
  })

  it('want=2 (배치) — 새 이미지 2장 모일 때까지 대기', async () => {
    const scan = vi.fn()
      .mockResolvedValueOnce([{ mediaId: 'a', src: 'sa' }])
      .mockResolvedValueOnce([{ mediaId: 'a', src: 'sa' }, { mediaId: 'b', src: 'sb' }])
    const sessionFetch = vi.fn().mockResolvedValue(fakeRes())
    const r = await collectAgentDomImages({
      scan, sessionFetch, sleep: noSleep, existingMediaIds: [], want: 2, pollMs: 1, maxWaitMs: 100,
    })
    expect(r.success).toBe(true)
    expect(r.images.map(i => i.mediaId)).toEqual(['a', 'b'])
  })
})

/**
 * collectAgentDomVideos — Agent ON 비디오는 결과가 <video src=media...?name=UUID> 로
 * 이미 완성된 채 렌더된다. 이미지와 달리 base64 를 직접 받지 않고 mediaId 만 골라
 * 반환한다 — 다운로드는 렌더러의 기존 generationId→check-video-status→download 파이프가
 * 이어받기 때문(=video 통화는 generationId). 그래서 sessionFetch 가 필요없다.
 */
describe('collectAgentDomVideos', () => {
  it('스냅샷 후 나타난 새 비디오 mediaId 를 폴링 수집 (기존 비디오 제외, fetch 안 함)', async () => {
    const scan = vi.fn()
      .mockResolvedValueOnce([{ mediaId: 'old', src: 'old-src' }])
      .mockResolvedValueOnce([{ mediaId: 'old', src: 'old-src' }, { mediaId: 'result', src: 'result-src' }])
    const r = await collectAgentDomVideos({
      scan, sleep: noSleep, existingMediaIds: ['old'], pollMs: 1, maxWaitMs: 100,
    })
    expect(r.success).toBe(true)
    expect(r.videos).toHaveLength(1)
    expect(r.videos[0].mediaId).toBe('result')
    expect(r.videos[0].src).toBe('result-src')
  })

  it('수집한 mediaId 를 markCollected 로 등록(공유 de-dup)', async () => {
    const scan = vi.fn().mockResolvedValue([{ mediaId: 'result', src: 'result-src' }])
    const collected = new Set()
    const r = await collectAgentDomVideos({
      scan, sleep: noSleep, existingMediaIds: [], pollMs: 1, maxWaitMs: 100,
      markCollected: (mid) => collected.add(mid),
    })
    expect(r.success).toBe(true)
    expect(collected.has('result')).toBe(true)
  })

  it('새 비디오가 안 뜨면 timeout 실패', async () => {
    const scan = vi.fn().mockResolvedValue([{ mediaId: 'old', src: 'old-src' }])
    const r = await collectAgentDomVideos({
      scan, sleep: noSleep, existingMediaIds: ['old'], pollMs: 1, maxWaitMs: 5,
    })
    expect(r.success).toBe(false)
    expect(r.error).toMatch(/timeout/i)
  })
})
