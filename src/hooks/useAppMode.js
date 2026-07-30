import { useState, useCallback } from 'react'
import {
  MODE_STORAGE_KEY, VALID_MODES, loadRoute, parseRoute,
  saveRoute, clearRoute,
} from '../config/appRoute.js'

export { MODE_STORAGE_KEY, VALID_MODES }

export function loadMode() {
  return loadRoute()?.mode ?? null
}

export function useAppMode() {
  const [route, setRouteState] = useState(() => loadRoute())

  const setRoute = useCallback((next) => {
    const accepted = parseRoute(next)
    if (!accepted) return
    saveRoute(localStorage, accepted)
    setRouteState(accepted)
  }, [])

  const setMode = useCallback((mode) => {
    if (!VALID_MODES.includes(mode)) return
    setRouteState((current) => {
      const accepted = { mode, sessionTarget: current?.sessionTarget ?? 'flow' }
      saveRoute(localStorage, accepted)
      return accepted
    })
  }, [])

  const clearMode = useCallback(() => {
    clearRoute(localStorage)
    setRouteState(null)
  }, [])

  return {
    route,
    mode: route?.mode ?? null,
    sessionTarget: route?.sessionTarget ?? 'flow',
    setRoute,
    setMode,
    clearMode,
  }
}
