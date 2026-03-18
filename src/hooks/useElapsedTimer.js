/**
 * useElapsedTimer - 경과 시간 타이머 훅
 * startedAt: 시작 시간 (timestamp)
 * endedAt: 종료 시간 (timestamp) — 있으면 멈추고 최종 값 유지
 */
import { useState, useEffect } from 'react'

export function useElapsedTimer(startedAt, endedAt = null) {
  const [elapsed, setElapsed] = useState(() => {
    if (!startedAt) return 0
    const end = endedAt || Date.now()
    return Math.floor((end - startedAt) / 1000)
  })

  useEffect(() => {
    if (!startedAt) {
      setElapsed(0)
      return
    }
    if (endedAt) {
      setElapsed(Math.floor((endedAt - startedAt) / 1000))
      return
    }
    setElapsed(Math.floor((Date.now() - startedAt) / 1000))
    const timer = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startedAt) / 1000))
    }, 1000)
    return () => clearInterval(timer)
  }, [startedAt, endedAt])

  return elapsed
}
