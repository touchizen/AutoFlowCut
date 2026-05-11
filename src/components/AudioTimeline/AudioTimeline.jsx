/**
 * AudioTimeline — Remotion Studio 스타일 멀티트랙 타임라인
 *
 * 트랙: Image / 자막 / Narration / Voice (접기) / SFX (접기)
 * 인터랙션: 클릭 재생 / 스크럽 / 줌 / 가로 스크롤 / 그룹 펼치기
 */

import { useState, useRef, useEffect, useLayoutEffect, useCallback, useMemo } from 'react'
import { useAudioTimeline } from './useAudioTimeline'
import { useI18n } from '../../hooks/useI18n'
import { formatDuration } from '../../utils/formatters'
import { toast } from '../Toast'
import TimeRuler from './TimeRuler'
import TrackLane from './TrackLane'
import TimelineFlagButton from './TimelineFlagButton'
import PreviewPanel from './PreviewPanel'
import Playhead from './Playhead'
import {
  LABEL_W_DEFAULT, LABEL_W_MIN, LABEL_W_MAX, LABEL_W_KEY,
  TRACK_H, SUB_TRACK_H, FILE_ROW_H, RULER_H,
  PX_PER_SEC_BASE, ZOOM_MIN, ZOOM_MAX,
  PREVIEW_H_MIN, PREVIEW_H_MAX, PREVIEW_H_DEFAULT, PREVIEW_H_KEY,
  TRACK_H_MIN, TRACK_H_MAX, SUB_TRACK_H_MIN, SUB_TRACK_H_MAX, TRACK_HEIGHTS_KEY,
  TRACK_LABEL_KEYS,
} from './constants'
import './AudioTimeline.css'

// utils/formatters의 formatDuration(seconds)와 표시 규칙이 동일.
// 여기선 ms-friendly + 비유한값 가드를 추가한 thin wrapper로 둠 (시간 포맷 단일 출처 유지).
function formatTC(ms) {
  if (!isFinite(ms) || ms == null) return '0:00'
  return formatDuration(ms / 1000)
}

