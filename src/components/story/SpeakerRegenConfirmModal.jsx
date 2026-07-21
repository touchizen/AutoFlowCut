import Modal from '../Modal'

/**
 * 화자 단위 강제 재생성 확인 모달.
 *
 * 성우 버튼 우클릭 시 뜬다. 그 화자의 오디오 세그먼트를 전부 다시 만드는(기존 오디오 교체)
 * 파괴적·시간 드는 작업이라, 세그먼트 수를 보여주고 확인을 받는다.
 *
 * Props:
 *   speaker       — 대상 화자 객체({id,name}) 또는 null = 닫힘
 *   segmentCount  — 재생성될 세그먼트 수(표시용)
 *   onConfirm     — 재생성 클릭
 *   onCancel      — 취소/닫기
 *   t             — i18n 함수(보간 지원)
 */
export default function SpeakerRegenConfirmModal({ speaker, segmentCount = 0, onConfirm, onCancel, confirmDisabled = false, t = (k) => k }) {
  if (!speaker) return null
  const name = speaker.name || speaker.id

  return (
    <Modal
      isOpen={true}
      onClose={onCancel}
      title={t('story.audio.speakerRegenTitle', '화자 오디오 전체 재생성')}
      className="modal-confirm-delete"
      footer={
        <div className="modal-confirm-actions">
          <button className="btn-cancel" onClick={onCancel}>
            {t('common.cancel', '취소')}
          </button>
          <button className="btn-danger" onClick={onConfirm} disabled={confirmDisabled}>
            {t('story.audio.speakerRegenConfirm', '재생성')}
          </button>
        </div>
      }
    >
      <div className="speaker-regen-preview">
        <p>
          {t(
            'story.audio.speakerRegenBody',
            '{speaker}의 오디오 세그먼트 {count}개를 모두 다시 생성합니다. 이미 만들어진 오디오는 새 음성으로 교체됩니다.',
            { speaker: name, count: segmentCount },
          )}
        </p>
      </div>
    </Modal>
  )
}
