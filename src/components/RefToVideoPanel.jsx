/**
 * RefToVideoPanel — References to Video 매핑 테이블
 *
 * 레퍼런스(mediaId 있는)를 최대 3개 조합하여
 * 비디오 생성 요청을 구성하는 UI.
 *
 * Props:
 *   references   — 전체 레퍼런스 배열
 *   refPairs     — [{ id, refIds: [], prompt, status }]
 *   onUpdate     — refPairs 업데이트 콜백
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

const MAX_REFS_PER_ROW = 3

let nextRefPairId = 1

export default function RefToVideoPanel({ references, refPairs, onUpdate, disabled, t }) {
  // mediaId 있는 레퍼런스만 선택 가능
  const availableRefs = useMemo(
    () => references.filter(r => r.mediaId),
    [references]
  )

  const toggleSelect = (id) => {
    onUpdate(refPairs.map(p =>
      p.id === id ? { ...p, selected: p.selected === false ? true : false } : p
    ))
  }

  const toggleSelectAll = () => {
    const allSelected = refPairs.every(p => p.selected !== false)
    onUpdate(refPairs.map(p => ({ ...p, selected: !allSelected })))
  }

  const updatePair = (index, field, value) => {
    const updated = [...refPairs]
    updated[index] = { ...updated[index], [field]: value }
    onUpdate(updated)
  }

  const toggleRef = (pairIndex, refId) => {
    const pair = refPairs[pairIndex]
    const currentIds = [...(pair.refIds || [])]

    if (currentIds.includes(refId)) {
      // 이미 선택된 거면 제거
      updatePair(pairIndex, 'refIds', currentIds.filter(id => id !== refId))
    } else if (currentIds.length < MAX_REFS_PER_ROW) {
      // 3개 미만이면 추가
      updatePair(pairIndex, 'refIds', [...currentIds, refId])
    }
  }

  const addRow = () => {
    onUpdate([
      ...refPairs,
      {
        id: `rp_${nextRefPairId++}`,
        refIds: [],
        prompt: '',
        status: 'waiting',
      },
    ])
  }

  const removeRow = (index) => {
    onUpdate(refPairs.filter((_, i) => i !== index))
  }

  const getRefThumb = (refId) => {
    const ref = references.find(r => r.id === refId || r.name === refId)
    return ref?.data || ref?.image || null
  }

  const getRefLabel = (ref) => {
    const categoryIcon = ref.category === 'person' ? '🧑' :
                         ref.category === 'scene'  ? '🏞️' :
                         ref.category === 'style'  ? '🎨' : '📎'
    return `${categoryIcon} ${ref.name}`
  }

  if (availableRefs.length === 0) {
    return (
      <div className="video-panel-empty">
        <p>🔗 {t('refToVideo.noRefsWithMedia')}</p>
      </div>
    )
  }

  return (
    <div className="video-panel">
      <div className="video-panel-header">
        <p className="video-panel-description">{t('refToVideo.description')}</p>
      </div>

      <div className="video-mapping-table">
        {/* 테이블 헤더 */}
        <div className="mapping-row mapping-header">
          <th className="col-check"><input
            type="checkbox"
            checked={refPairs.length > 0 && refPairs.every(p => p.selected !== false)}
            onChange={toggleSelectAll}
            disabled={disabled}
          /></th>
          <span className="mapping-col col-num">#</span>
          <span className="mapping-col col-refs">{t('refToVideo.references')}</span>
          <span className="mapping-col col-prompt">{t('refToVideo.prompt')}</span>
          <span className="mapping-col col-status">{t('refToVideo.status')}</span>
          <span className="mapping-col col-action"></span>
        </div>

        {/* 매핑 행들 */}
        {refPairs.map((pair, index) => (
          <div key={pair.id} className="mapping-row">
            <td className="col-check"><input
              type="checkbox"
              checked={pair.selected !== false}
              onChange={() => toggleSelect(pair.id)}
              disabled={disabled}
            /></td>
            <span className="mapping-col col-num">{index + 1}</span>

            {/* 레퍼런스 멀티 셀렉트 */}
            <div className="mapping-col col-refs">
              <div className="ref-chips">
                {/* 선택된 레퍼런스 칩 */}
                {(pair.refIds || []).map(refId => {
                  const ref = availableRefs.find(r => r.id === refId || r.name === refId)
                  if (!ref) return null
                  return (
                    <span
                      key={refId}
                      className="ref-chip selected"
                      onClick={() => !disabled && pair.status !== 'generating' && toggleRef(index, refId)}
                    >
                      {getRefThumb(refId) && (
                        <img src={getRefThumb(refId)} alt="" className="ref-chip-thumb" />
                      )}
                      {getRefLabel(ref)}
                      <span className="ref-chip-remove">✕</span>
                    </span>
                  )
                })}

                {/* 추가 가능한 레퍼런스 */}
                {(pair.refIds || []).length < MAX_REFS_PER_ROW && (
                  <select
                    className="ref-add-select"
                    value=""
                    onChange={(e) => {
                      if (e.target.value) toggleRef(index, e.target.value)
                    }}
                    disabled={disabled || pair.status === 'generating'}
                  >
                    <option value="">{t('refToVideo.selectRefs')}</option>
                    {availableRefs
                      .filter(r => !(pair.refIds || []).includes(r.id || r.name))
                      .map(ref => (
                        <option key={ref.id || ref.name} value={ref.id || ref.name}>
                          {getRefLabel(ref)}
                        </option>
                      ))
                    }
                  </select>
                )}
              </div>
            </div>

            {/* 프롬프트 */}
            <div className="mapping-col col-prompt">
              <input
                type="text"
                value={pair.prompt}
                onChange={(e) => updatePair(index, 'prompt', e.target.value)}
                disabled={disabled || pair.status === 'generating'}
                placeholder={t('refToVideo.promptPlaceholder')}
              />
            </div>

            {/* 상태 */}
            <span className="mapping-col col-status">
              {STATUS_ICONS[pair.status] || '⏳'} {t(`refToVideo.${pair.status}`)}
            </span>

            {/* 삭제 */}
            <div className="mapping-col col-action">
              <button
                className="btn-remove"
                onClick={() => removeRow(index)}
                disabled={disabled || pair.status === 'generating'}
                title={t('refToVideo.removeRow')}
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
        {t('refToVideo.addRow')}
      </button>
    </div>
  )
}
