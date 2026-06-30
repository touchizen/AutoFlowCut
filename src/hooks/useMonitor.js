import { useState, useEffect, useCallback } from 'react'
import { monitorRenderMode } from '../utils/monitorVisibility'
import { useMonitorOverlay } from './useMonitorOverlay'
import { useModalVisibility } from './useModalVisibility'

const WIDTH_KEY = 'autoflowcut_monitorWidth'

/**
 * useMonitor — 상단 프리뷰 모니터의 표시 상태/효과/핸들러를 한곳에 모은 훅.
 *
 * App.jsx 비대화 완화를 위해 모니터 관련 state(재생/플레이헤드/숨김롤/폭/오버레이/전체화면)와
 * 그 효과(폭 영속, 전체화면 Esc 해제, 표시불가 시 전체화면 해제, Flow 뷰 숨김, 모드 전환 시 리셋)를
 * 캡슐화한다. 렌더는 <PreviewMonitor> 가 담당.
 *
 * @param {{ mode: string|null, activeTab: string }} args
 */
export function useMonitor({ mode, activeTab }) {
  // 상단 모니터가 보여줄 시점(ms). 하단 타임라인 스크럽/재생이 갱신.
  const [monitorMs, setMonitorMs] = useState(0)
  // 하단 타임라인 재생 중 여부 — 모니터 비디오는 이때만 재생(정지 시 프레임만).
  const [monitorPlaying, setMonitorPlaying] = useState(false)
  // 타임라인 트랙 View 토글 → 모니터 프리뷰에도 반영.
  const [monitorHiddenRoles, setMonitorHiddenRoles] = useState(() => new Set())
  // Flow 모드 오버레이 open — 재생 시작 시 자동 open, '프리뷰' 라벨로 수동 토글. (API 는 항상 inline)
  const { open: monitorOverlayOpen, setOpen: setMonitorOverlayOpen } = useMonitorOverlay(monitorPlaying)

  // 프리뷰 폭 — 좌우 드래그 조절, localStorage 영속. null = 5:5 기본(CSS '50%').
  const [monitorWidth, setMonitorWidth] = useState(() => {
    const saved = parseInt(localStorage.getItem(WIDTH_KEY), 10)
    return Number.isFinite(saved) ? saved : null
  })
  useEffect(() => {
    if (!Number.isFinite(monitorWidth)) return // 5:5 기본(null)은 저장 안 함 — 창 크기에 반응
    try { localStorage.setItem(WIDTH_KEY, String(monitorWidth)) } catch {}
  }, [monitorWidth])
  const startMonitorResize = useCallback((e) => {
    e.preventDefault()
    const row = e.currentTarget.parentElement // .editor-row
    const rect = row.getBoundingClientRect()
    const leftEdge = rect.left // 모니터가 좌측(row-reverse) → 폭 = 마우스 - 좌측 edge
    const maxW = rect.width * 0.9 // 최대 90% (우측 패널 10% 확보)
    const onMove = (ev) => setMonitorWidth(Math.max(200, Math.min(maxW, ev.clientX - leftEdge)))
    const onUp = () => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }, [])
  // 더블클릭 → 5:5 기본(null). 저장 effect 가 null 을 건너뛰므로 stale px 직접 제거.
  const resetMonitorWidth = useCallback(() => {
    setMonitorWidth(null)
    try { localStorage.removeItem(WIDTH_KEY) } catch {}
  }, [])

  // 전체화면 — DOM Fullscreen API 대신 CSS maximize. requestFullscreen 은 macOS 네이티브 윈도우
  //   풀스크린을 유발해 복귀 시 Flow 뷰 복원이 race 됐다. CSS maximize + setModalVisible 토글은
  //   모달과 동일 경로라 복원이 결정적.
  const [monitorFullscreen, setMonitorFullscreen] = useState(false)
  const toggleMonitorFullscreen = useCallback(() => setMonitorFullscreen(f => !f), [])
  // Esc 로 해제. document(bubble)는 window 보다 먼저라 stopPropagation 으로 AudioTimeline 의
  //   window Esc(=정지)가 같이 발화하는 것을 막는다(전체화면 해제만).
  useEffect(() => {
    if (!monitorFullscreen) return
    const onKey = (e) => {
      if (e.key !== 'Escape') return
      e.stopPropagation()
      e.preventDefault()
      setMonitorFullscreen(false)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [monitorFullscreen])
  // 모니터 표시 불가(audio 탭 / flow 미오픈)면 전체화면 해제 — useModalVisibility 가 Flow 복원.
  useEffect(() => {
    if (monitorRenderMode({ mode, activeTab, overlayOpen: monitorOverlayOpen }) !== 'inline') {
      setMonitorFullscreen(false)
    }
  }, [mode, activeTab, monitorOverlayOpen])
  // 전체화면 동안 Flow WebContentsView(네이티브)를 0x0 으로 접어 모니터를 가리지 않게 — 모달과 동일.
  useModalVisibility(monitorFullscreen)
  // 모드 전환 시 오버레이 리셋 — API 재생이 켜둔 overlayOpen 이 Flow 로 새어 "Flow 기본 숨김"을 깨는 것 방지.
  useEffect(() => { setMonitorOverlayOpen(false) }, [mode, setMonitorOverlayOpen])

  const monitorMode = monitorRenderMode({ mode, activeTab, overlayOpen: monitorOverlayOpen })

  return {
    monitorMs, setMonitorMs,
    monitorPlaying, setMonitorPlaying,
    monitorHiddenRoles, setMonitorHiddenRoles,
    monitorWidth, startMonitorResize, resetMonitorWidth,
    monitorOverlayOpen, setMonitorOverlayOpen,
    monitorFullscreen, toggleMonitorFullscreen,
    monitorMode,
  }
}
