/**
 * avatarCache — 24h base64 localStorage 캐시 단위 테스트
 *
 * 검증 포인트:
 *   1. read/write — JSON 직렬화 + 손상된 데이터 방어
 *   2. TTL — 24h 경과 시 stale 처리
 *   3. cap — MAX_ENTRIES 초과 시 오래된 것부터 제거
 *   4. fetchAsBase64 — referrer-less + ok 검사 + base64 변환
 *   5. quota exceeded — silent fail (앱이 안 깨짐)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  readCache,
  writeCache,
  pruneCache,
  getCachedEntry,
  setCachedEntry,
  clearCachedEntry,
  fetchAsBase64,
  blobToDataUrl,
  CACHE_KEY,
  TTL_MS,
  MAX_ENTRIES
} from '../../src/utils/avatarCache'

// 가짜 storage — Map 기반, quota 시뮬레이션 가능
function makeStorage(quotaError = false) {
  const map = new Map()
  return {
    getItem: (k) => map.has(k) ? map.get(k) : null,
    setItem: (k, v) => {
      if (quotaError) {
        const e = new Error('QuotaExceededError')
        e.name = 'QuotaExceededError'
        throw e
      }
      map.set(k, v)
    },
    removeItem: (k) => map.delete(k),
    clear: () => map.clear(),
    _map: map
  }
}

describe('avatarCache — read/write', () => {
  it('빈 storage 면 빈 객체 반환', () => {
    const storage = makeStorage()
    expect(readCache(storage)).toEqual({})
  })

  it('손상된 JSON 이면 빈 객체 반환', () => {
    const storage = makeStorage()
    storage.setItem(CACHE_KEY, '{not valid json')
    expect(readCache(storage)).toEqual({})
  })

  it('write 후 read 하면 동일한 객체 반환', () => {
    const storage = makeStorage()
    const entry = { 'http://a/img': { data: 'data:image/png;base64,xxx', cachedAt: 100 } }
    writeCache(entry, storage)
    expect(readCache(storage)).toEqual(entry)
  })

  it('quota exceeded 시 silent fail (throw X, 다음 read 는 빈 객체)', () => {
    const storage = makeStorage(true)
    expect(() => writeCache({ a: 1 }, storage)).not.toThrow()
    expect(readCache(storage)).toEqual({})
  })
})

describe('avatarCache — pruneCache', () => {
  const now = 1_000_000_000_000  // 임의 ts

  it('TTL 이내 엔트리는 유지', () => {
    const fresh = { 'a': { data: 'd', cachedAt: now - 1000 } }
    expect(pruneCache(fresh, now)).toEqual(fresh)
  })

  it('TTL 경과 엔트리는 제거', () => {
    const stale = { 'a': { data: 'd', cachedAt: now - TTL_MS - 1 } }
    expect(pruneCache(stale, now)).toEqual({})
  })

  it('cap 초과 시 오래된 것부터 제거', () => {
    const cache = {}
    // MAX_ENTRIES + 5 개 만들기. cachedAt 차등 부여
    for (let i = 0; i < MAX_ENTRIES + 5; i++) {
      cache[`url_${i}`] = { data: 'd', cachedAt: now - i * 1000 }
    }
    const pruned = pruneCache(cache, now)
    expect(Object.keys(pruned).length).toBe(MAX_ENTRIES)
    // 가장 새로운 MAX_ENTRIES 개가 남아야 함 (i=0..MAX_ENTRIES-1)
    for (let i = 0; i < MAX_ENTRIES; i++) {
      expect(pruned[`url_${i}`]).toBeDefined()
    }
    expect(pruned[`url_${MAX_ENTRIES}`]).toBeUndefined()
  })

  it('손상된 엔트리(cachedAt 누락) 제거', () => {
    const broken = { 'a': { data: 'd' } }
    expect(pruneCache(broken, now)).toEqual({})
  })
})

describe('avatarCache — getCachedEntry / setCachedEntry', () => {
  const now = 2_000_000_000_000

  it('miss 시 null', () => {
    const storage = makeStorage()
    expect(getCachedEntry('http://x', now, storage)).toBeNull()
  })

  it('fresh hit 시 entry 반환', () => {
    const storage = makeStorage()
    setCachedEntry('http://x', 'data:image/png;base64,zzz', now, storage)
    const entry = getCachedEntry('http://x', now + 1000, storage)
    expect(entry?.data).toBe('data:image/png;base64,zzz')
    expect(entry?.cachedAt).toBe(now)
  })

  it('expired 시 null (TTL 초과)', () => {
    const storage = makeStorage()
    setCachedEntry('http://x', 'data:image/png;base64,zzz', now, storage)
    const entry = getCachedEntry('http://x', now + TTL_MS + 1, storage)
    expect(entry).toBeNull()
  })

  it('url null/undefined 시 null', () => {
    expect(getCachedEntry(null)).toBeNull()
    expect(getCachedEntry(undefined)).toBeNull()
  })

  it('set 시 함께 prune 되어 cap 유지', () => {
    const storage = makeStorage()
    // cap 초과로 채움
    for (let i = 0; i < MAX_ENTRIES + 3; i++) {
      setCachedEntry(`url_${i}`, 'data', now + i, storage)
    }
    const cache = readCache(storage)
    expect(Object.keys(cache).length).toBeLessThanOrEqual(MAX_ENTRIES)
  })
})

describe('avatarCache — fetchAsBase64', () => {
  it('성공 시 base64 data URL 반환', async () => {
    const fakeBlob = new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' })
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      blob: () => Promise.resolve(fakeBlob)
    })

    const result = await fetchAsBase64('http://example/img', fetchMock)

    expect(result).toMatch(/^data:image\/png;base64,/)
    expect(fetchMock).toHaveBeenCalledWith('http://example/img', {
      referrerPolicy: 'no-referrer',
      cache: 'force-cache'
    })
  })

  it('non-ok 응답 시 throw', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 429,
      blob: () => Promise.resolve(new Blob())
    })
    await expect(fetchAsBase64('http://x', fetchMock)).rejects.toThrow(/429/)
  })

  it('network error 전파', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('network'))
    await expect(fetchAsBase64('http://x', fetchMock)).rejects.toThrow('network')
  })

  it('200 이지만 image/* 가 아닌 content-type 이면 throw (HTML 에러 페이지 방어)', async () => {
    const htmlBlob = new Blob(['<html>error</html>'], { type: 'text/html' })
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      blob: () => Promise.resolve(htmlBlob)
    })
    await expect(fetchAsBase64('http://x', fetchMock)).rejects.toThrow(/Not an image/)
  })

  it('200 이지만 빈 body 면 throw (zero-byte 방어)', async () => {
    const emptyBlob = new Blob([], { type: 'image/png' })
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      blob: () => Promise.resolve(emptyBlob)
    })
    await expect(fetchAsBase64('http://x', fetchMock)).rejects.toThrow(/Empty/)
  })

  it('content-type 이 빈 문자열이어도 throw (블록의 type 누락 방어)', async () => {
    const noTypeBlob = new Blob([new Uint8Array([1, 2])], { type: '' })
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      blob: () => Promise.resolve(noTypeBlob)
    })
    await expect(fetchAsBase64('http://x', fetchMock)).rejects.toThrow(/Not an image/)
  })
})

describe('avatarCache — clearCachedEntry', () => {
  it('존재하는 엔트리 제거', () => {
    const storage = makeStorage()
    setCachedEntry('http://x/avatar', 'data:image/png;base64,xxx', 1000, storage)
    expect(getCachedEntry('http://x/avatar', 1000, storage)).toBeTruthy()

    clearCachedEntry('http://x/avatar', storage)
    expect(getCachedEntry('http://x/avatar', 1000, storage)).toBeNull()
  })

  it('없는 엔트리 제거 시도해도 throw 없음 (no-op)', () => {
    const storage = makeStorage()
    expect(() => clearCachedEntry('http://nope', storage)).not.toThrow()
  })

  it('url 이 falsy 면 no-op', () => {
    const storage = makeStorage()
    expect(() => clearCachedEntry(null, storage)).not.toThrow()
    expect(() => clearCachedEntry('', storage)).not.toThrow()
  })

  it('다른 엔트리는 영향 없음', () => {
    const storage = makeStorage()
    setCachedEntry('http://a', 'data:a', 1000, storage)
    setCachedEntry('http://b', 'data:b', 1000, storage)

    clearCachedEntry('http://a', storage)

    expect(getCachedEntry('http://a', 1000, storage)).toBeNull()
    expect(getCachedEntry('http://b', 1000, storage)?.data).toBe('data:b')
  })
})

describe('avatarCache — blobToDataUrl', () => {
  it('Blob 을 data URL 로 변환', async () => {
    const blob = new Blob([new Uint8Array([0, 1, 2])], { type: 'image/jpeg' })
    const dataUrl = await blobToDataUrl(blob)
    expect(dataUrl).toMatch(/^data:image\/jpeg;base64,/)
  })
})
