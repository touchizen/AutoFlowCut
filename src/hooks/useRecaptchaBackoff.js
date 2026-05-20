import { useState, useRef, useCallback, useMemo } from 'react'
import { planRecaptchaWait, shouldResetIncidents } from '../services/recaptchaPolicy'

/**
 * reCAPTCHA backoff 상태 머신.
 *
 * - registerBlock(): incident을 1회 등록하고 정책에 따라 wait. 같은 wave 안의 추가 호출은 흡수.
 * - cancelWait(): 진행 중인 wait을 즉시 종료.
 * - recordSuccess(): 성공 1회 기록. 연속 임계 도달 시 incident 카운터 자동 리셋.
 * - reset(): 모든 상태 초기화 (배치 시작 시).
 *
 * @param {Function} t  i18n 함수
 * @param {{ notifyOS?: ({title,body}) => void, getStopRequested?: () => boolean, graceMs?: number }} [opts]
 */
export function useRecaptchaBackoff(t, opts = {}) {
  const notifyOS = opts.notifyOS  // 주입 없으면 알림 생략 (테스트에서 window.electronAPI 의존 회피)
  const getStopRequested = opts.getStopRequested ?? (() => false)
  const GRACE_MS = opts.graceMs ?? 10000  // 호출자가 테스트용으로 override 가능

  const [modalState, setModalState] = useState(null) // { mode:'auto'|'manual', waitMs } | null
  const incidentRef = useRef(0)
  const handlingRef = useRef(false)
  const consecutiveSuccessRef = useRef(0)
  const cancelRef = useRef(false)
  const graceTimerRef = useRef(null)

  const clearGraceTimer = () => {
    if (graceTimerRef.current) {
      clearTimeout(graceTimerRef.current)
      graceTimerRef.current = null
    }
  }

  const reset = useCallback(() => {
    clearGraceTimer()
    incidentRef.current = 0
    handlingRef.current = false
    consecutiveSuccessRef.current = 0
    cancelRef.current = false
    setModalState(null)
  }, [])

  const recordSuccess = useCallback(() => {
    consecutiveSuccessRef.current++
    if (incidentRef.current > 0 && shouldResetIncidents(consecutiveSuccessRef.current)) {
      incidentRef.current = 0
    }
  }, [])

  const recordFailure = useCallback(() => {
    consecutiveSuccessRef.current = 0
  }, [])

  /**
   * @param {{ allowAbsorb?: boolean }} [opts]
   *   - allowAbsorb=true (기본): handling 중이면 absorbed 반환 (in-flight 잔여 흡수).
   *   - allowAbsorb=false: handling 가드 무시. grace window 안이라도 새 incident 시작 (submit probe 용).
   * @returns {Promise<{ waitedMs:number, mode:'auto'|'manual'|'absorbed', resumed:boolean }>}
   *   - mode 'absorbed': 같은 wave 안의 중복 호출 — 호출자는 이 케이스에서 추가 시간 보정 불필요.
   *   - mode 'auto': 정상 backoff 진행 후 resolve. waitedMs = 실제 경과 시간.
   *   - mode 'manual': incident 4회+ — cancelWait 또는 stop 까지 대기 후 resolve.
   */
  const registerBlock = useCallback(async ({ allowAbsorb = true } = {}) => {
    if (handlingRef.current && allowAbsorb) {
      return { waitedMs: 0, mode: 'absorbed', resumed: false }
    }
    clearGraceTimer()
    handlingRef.current = true
    incidentRef.current += 1
    consecutiveSuccessRef.current = 0
    cancelRef.current = false

    const { waitMs, autoResume } = planRecaptchaWait(incidentRef.current)

    setModalState({ mode: autoResume ? 'auto' : 'manual', waitMs: autoResume ? waitMs : 0 })
    try {
      notifyOS?.({
        title: 'AutoFlowCut',
        body: autoResume
          ? t('recaptcha.notify', { min: Math.round(waitMs / 60000) })
          : t('recaptcha.notifyManual'),
      })
    } catch {}

    const start = Date.now()
    const end = autoResume ? start + waitMs : null  // manual: 무한 — cancel/stop 까지 대기

    while (
      !cancelRef.current &&
      !getStopRequested() &&
      (end === null || Date.now() < end)
    ) {
      await new Promise(r => setTimeout(r, 500))
    }
    const waitedMs = Date.now() - start
    const stoppedExternally = getStopRequested()
    const cancelledByUser = cancelRef.current

    setModalState(null)
    cancelRef.current = false

    if (autoResume && !stoppedExternally && GRACE_MS > 0) {
      // 정상 auto 종료 — grace window: 직후의 in-flight 잔여 reCAPTCHA 를 같은 incident 으로 흡수.
      graceTimerRef.current = setTimeout(() => {
        handlingRef.current = false
        graceTimerRef.current = null
      }, GRACE_MS)
    } else {
      // stop / manual / cancel / graceMs=0 — 즉시 풀기.
      handlingRef.current = false
    }

    return {
      waitedMs,
      mode: autoResume ? 'auto' : 'manual',
      resumed: !stoppedExternally && !cancelledByUser,
    }
  }, [t, notifyOS, getStopRequested, GRACE_MS])

  const cancelWait = useCallback(() => {
    cancelRef.current = true
    clearGraceTimer()
    handlingRef.current = false
    setModalState(null)
  }, [])

  return useMemo(
    () => ({
      modalState,
      registerBlock,
      cancelWait,
      recordSuccess,
      recordFailure,
      reset,
      // 디버그/테스트용 — 외부 직접 접근은 권장 안 함
      _debug: {
        incidentCount: () => incidentRef.current,
        isHandling: () => handlingRef.current,
      },
    }),
    [modalState, registerBlock, cancelWait, recordSuccess, recordFailure, reset]
  )
}
