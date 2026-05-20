import { useState, useRef, useCallback } from 'react'
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
 * @param {{ notifyOS?: ({title,body}) => void }} [opts]  의존성 주입 (테스트 친화)
 */
export function useRecaptchaBackoff(t, opts = {}) {
  const notifyOS = opts.notifyOS  // 주입 없으면 알림 생략 (테스트에서 window.electronAPI 의존 회피)

  const [modalState, setModalState] = useState(null) // { mode:'auto'|'manual', waitMs } | null
  const incidentRef = useRef(0)
  const handlingRef = useRef(false)
  const consecutiveSuccessRef = useRef(0)
  const cancelRef = useRef(false)

  const reset = useCallback(() => {
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
   * @returns {Promise<{ waitedMs:number, mode:'auto'|'manual'|'absorbed', resumed:boolean }>}
   *   - mode 'absorbed': 같은 wave 안의 중복 호출 — 호출자는 이 케이스에서 추가 시간 보정 불필요.
   *   - mode 'auto': 정상 backoff 진행 후 resolve. waitedMs = 실제 경과 시간 (cancel 시 단축됨).
   *   - mode 'manual': incident 4회+ — wait 없이 즉시 resolve. 사용자 수동 처리.
   */
  const registerBlock = useCallback(async () => {
    if (handlingRef.current) {
      return { waitedMs: 0, mode: 'absorbed', resumed: false }
    }
    handlingRef.current = true
    incidentRef.current += 1
    consecutiveSuccessRef.current = 0
    cancelRef.current = false

    const { waitMs, autoResume } = planRecaptchaWait(incidentRef.current)

    if (!autoResume) {
      setModalState({ mode: 'manual', waitMs: 0 })
      try { notifyOS?.({ title: 'AutoFlowCut', body: t('recaptcha.notifyManual') }) } catch {}
      // manual mode: 즉시 ref 풀어 다음 차단도 잡을 수 있게 (별도 gap fix 와 일치)
      handlingRef.current = false
      return { waitedMs: 0, mode: 'manual', resumed: false }
    }

    setModalState({ mode: 'auto', waitMs })
    try {
      notifyOS?.({
        title: 'AutoFlowCut',
        body: t('recaptcha.notify', { min: Math.round(waitMs / 60000) }),
      })
    } catch {}

    const start = Date.now()
    const end = start + waitMs
    while (!cancelRef.current && Date.now() < end) {
      await new Promise(r => setTimeout(r, 500))
    }
    const waitedMs = Date.now() - start

    setModalState(null)
    handlingRef.current = false
    cancelRef.current = false
    return { waitedMs, mode: 'auto', resumed: true }
  }, [t, notifyOS])

  const cancelWait = useCallback(() => {
    cancelRef.current = true
    setModalState(null)
  }, [])

  return {
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
  }
}
