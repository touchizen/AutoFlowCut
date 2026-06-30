/**
 * useAppMode — 생성 모드('api' | 'flow') 상태 + localStorage 영속.
 * 미선택은 null (최초 실행 → ModeSelector 노출 신호).
 */
import { useState, useCallback } from 'react'

export const MODE_STORAGE_KEY = 'autoflowcut_mode'
export const VALID_MODES = ['api', 'flow']

export function loadMode() {
  const saved = localStorage.getItem(MODE_STORAGE_KEY)
  return VALID_MODES.includes(saved) ? saved : null
}

export function useAppMode() {
  const [mode, setModeState] = useState(() => loadMode())

  const setMode = useCallback((next) => {
    if (!VALID_MODES.includes(next)) return
    localStorage.setItem(MODE_STORAGE_KEY, next)
    setModeState(next)
  }, [])

  // 모드 선택 해제 → null. ModeGate 가 다시 ModeSelector(피커)를 노출.
  const clearMode = useCallback(() => {
    localStorage.removeItem(MODE_STORAGE_KEY)
    setModeState(null)
  }, [])

  return { mode, setMode, clearMode }
}
