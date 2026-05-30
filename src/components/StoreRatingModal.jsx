/**
 * StoreRatingModal — CapCut 내보내기 N회 후 Microsoft Store 평점 유도 모달
 *
 * "지금 평가하기" → Store 평점 페이지 딥링크 열기
 * "나중에"        → 다음 임계값까지 스누즈
 * "다시 묻지 않기" → 영구 비표시
 */

import Modal from './Modal'
import useI18n from '../hooks/useI18n'
import './StoreRatingModal.css'

export default function StoreRatingModal({ isOpen, onRate, onLater, onNever }) {
  const { t } = useI18n()
  if (!isOpen) return null

  const footer = (
    <>
      <button className="btn-text store-rating-never" onClick={onNever}>
        {t('storeRating.never')}
      </button>
      <span className="store-rating-spacer" />
      <button className="btn-secondary" onClick={onLater}>
        {t('storeRating.later')}
      </button>
      <button className="btn-primary" onClick={onRate}>
        {t('storeRating.rate')}
      </button>
    </>
  )

  return (
    <Modal
      onClose={onLater}
      title={t('storeRating.title')}
      className="store-rating-modal"
      footer={footer}
    >
      <div className="store-rating-stars" aria-hidden="true">⭐⭐⭐⭐⭐</div>
      <p className="store-rating-body">{t('storeRating.body')}</p>
    </Modal>
  )
}
