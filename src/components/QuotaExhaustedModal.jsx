/**
 * QuotaExhaustedModal — Flow quota 소진 안내 모달.
 *
 * Provider 가 mount 시 quotaStop event bus 를 구독한다. Hook 들은 UI 컴포넌트를
 * 직접 import 하지 않고 `emitQuotaStop()` 만 호출하면 된다 — 계층 분리.
 *
 * 사용자가 OK 를 누르면 `notifyQuotaModalDismissed()` 로 quota-block 상태 해제 →
 * 다음 enqueue 부터 다시 허용 (useGenerationQueue 가 isQuotaBlocked() 로 가드).
 */

import { useEffect, useState } from 'react'
import Modal from './Modal'
import { useI18n } from '../hooks/useI18n'
import { subscribeQuotaStop, notifyQuotaModalDismissed } from '../utils/quotaStop'

export function QuotaExhaustedModalProvider({ children }) {
  const [isOpen, setIsOpen] = useState(false)
  const { t } = useI18n()

  useEffect(() => {
    const unsubscribe = subscribeQuotaStop(() => setIsOpen(true))
    return unsubscribe
  }, [])

  const close = () => {
    setIsOpen(false)
    notifyQuotaModalDismissed()
  }

  return (
    <>
      {children}
      <Modal
        isOpen={isOpen}
        onClose={close}
        title={t('quotaExhausted.title')}
        className="quota-exhausted-modal"
        footer={
          <button className="btn btn-primary" onClick={close}>
            {t('quotaExhausted.ok')}
          </button>
        }
      >
        <p style={{ whiteSpace: 'pre-line', lineHeight: 1.55, margin: 0 }}>
          {t('quotaExhausted.message')}
        </p>
      </Modal>
    </>
  )
}

export default QuotaExhaustedModalProvider
