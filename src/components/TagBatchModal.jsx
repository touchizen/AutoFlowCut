/**
 * TagBatchModal - 태그 적용 모달 (캐릭터/배경/스타일 공통)
 *
 * mode='single': 개별 씬 태그 변경 (캐릭터/배경용)
 * mode='batch':  범위 지정 일괄 변경 (스타일용)
 */

import { useState, useMemo } from 'react'
import { resolveImageSrc } from '../utils/formatters'
import { STYLE_PRESETS } from '../config/defaults'
import Modal from './Modal'
import StylePicker from './StylePicker'

const TAG_CONFIG = {
  character: { icon: '👤', field: 'characters' },
  scene:     { icon: '🏞️', field: 'scene_tag' },
  style:     { icon: '🎨', field: 'style_tag' },
}

export default function TagBatchModal({
  tagType,
  mode = 'batch',    // 'single' | 'batch'
  sceneIndex,        // single 모드: 대상 씬 인덱스 (0-based)
  scenes,
  references,
  styleThumbnails = {},
  onApply,
  onClose,
  t
}) {
  const config = TAG_CONFIG[tagType]
  const typeLabel = t(`sceneList.${tagType}`)

  const refs = useMemo(
    () => references.filter(r => r.type === tagType),
    [references, tagType]
  )

  const [selectedNames, setSelectedNames] = useState(new Set())
  const [rangeFrom, setRangeFrom] = useState(1)
  const [rangeTo, setRangeTo] = useState(scenes.length)

  // 스타일 모드: 프리셋 선택 상태
  const [presetStyleId, setPresetStyleId] = useState(null) // 'preset:xxx' or null
  const isStyleMode = tagType === 'style'
  const isKo = t('common.cancel') === '취소'

  const toggleName = (name) => {
    // 프리셋 선택 해제
    if (isStyleMode) setPresetStyleId(null)
    setSelectedNames(prev => {
      const next = new Set(prev)
      if (next.has(name)) next.delete(name)
      else next.add(name)
      return next
    })
  }

  const handlePresetSelect = (id) => {
    setPresetStyleId(id)
    // 레퍼런스 선택 해제
    setSelectedNames(new Set())
  }

  // 프리셋에서 style_tag 값 resolve
  const resolvePresetName = (id) => {
    if (!id) return null
    if (id.startsWith('preset:')) {
      const presetId = id.replace('preset:', '')
      const preset = STYLE_PRESETS?.styles?.find(s => s.id === presetId)
      return preset?.name_en || presetId
    }
    return id
  }

  const handleApply = () => {
    let value
    if (presetStyleId) {
      value = resolvePresetName(presetStyleId)
    } else if (selectedNames.size > 0) {
      value = [...selectedNames].join(',')
    } else {
      return
    }
    if (mode === 'single' && sceneIndex != null) {
      onApply(config.field, value, sceneIndex, sceneIndex)
    } else {
      onApply(config.field, value, rangeFrom - 1, rangeTo - 1)
    }
  }

  const isSingle = mode === 'single' && sceneIndex != null
  const affectedCount = isSingle
    ? 1
    : Math.max(0, Math.min(rangeTo, scenes.length) - Math.max(rangeFrom, 1) + 1)

  const hasSelection = presetStyleId || selectedNames.size > 0

  const titleText = isSingle
    ? `${config.icon} ${typeLabel} — #${sceneIndex + 1}`
    : `${config.icon} ${typeLabel} ${t('sceneList.batchApply')}`

  const footer = (
    <>
      <button className="btn-secondary" onClick={onClose}>{t('common.cancel')}</button>
      <button
        className="btn-primary"
        onClick={handleApply}
        disabled={!hasSelection || affectedCount === 0}
      >
        {t('sceneList.applyTag')} ({affectedCount}{t('sceneList.sceneUnit')})
      </button>
    </>
  )

  return (
    <Modal
      onClose={onClose}
      title={titleText}
      className={`tag-batch-modal ${isStyleMode ? 'tag-batch-modal-wide' : ''}`}
      footer={footer}
    >
      {/* 레퍼런스 목록 (다중 선택) */}
      {refs.length > 0 && (
        <div className="tag-batch-list">
          {refs.map(ref => {
            const thumb = resolveImageSrc(ref)
            const isSelected = selectedNames.has(ref.name)
            return (
              <div
                key={ref.name}
                className={`tag-batch-item ${isSelected ? 'selected' : ''}`}
                onClick={() => toggleName(ref.name)}
              >
                <span className={`tag-batch-check ${isSelected ? 'checked' : ''}`}>
                  {isSelected ? '☑' : '☐'}
                </span>
                {thumb ? (
                  <img src={thumb} alt={ref.name} className="tag-batch-thumb" />
                ) : (
                  <div className="tag-batch-thumb placeholder">{config.icon}</div>
                )}
                <div className="tag-batch-info">
                  <span className="tag-batch-name">{ref.name}</span>
                  {ref.prompt && (
                    <span className="tag-batch-prompt">{ref.prompt.substring(0, 60)}...</span>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* 스타일 모드: 프리셋 스타일 피커 */}
      {isStyleMode && (
        <>
          {refs.length > 0 && (
            <div className="tag-batch-divider">
              <span>{t('sceneList.orPickPreset')}</span>
            </div>
          )}
          <div className="tag-batch-style-picker">
            <StylePicker
              selectedId={presetStyleId}
              onSelect={handlePresetSelect}
              thumbnails={styleThumbnails}
              t={t}
              isKo={isKo}
            />
          </div>
        </>
      )}

      {/* 레퍼런스가 없고 스타일 모드도 아닌 경우 */}
      {refs.length === 0 && !isStyleMode && (
        <div className="tag-batch-empty">
          <p>{t('sceneList.noRefForType', { type: typeLabel })}</p>
        </div>
      )}

      {/* 선택된 태그 미리보기 */}
      {hasSelection && (
        <div className="tag-batch-preview">
          {config.field}: <code>
            {presetStyleId ? resolvePresetName(presetStyleId) : [...selectedNames].join(',')}
          </code>
        </div>
      )}

      {/* 범위 지정 (batch 모드만) */}
      {!isSingle && (
        <div className="tag-batch-range">
          <label>{t('sceneList.range')}</label>
          <div className="range-inputs">
            <input
              type="number"
              min={1}
              max={scenes.length}
              value={rangeFrom}
              onChange={(e) => setRangeFrom(Math.max(1, parseInt(e.target.value) || 1))}
            />
            <span>~</span>
            <input
              type="number"
              min={1}
              max={scenes.length}
              value={rangeTo}
              onChange={(e) => setRangeTo(Math.min(scenes.length, parseInt(e.target.value) || scenes.length))}
            />
            <button
              className="btn-secondary btn-sm"
              onClick={() => { setRangeFrom(1); setRangeTo(scenes.length) }}
            >
              {t('sceneList.allScenes')}
            </button>
          </div>
        </div>
      )}
    </Modal>
  )
}
