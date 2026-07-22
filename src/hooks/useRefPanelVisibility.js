import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * 실제 Ref 작업이 있는 동안 레퍼런스 패널의 자동 표시 수명을 소유한다.
 *
 * opening은 닫힌 패널을 열 수 있지만 bridge는 앱이 이미 연 패널만 이어 준다. 사용자 close의
 * 억제와 자동 소유권은 렌더 state만 따라가면 같은 tick 안에서 어긋날 수 있어 ref로 즉시 판정한다.
 */
export function useRefPanelVisibility({
  refBatchActive,
  generatingRefsCount,
  stoppingRefs,
  syncGate,
  syncGateBusy,
  mode,
  automationStatus,
  hasPendingBatch,
  projectKey,
}) {
  const [isOpen, setIsOpen] = useState(false)
  const isOpenRef = useRef(false)
  const ownedRef = useRef(false)
  const suppressedRef = useRef(false)
  const closeTimerRef = useRef(null)
  const previousPendingRef = useRef(hasPendingBatch)
  const projectKeyRef = useRef(projectKey)

  const openingSignal = Boolean(
    refBatchActive
    || generatingRefsCount > 0
    || syncGate
    || syncGateBusy
    || (mode === 'flow' && automationStatus === 'uploading')
  )
  const bridgeSignal = Boolean(
    stoppingRefs
    || (mode === 'flow' && automationStatus === 'preparing')
  )
  const signalsRef = useRef(null)
  signalsRef.current = { openingSignal, bridgeSignal, hasPendingBatch }

  const setPanelOpen = useCallback((nextOpen) => {
    isOpenRef.current = nextOpen
    setIsOpen(nextOpen)
  }, [])

  const cancelPendingClose = useCallback(() => {
    if (closeTimerRef.current === null) return
    clearTimeout(closeTimerRef.current)
    closeTimerRef.current = null
  }, [])

  const setOpenByUser = useCallback((nextOpen) => {
    cancelPendingClose()

    if (nextOpen) {
      // 명시적 open은 자동 소유를 사용자 소유로 넘기고 이전 close 의사도 철회한다.
      ownedRef.current = false
      suppressedRef.current = false
      setPanelOpen(true)
      return
    }

    const signals = signalsRef.current
    if (
      signals.hasPendingBatch
      || signals.openingSignal
      || signals.bridgeSignal
      || ownedRef.current
    ) {
      // 신호 사이의 한 tick 틈도 같은 Ref 작업 창으로 보아 뒤 신호의 재개방을 막는다.
      suppressedRef.current = true
    }
    ownedRef.current = false
    setPanelOpen(false)
  }, [cancelPendingClose, setPanelOpen])

  useEffect(() => {
    const projectChanged = projectKeyRef.current !== projectKey
    if (projectChanged) {
      projectKeyRef.current = projectKey
      cancelPendingClose()
      ownedRef.current = false
      suppressedRef.current = false
      previousPendingRef.current = hasPendingBatch
      // 프로젝트 경계 자체는 현재 화면을 바꾸지 않는다. 같은 렌더의 신호는 옛 프로젝트에서
      // 남은 값일 수 있고, 새 프로젝트의 실제 작업은 이후 opening 전이에서 다시 판정한다.
      return
    }

    if (!previousPendingRef.current && hasPendingBatch) suppressedRef.current = false
    previousPendingRef.current = hasPendingBatch

    if (openingSignal) {
      cancelPendingClose()
      if (!isOpenRef.current && !suppressedRef.current) {
        ownedRef.current = true
        setPanelOpen(true)
      }
      return
    }

    if (bridgeSignal) {
      if (ownedRef.current) cancelPendingClose()
      return
    }

    if (!ownedRef.current || closeTimerRef.current !== null) return
    // React commit/마이크로태스크 하나짜리 신호 틈만 덮고, producer의 긴 수명을 대신 숨기지 않는다.
    closeTimerRef.current = setTimeout(() => {
      closeTimerRef.current = null
      const current = signalsRef.current
      if (current.openingSignal || current.bridgeSignal || !ownedRef.current) return
      ownedRef.current = false
      setPanelOpen(false)
    }, 0)
  }, [
    automationStatus,
    bridgeSignal,
    cancelPendingClose,
    hasPendingBatch,
    openingSignal,
    projectKey,
    setPanelOpen,
  ])

  // 실제 unmount에서는 ref도 함께 버려진다. StrictMode의 effect 재실행에서는 소유권을 보존하되
  // 예약 타이머만 제거해야 재설정 뒤 stale callback이 사용자 패널을 닫지 않는다.
  useEffect(() => () => cancelPendingClose(), [cancelPendingClose])

  return { isOpen, setOpenByUser }
}
