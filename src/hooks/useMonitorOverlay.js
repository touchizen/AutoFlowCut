import { useState, useEffect } from 'react'

/**
 * Flow 모드 프리뷰 모니터 오버레이의 open 상태.
 *   - 기본 닫힘.
 *   - 재생이 시작되면(isPlaying false→true) 자동으로 연다.
 *   - '프리뷰' 라벨 버튼으로 수동 토글(setOpen) 가능.
 *   - 재생이 멈춰도 자동으로 닫지 않는다(사용자가 라벨로 닫음).
 *
 * @param {boolean} isPlaying  타임라인 재생 중 여부(monitorPlaying)
 * @returns {{ open: boolean, setOpen: (v: boolean | ((p:boolean)=>boolean)) => void }}
 */
export function useMonitorOverlay(isPlaying) {
  const [open, setOpen] = useState(false)
  useEffect(() => {
    if (isPlaying) setOpen(true)
  }, [isPlaying])
  return { open, setOpen }
}