export default function AudioTimeline({ audioPackage, scenes, srtEntries, onClipSelect, onSaveTimecodeOverride, disabled = false, onFlag, isFlagged }) {
  const { t } = useI18n()
  const data = useAudioTimeline(audioPackage, scenes, srtEntries)
  const [zoom, setZoom] = useState(1)
  const [playheadMs, setPlayheadMs] = useState(0)
  const [expandedTracks, setExpandedTracks] = useState(new Set())
  const [expandedSubTracks, setExpandedSubTracks] = useState(new Set())
  const [labelW, setLabelW] = useState(() => {
    try {
      const saved = parseInt(localStorage.getItem(LABEL_W_KEY), 10)
      if (Number.isFinite(saved) && saved >= LABEL_W_MIN && saved <= LABEL_W_MAX) return saved
    } catch {}
    return LABEL_W_DEFAULT
  })
  const [labelsScrollY, setLabelsScrollY] = useState(0)
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
    // 이전 드래그가 살아있다면 먼저 정리 (cursor reset이 아래 cursor 세팅을 덮지 않도록 순서 중요)
    activeDragCleanupRef.current?.()
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
    const cleanup = () => {
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      activeDragCleanupRef.current = null
    }
    const onUp = () => {
      cleanup()
      setTrackHeights(prev => {
        const next = { ...prev, [track.id]: nextH }
        persistTrackHeights(next)
        return next
      })
    }
    activeDragCleanupRef.current = cleanup
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
  // 활성 드래그 cleanup. pointerup 정상 종료 시 / 컴포넌트 unmount 시 모두 호출됨 (idempotent).
  // 드래그 중 프로젝트 전환 등으로 onUp이 안 와도 listener/cursor 잔류 방지.
  const activeDragCleanupRef = useRef(null)

  const pxPerMs = (PX_PER_SEC_BASE * zoom) / 1000

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
    // data를 deps에 둬야 — null → 데이터 복귀 시 .atl-scroll DOM이 새로 마운트되므로 리스너 재등록 필요
  }, [handleWheel, data])

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
    activeDragCleanupRef.current?.()
    const startY = e.clientY
    const startH = previewHeight
    document.body.style.cursor = 'row-resize'
    document.body.style.userSelect = 'none'

    const onMove = (mv) => {
      const dy = mv.clientY - startY
      const next = Math.max(PREVIEW_H_MIN, Math.min(PREVIEW_H_MAX, startH + dy))
      setPreviewHeight(next)
    }
    const cleanup = () => {
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      activeDragCleanupRef.current = null
    }
    const onUp = () => {
      cleanup()
      // 최종 값 저장
      try { localStorage.setItem(PREVIEW_H_KEY, String(previewHeightRef.current)) } catch {}
    }
    activeDragCleanupRef.current = cleanup
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }
  const previewHeightRef = useRef(previewHeight)
  useEffect(() => { previewHeightRef.current = previewHeight }, [previewHeight])

  // ── 좌측 라벨 컬럼 폭 조절 (drag) ──
  const labelWRef = useRef(labelW)
  useEffect(() => { labelWRef.current = labelW }, [labelW])
  const startColResize = (e) => {
    if (e.button !== 0) return
    e.preventDefault()
    activeDragCleanupRef.current?.()
    const startX = e.clientX
    const startW = labelW
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
    const onMove = (mv) => {
      const dx = mv.clientX - startX
      const next = Math.max(LABEL_W_MIN, Math.min(LABEL_W_MAX, startW + dx))
      setLabelW(next)
    }
    const cleanup = () => {
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      activeDragCleanupRef.current = null
    }
    const onUp = () => {
      cleanup()
      try { localStorage.setItem(LABEL_W_KEY, String(labelWRef.current)) } catch {}
    }
    activeDragCleanupRef.current = cleanup
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }
  const resetLabelW = () => {
    setLabelW(LABEL_W_DEFAULT)
    try { localStorage.setItem(LABEL_W_KEY, String(LABEL_W_DEFAULT)) } catch {}
  }
  // 좌측 라벨 col에서 휠 → 우측 메인 스크롤로 위임 (세로만, Cmd/Ctrl+휠은 우측에서 줌 처리하므로 제외)
  const onLabelsWheel = (e) => {
    if (e.ctrlKey || e.metaKey) return
    if (scrollRef.current) {
      scrollRef.current.scrollTop += e.deltaY
    }
  }
  // 우측 메인 스크롤 → 좌측 라벨 transform translateY로 sync
  const onMainScroll = () => {
    if (scrollRef.current) {
      setLabelsScrollY(scrollRef.current.scrollTop)
    }
  }

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
    if (!data) return
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
    if (!data || disabled) return
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
  // disabled를 ref로 들고 핸들러에서 매번 검사 — keydown effect는 마운트 1회 등록이라 prop 변경 시 재생성 안 됨.
  const disabledRef = useRef(disabled)
  useEffect(() => {
    togglePlayRef.current = togglePlay
    stopAllRef.current = stopAll
    disabledRef.current = disabled
  })

  useEffect(() => {
    const onKey = (e) => {
      // disabled (loading/refresh overlay 중) — 단축키도 막아야 deferred timeline에 의도치 않은 재생/정지가 안 일어남
      if (disabledRef.current) return
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

  // 컴포넌트 unmount 시 audio + 활성 드래그 정리
  // 드래그 중 unmount되면 onUp이 안 와서 listener/cursor 잔류 → 여기서 cleanup 강제 실행
  useEffect(() => () => {
    stopAll()
    activeDragCleanupRef.current?.()
    activeDragCleanupRef.current = null
  }, [])

  // disabled로 전환되는 순간 — 진행 중이던 audio/RAF/scheduled timer 정리.
  // 키보드/버튼 차단만으론 이미 시작된 재생이 overlay 아래에서 계속 흐름.
  // ref로 호출해야 stopAll의 최신 클로저 잡음 (deps에 stopAll 넣으면 매 렌더 effect 재실행).
  useEffect(() => {
    if (disabled) stopAllRef.current?.()
  }, [disabled])

  // ── 스크럽 (Remotion 패턴: 타임라인 영역 전체 pointerdown + window pointermove) ──
  const isDraggingRef = useRef(false)

  const computeMsFromClientX = useCallback((clientX) => {
    const scrollEl = scrollRef.current
    if (!scrollEl) return 0
    const rect = scrollEl.getBoundingClientRect()
    const xInContent = (clientX - rect.left) + scrollEl.scrollLeft
    return Math.max(0, Math.min(data.totalDurationMs, xInContent / pxPerMs))
  }, [data?.totalDurationMs, pxPerMs])

  if (!data) return null
  const totalWidth = Math.max(800, data.totalDurationMs * pxPerMs)

  const startScrub = (e) => {
    if (e.button !== 0) return
    // 스크롤바 클릭은 무시 — 안 그러면 playhead가 스크롤바 위치(우측 끝/하단)로 점프해서 사라짐
    // clientWidth/clientHeight는 스크롤바를 제외한 영역, rect는 포함이라 차이로 감지
    const scrollEl = scrollRef.current
    if (scrollEl) {
      const rect = scrollEl.getBoundingClientRect()
      if (e.clientX > rect.left + scrollEl.clientWidth) return  // 세로 스크롤바
      if (e.clientY > rect.top + scrollEl.clientHeight) return  // 가로 스크롤바
    }
    e.preventDefault()
    stopAll() // 스크럽 시 재생 중지
    activeDragCleanupRef.current?.()
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
    const cleanup = () => {
      isDraggingRef.current = false
      stopEdgeScroll()
      document.body.style.userSelect = ''
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      activeDragCleanupRef.current = null
    }
    const onUp = () => { cleanup() }
    activeDragCleanupRef.current = cleanup
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
            disabled={disabled}
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
            onClick={() => { if (disabled) return; stopAll(); setPlayheadMs(0); if (scrollRef.current) scrollRef.current.scrollLeft = 0 }}
            disabled={disabled}
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
        <div
          className="atl-labels-col"
          style={{ width: labelW }}
          onWheel={onLabelsWheel}
        >
          <div className="atl-label-spacer" style={{ height: RULER_H }} />
          <div
            className="atl-labels-scroll"
            style={{ transform: `translateY(${-labelsScrollY}px)` }}
          >
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
        </div>

        {/* 좌측 라벨 ↔ 타임라인 splitter (드래그=폭 조절 / 더블클릭=기본값) */}
        <div
          className="atl-col-splitter"
          onPointerDown={startColResize}
          onDoubleClick={resetLabelW}
          title="드래그=폭 조절 · 더블클릭=기본값"
        />

        <div className="atl-scroll" ref={scrollRef} onPointerDown={startScrub} onScroll={onMainScroll}>
          {/* wrapper: Playhead의 containing block을 viewport가 아닌 content 전체 높이로 만듦
              (이게 없으면 세로 스크롤 시 playhead가 viewport 밖 영역까지 못 닿음) */}
          <div className="atl-content" style={{ width: totalWidth }}>
          <TimeRuler totalMs={data.totalDurationMs} pxPerMs={pxPerMs} width={totalWidth} />
          <div className="atl-tracks" style={{ width: totalWidth }}>
            {visibleTracks.map((track, i) => {
              // 파일 항목은 lane 없이 작은 빈 row (vertical 정렬)
              if (track.isFileItem) {
                // sub-track 펼친 상태에서 file row의 lane은 비어있어 시간 위치 컨텍스트가 사라짐.
                // 컬러바 mini-clip을 표시해서 각 row가 자기 위치를 self-explain하게 함.
                const clip = track.clip
                const left = clip.startMs * pxPerMs
                const width = Math.max(2, (clip.endMs - clip.startMs) * pxPerMs)
                const fileFlagged = !!(isFlagged && clip.audioPath && isFlagged(clip.audioPath))
                const showFlagBtn = !!clip.audioPath && !!onFlag
                return (
                  <div
                    key={`${track.id}-${i}`}
                    className="atl-lane atl-lane-file"
                    style={{ width: totalWidth, height: FILE_ROW_H }}
                  >
                    <div
                      className={`atl-file-mini-clip${fileFlagged ? ' atl-clip-flagged' : ''}`}
                      style={{ left, width, backgroundColor: track.color }}
                      onPointerDown={(e) => {
                        if (e.button !== 0) return
                        e.stopPropagation() // 스크럽 트리거 차단
                        jumpToClip(clip)
                        if (clip.audioPath) onClipSelect?.(clip)
                      }}
                      title={clip.filename}
                    >
                      {fileFlagged && (
                        <span className="atl-clip-flag-indicator" aria-label="flagged">⚠️</span>
                      )}
                      {showFlagBtn && (
                        <TimelineFlagButton
                          audioPath={clip.audioPath}
                          filename={clip.filename}
                          flagged={fileFlagged}
                          narrow={width < 40}
                          onFlag={onFlag}
                        />
                      )}
                    </div>
                  </div>
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
                  onFlag={onFlag}
                  isFlagged={isFlagged}
                />
              )
            })}
          </div>
          <Playhead positionPx={playheadMs * pxPerMs} totalHeight={visibleTracks.length} />
          </div>
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
