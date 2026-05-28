import { useMemo, useRef, useEffect } from 'react'
import { resolveVideoSrc } from '../../utils/videoSrc'
import { computeVideoClipPlacement, getSceneTimeRangeMs } from './useAudioTimeline'

/**
 * Lower-bound binary search — startMs 기준 정렬된 ranges 배열에서
 * `t` 시점에 활성인 range를 찾아 반환 (없으면 null).
 *
 * Range는 [startMs, endMs) 반-개구간 매칭 (endMs 포함 여부는 inclusiveEnd로 제어).
 * - inclusiveEnd=false (기본, 씬용): t < endMs
 * - inclusiveEnd=true  (SRT용): t <= endMs
 *
 * 가정: ranges는 startMs 오름차순 정렬되어 있고 **비-중첩**.
 * 두 range가 t 시점에 동시에 활성(overlap)이면 startMs가 더 큰 쪽을 반환 —
 * "first-by-array-order" 의미가 필요한 경우 (예: SRT) findRangeAt 대신
 * sorted ranges 위에서 .find() 를 직접 사용하는 게 안전.
 *
 * O(log N) — 1500 entries에서도 ~11 비교/lookup.
 */
export function findRangeAt(ranges, t, inclusiveEnd = false) {
  let lo = 0
  let hi = ranges.length
  while (lo < hi) {
    const mid = (lo + hi) >>> 1
    if (ranges[mid].startMs <= t) lo = mid + 1
    else hi = mid
  }
  // lo = startMs > t 인 첫 항목 → 직전 항목이 후보
  const idx = lo - 1
  if (idx < 0) return null
  const r = ranges[idx]
  const endOk = inclusiveEnd ? t <= r.endMs : t < r.endMs
  return endOk ? r : null
}

