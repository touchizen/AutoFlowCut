/**
 * useCachedAvatar — 외부 아바타 URL 을 24h base64 로 localStorage 캐싱하여 표시.
 *
 * 동작:
 *   1. mount/url 변경 시 캐시 hit 확인 — 있으면 즉시 base64 src 사용 (네트워크 X)
 *   2. miss/expired 면 fetch (referrer-less) → 유효성 검증 → base64 변환 → 캐시 저장 → src 갱신
 *   3. fetch 실패 시 failed=true 로 호출자가 placeholder 폴백할 수 있게 신호
 *   4. `<img>` 가 캐시된 base64 디코드에 실패하면 onImageError 호출 → 캐시 invalidate + failed=true
 *
 * URL tagging — frame leak 차단:
 *   state 를 항상 `{ url, data, failed, loading }` 형태로 저장하고 반환 시점에
 *   state.url === 현재 url 인지 확인한다. props 가 A→B 로 바뀐 직후 useEffect 가 돌기 전
 *   한 프레임에서는 state 가 아직 A 의 데이터인데, 단순 `useState(src)` 로는 이걸 감지 못 해
 *   "A 의 아바타 + B 의 이름" 누수가 발생한다. tagged state + 매 렌더의 url 비교로 차단.
 *
 * 반환:
 *   { src, failed, loading, onImageError }
 */

import { useCallback, useEffect, useState } from 'react'
import {
  getCachedEntry,
  setCachedEntry,
  clearCachedEntry,
  fetchAsBase64
} from '../utils/avatarCache'

const EMPTY_STATE = Object.freeze({ url: null, data: null, failed: false, loading: false })

function initialStateFor(url) {
  if (!url) return EMPTY_STATE
  const entry = getCachedEntry(url)
  if (entry?.data) {
    return { url, data: entry.data, failed: false, loading: false }
  }
  // miss — effect 가 fetch 시작할 때까지 loading
  return { url, data: null, failed: false, loading: true }
}

export function useCachedAvatar(url) {
  const [state, setState] = useState(() => initialStateFor(url))

  useEffect(() => {
    if (!url) {
      setState(EMPTY_STATE)
      return
    }

    // 1. 캐시 hit (sync) — url 전환 직후라도 즉시 새 url 데이터로 교체
    const entry = getCachedEntry(url)
    if (entry?.data) {
      setState({ url, data: entry.data, failed: false, loading: false })
      return
    }

    // 2. miss/expired — fetch & cache (fetchAsBase64 가 content-type/size 검증 후 throw)
    setState({ url, data: null, failed: false, loading: true })

    let cancelled = false
    fetchAsBase64(url)
      .then(dataUrl => {
        if (cancelled) return
        setCachedEntry(url, dataUrl)
        setState({ url, data: dataUrl, failed: false, loading: false })
      })
      .catch(err => {
        if (cancelled) return
        console.warn('[useCachedAvatar] Fetch failed:', err?.message || err)
        setState({ url, data: null, failed: true, loading: false })
      })

    return () => { cancelled = true }
  }, [url])

  // `<img>` 디코드 실패용 콜백 — 캐시 invalidate 하여 다음 mount 시 재시도, 현 세션은 placeholder 폴백.
  // setState updater 형태로 url 비교하여 in-flight url 전환 중 stale callback 호출 방어.
  const onImageError = useCallback(() => {
    if (url) clearCachedEntry(url)
    setState(prev => prev.url === url ? { ...prev, data: null, failed: true } : prev)
  }, [url])

  // 핵심: state.url 과 현재 url 이 일치할 때만 데이터 반환.
  // 일치하지 않으면 (props 가 막 바뀐 직후 한 프레임 윈도우) — null + loading 으로 처리.
  const matched = state.url === url
  return {
    src: matched ? state.data : null,
    failed: matched ? state.failed : false,
    loading: matched ? state.loading : Boolean(url),
    onImageError
  }
}

export default useCachedAvatar
