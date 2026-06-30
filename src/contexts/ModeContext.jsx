/**
 * ModeContext — 앱 전역 생성 모드 공급. value = useAppMode() 반환.
 */
import { createContext, useContext } from 'react'
import { useAppMode } from '../hooks/useAppMode'

const ModeContext = createContext(null)

export function ModeProvider({ children }) {
  const value = useAppMode()
  return <ModeContext.Provider value={value}>{children}</ModeContext.Provider>
}

export function useMode() {
  const ctx = useContext(ModeContext)
  if (!ctx) throw new Error('useMode must be used within ModeProvider')
  return ctx
}
