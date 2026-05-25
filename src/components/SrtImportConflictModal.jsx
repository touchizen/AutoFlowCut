import Modal from './Modal'

/**
 * SRT import 시 기존 scenes/srtTrack 가 이미 있을 때 띄우는 충돌 해결 모달.
 *
 * 3개 선택지:
 *   - 대체 (replace): 기존 비우고 새 SRT 로 wholesale.
 *   - 스마트 병합 (merge): 기존 prompt/image 보존, 매칭 안 된 라인은 append.
 *   - 취소.
 *
 * Props:
 *   isOpen                 — boolean
 *   existingSceneCount     — 손실 가능성 인지용 카운트
 *   existingSrtLineCount   — 손실 가능성 인지용 카운트
 *   onReplace              — 대체 클릭
 *   onMerge                — 스마트 병합 클릭
 *   onCancel               — 취소 / 백드롭 클릭
 *   t                      — i18n
 */
export default function SrtImportConflictModal({
  isOpen,
  existingSceneCount = 0,
  existingSrtLineCount = 0,
  onReplace,
  onMerge,
  onCancel,
  t = (k) => k,
}) {
  if (!isOpen) return null

  return (
    <Modal
      isOpen={true}
      onClose={onCancel}
      title={t('srtImport.conflictTitle') || 'SRT 가져오기 충돌'}
      className="modal-srt-import-conflict"
      footer={
        <div className="modal-confirm-actions">
          <button className="btn-cancel" onClick={onCancel}>
            {t('common.cancel') || '취소'}
          </button>
          <button className="btn-secondary" onClick={onMerge}>
            {t('srtImport.merge') || '스마트 병합'}
          </button>
          <button className="btn-danger" onClick={onReplace}>
            {t('srtImport.replace') || '대체'}
          </button>
        </div>
      }
    >
      <div className="srt-import-conflict-body">
        <p>
          {t('srtImport.conflictIntro')
            || '기존 프로젝트에 이미 자막/씬 데이터가 있습니다.'}
        </p>
        <ul>
          <li>
            {t('srtImport.existingScenes') || '기존 씬'}: <strong>{existingSceneCount}</strong>
          </li>
          <li>
            {t('srtImport.existingSrtLines') || '기존 자막 라인'}: <strong>{existingSrtLineCount}</strong>
          </li>
        </ul>
        <p>
          <strong>{t('srtImport.replace') || '대체'}</strong>
          {' — '}
          {t('srtImport.replaceDesc')
            || '기존 씬/자막을 전부 제거하고 새 SRT 로 다시 만듭니다. prompt/이미지/비디오도 함께 사라집니다.'}
        </p>
        <p>
          <strong>{t('srtImport.merge') || '스마트 병합'}</strong>
          {' — '}
          {t('srtImport.mergeDesc')
            || '동일/유사한 자막은 기존 씬에 매칭해 prompt/이미지를 유지합니다. 매칭 안 된 새 라인은 뒤에 추가됩니다.'}
        </p>
      </div>
    </Modal>
  )
}
