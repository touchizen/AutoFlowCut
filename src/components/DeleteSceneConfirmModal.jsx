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

  // mediaId 외에도 base64 (scene.image) 또는 파일 경로 (scene.imagePath) 만 있는 경우도
  // 생성된 이미지로 인정. mediaId 만 보면 path-only 로드된 이미지가 모달에서 누락됨.
  const hasImage = !!(scene.image || scene.imagePath || scene.mediaId)
  const imagePrompt = scene.prompt?.trim() || ''
  const videoT2V = scene.videoT2VPrompt?.trim() || ''
  const videoI2V = scene.videoI2VPrompt?.trim() || ''
  const subtitle = scene.subtitle?.trim() || ''

  const isEmpty = !imagePrompt && !videoT2V && !videoI2V && !subtitle && !hasImage && ownedRowCount === 0

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
          {videoT2V && (
            <li>
              <strong>{t('prompt.videoT2V') || '비디오 T2V'}:</strong> {truncate(videoT2V)}
            </li>
          )}
          {videoI2V && (
            <li>
              <strong>{t('prompt.videoI2V') || '비디오 I2V'}:</strong> {truncate(videoI2V)}
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