// 현재 playhead 위치의 씬 이미지 + 자막
// 씬에 비디오(i2v 우선, t2v 차순)가 있고 playhead가 비디오 구간 안이면
// 단일 공유 <video> element를 이미지 위에 오버레이 재생한다.
// <video>는 DOM에 항상 1개만 존재 — 씬이 바뀔 때만 src swap (500씬 스케일 대응).
export default function PreviewPanel({ playheadMs, scenes, srtEntries, height = 240 }) {
  // 씬 ranges precompute — getSceneTimeRangeMs는 parseTimeToSeconds(regex+split)을 부르므로
  // playhead 매 tick (60fps) 마다 N회 반복하면 1시간/1500씬 기준 ~0.5% CPU 누적.
  // sort를 명시적으로 — binary search 정확성 보장.
  const sceneRanges = useMemo(() => {
    if (!scenes?.length) return []
    return scenes
      .map(s => {
        const r = getSceneTimeRangeMs(s)
        return r ? { startMs: r.startMs, endMs: r.endMs, scene: s } : null
      })
      .filter(Boolean)
      .sort((a, b) => a.startMs - b.startMs)
  }, [scenes])

  // SRT ranges — 이미 number지만 정렬 안 됐을 수 있으므로 메모이즈 + 정렬해서 보관.
  const srtRanges = useMemo(() => {
    if (!srtEntries?.length) return []
    return srtEntries
      .filter(e => Number.isFinite(e?.startMs) && Number.isFinite(e?.endMs))
      .map(e => ({ startMs: e.startMs, endMs: e.endMs, entry: e }))
      .sort((a, b) => a.startMs - b.startMs)
  }, [srtEntries])

  // 시간 기준 씬 매칭 — O(log N) binary search.
  // 씬은 도메인상 비-overlap 보장 (CSV의 start_time/end_time이 순차 분할).
  const scene = useMemo(() => {
    if (!sceneRanges.length) return null
    return findRangeAt(sceneRanges, playheadMs, /* inclusiveEnd */ false)?.scene || null
  }, [sceneRanges, playheadMs])

  // SRT 자막 — startMs 정렬된 ranges 위에서 linear .find.
  // 일반 SRT는 비-overlap이지만 일부 도구가 카라오케·다중 화자용으로 겹친 cue를 생성.
  // 그런 경우 "가장 먼저 시작한" 매칭을 보여주는 게 자연 — findRangeAt(lower-bound) 는
  // "가장 늦게 시작한" 을 반환하므로 의미가 바뀜. 첫-매칭 의미 유지를 위해 linear.
  // 일반적 SRT 길이(수십~수백 cue)에서 linear cost는 무시할 수준.
  const srt = useMemo(() => {
    if (!srtRanges.length) return null
    const r = srtRanges.find(e => playheadMs >= e.startMs && playheadMs <= e.endMs)
    return r?.entry || null
  }, [srtRanges, playheadMs])

  const imgPath = scene?.imagePath || scene?.image_path || scene?.filePath
  const subtitleText = srt?.text || ''

  // ── 비디오 오버레이 ──
  // 현재 scene의 비디오 placement — useAudioTimeline과 동일 로직 + 동일 헬퍼.
  const videoPlacement = useMemo(() => {
    const range = getSceneTimeRangeMs(scene)
    if (!range) return null
    return computeVideoClipPlacement(scene, range.startMs, range.endMs)
  }, [scene])

  const isVideoActive = !!videoPlacement
    && playheadMs >= videoPlacement.videoIn
    && playheadMs < videoPlacement.videoOut

  // 단일 <video> ref — src는 활성 placement가 바뀔 때만 swap, currentTime/play는 매 tick 동기화
  const videoRef = useRef(null)
  const currentSrcRef = useRef(null)

  useEffect(() => {
    const el = videoRef.current
    if (!el) return

    if (!isVideoActive || !videoPlacement) {
      // playhead가 비디오 구간 밖 → pause만, src는 그대로 둠 (다음 활성화 시 재로딩 비용 절감)
      if (!el.paused) {
        try { el.pause() } catch {}
      }
      return
    }

    // src swap — 활성 비디오 path가 바뀐 경우에만.
    // Windows 절대경로(C:\...) → file:///C:/... 형태로 정규화는 resolveVideoSrc가 담당.
    const desiredSrc = resolveVideoSrc(null, videoPlacement.videoPath)
    if (!desiredSrc) return
    if (currentSrcRef.current !== desiredSrc) {
      currentSrcRef.current = desiredSrc
      el.src = desiredSrc
      try { el.load() } catch {}
    }

    // currentTime sync — 매 tick (씬 안에서의 비디오 진행 위치)
    const targetSec = (playheadMs - videoPlacement.videoIn) / 1000
    if (Number.isFinite(targetSec) && targetSec >= 0) {
      const drift = Math.abs((el.currentTime || 0) - targetSec)
      // 0.15s 이상 어긋날 때만 seek — frame-by-frame jitter 회피
      if (drift > 0.15) {
        try { el.currentTime = targetSec } catch {}
      }
    }

    if (el.paused) {
      el.play().catch(() => { /* autoplay 정책 거부 시 silent */ })
    }
  }, [isVideoActive, videoPlacement, playheadMs])

  return (
    <div className="atl-preview" style={{ height }}>
      <div className="atl-preview-stage">
        {imgPath ? (
          <img className="atl-preview-img" src={`file://${imgPath}`} alt="" />
        ) : (
          <div className="atl-preview-empty">— 씬 없음 —</div>
        )}
        <video
          ref={videoRef}
          className="atl-preview-video"
          muted
          playsInline
          preload="metadata"
          style={{
            display: isVideoActive ? 'block' : 'none',
            position: 'absolute',
            inset: 0,
            width: '100%',
            height: '100%',
            objectFit: 'contain',
            background: '#000',
          }}
        />
        {subtitleText && (
          <div className="atl-preview-subtitle">{subtitleText}</div>
        )}
      </div>
    </div>
  )
}
