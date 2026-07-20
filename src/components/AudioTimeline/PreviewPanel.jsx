import { useMemo, useRef, useEffect, useLayoutEffect, useState, useCallback } from 'react'
import { computeKenBurns } from '../../../electron/render/kenBurns.js'
import { outputSpec } from '../../../electron/render/buildRenderPlan.js'
import { useExportSettingsContext } from '../../contexts/ExportSettingsContext'
import { resolveVideoSrc } from '../../utils/videoSrc'
import { resolveImageSrc } from '../../utils/formatters'
import { isExportableScene } from '../../utils/exportableScene'
import { resolveExportVideos } from '../../utils/sceneMedia'
import {
  aspectRatioToRenderFormat,
  kenBurnsPreviewStyle,
  normalizePreviewImageSrc,
  toKenBurnsRatios,
} from '../../utils/kenBurnsPreview'
import { computeVideoClipPlacement, getSceneTimeRangeMs, isPreviewVideoVisible } from './useAudioTimeline'

// 활성 직전 비디오 prefetch lead time — playhead가 다음 비디오 활성에 도달
// PREFETCH_LEAD_MS 안쪽으로 가까워지면 hidden <video>로 미리 src+load 트리거.
// 첫 재생 시 OS 페이지 캐시 cold read 로 인한 ~수백ms~수초 hang을 평탄화.
// 너무 짧으면 효과 없음 / 너무 길면 prefetch가 빈번해짐 — 1.5s가 일반적 안전치.
const PREFETCH_LEAD_MS = 1500

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
const EMPTY_HIDDEN = new Set()

