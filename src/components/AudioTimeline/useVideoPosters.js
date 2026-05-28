/**
 * useVideoPosters — video clips → { [clipId]: posterDataUrl } 비동기 로드 hook
 *
 * 각 clip의 videoPath에 대해 getVideoPoster()를 호출하고, 결과 dataURL을
 * clipId 키로 누적해 상태로 노출한다. AbortController로 unmount/clips 변경 시
 * 진행 중인 요청을 취소.
 *
 * 기존 getVideoPoster는 sequential queue + 100-entry LRU (videoPoster.js).
 * 500개 동시 요청해도 큐가 순차 처리하며, LRU evict로 메모리는 안정.
 */
import { useEffect, useState } from 'react'
import { getVideoPoster } from '../../utils/videoPoster'

// 내부 상태: posterMap value는 { url, src } — src는 추출에 쓰인 URL.
// 같은 clip.id에서 videoSrc가 바뀐 경우(같은 씬에서 i2v↔t2v 스왑)
// 이전 src로 추출된 poster를 잘못 노출하지 않도록 비교 키로 함께 보관.
//
// clip.videoSrc는 useAudioTimeline이 미리 resolveVideoSrc()로 정규화한 값.
// 이 hook은 raw videoPath를 더 이상 보지 않는다 — 정규화 책임은 단일 지점.
export function useVideoPosters(clips) {
  const [posterMap, setPosterMap] = useState({})

  useEffect(() => {
    if (!clips || clips.length === 0) {
      setPosterMap({})
      return undefined
    }

    const controller = new AbortController()
    const { signal } = controller
    let cancelled = false

    // 현재 clips의 (id, src) 페어를 만들어 보존 판단 기준으로 사용
    const currentPairs = new Map()
    for (const c of clips) {
      if (!c?.id || !c?.videoSrc) continue
      currentPairs.set(c.id, c.videoSrc)
    }

    // 새 clips 세트가 들어왔으니 이전 맵에서 (a) 더 이상 존재하지 않는 키와
    // (b) 같은 id지만 src가 바뀐 항목(stale poster)을 정리
    setPosterMap(prev => {
      const next = {}
      for (const [id, entry] of Object.entries(prev)) {
        const stillValid = currentPairs.has(id) && currentPairs.get(id) === entry?.src
        if (stillValid) next[id] = entry
      }
      return next
    })

    for (const clip of clips) {
      if (!clip?.id || !clip?.videoSrc) continue
      const src = clip.videoSrc
      // getVideoPoster는 sequential queue + 100-entry LRU + consumer-signal 분리 (videoPoster.js).
      getVideoPoster(src, { signal })
        .then(dataUrl => {
          if (cancelled || signal.aborted) return
          if (!dataUrl) return
          setPosterMap(prev => {
            const existing = prev[clip.id]
            if (existing?.url === dataUrl && existing?.src === src) return prev
            return { ...prev, [clip.id]: { url: dataUrl, src } }
          })
        })
        .catch(() => { /* swallow — getVideoPoster already returns null on error */ })
    }

    return () => {
      cancelled = true
      controller.abort()
    }
  }, [clips])

  return posterMap
}
