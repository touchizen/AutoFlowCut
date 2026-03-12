/**
 * FrameToVideoPanel — Frame to Video 매핑 테이블
 *
 * 이미지 씬(mediaId 있는)을 Start/End Image로 선택하여
 * 비디오 생성 요청을 구성하는 UI.
 *
 * Props:
 *   scenes       — 전체 씬 배열
 *   framePairs   — [{ id, startSceneId, endSceneId, prompt, status }]
 *   onUpdate     — framePairs 업데이트 콜백
 *   disabled     — 생성 중 비활성화
 *   t            — i18n 함수
 */

import { useMemo } from 'react'

const STATUS_ICONS = {
  waiting: '⏳',
  generating: '⚙️',
  complete: '✅',
  error: '❌',
}

let nextPairId = 1

export default function FrameToVideoPanel({ scenes, framePairs, onUpdate, disabled, t }) {
  // mediaId 있는 씬만 드롭다운에 표시
  const availableScenes = useMemo(
    () => scenes.filter(s => s.mediaId),
    [scenes]
  )

  const toggleSelect = (id) => {
    onUpdate(framePairs.map(p =>
      p.id === id ? { ...p, selected: p.selected === false ? true : false } : p
    ))
  }

  const toggleSelectAll = () => {
    const allSelected = framePairs.every(p => p.selected !== false)
    onUpdate(framePairs.map(p => ({ ...p, selected: !allSelected })))
  }

  const updatePair = (index, field, value) => {
    const updated = [...framePairs]
    updated[index] = { ...updated[index], [field]: value }
    onUpdate(updated)
  }

  const addRow = () => {
    // 기본값: 순서대로 자동 채움
    const usedStart = new Set(framePairs.map(p => p.startSceneId))
    const nextStart = availableScenes.find(s => !usedStart.has(s.id))
    const nextStartId = nextStart?.id || ''

    const startIdx = availableScenes.findIndex(s => s.id === nextStartId)
    const nextEnd = startIdx >= 0 ? availableScenes[startIdx + 1] : null

    onUpdate([
      ...framePairs,
      {
        id: `fp_${nextPairId++}`,
        startSceneId: nextStartId,
        endSceneId: nextEnd?.id || '',
        prompt: nextStart?.prompt || '',
        status: 'waiting',
      },
    ])
  }

  const removeRow = (index) => {
    onUpdate(framePairs.filter((_, i) => i !== index))
  }

  const getSceneThumb = (sceneId) => {
    const scene = scenes.find(s => s.id === sceneId)
    return scene?.image || null
  }

  const getSceneLabel = (scene) => {
    const idx = scenes.indexOf(scene) + 1
    return `#${idx} ${scene.prompt?.substring(0, 25) || scene.id}`
  }

  if (availableScenes.length === 0) {
    return (
      <div className="video-panel-empty">
        <p>🎞️ {t('frameToVideo.noScenesWithMedia')}</p>
      </div>
    )
  }

  return (
    <div className="video-panel">
      <div className="video-panel-header">
        <p className="video-panel-description">{t('frameToVideo.description')}</p>
      </div>

      <div className="video-mapping-table">
        {/* 테이블 헤더 */}
        <div className="mapping-row mapping-header">
          <th className="col-check"><input
            type="checkbox"
            checked={framePairs.length > 0 && framePairs.every(p => p.selected !== false)}
            onChange={toggleSelectAll}
            disabled={disabled}
          /></th>
          <span className="mapping-col col-num">#</span>
          <span className="mapping-col col-image">{t('frameToVideo.startImage')}</span>
          <span className="mapping-col col-image">{t('frameToVideo.endImage')}</span>
          <span className="mapping-col col-prompt">{t('frameToVideo.prompt')}</span>
          <span className="mapping-col col-status">{t('frameToVideo.status')}</span>
          <span className="mapping-col col-action"></span>
        </div>

        {/* 매핑 행들 */}
        {framePairs.map((pair, index) => (
          <div key={pair.id} className="mapping-row">
            <td className="col-check"><input
              type="checkbox"
              checked={pair.selected !== false}
              onChange={() => toggleSelect(pair.id)}
              disabled={disabled}
            /></td>
            <span className="mapping-col col-num">{index + 1}</span>

            {/* Start Image 드롭다운 */}
            <div className="mapping-col col-image">
              <div className="scene-select-wrapper">
                {pair.startSceneId && getSceneThumb(pair.startSceneId) && (
                  <img
                    src={getSceneThumb(pair.startSceneId)}
                    alt=""
                    className="scene-thumb"
                  />
                )}
                <select
                  value={pair.startSceneId}
                  onChange={(e) => updatePair(index, 'startSceneId', e.target.value)}
                  disabled={disabled || pair.status === 'generating'}
                >
                  <option value="">—</option>
                  {availableScenes.map(scene => (
                    <option key={scene.id} value={scene.id}>
                      {getSceneLabel(scene)}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* End Image 드롭다운 */}
            <div className="mapping-col col-image">
              <div className="scene-select-wrapper">
                {pair.endSceneId && getSceneThumb(pair.endSceneId) && (
                  <img
                    src={getSceneThumb(pair.endSceneId)}
                    alt=""
                    className="scene-thumb"
                  />
                )}
                <select
                  value={pair.endSceneId}
                  onChange={(e) => updatePair(index, 'endSceneId', e.target.value)}
                  disabled={disabled || pair.status === 'generating'}
                >
                  <option value="">{t('frameToVideo.noEndImage')}</option>
                  {availableScenes.map(scene => (
                    <option key={scene.id} value={scene.id}>
                      {getSceneLabel(scene)}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* 프롬프트 */}
            <div className="mapping-col col-prompt">
              <input
                type="text"
                value={pair.prompt}
                onChange={(e) => updatePair(index, 'prompt', e.target.value)}
                disabled={disabled || pair.status === 'generating'}
                placeholder={t('frameToVideo.promptPlaceholder')}
              />
            </div>

            {/* 상태 */}
            <span className="mapping-col col-status">
              {STATUS_ICONS[pair.status] || '⏳'} {t(`frameToVideo.${pair.status}`)}
            </span>

            {/* 삭제 */}
            <div className="mapping-col col-action">
              <button
                className="btn-remove"
                onClick={() => removeRow(index)}
                disabled={disabled || pair.status === 'generating'}
                title={t('frameToVideo.removeRow')}
              >
                ✕
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* 행 추가 버튼 */}
      <button
        className="btn-add-row"
        onClick={addRow}
        disabled={disabled}
      >
        {t('frameToVideo.addRow')}
      </button>
    </div>
  )
}
