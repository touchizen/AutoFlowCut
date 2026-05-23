import Modal from './Modal'

/**
 * Preview-and-confirm modal for scene deletion.
 *
 * Shows the user what's about to be lost so they don't accidentally delete a
 * scene with generated image data + video prompts + subtitle + F→V rows.
 *
 * Props:
 *   scene         — the scene object being deleted (or null = modal closed)
 *   sceneIndex    — 0-based position in scenes array (for display as #N+1)
 *   framePairs    — needed to count F→V rows owning this scene
 *   onConfirm     — called when user clicks Delete
 *   onCancel      — called when user clicks Cancel or closes modal
 *   t             — i18n function
 */
export default function DeleteSceneConfirmModal({
  scene,
  sceneIndex,
  framePairs,
  onConfirm,
  onCancel,
  t = (k) => k,
}) {
  if (!scene) return null

  const ownedRowCount = (framePairs || []).filter(
    fp => fp.ownerSceneId && fp.ownerSceneId === scene.id
  ).length

  const truncate = (s, n = 80) => {
    if (!s) return ''
    return s.length > n ? s.slice(0, n) + '…' : s
  }

  // 생성된 미디어 판정 기준은 sceneTrim.isSceneEmpty 와 정렬 — base64 / path / mediaId
  // 중 하나라도 있으면 "데이터 있음". 다르면 trim 이 살려둔 씬을 모달이 "빈 씬" 으로
  // 잘못 표시해 사용자가 손실 인지 못 함.
  const hasImage = !!(scene.image || scene.imagePath || scene.mediaId)
  const hasVideoT2V = !!(scene.videoT2V || scene.videoT2VPath)
  const hasVideoI2V = !!(scene.videoI2V || scene.videoI2VPath)
  const imagePrompt = scene.prompt?.trim() || ''
  const videoT2VPrompt = scene.videoT2VPrompt?.trim() || ''
  const videoI2VPrompt = scene.videoI2VPrompt?.trim() || ''
  const subtitle = scene.subtitle?.trim() || ''

  const isEmpty = !imagePrompt && !videoT2VPrompt && !videoI2VPrompt && !subtitle
    && !hasImage && !hasVideoT2V && !hasVideoI2V && ownedRowCount === 0

  return (
    <Modal
      isOpen={true}
      onClose={onCancel}
      title={t('sceneList.deleteConfirmTitle') || '씬 삭제 확인'}
      className="modal-confirm-delete"
      footer={
        <div className="modal-confirm-actions">
          <button className="btn-cancel" onClick={onCancel}>
            {t('common.cancel') || '취소'}
          </button>
          <button className="btn-danger" onClick={onConfirm}>
            {t('common.delete') || '삭제'}
          </button>
        </div>
      }
    >
      <div className="delete-scene-preview">
        <p>
          <strong>#{sceneIndex + 1}</strong> {t('sceneList.deleteConfirmIntro') || '씬을 삭제합니다. 다음 데이터가 함께 사라집니다:'}
        </p>
        <ul>
          {imagePrompt && (
            <li>
              <strong>{t('prompt.image') || '이미지 프롬프트'}:</strong> {truncate(imagePrompt)}
            </li>
          )}
          {videoT2VPrompt && (
            <li>
              <strong>{t('prompt.videoT2V') || '비디오 T2V'}:</strong> {truncate(videoT2VPrompt)}
            </li>
          )}
          {videoI2VPrompt && (
            <li>
              <strong>{t('prompt.videoI2V') || '비디오 I2V'}:</strong> {truncate(videoI2VPrompt)}
            </li>
          )}
          {subtitle && (
            <li>
              <strong>{t('sceneList.subtitle') || '자막'}:</strong> {truncate(subtitle)}
            </li>
          )}
          {hasImage && (
            <li>
              <strong>{t('sceneList.generatedImage') || '생성된 이미지'}</strong>
            </li>
          )}
          {hasVideoT2V && (
            <li>
              <strong>{t('sceneList.generatedVideoT2V') || '생성된 T2V 비디오'}</strong>
            </li>
          )}
          {hasVideoI2V && (
            <li>
              <strong>{t('sceneList.generatedVideoI2V') || '생성된 I2V 비디오'}</strong>
            </li>
          )}
          {ownedRowCount > 0 && (
            <li>
              <strong>F→V {t('sceneList.rowCount', { count: ownedRowCount }) || `${ownedRowCount}개 행`}</strong>
            </li>
          )}
          {isEmpty && (
            <li>{t('sceneList.deleteConfirmEmpty') || '(빈 씬)'}</li>
          )}
        </ul>
      </div>
    </Modal>
  )
}
