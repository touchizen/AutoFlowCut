/**
 * AudioTimeline — Remotion Studio 스타일 멀티트랙 타임라인
 *
 * 트랙: Image / 자막 / Narration / Voice (접기) / SFX (접기)
 * 인터랙션: 클릭 재생 / 스크럽 / 줌 / 가로 스크롤 / 그룹 펼치기
 */

import { useState, useRef, useEffect, useLayoutEffect, useCallback, useMemo } from 'react'
import { useAudioTimeline } from './useAudioTimeline'
import { useI18n } from '../../hooks/useI18n'
import { findSrtSegment } from '../../utils/audioTimeline'
import { parseTimeToSeconds } from '../../utils/parsers'
import { toast } from '../Toast'
import './AudioTimeline.css'

const LABEL_W = 140
const TRACK_H = 64
const SUB_TRACK_H = 36
const FILE_ROW_H = 22
const RULER_H = 32
const PX_PER_SEC_BASE = 40 // 100% 줌 기준
const ZOOM_MIN = 0.1
const ZOOM_MAX = 10
const PREVIEW_H_MIN = 80
const PREVIEW_H_MAX = 800
const PREVIEW_H_DEFAULT = 240
const PREVIEW_H_KEY = 'autoflowcut.audioTimeline.previewHeight'
const TRACK_H_MIN = 32
const TRACK_H_MAX = 240
const SUB_TRACK_H_MIN = 24
const SUB_TRACK_H_MAX = 120
const TRACK_HEIGHTS_KEY = 'autoflowcut.audioTimeline.trackHeights'

function formatTC(ms) {
  if (!isFinite(ms) || ms == null) return '0:00'
  const s = Math.floor(ms / 1000)
  const hh = Math.floor(s / 3600)
  const mm = Math.floor((s % 3600) / 60)
  const ss = s % 60
  const pad = (n) => String(n).padStart(2, '0')
  return hh > 0 ? `${hh}:${pad(mm)}:${pad(ss)}` : `${mm}:${pad(ss)}`
}

// 트랙 ID → i18n key 매핑 (sub-track은 user data라 매핑 X)
const TRACK_LABEL_KEYS = {
  image: 'audioTimeline.trackImage',
  subtitle: 'audioTimeline.trackSubtitle',
  narration: 'audioTimeline.trackNarration',
  voice: 'audioTimeline.trackVoice',
  sfx: 'audioTimeline.trackSfx',
}

