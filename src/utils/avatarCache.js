/**
 * Avatar cache — Google 프로필 이미지 등 외부 아바타를 24h base64 로 localStorage 에 캐싱.
 *
 * 동기:
 *   - Electron file:// origin 에서 `lh3.googleusercontent.com` 이 429 (Too Many Requests) 자주 반환
 *   - referrer/throttle 정책상 클라이언트 측에서 완전한 회피 불가
 *   - 한 번 받아 base64 로 저장하면 이후 네트워크 안 때려서 429 원천 차단
 *
 * 형식 (localStorage):
 *   avatarCache_v1 = JSON.stringify({
 *     [url]: { data: 'data:image/jpeg;base64,...', cachedAt: 1700000000000 },
 *     ...
 *   })
 *
 * 정책:
 *   - TTL: 24h (만료 시 read 시점에 prune)
 *   - 엔트리 cap: 20 개 (초과 시 오래된 것부터 제거 — base64 평균 5~10KB × 20 = ~200KB)
 *   - quota exceeded / parse 실패 등은 silent fail — 캐시는 best-effort, 폴백은 원본 URL
 */

export const CACHE_KEY = 'avatarCache_v1'
export const TTL_MS = 24 * 60 * 60 * 1000  // 24h
export const MAX_ENTRIES = 20

/**
 * localStorage 에서 캐시 객체 읽기. 손상/없음 시 빈 객체.
 */
export function readCache(storage = globalThis.localStorage) {
  if (!storage) return {}
  try {
    const raw = storage.getItem(CACHE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

/**
 * localStorage 에 캐시 객체 쓰기. quota 초과 등은 silent fail.
 */
export function writeCache(cache, storage = globalThis.localStorage) {
  if (!storage) return
  try {
    storage.setItem(CACHE_KEY, JSON.stringify(cache))
  } catch {
    // QuotaExceededError 등 — 캐시 미적용으로 처리, 다음에 다시 시도
  }
}

/**
 * 만료된 엔트리 + cap 초과분 제거. 새 cache 객체 반환 (입력 mutate X).
 */
export function pruneCache(cache, now = Date.now()) {
  const entries = Object.entries(cache).filter(
    ([, entry]) => entry?.cachedAt && (now - entry.cachedAt) < TTL_MS
  )
  // cap 초과 시 cachedAt 오름차순으로 잘라냄 (오래된 것 제거)
  entries.sort((a, b) => b[1].cachedAt - a[1].cachedAt)
  const trimmed = entries.slice(0, MAX_ENTRIES)
  return Object.fromEntries(trimmed)
}

/**
 * 특정 URL 의 fresh 캐시 엔트리 반환 (없거나 만료면 null).
 */
export function getCachedEntry(url, now = Date.now(), storage = globalThis.localStorage) {
  if (!url) return null
  const cache = readCache(storage)
  const entry = cache[url]
  if (!entry?.data || !entry?.cachedAt) return null
  if ((now - entry.cachedAt) >= TTL_MS) return null
  return entry
}

/**
 * URL 의 새 base64 데이터를 캐시에 저장. 동시에 prune 도 수행.
 */
export function setCachedEntry(url, dataUrl, now = Date.now(), storage = globalThis.localStorage) {
  if (!url || !dataUrl) return
  const cache = pruneCache(readCache(storage), now)
  cache[url] = { data: dataUrl, cachedAt: now }
  writeCache(pruneCache(cache, now), storage)
}

/**
 * 특정 URL 의 캐시 엔트리 제거.
 * `<img>` 디코드 실패 등 "캐시는 있는데 데이터가 깨진" 경우에 호출하여
 * 다음 render 가 새로 fetch 하도록 한다.
 */
export function clearCachedEntry(url, storage = globalThis.localStorage) {
  if (!url) return
  const cache = readCache(storage)
  if (!(url in cache)) return
  delete cache[url]
  writeCache(cache, storage)
}

/**
 * URL 에서 이미지를 fetch 후 base64 data URL 로 변환.
 *   - referrerPolicy: 'no-referrer' — Google CDN 의 referrer 기반 throttle 회피
 *   - cache: 'force-cache' — Electron HTTP 캐시도 활용 (이중 안전망)
 *
 * 유효성 검사 (정상 이미지일 때만 캐시되도록):
 *   - HTTP 200 (res.ok)
 *   - blob.type 이 image/* 으로 시작
 *   - blob.size > 0
 *
 * 위 중 하나라도 실패하면 throw — 호출자가 catch 해서 캐시 안 하고 폴백 처리.
 */
export async function fetchAsBase64(url, fetchImpl = globalThis.fetch) {
  const res = await fetchImpl(url, {
    referrerPolicy: 'no-referrer',
    cache: 'force-cache'
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const blob = await res.blob()
  // CDN 이 200 으로 HTML 에러 페이지를 반환하는 경우 등 — 이미지 아닌 응답 거부
  if (!blob.type || !blob.type.startsWith('image/')) {
    throw new Error(`Not an image (content-type: ${blob.type || 'unknown'})`)
  }
  // 빈 body — base64 변환되지만 `<img>` 가 못 그림
  if (blob.size === 0) {
    throw new Error('Empty image response')
  }
  return await blobToDataUrl(blob)
}

/**
 * Blob → base64 data URL 변환.
 */
export function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onloadend = () => resolve(reader.result)
    reader.onerror = () => reject(reader.error || new Error('FileReader failed'))
    reader.readAsDataURL(blob)
  })
}