export default function PreviewPanel({ playheadMs, scenes, srtEntries, height = 240, isPlaying = false, hiddenRoles = EMPTY_HIDDEN, monitorVolume = 1, monitorMuted = true }) {
  const { settings, aspectRatio } = useExportSettingsContext()

  // 씬 ranges precompute — getSceneTimeRangeMs는 parseTimeToSeconds(regex+split)을 부르므로
  // playhead 매 tick (60fps) 마다 N회 반복하면 1시간/1500씬 기준 ~0.5% CPU 누적.
  // exportable 씬의 객체 참조 index도 함께 보관해 self-render seed와 맞춘다.
  // sort를 명시적으로 — binary search 정확성 보장.
  const sceneRanges = useMemo(() => {
    if (!scenes?.length) return []
    const exportableScenes = scenes.filter(isExportableScene)
    const exportIndexByScene = new Map(exportableScenes.map((scene, index) => [scene, index]))
    return scenes
      .map(s => {
        const r = getSceneTimeRangeMs(s)
        return r ? {
          startMs: r.startMs,
          endMs: r.endMs,
          scene: s,
          exportIndex: exportIndexByScene.get(s) ?? null,
        } : null
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
  const sceneRange = useMemo(() => {
    if (!sceneRanges.length) return null
    return findRangeAt(sceneRanges, playheadMs, /* inclusiveEnd */ false)
  }, [sceneRanges, playheadMs])
  const scene = sceneRange?.scene || null
  const exportIndex = sceneRange?.exportIndex ?? null
  const sceneDurationMs = sceneRange ? sceneRange.endMs - sceneRange.startMs : 0
  const sceneProgress = sceneRange && sceneDurationMs > 0
    ? Math.min(1, Math.max(0, (playheadMs - sceneRange.startMs) / sceneDurationMs))
    : 0

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
  const imageSrc = normalizePreviewImageSrc(resolveImageSrc({
    imagePath: imgPath,
    image: scene?.image,
    generatedAt: scene?.generatedAt,
  }))
  const subtitleText = srt?.text || ''

  const renderFormat = aspectRatioToRenderFormat(aspectRatio)
  const spec = useMemo(
    () => outputSpec(renderFormat, settings.renderMode),
    [renderFormat, settings.renderMode],
  )
  const stageRef = useRef(null)
  const [frameSize, setFrameSize] = useState(null)
  useLayoutEffect(() => {
    const stage = stageRef.current
    if (!stage) return undefined

    const updateFrameSize = () => {
      const { width: stageWidth, height: stageHeight } = stage.getBoundingClientRect()
      if (!(stageWidth > 0) || !(stageHeight > 0)) {
        setFrameSize(previous => previous == null ? previous : null)
        return
      }
      const ratio = spec.width / spec.height
      const width = Math.min(stageWidth, stageHeight * ratio)
      const height = width / ratio
      setFrameSize(previous => (
        previous
        && Math.abs(previous.width - width) < 0.01
        && Math.abs(previous.height - height) < 0.01
          ? previous
          : { width, height }
      ))
    }

    updateFrameSize()
    const observer = new ResizeObserver(updateFrameSize)
    observer.observe(stage)
    return () => observer.disconnect()
  }, [spec.width, spec.height])
  const frameStyle = useMemo(() => ({
    aspectRatio: `${spec.width} / ${spec.height}`,
    ...(frameSize ? { width: `${frameSize.width}px`, height: `${frameSize.height}px` } : {}),
  }), [spec.width, spec.height, frameSize])
  const kenBurnsOptions = useMemo(() => toKenBurnsRatios({
    kenBurnsMode: settings.kenBurnsMode,
    kenBurnsScaleMin: settings.kenBurnsScaleMin,
    kenBurnsScaleMax: settings.kenBurnsScaleMax,
  }), [settings.kenBurnsMode, settings.kenBurnsScaleMin, settings.kenBurnsScaleMax])
  const kenBurns = useMemo(() => {
    if (!scene || exportIndex == null) return null
    return computeKenBurns(scene, exportIndex, kenBurnsOptions)
  }, [scene, exportIndex, kenBurnsOptions])
  const hasVideo = useMemo(() => resolveExportVideos(scene).length > 0, [scene])
  // 모니터 표시는 kenBurnsPreview(Timeline 체크박스)가 게이트하되, export 가 적용하지
  // 않는 효과를 보여주지 않도록 kenBurns(export 설정)도 함께 요구한다(WYSIWYG).
  const kenBurnsStyle = settings.kenBurnsPreview && settings.kenBurns
    && exportIndex != null && !hasVideo && kenBurns
    ? kenBurnsPreviewStyle(kenBurns, sceneProgress)
    : undefined

  const seededImageSize = scene?.upscaled_size || scene?.image_size
  const seededWidth = Number(seededImageSize?.width)
  const seededHeight = Number(seededImageSize?.height)
  const seededDims = Number.isFinite(seededWidth) && seededWidth > 0
    && Number.isFinite(seededHeight) && seededHeight > 0
    ? { width: seededWidth, height: seededHeight }
    : null
  const [loadedDims, setLoadedDims] = useState(null)
  const imageDims = loadedDims?.src === imageSrc ? loadedDims : seededDims
  const handleImageLoad = useCallback((event) => {
    const width = event.currentTarget.naturalWidth
    const height = event.currentTarget.naturalHeight
    if (width > 0 && height > 0) setLoadedDims({ src: imageSrc, width, height })
  }, [imageSrc])

  const imagePlacementStyle = useMemo(() => {
    const base = {
      position: 'absolute',
      maxWidth: 'none',
      objectPosition: 'center',
    }
    if (settings.scaleMode === 'fill') {
      return { ...base, inset: 0, width: '100%', height: '100%', objectFit: 'cover' }
    }
    if (settings.scaleMode === 'fit') {
      return { ...base, inset: 0, width: '100%', height: '100%', objectFit: 'contain' }
    }
    if (imageDims) {
      return {
        ...base,
        left: '50%',
        top: '50%',
        width: `${imageDims.width / spec.width * 100}%`,
        height: `${imageDims.height / spec.height * 100}%`,
        objectFit: 'fill',
        transform: 'translate(-50%, -50%)',
      }
    }
    // 자연 dims를 아직 모르는 첫 페인트만 cover로 임시 표시한다.
    return { ...base, inset: 0, width: '100%', height: '100%', objectFit: 'cover' }
  }, [settings.scaleMode, imageDims?.width, imageDims?.height, spec.width, spec.height])

  // ── 비디오 오버레이 ──
  // 모니터는 한 화면이라 비디오 1개만 재생 — 맨 위 "보이는" 트랙 우선(i2v → t2v).
  // i2v 트랙 View 를 끄면(hiddenRoles) t2v 가 재생된다(트랙 스택과 일치).
  const { videoPlacement, videoSource } = useMemo(() => {
    const range = getSceneTimeRangeMs(scene)
    if (!range) return { videoPlacement: null, videoSource: null }
    const i2v = isPreviewVideoVisible(scene, 'i2v', hiddenRoles) ? computeVideoClipPlacement(scene, range.startMs, range.endMs, 'i2v') : null
    const t2v = isPreviewVideoVisible(scene, 't2v', hiddenRoles) ? computeVideoClipPlacement(scene, range.startMs, range.endMs, 't2v') : null
    if (i2v && playheadMs >= i2v.videoIn && playheadMs < i2v.videoOut) return { videoPlacement: i2v, videoSource: 'i2v' }
    if (t2v && playheadMs >= t2v.videoIn && playheadMs < t2v.videoOut) return { videoPlacement: t2v, videoSource: 't2v' }
    return { videoPlacement: null, videoSource: null }
  }, [scene, hiddenRoles, playheadMs])

  // 트랙 View 토글 — 해당 role 이 hiddenRoles 에 있으면 프리뷰에서 끔.
  const hideImage = hiddenRoles.has('image')
  const hideSubtitle = hiddenRoles.has('subtitle')

  const isVideoActive = !!videoPlacement

  // 단일 <video> ref — src는 활성 placement가 바뀔 때만 swap, currentTime/play는 매 tick 동기화
  const videoRef = useRef(null)
  const currentSrcRef = useRef(null)

  // ── Prefetch lookahead ──
  // 전체 씬에서 비디오 placement를 한 번에 precompute (videoIn 기준 정렬).
  // playhead가 다음 활성까지 PREFETCH_LEAD_MS 안쪽 진입 시 hidden video에 src 설정.
  const videoPlacements = useMemo(() => {
    // 한 씬 안에서도 i2v·t2v 가 서로 다른 구간에 top-visible 일 수 있다(예: t2v 가 더 길어
    // 먼저 시작 → t2v 6-8s 재생 후 i2v 8-10s 재생). 그래서 source 별 진입점을 각각 후보로
    // 넣되, "실제 top-visible 인 진입"만 등록한다:
    //   - i2v(보이면): 활성 시 항상 최상단 → videoIn 등록.
    //   - t2v(보이면): i2v 가 없거나 t2v 가 i2v 보다 먼저 시작할 때만(그 전 구간에서 top-visible).
    const out = []
    for (const r of sceneRanges) {
      const i2v = isPreviewVideoVisible(r.scene, 'i2v', hiddenRoles) ? computeVideoClipPlacement(r.scene, r.startMs, r.endMs, 'i2v') : null
      const t2v = isPreviewVideoVisible(r.scene, 't2v', hiddenRoles) ? computeVideoClipPlacement(r.scene, r.startMs, r.endMs, 't2v') : null
      if (i2v) {
        out.push({ videoIn: i2v.videoIn, videoOut: i2v.videoOut, videoPath: i2v.videoPath, generatedAt: r.scene?.videoI2VGeneratedAt ?? r.scene?.generatedAt })
      }
      if (t2v && (!i2v || t2v.videoIn < i2v.videoIn)) {
        out.push({ videoIn: t2v.videoIn, videoOut: t2v.videoOut, videoPath: t2v.videoPath, generatedAt: r.scene?.videoT2VGeneratedAt ?? r.scene?.generatedAt })
      }
    }
    return out.sort((a, b) => a.videoIn - b.videoIn)
  }, [sceneRanges, hiddenRoles])

  // 다음 활성 예정 비디오 lookup — O(log N) binary search.
  // playhead보다 큰 첫 videoIn 찾고, 그 차이가 PREFETCH_LEAD_MS 이내면 prefetch 대상.
  const prefetchSrc = useMemo(() => {
    if (!videoPlacements.length) return null
    let lo = 0, hi = videoPlacements.length
    while (lo < hi) {
      const mid = (lo + hi) >>> 1
      if (videoPlacements[mid].videoIn <= playheadMs) lo = mid + 1
      else hi = mid
    }
    if (lo >= videoPlacements.length) return null
    const next = videoPlacements[lo]
    const delta = next.videoIn - playheadMs
    if (delta > PREFETCH_LEAD_MS) return null
    return resolveVideoSrc(null, next.videoPath, { version: next.generatedAt })
  }, [videoPlacements, playheadMs])

  const prefetchRef = useRef(null)
  const prefetchSrcRef = useRef(null)
  useEffect(() => {
    const el = prefetchRef.current
    if (!el) return
    // 타깃 없음 → src 해제 (메모리/네트워크 정리)
    if (!prefetchSrc) {
      if (prefetchSrcRef.current) {
        prefetchSrcRef.current = null
        try { el.removeAttribute('src'); el.load() } catch {}
      }
      return
    }
    // 이미 메인 비디오가 들고 있는 src거나 동일 prefetch target이면 no-op
    if (prefetchSrcRef.current === prefetchSrc) return
    if (currentSrcRef.current === prefetchSrc) return
    prefetchSrcRef.current = prefetchSrc
    el.src = prefetchSrc
    // preload="auto" + load() — 브라우저가 metadata + 초기 chunk fetch → OS 캐시 warm
    try { el.load() } catch {}
  }, [prefetchSrc])

  // 마스터 볼륨/뮤트 → 활성 <video> 오디오. 기본 muted=true(타임라인 인라인 등 다른 인스턴스는
  //   무음 유지 → 모니터 영상과 이중음 방지). 모니터만 실제 monitorMuted/monitorVolume 를 넘긴다.
  //   단일 영속 element 라 값은 src swap 후에도 유지된다. 아래 play effect "앞"에 선언 —
  //   같은 flush 에서 이 effect 가 먼저 돌아 play() 호출 전에 muted 가 확정된다(첫 프레임 소리 방지).
  useEffect(() => {
    const el = videoRef.current
    if (!el) return
    el.muted = monitorMuted
    el.volume = Math.max(0, Math.min(1, monitorVolume))
  }, [monitorMuted, monitorVolume, isVideoActive])

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
    const desiredSrc = resolveVideoSrc(null, videoPlacement.videoPath, { version: (videoSource === 't2v' ? scene?.videoT2VGeneratedAt : scene?.videoI2VGeneratedAt) ?? scene?.generatedAt })
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

    // 재생 중일 때만 play. 정지(스크럽/모니터 — playhead가 안 움직임)면 해당 프레임에서
    // pause — 플레이헤드가 비디오 위에 있다고 영상이 멋대로 재생되지 않도록.
    if (isPlaying) {
      if (el.paused) el.play().catch(() => { /* autoplay 정책 거부 시 silent */ })
    } else if (!el.paused) {
      try { el.pause() } catch {}
    }
  }, [isVideoActive, videoPlacement, playheadMs, isPlaying])

  return (
    <div className="atl-preview" style={{ height }}>
      <div ref={stageRef} className="atl-preview-stage">
        <div
          className="atl-preview-frame"
          style={frameStyle}
        >
          <div className="atl-preview-kb" style={kenBurnsStyle}>
            {imageSrc && !hideImage && (
              <img
                key={imageSrc}
                className="atl-preview-img"
                src={imageSrc}
                alt=""
                style={imagePlacementStyle}
                onLoad={handleImageLoad}
              />
            )}
          </div>
          {(!imageSrc || hideImage) && (
            <div className="atl-preview-empty">— 씬 없음 —</div>
          )}
          <video
            ref={videoRef}
            className="atl-preview-video"
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
          {subtitleText && !hideSubtitle && (
            <div className="atl-preview-subtitle">{subtitleText}</div>
          )}
        </div>
      </div>
      {/* Hidden prefetch — 다음 활성 비디오를 미리 OS 캐시에 warm. 화면 표시는 안 함. */}
      <video
        ref={prefetchRef}
        muted
        playsInline
        preload="auto"
        style={{ display: 'none', position: 'absolute', width: 1, height: 1, pointerEvents: 'none' }}
        aria-hidden="true"
      />
    </div>
  )
}
