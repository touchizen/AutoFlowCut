import { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { useModalVisibility } from '../hooks/useModalVisibility'
import './RecaptchaModal.css'

/**
 * reCAPTCHA 차단 안내 모달 — 순수 안내용.
 * props:
 *  - open: boolean         — 외부 modalState 진실값
 *  - mode: 'auto' | 'manual'
 *  - waitMs: number        (mode='auto'일 때 카운트다운 총 길이)
 *  - onClose: () => void   (확인 클릭 시 콜백 — 부모는 무시해도 무방)
 *  - t: (key, vars) => string
 *
 * 동작:
 *  - 모달 열릴 때 Flow WebContentsView 를 숨김 (useModalVisibility).
 *  - [확인] 클릭 = 로컬 dismissed 만 토글. 외부 modalState 는 그대로 두고 모달만 안 보이게.
 *    이 wave 끝나기 전에 다시 안 뜸. 새 wave (mode/waitMs 변경) 들어오면 dismissed 자동 리셋.
 *  - 배치 중지/재개는 이 모달이 아니라 앱 본체 컨트롤이 담당.
 */
export default function RecaptchaModal({ open, mode = 'auto', waitMs = 0, onClose, t }) {
  const [remainMs, setRemainMs] = useState(waitMs)
  const [dismissed, setDismissed] = useState(false)

  // 새 wave (mode/waitMs 변경) 또는 외부 close → dismissed 리셋
  useEffect(() => { setDismissed(false) }, [open, mode, waitMs])

  useEffect(() => {
    if (!open || mode !== 'auto') return
    setRemainMs(waitMs)
    const end = Date.now() + waitMs
    const id = setInterval(() => {
      const left = Math.max(0, end - Date.now())
      setRemainMs(left)
      if (left <= 0) clearInterval(id)
    }, 1000)
    return () => clearInterval(id)
  }, [open, mode, waitMs])

  const visible = open && !dismissed
  useModalVisibility(visible)

  if (!visible) return null

  const min = Math.round(waitMs / 60000)
  const isManual = mode === 'manual'
  const mm = String(Math.floor(remainMs / 60000)).padStart(2, '0')
  const ss = String(Math.floor((remainMs % 60000) / 1000)).padStart(2, '0')

  const handleConfirm = () => {
    setDismissed(true)
    onClose?.()
  }

  return createPortal(
    <div className="recaptcha-modal-overlay" role="dialog" aria-modal="true">
      <div className="recaptcha-modal">
        <h3 className="recaptcha-modal-title">
          {isManual ? t('recaptcha.titleManual') : t('recaptcha.title', { min })}
        </h3>
        <p className="recaptcha-modal-body">
          {isManual ? t('recaptcha.bodyManual') : t('recaptcha.body', { min })}
        </p>
        {!isManual && (
          <p className="recaptcha-modal-countdown">
            {t('recaptcha.countdown', { time: `${mm}:${ss}` })}
          </p>
        )}
        <button className="recaptcha-modal-confirm" onClick={handleConfirm}>
          {t('recaptcha.confirm')}
        </button>
      </div>
    </div>,
    document.body
  )
}
