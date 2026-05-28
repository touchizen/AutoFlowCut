import { useMemo, useRef, useEffect } from 'react'
import { resolveVideoSrc } from '../../utils/videoSrc'
import { computeVideoClipPlacement, getSceneTimeRangeMs } from './useAudioTimeline'

// 현재 playhead 위치의 씬 이미지 + 자막
// 씬에 비디오(i2v 우선, t2v 차순)가 있고 playhead가 비디오 구간 안이면
// 단일 공유 <video> element를 이미지 위에 오버레이 재생한다.
// <video>는 DOM에 항상 1개만 존재 — 씬이 바뀔 때만 src swap (500씬 스케일 대응).
export default function PreviewPanel({ playheadMs, scenes, srtEntries, height = 240 }) {
  // 씬 ranges precompute — getSceneTimeRangeMs는 parseTimeToSeconds(regex+split)을 부르므로
  // playhead 매 tick (60fps) 마다 N회 반복하면 1시간/1500씬 기준 ~0.5% CPU 누적.
  // 한 번 정규화해서 number range로 들고 있고, 매 tick의 find는 number 비교만.
  const sceneRanges = useMemo(() => {
    if (!scenes?.length) return []
    return scenes
      .map(s => {
        const r = getSceneTimeRangeMs(s)
        return r ? { startMs: r.startMs, endMs: r.endMs, scene: s } : null
      })
      .filter(Boolean)
  }, [scenes])

  // 시간 기준 씬 매칭 (precomputed ranges 위에서 number 비교)
  const scene = useMemo(() => {
    if (!sceneRanges.length) return null
    return sceneRanges.find(r => playheadMs >= r.startMs && playheadMs < r.endMs)?.scene || null
  }, [sceneRanges, playheadMs])

  // SRT 자막 — startMs/endMs는 import 시점에 이미 number로 파싱돼 있음 (parsers.js).
  // 별도 ranges precompute 불필요, find가 그대로 number 비교.
  const srt = useMemo(() => {
    if (!srtEntries?.length) return null
    return srtEntries.find(e => playheadMs >= e.startMs && playheadMs <= e.endMs) || null
  }, [srtEntries, playheadMs])

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
