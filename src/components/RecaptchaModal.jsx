import { useState, useEffect } from 'react'
import './RecaptchaModal.css'

/**
 * reCAPTCHA 차단 안내 모달 — 순수 안내용.
 * props:
 *  - open: boolean
 *  - mode: 'auto' | 'manual'   ('auto'=1~3회, 'manual'=4회+)
 *  - waitMs: number            (mode='auto'일 때 카운트다운 총 길이)
 *  - onClose: () => void       (확인 클릭 시 — 모달만 닫음, 배치 영향 없음)
 *  - t: (key, vars) => string
 * 배치 중지/재개는 이 모달이 아니라 앱 본체 컨트롤이 담당한다.
 */
export default function RecaptchaModal({ open, mode = 'auto', waitMs = 0, onClose, t }) {
  const [remainMs, setRemainMs] = useState(waitMs)

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

  if (!open) return null

  const min = Math.round(waitMs / 60000)
  const isManual = mode === 'manual'
  const mm = String(Math.floor(remainMs / 60000)).padStart(2, '0')
  const ss = String(Math.floor((remainMs % 60000) / 1000)).padStart(2, '0')

  return (
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
        <button className="recaptcha-modal-confirm" onClick={onClose}>
          {t('recaptcha.confirm')}
        </button>
      </div>
    </div>
  )
}
