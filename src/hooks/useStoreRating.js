/**
 * useStoreRating — CapCut 내보내기 N회 후 Microsoft Store 평점 유도
 *
 * 내보내기가 성공할 때마다 recordExport() 를 호출하면 누적 횟수를 localStorage 에
 * 영속하고, 임계값에 도달하면(그리고 Store 빌드일 때만) 평점 모달을 띄운다.
 *
 * 모달이 앱 시작 시점에 멋대로 뜨지 않도록, "방금 내보내기로 인해 임계값을
 * 넘었을 때"만 트리거되게 armedRef 로 가드한다. (이전 세션에서 임계값을 넘긴 채
 * 응답하지 않고 종료해도 다음 실행 시작과 동시에 팝업이 뜨지 않는다.)
 */

import { useState, useEffect, useCallback, useRef } from 'react'
import {
  STORE_RATING_KEY,
  buildStoreReviewUrl,
  createInitialRatingState,
  normalizeRatingState,
  registerEvent,
  shouldShowRatingPrompt,
  markRated,
  markNever,
  snooze
} from '../utils/storeRating'

function loadState() {
  try {
    const saved = localStorage.getItem(STORE_RATING_KEY)
    if (!saved) return createInitialRatingState()
    return normalizeRatingState(JSON.parse(saved))
  } catch {
    return createInitialRatingState()
  }
}

/**
 * @param {{ isStoreBuild?: boolean, openExternal?: (url: string) => void }} opts
 *  - isStoreBuild: appx(Store) 빌드 여부. 아니면 프롬프트를 절대 띄우지 않음.
 *  - openExternal: 테스트 주입용. 기본값은 Electron openExternal.
 */
export function useStoreRating({ isStoreBuild = false, openExternal } = {}) {
  const [state, setState] = useState(loadState)
  const [showModal, setShowModal] = useState(false)
  const armedRef = useRef(false)

  // localStorage 동기화
  useEffect(() => {
    try {
      localStorage.setItem(STORE_RATING_KEY, JSON.stringify(state))
    } catch {
      /* 저장 실패는 치명적이지 않음 — 무시 */
    }
  }, [state])

  // 방금 내보내기(arm)로 임계값을 넘겼을 때만 모달 오픈
  useEffect(() => {
    if (armedRef.current && shouldShowRatingPrompt(state, { isStoreBuild })) {
      armedRef.current = false
      setShowModal(true)
    }
  }, [state, isStoreBuild])

  // 성공 이벤트 기록 — 방금 발생(arm)으로 임계값을 넘겼을 때만 모달을 띄운다
  const record = useCallback(channel => {
    armedRef.current = true
    setState(prev => registerEvent(prev, channel))
  }, [])

  const recordExport = useCallback(() => record('export'), [record])
  const recordGeneration = useCallback(() => record('generation'), [record])

  const openStore = useCallback(() => {
    const url = buildStoreReviewUrl()
    const open = openExternal || window.electronAPI?.openExternal
    open?.(url)
  }, [openExternal])

  const rateNow = useCallback(() => {
    openStore()
    setState(prev => markRated(prev))
    setShowModal(false)
  }, [openStore])

  const remindLater = useCallback(() => {
    setState(prev => snooze(prev))
    setShowModal(false)
  }, [])

  const dismissForever = useCallback(() => {
    setState(prev => markNever(prev))
    setShowModal(false)
  }, [])

  return {
    state,
    showModal,
    recordExport,
    recordGeneration,
    rateNow,
    remindLater,
    dismissForever
  }
}
