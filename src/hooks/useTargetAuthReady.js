import { useCallback, useEffect, useRef, useState } from 'react'

const EMPTY_AUTH_READY = Object.freeze({ flow: false, chatgpt: false })

const isKnownTarget = (target) => Object.hasOwn(EMPTY_AUTH_READY, target)

export function useTargetAuthReady(
  target,
  electronAPI = globalThis.window?.electronAPI,
) {
  const [authReadyByTarget, setAuthReadyByTarget] = useState(EMPTY_AUTH_READY)
  const revisionsRef = useRef({ flow: -1, chatgpt: -1 })

  const setTargetReady = useCallback((eventTarget, ready) => {
    if (!isKnownTarget(eventTarget)) return
    setAuthReadyByTarget((previous) => ({
      ...previous,
      [eventTarget]: Boolean(ready),
    }))
  }, [])

  const applyTargetStatus = useCallback((status) => {
    const eventTarget = status?.target
    const revision = status?.revision
    if (!isKnownTarget(eventTarget) || !Number.isInteger(revision) || revision < 0) return
    if (revision <= revisionsRef.current[eventTarget]) return

    revisionsRef.current[eventTarget] = revision
    setTargetReady(
      eventTarget,
      status.status === 'ready' && status.ready === true,
    )
  }, [setTargetReady])

  useEffect(() => {
    if (!isKnownTarget(target) || !electronAPI) return undefined

    let active = true
    const applyWhileActive = (status) => {
      if (active) applyTargetStatus(status)
    }
    const off = electronAPI.onSessionTargetStatus?.(applyWhileActive)

    if (typeof electronAPI.getSessionTargetStatus === 'function') {
      Promise.resolve(electronAPI.getSessionTargetStatus(target))
        .then(applyWhileActive)
        .catch(() => {})
    }

    return () => {
      active = false
      off?.()
    }
  }, [applyTargetStatus, electronAPI, target])

  return {
    authReadyByTarget,
    authReady: authReadyByTarget[target] === true,
    setTargetReady,
  }
}

export default useTargetAuthReady