export default function AudioTimeline({ audioPackage, scenes, srtEntries, onClipSelect, onSaveTimecodeOverride }) {
  const { t } = useI18n()
  const data = useAudioTimeline(audioPackage, scenes, srtEntries)
  const [zoom, setZoom] = useState(1)
  const [playheadMs, setPlayheadMs] = useState(0)
  const [expandedTracks, setExpandedTracks] = useState(new Set())
  const [expandedSubTracks, setExpandedSubTracks] = useState(new Set())
  const [previewHeight, setPreviewHeight] = useState(() => {
    try {
      const saved = parseInt(localStorage.getItem(PREVIEW_H_KEY), 10)
      if (Number.isFinite(saved) && saved >= PREVIEW_H_MIN && saved <= PREVIEW_H_MAX) return saved
    } catch {}
    return PREVIEW_H_DEFAULT
  })
  // 트랙별 사용자 지정 높이 (오버라이드, 미설정 시 기본값 사용)
  const [trackHeights, setTrackHeights] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(TRACK_HEIGHTS_KEY))
      if (saved && typeof saved === 'object') return saved
    } catch {}
    return {}
  })
  const persistTrackHeights = (next) => {
    try { localStorage.setItem(TRACK_HEIGHTS_KEY, JSON.stringify(next)) } catch {}
  }
  const getTrackHeight = (track) => {
    if (track.isFileItem) return FILE_ROW_H
    const override = trackHeights[track.id]
    if (override) return override
    return track.isSubTrack ? SUB_TRACK_H : TRACK_H
  }
  const startTrackResize = (e, track) => {
    if (e.button !== 0 || track.isFileItem) return
    e.preventDefault()
    e.stopPropagation()
    const startY = e.clientY
    const startH = getTrackHeight(track)
    const min = track.isSubTrack ? SUB_TRACK_H_MIN : TRACK_H_MIN
    const max = track.isSubTrack ? SUB_TRACK_H_MAX : TRACK_H_MAX
    document.body.style.cursor = 'row-resize'
    document.body.style.userSelect = 'none'
    let nextH = startH
    const onMove = (mv) => {
      nextH = Math.max(min, Math.min(max, startH + (mv.clientY - startY)))
      setTrackHeights(prev => ({ ...prev, [track.id]: nextH }))
    }
    const onUp = () => {
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      setTrackHeights(prev => {
        const next = { ...prev, [track.id]: nextH }
        persistTrackHeights(next)
        return next
      })
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }
  const resetTrackHeight = (track) => {
    setTrackHeights(prev => {
      const next = { ...prev }
      delete next[track.id]
      persistTrackHeights(next)
      return next
    })
  }
  // 헤더 버튼 툴팁 (label / desc / hotkey)
  const [btnTooltip, setBtnTooltip] = useState(null) // { x, y, label, desc, hotkey } | null
  const showBtnTooltip = (e, info) => {
    const r = e.currentTarget.getBoundingClientRect()
    setBtnTooltip({ x: r.left + r.width / 2, y: r.bottom + 6, ...info })
  }
  const hideBtnTooltip = () => setBtnTooltip(null)
  const [playingClipIds, setPlayingClipIds] = useState(new Set()) // 현재 재생 중인 클립 (단독 또는 글로벌)
  const [isGlobalPlaying, setIsGlobalPlaying] = useState(false)
  const [hoverScene, setHoverScene] = useState(null) // { x, y, scene }
  const audioInstancesRef = useRef(new Map()) // clipId -> Audio
  const scheduledTimersRef = useRef([]) // setTimeout IDs (글로벌 재생 시 미래 클립 예약)
  const scrollRef = useRef(null)
  const rafRef = useRef(null)
  const playStartTimeRef = useRef(0) // performance.now() 시점
  const playStartMsRef = useRef(0)   // 재생 시작 시 playhead 위치 (ms)
  const isGlobalPlayingRef = useRef(false)

  if (!data) return null

  const pxPerMs = (PX_PER_SEC_BASE * zoom) / 1000
  const totalWidth = Math.max(800, data.totalDurationMs * pxPerMs)

  // ── 줌 (playhead 위치를 앵커로 유지) ──
  // setter는 click 시점의 scroll 위치만 기록하고, 실제 scroll 보정은
  // useEffect에서 zoom commit 후 안전하게 처리
  const lastAppliedZoomRef = useRef(zoom)
  const playheadAnchorRef = useRef(null) // { screenX, visible } | null

  const setZoomClamped = useCallback((next) => {
    const clamped = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, next))
    if (clamped === zoom) return

    const scrollEl = scrollRef.current
    if (scrollEl) {
      const oldPxPerMs = (PX_PER_SEC_BASE * zoom) / 1000
      const playheadOldX = playheadMs * oldPxPerMs
      const screenX = playheadOldX - scrollEl.scrollLeft
      const visible = screenX >= 0 && screenX <= scrollEl.clientWidth
      playheadAnchorRef.current = { screenX, visible }
    }

    setZoom(clamped)
  }, [zoom, playheadMs])

  // useLayoutEffect: DOM commit 직후, paint 전에 sync로 실행 → totalWidth 새 값 보장
  // playheadMs는 deps에서 제외 (재생 중 매 프레임 실행되는 거 방지 → zoom 변경 시에만 실행)
  useLayoutEffect(() => {
    if (zoom === lastAppliedZoomRef.current) return
    lastAppliedZoomRef.current = zoom

    const scrollEl = scrollRef.current
    if (!scrollEl || !data) return

    const anchor = playheadAnchorRef.current
    const newPxPerMs = (PX_PER_SEC_BASE * zoom) / 1000
    const playheadNewX = playheadMs * newPxPerMs
    const cw = scrollEl.clientWidth
    const maxScroll = Math.max(0, scrollEl.scrollWidth - cw)

    let target
    if (!anchor) {
      target = playheadNewX - cw / 2
    } else {
      target = anchor.visible
        ? playheadNewX - anchor.screenX
        : playheadNewX - cw / 2
      playheadAnchorRef.current = null
    }

    // 새 totalWidth 기준으로 클램프 (playhead가 끝 근처면 보이도록 보장)
    scrollEl.scrollLeft = Math.max(0, Math.min(maxScroll, target))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zoom, data])

  // ── 휠 (Cmd/Ctrl+휠 = 줌, 일반 휠 = 가로 스크롤) ──
  const handleWheel = useCallback((e) => {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault()
      const delta = -e.deltaY * 0.002
      setZoomClamped(zoom * (1 + delta))
    } else if (Math.abs(e.deltaX) < Math.abs(e.deltaY)) {
      // 세로 휠 → 가로 스크롤
      e.preventDefault()
      if (scrollRef.current) scrollRef.current.scrollLeft += e.deltaY
    }
  }, [zoom, setZoomClamped])

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    el.addEventListener('wheel', handleWheel, { passive: false })
    return () => el.removeEventListener('wheel', handleWheel)
  }, [handleWheel])

  // ── 트랙 펼치기/접기 ──
  const toggleExpand = (trackId) => {
    setExpandedTracks(prev => {
      const next = new Set(prev)
      if (next.has(trackId)) next.delete(trackId); else next.add(trackId)
      return next
    })
  }

  // ── Preview ↔ Body 사이 splitter 드래그 ──
  const startSplitterDrag = (e) => {
    if (e.button !== 0) return
    e.preventDefault()
    const startY = e.clientY
    const startH = previewHeight
    document.body.style.cursor = 'row-resize'
    document.body.style.userSelect = 'none'

    const onMove = (mv) => {
      const dy = mv.clientY - startY
      const next = Math.max(PREVIEW_H_MIN, Math.min(PREVIEW_H_MAX, startH + dy))
      setPreviewHeight(next)
    }
    const onUp = () => {
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      // 최종 값 저장
      try { localStorage.setItem(PREVIEW_H_KEY, String(previewHeightRef.current)) } catch {}
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }
  const previewHeightRef = useRef(previewHeight)
  useEffect(() => { previewHeightRef.current = previewHeight }, [previewHeight])

  // pxPerMs를 ref로 — RAF tick / setTimeout 콜백이 stale closure로 옛 값 쓰는 거 방지
  const pxPerMsRef = useRef(pxPerMs)
  useEffect(() => { pxPerMsRef.current = pxPerMs }, [pxPerMs])

  // sub-track (캐릭터/카테고리) 파일 목록 펼치기/접기
  const toggleSubExpand = (subId) => {
    setExpandedSubTracks(prev => {
      const next = new Set(prev)
      if (next.has(subId)) next.delete(subId); else next.add(subId)
      return next
    })
  }

  // 파일 항목 클릭 → playhead 점프 + 화면 중앙으로 스크롤
  const jumpToClip = (clip) => {
    setPlayheadMs(clip.startMs)
    const scrollEl = scrollRef.current
    if (scrollEl && data) {
      const targetX = clip.startMs * pxPerMsRef.current
      scrollEl.scrollLeft = Math.max(0, targetX - scrollEl.clientWidth / 2)
    }
  }

  // ── 재생 ──
  const playableClips = useMemo(() => {
    if (!data) return []
    return data.tracks
      .flatMap(t => t.clips || [])
      .filter(c => c.audioPath)
      .sort((a, b) => a.startMs - b.startMs)
  }, [data])

  // 모든 audio 정지 + RAF/timer 정리
  const stopAll = () => {
    isGlobalPlayingRef.current = false
    setIsGlobalPlaying(false)
    for (const audio of audioInstancesRef.current.values()) {
      try { audio.pause() } catch {}
    }
    audioInstancesRef.current.clear()
    scheduledTimersRef.current.forEach(id => clearTimeout(id))
    scheduledTimersRef.current = []
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current)
      rafRef.current = null
    }
    setPlayingClipIds(new Set())
  }

  // 한 클립 시작 (offsetMs는 클립 시작 시점 기준 오프셋)
  const startClipAt = async (clip, offsetMs = 0) => {
    if (!clip?.audioPath) return
    try {
      const result = await window.electronAPI?.readFileAbsolute({ filePath: clip.audioPath })
      if (!result?.success) {
        console.error('[AudioTimeline] Failed to read audio file:', clip.audioPath, result?.error)
        return
      }
      const audio = new Audio(result.data)
      audio.onerror = (e) => console.error('[AudioTimeline] Audio error:', clip.audioPath, e)
      if (offsetMs > 0) audio.currentTime = offsetMs / 1000
      audioInstancesRef.current.set(clip.id, audio)
      setPlayingClipIds(prev => new Set(prev).add(clip.id))
      audio.onended = () => {
        audioInstancesRef.current.delete(clip.id)
        setPlayingClipIds(prev => {
          const n = new Set(prev); n.delete(clip.id); return n
        })
      }
      try {
        await audio.play()
      } catch (playErr) {
        console.error('[AudioTimeline] audio.play() rejected:', clip.audioPath, playErr)
      }
    } catch (err) {
      console.error('[AudioTimeline] startClipAt error:', err)
    }
  }

  // 글로벌 재생: playhead 위치부터 모든 트랙 동시 재생
  const playGlobal = () => {
    stopAll()
    isGlobalPlayingRef.current = true
    setIsGlobalPlaying(true)
    const startMs = playheadMs
    playStartTimeRef.current = performance.now()
    playStartMsRef.current = startMs

    for (const clip of playableClips) {
      if (clip.endMs <= startMs) continue
      if (clip.startMs <= startMs) {
        // 현재 진행 중인 클립 — 오프셋부터 재생
        startClipAt(clip, startMs - clip.startMs)
      } else {
        // 미래 클립 — 시작 시점에 setTimeout 예약
        const delay = clip.startMs - startMs
        const id = setTimeout(() => {
          if (isGlobalPlayingRef.current) startClipAt(clip, 0)
        }, delay)
        scheduledTimersRef.current.push(id)
      }
    }

    const tick = () => {
      if (!isGlobalPlayingRef.current) return
      const elapsed = performance.now() - playStartTimeRef.current
      const cur = playStartMsRef.current + elapsed
      setPlayheadMs(cur)

      if (cur >= data.totalDurationMs) { stopAll(); return }

      // 페이지-플립 스크롤: playhead가 우측 끝에 닿는 순간
      // 그 시점을 UI 좌측 시작점으로 옮김 (화면 밖으로 사라지지 않게)
      // pxPerMs는 ref로 읽어야 — 재생 중 줌 변경 시에도 새 값 반영
      const scrollEl = scrollRef.current
      if (scrollEl) {
        const playheadPx = cur * pxPerMsRef.current
        const viewportRight = scrollEl.scrollLeft + scrollEl.clientWidth
        if (playheadPx >= viewportRight) {
          scrollEl.scrollLeft = playheadPx
        }
      }

      rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)
  }

  const togglePlay = () => {
    if (isGlobalPlayingRef.current || audioInstancesRef.current.size > 0) {
      stopAll()
    } else {
      playGlobal()
    }
  }

  // ── 키보드 (스페이스 = 글로벌 재생/멈춤, Esc = 처음으로) ──
  // 리스너는 마운트 시 한 번만 붙임. togglePlay/stopAll은 매 렌더 새로 만들어지므로
  // ref로 최신 참조를 들고 있다가 핸들러에서 ref.current로 호출
  // (deps에 playheadMs를 넣으면 RAF로 매 프레임 add/remove → perf 낭비 + 키 입력 누락 가능)
  const togglePlayRef = useRef(togglePlay)
  const stopAllRef = useRef(stopAll)
  useEffect(() => { togglePlayRef.current = togglePlay; stopAllRef.current = stopAll })

  useEffect(() => {
    const onKey = (e) => {
      const tag = (e.target?.tagName || '').toLowerCase()
      if (tag === 'input' || tag === 'textarea' || e.target?.isContentEditable) return
      if (e.code === 'Space') {
        e.preventDefault()
        togglePlayRef.current?.()
      } else if (e.code === 'Escape') {
        stopAllRef.current?.()
        setPlayheadMs(0)
        if (scrollRef.current) scrollRef.current.scrollLeft = 0
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // 컴포넌트 unmount 시 audio 정리
  useEffect(() => () => stopAll(), [])

  // ── 스크럽 (Remotion 패턴: 타임라인 영역 전체 pointerdown + window pointermove) ──
  const isDraggingRef = useRef(false)

  const computeMsFromClientX = useCallback((clientX) => {
    const scrollEl = scrollRef.current
    if (!scrollEl) return 0
    const rect = scrollEl.getBoundingClientRect()
    const xInContent = (clientX - rect.left) + scrollEl.scrollLeft
    return Math.max(0, Math.min(data.totalDurationMs, xInContent / pxPerMs))
  }, [data?.totalDurationMs, pxPerMs])

  const startScrub = (e) => {
    if (e.button !== 0) return
    e.preventDefault()
    stopAll() // 스크럽 시 재생 중지
    isDraggingRef.current = true
    document.body.style.userSelect = 'none'
    setPlayheadMs(computeMsFromClientX(e.clientX))

    let lastClientX = e.clientX
    let edgeScrollId = null
    const EDGE = 40       // 가장자리 zone (px)
    const SCROLL_STEP = 12 // tick당 스크롤 양

    const stopEdgeScroll = () => {
      if (edgeScrollId) { clearInterval(edgeScrollId); edgeScrollId = null }
    }

    const ensureEdgeScroll = () => {
      const scrollEl = scrollRef.current
      if (!scrollEl) return
      const rect = scrollEl.getBoundingClientRect()
      const rightOver = lastClientX > rect.right - EDGE
      const leftOver = lastClientX < rect.left + EDGE

      if (!rightOver && !leftOver) {
        stopEdgeScroll()
        return
      }
      if (edgeScrollId) return

      edgeScrollId = setInterval(() => {
        if (!isDraggingRef.current) { stopEdgeScroll(); return }
        const dir = lastClientX > rect.right - EDGE ? 1 : (lastClientX < rect.left + EDGE ? -1 : 0)
        if (dir === 0) { stopEdgeScroll(); return }
        const before = scrollEl.scrollLeft
        scrollEl.scrollLeft += dir * SCROLL_STEP
        if (scrollEl.scrollLeft === before) { stopEdgeScroll(); return } // 한계 도달
        // 스크롤됐으니 같은 clientX여도 ms는 변함 → playhead 업데이트
        setPlayheadMs(computeMsFromClientX(lastClientX))
      }, 16)
    }

    const onMove = (mv) => {
      if (!isDraggingRef.current) return
      lastClientX = mv.clientX
      setPlayheadMs(computeMsFromClientX(mv.clientX))
      ensureEdgeScroll()
    }
    const onUp = () => {
      isDraggingRef.current = false
      stopEdgeScroll()
      document.body.style.userSelect = ''
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  const onClipClick = (clip) => {
    // 단독 재생은 모달이 담당 (auto-play). 여기선 playhead만 이동시키고 모달 띄움
    setPlayheadMs(clip.startMs)
    onClipSelect?.(clip)
  }

  // 클립 드래그 → timecode 보정 저장
  const onClipDrag = (clip, newStartMs) => {
    if (!clip.relPath) return
    onSaveTimecodeOverride?.(clip.relPath, newStartMs)
  }

  // ── 표시 트랙 리스트 ──
  // group(Voice/SFX) → sub-track(캐릭터/카테고리) → file item(개별 파일)
  // group/sub-track은 lane을 가지고, file item은 라벨 row만 (lane 없음)
  const visibleTracks = []
  for (const tt of data.tracks) {
    visibleTracks.push({ ...tt, isGroup: tt.expandable, isExpanded: expandedTracks.has(tt.id) })
    if (tt.expandable && expandedTracks.has(tt.id)) {
      for (const sub of tt.subTracks || []) {
        const subExpanded = expandedSubTracks.has(sub.id)
        const fileCount = sub.clips?.length || 0
        visibleTracks.push({
          ...sub,
          variant: tt.variant,
          isSubTrack: true,
          isSubGroup: fileCount > 0,
          isSubExpanded: subExpanded,
          fileCount,
          parentId: tt.id,
        })
        if (subExpanded) {
          // 시간순 정렬된 파일 목록
          const sorted = [...(sub.clips || [])].sort((a, b) => a.startMs - b.startMs)
          for (const clip of sorted) {
            visibleTracks.push({
              id: `file-${clip.id}`,
              isFileItem: true,
              clip,
              color: sub.color,
            })
          }
        }
      }
    }
  }

  return (
    <div className="atl-root">
      {/* 비디오 프리뷰 (현재 playhead 위치의 씬 이미지 + 자막) */}
      <PreviewPanel
        playheadMs={playheadMs}
        scenes={scenes}
        srtEntries={srtEntries}
        height={previewHeight}
      />

      {/* Preview ↔ Timeline 사이 splitter (드래그=조절 / 더블클릭=기본값 복귀) */}
      <div
        className="atl-splitter"
        onPointerDown={startSplitterDrag}
        onDoubleClick={() => {
          setPreviewHeight(PREVIEW_H_DEFAULT)
          try { localStorage.setItem(PREVIEW_H_KEY, String(PREVIEW_H_DEFAULT)) } catch {}
        }}
        title="드래그=높이 조절 · 더블클릭=기본값"
      >
        <div className="atl-splitter-grip" />
      </div>

      {/* Header */}
      <div className="atl-header">
        <div className="atl-title">{t('audioTimeline.title') || 'Audio Timeline'}</div>
        <div className="atl-transport">
          <button
            className={`atl-play-btn${isGlobalPlaying ? ' atl-playing' : ''}`}
            onClick={togglePlay}
            onMouseEnter={(e) => showBtnTooltip(e, {
              label: isGlobalPlaying ? t('audioTimeline.pauseLabel') : t('audioTimeline.playLabel'),
              desc: isGlobalPlaying ? t('audioTimeline.pauseDesc') : t('audioTimeline.playDesc'),
              hotkey: 'Space',
            })}
            onMouseLeave={hideBtnTooltip}
          >
            {isGlobalPlaying ? '⏸' : '▶'}
          </button>
          <button
            className="atl-stop-btn"
            onClick={() => { stopAll(); setPlayheadMs(0); if (scrollRef.current) scrollRef.current.scrollLeft = 0 }}
            onMouseEnter={(e) => showBtnTooltip(e, {
              label: t('audioTimeline.stopLabel'),
              desc: t('audioTimeline.stopDesc'),
              hotkey: 'Esc',
            })}
            onMouseLeave={hideBtnTooltip}
          >
            ⏹
          </button>
          <span className="atl-time-display">
            <span className="atl-time-cur">{formatTC(playheadMs)}</span>
            <span className="atl-time-sep"> / </span>
            <span className="atl-time-total">{formatTC(data.totalDurationMs)}</span>
          </span>
          <label
            className="atl-kb-toggle"
            onClick={(e) => {
              // 실제 토글 X — 클릭만 받아서 안내 토스트 표시
              e.preventDefault()
              toast.info(t('audioTimeline.kenBurnsToast'))
            }}
            onMouseEnter={(e) => showBtnTooltip(e, {
              label: t('audioTimeline.kenBurnsLabel'),
              desc: t('audioTimeline.kenBurnsDesc'),
            })}
            onMouseLeave={hideBtnTooltip}
          >
            <input type="checkbox" checked={false} readOnly tabIndex={-1} />
            <span>{t('audioTimeline.kenBurns')}</span>
          </label>
        </div>
        <div className="atl-zoom">
          <button
            onClick={() => setZoomClamped(zoom / 1.4)}
            onMouseEnter={(e) => showBtnTooltip(e, {
              label: t('audioTimeline.zoomOutLabel'),
              desc: t('audioTimeline.zoomOutDesc'),
              hotkey: t('audioTimeline.zoomWheelHint'),
            })}
            onMouseLeave={hideBtnTooltip}
          >−</button>
          <span className="atl-zoom-val">{Math.round(zoom * 100)}%</span>
          <button
            onClick={() => setZoomClamped(zoom * 1.4)}
            onMouseEnter={(e) => showBtnTooltip(e, {
              label: t('audioTimeline.zoomInLabel'),
              desc: t('audioTimeline.zoomInDesc'),
              hotkey: t('audioTimeline.zoomWheelHint'),
            })}
            onMouseLeave={hideBtnTooltip}
          >+</button>
          <button
            className="atl-zoom-fit"
            onClick={() => setZoom(1)}
            onMouseEnter={(e) => showBtnTooltip(e, {
              label: t('audioTimeline.zoomResetLabel'),
              desc: t('audioTimeline.zoomResetDesc'),
            })}
            onMouseLeave={hideBtnTooltip}
          >⊡</button>
        </div>
      </div>

      {/* Body — 좌측 라벨 (sticky) + 우측 lane (가로 스크롤) */}
      <div className="atl-body">
        <div className="atl-labels-col" style={{ width: LABEL_W }}>
          <div className="atl-label-spacer" style={{ height: RULER_H }} />
          {visibleTracks.map((track, i) => {
            // 파일 항목 row (라벨만, lane 없음)
            if (track.isFileItem) {
              return (
                <div
                  key={`${track.id}-${i}`}
                  className="atl-label atl-label-file"
                  style={{ color: track.color, height: FILE_ROW_H }}
                  onClick={() => jumpToClip(track.clip)}
                  title={track.clip.filename}
                >
                  <span className="atl-file-tc">{formatTC(track.clip.startMs)}</span>
                  <span className="atl-file-name">{track.clip.filename}</span>
                </div>
              )
            }
            // 일반 트랙/sub-track 라벨
            const clickable = track.isGroup || track.isSubGroup
            const onClick = () => {
              if (track.isGroup) toggleExpand(track.id)
              else if (track.isSubGroup) toggleSubExpand(track.id)
            }
            return (
              <div
                key={`${track.id}-${i}`}
                className={`atl-label ${track.isSubTrack ? 'atl-label-sub' : ''}${clickable ? ' atl-label-clickable' : ''}`}
                style={{
                  color: track.color,
                  height: getTrackHeight(track),
                }}
                onClick={onClick}
              >
                {track.isGroup && <span className="atl-expand">{track.isExpanded ? '▼' : '▶'}</span>}
                {track.isSubTrack && !track.isSubGroup && <span className="atl-sub-marker">└</span>}
                {track.isSubTrack && track.isSubGroup && (
                  <span className="atl-expand atl-expand-sub">{track.isSubExpanded ? '▼' : '▶'}</span>
                )}
                <span className="atl-label-name">
                  {track.isSubTrack
                    ? track.name
                    : (TRACK_LABEL_KEYS[track.id] ? (t(TRACK_LABEL_KEYS[track.id]) || track.name) : track.name)}
                </span>
                {track.isSubGroup && (
                  <span className="atl-file-count">{track.fileCount}</span>
                )}
                {/* 트랙 높이 조절 핸들 (드래그=조절, 더블클릭=기본값 복귀) */}
                <div
                  className="atl-track-resize"
                  onPointerDown={(e) => startTrackResize(e, track)}
                  onDoubleClick={(e) => { e.stopPropagation(); resetTrackHeight(track) }}
                  onClick={(e) => e.stopPropagation()}
                  title="드래그=높이 조절 · 더블클릭=기본값"
                />
              </div>
            )
          })}
        </div>

        <div className="atl-scroll" ref={scrollRef} onPointerDown={startScrub}>
          <TimeRuler totalMs={data.totalDurationMs} pxPerMs={pxPerMs} width={totalWidth} />
          <div className="atl-tracks" style={{ width: totalWidth }}>
            {visibleTracks.map((track, i) => {
              // 파일 항목은 lane 없이 작은 빈 row (vertical 정렬)
              if (track.isFileItem) {
                return (
                  <div
                    key={`${track.id}-${i}`}
                    className="atl-lane atl-lane-file"
                    style={{ width: totalWidth, height: FILE_ROW_H }}
                  />
                )
              }
              // 그룹이 펼쳐진 상태면 group lane엔 클립 안 그림 (sub-track에만 표시)
              const renderClips = !(track.isGroup && track.isExpanded)
              return (
                <TrackLane
                  key={`${track.id}-${i}`}
                  track={track}
                  width={totalWidth}
                  height={getTrackHeight(track)}
                  pxPerMs={pxPerMs}
                  renderClips={renderClips}
                  onClipClick={onClipClick}
                  onClipDrag={onClipDrag}
                  totalDurationMs={data.totalDurationMs}
                  playingClipIds={playingClipIds}
                  onSceneHover={setHoverScene}
                />
              )
            })}
          </div>
          <Playhead positionPx={playheadMs * pxPerMs} totalHeight={visibleTracks.length} />
        </div>
      </div>

      {/* 헤더 버튼 hover 툴팁 (label + desc + hotkey) */}
      {btnTooltip && (
        <div
          className="atl-btn-tooltip"
          style={{ left: btnTooltip.x, top: btnTooltip.y }}
        >
          <div className="atl-btn-tooltip-label">{btnTooltip.label}</div>
          {btnTooltip.desc && <div className="atl-btn-tooltip-desc">{btnTooltip.desc}</div>}
          {btnTooltip.hotkey && (
            <div className="atl-btn-tooltip-hotkey">
              {t('audioTimeline.hotkey')}: <kbd>{btnTooltip.hotkey}</kbd>
            </div>
          )}
        </div>
      )}

      {/* 씬 hover 툴팁 */}
      {hoverScene && (() => {
        const imgPath = hoverScene.scene.imagePath || hoverScene.scene.image_path || hoverScene.scene.filePath
        return (
          <div className="atl-tooltip" style={{ left: hoverScene.x + 12, top: hoverScene.y - 8 }}>
            {imgPath && <img src={`file://${imgPath}`} alt="" />}
            {hoverScene.scene.subtitle && <div className="atl-tooltip-sub">{hoverScene.scene.subtitle}</div>}
          </div>
        )
      })()}
    </div>
  )
}

// ── TimeRuler ──
function TimeRuler({ totalMs, pxPerMs, width }) {
  // 줌에 따라 major tick 간격 자동 결정
  const pxPerSec = pxPerMs * 1000
  let majorSec = 60
  if (pxPerSec > 200) majorSec = 1
  else if (pxPerSec > 80) majorSec = 5
  else if (pxPerSec > 30) majorSec = 10
  else if (pxPerSec > 10) majorSec = 30
  else majorSec = 60

  const totalSec = totalMs / 1000
  const ticks = []
  for (let s = 0; s <= totalSec; s += majorSec) {
    ticks.push({ sec: s, x: s * 1000 * pxPerMs })
  }

  return (
    <div className="atl-ruler" style={{ width, height: RULER_H }}>
      {ticks.map(t => (
        <div key={t.sec} className="atl-ruler-tick" style={{ left: t.x }}>
          <div className="atl-ruler-line" />
          <div className="atl-ruler-label">{formatTC(t.sec * 1000)}</div>
        </div>
      ))}
    </div>
  )
}

// ── TrackLane ──
function TrackLane({ track, width, height, pxPerMs, renderClips = true, onClipClick, onClipDrag, totalDurationMs, playingClipIds, onSceneHover }) {
  const h = height ?? (track.isSubTrack ? SUB_TRACK_H : TRACK_H)
  return (
    <div className="atl-lane" style={{ height: h, width }}>
      {renderClips && (track.clips || []).map(clip => (
        <Clip
          key={clip.id}
          clip={clip}
          variant={track.variant}
          pxPerMs={pxPerMs}
          height={h}
          onClickClip={onClipClick}
          onDragClip={onClipDrag}
          totalDurationMs={totalDurationMs}
          isPlaying={playingClipIds?.has(clip.id)}
          onSceneHover={onSceneHover}
        />
      ))}
    </div>
  )
}

// ── Clip (click vs drag 자동 구분, draggable이면 드래그로 timecode 보정) ──
function Clip({ clip, variant, pxPerMs, height, onClickClip, onDragClip, totalDurationMs, isPlaying, onSceneHover }) {
  const [dragOffsetMs, setDragOffsetMs] = useState(null)
  const isDragging = dragOffsetMs !== null

  const visualStartMs = clip.startMs + (dragOffsetMs || 0)
  const left = visualStartMs * pxPerMs
  const width = Math.max(2, (clip.endMs - clip.startMs) * pxPerMs)
  const style = {
    left,
    width,
    top: 4,
    bottom: 4,
    background: variant === 'text'
      ? `${clip.color}26`
      : `linear-gradient(180deg, ${clip.color}, ${clip.color}88)`,
    border: variant === 'text' ? `1px solid ${clip.color}` : `1px solid ${clip.color}AA`,
    cursor: clip.draggable ? (isDragging ? 'grabbing' : 'grab') : 'pointer',
    opacity: isDragging ? 0.7 : 1,
    zIndex: isDragging ? 10 : undefined,
  }

  const onMouseEnter = (e) => {
    if (clip.sceneRef && variant === 'block') {
      onSceneHover?.({ x: e.clientX, y: e.clientY, scene: clip.sceneRef })
    }
  }
  const onMouseLeave = () => onSceneHover?.(null)

  const onPointerDown = (e) => {
    if (e.button !== 0) return
    e.stopPropagation() // 스크럽 트리거 차단
    const startX = e.clientX
    let lastDx = 0
    let didDrag = false

    const onMove = (mv) => {
      const dx = mv.clientX - startX
      lastDx = dx
      if (Math.abs(dx) > 4) {
        didDrag = true
        if (clip.draggable) {
          // 좌측 0 이하로 못 가게 클램프
          const newStart = Math.max(0, Math.min((totalDurationMs || Infinity), clip.startMs + dx / pxPerMs))
          setDragOffsetMs(newStart - clip.startMs)
        }
      }
    }
    const onUp = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      if (didDrag && clip.draggable) {
        const newStart = Math.max(0, Math.min((totalDurationMs || Infinity), clip.startMs + lastDx / pxPerMs))
        onDragClip?.(clip, newStart)
        setDragOffsetMs(null)
      } else {
        // 클릭으로 처리
        setDragOffsetMs(null)
        onClickClip?.(clip)
      }
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  return (
    <div
      className={`atl-clip atl-clip-${variant}${isPlaying ? ' atl-clip-playing' : ''}${isDragging ? ' atl-clip-dragging' : ''}`}
      style={style}
      onPointerDown={onPointerDown}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      title={clip.filename || clip.label || ''}
    >
      {variant === 'block' && clip.imagePath && (
        <img className="atl-clip-img" src={`file://${clip.imagePath}`} alt="" />
      )}
      {variant === 'text' && (
        <span className="atl-clip-text" style={{ color: clip.color }}>{clip.label}</span>
      )}
      {variant === 'audio' && width > 30 && (
        <Waveform color="#fff" />
      )}
    </div>
  )
}

// ── Waveform (합성, Phase 1) ──
function Waveform({ color }) {
  const bars = useMemo(() => Array.from({ length: 32 }, (_, i) => {
    const h = 35 + Math.sin(i * 0.55) * 22 + Math.cos(i * 1.3) * 10 + Math.sin(i * 0.27) * 8
    return Math.max(18, Math.min(95, h))
  }), [])
  return (
    <div className="atl-waveform">
      {bars.map((h, i) => (
        <div key={i} style={{ height: `${h}%`, backgroundColor: color, opacity: 0.7 }} />
      ))}
    </div>
  )
}

// ── PreviewPanel — 현재 playhead 위치의 씬 이미지 + 자막 ──
function PreviewPanel({ playheadMs, scenes, srtEntries, height = 240 }) {
  // 시간 기준 씬 매칭 (camelCase / snake_case 둘 다 지원)
  const scene = useMemo(() => {
    if (!scenes?.length) return null
    const timeSec = playheadMs / 1000
    return scenes.find(s => {
      const startRaw = s.startTime ?? s.start_time
      const endRaw = s.endTime ?? s.end_time
      const start = typeof startRaw === 'number' ? startRaw : parseTimeToSeconds(startRaw)
      const end = typeof endRaw === 'number' ? endRaw : parseTimeToSeconds(endRaw)
      if (isNaN(start) || isNaN(end)) return false
      return timeSec >= start && timeSec < end
    }) || null
  }, [scenes, playheadMs])

  // SRT 자막 — 정확히 그 시점에 표시되는 것만
  const srt = useMemo(() => {
    if (!srtEntries?.length) return null
    return srtEntries.find(e => playheadMs >= e.startMs && playheadMs <= e.endMs) || null
  }, [srtEntries, playheadMs])

  const imgPath = scene?.imagePath || scene?.image_path || scene?.filePath
  const subtitleText = srt?.text || ''

  return (
    <div className="atl-preview" style={{ height }}>
      <div className="atl-preview-stage">
        {imgPath ? (
          <img className="atl-preview-img" src={`file://${imgPath}`} alt="" />
        ) : (
          <div className="atl-preview-empty">— 씬 없음 —</div>
        )}
        {subtitleText && (
          <div className="atl-preview-subtitle">{subtitleText}</div>
        )}
      </div>
    </div>
  )
}

// ── Playhead ──
function Playhead({ positionPx, totalHeight }) {
  return (
    <div
      className="atl-playhead"
      style={{
        left: positionPx,
        top: 0,
        bottom: 0,
      }}
    >
      <div className="atl-playhead-handle" />
      <div className="atl-playhead-line" />
    </div>
  )
}
