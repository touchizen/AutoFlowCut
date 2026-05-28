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

    // 새 clips 세트가 들어왔으니 이전 맵에서 더 이상 존재하지 않는 키 정리
    setPosterMap(prev => {
      const currentIds = new Set(clips.map(c => c.id))
      const next = {}
      for (const [id, url] of Object.entries(prev)) {
        if (currentIds.has(id)) next[id] = url
      }
      return next
    })

    for (const clip of clips) {
      if (!clip?.id || !clip?.videoPath) continue
      // 기존 cache hit이면 동기에 가까운 resolve — 그래도 promise 경로로 안전 처리
      getVideoPoster(clip.videoPath, { signal })
        .then(dataUrl => {
          if (cancelled || signal.aborted) return
          if (!dataUrl) return
          setPosterMap(prev => {
            if (prev[clip.id] === dataUrl) return prev
            return { ...prev, [clip.id]: dataUrl }
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
