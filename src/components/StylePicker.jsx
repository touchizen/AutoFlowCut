/**
 * StylePicker - 썸네일 그리드 기반 스타일 프리셋 선택기
 */

import { useState, useMemo } from 'react'
import { STYLE_PRESETS } from '../config/defaults'
import { resolveImageSrc, hasImageData, formatElapsedMs } from '../utils/formatters'
import { toFileUrl } from '../hooks/useStyleThumbnails'
import { useElapsedTimer } from '../hooks/useElapsedTimer'
import './StylePicker.css'

const ALL_CATEGORY = '__all__'

export default function StylePicker({
  selectedId,
  onSelect,
  thumbnails = {},
  onDeleteThumbnail,
  uploadedStyleRefs = [],
  generating,
  stopping,
  progress = { current: 0, total: 0 },
  onGenerateThumbnails,
  onStopGenerating,
  t,
  isKo
}) {
  const [activeCategory, setActiveCategory] = useState(ALL_CATEGORY)
  const [searchQuery, setSearchQuery] = useState('')
  const [previewStyle, setPreviewStyle] = useState(null)  // 더블클릭 미리보기
  const [hoverPreview, setHoverPreview] = useState(null)  // 호버 풍선 { style, thumb, x, y }

  const elapsedSec = useElapsedTimer(generating && progress.startedAt ? progress.startedAt : null)
  const elapsed = elapsedSec * 1000 // ms로 변환 (기존 formatElapsedMs 호환)

  const categories = STYLE_PRESETS?.categories || []
  const allStyles = STYLE_PRESETS?.styles || []

  // 카테고리 + 검색어 필터
  const filteredStyles = useMemo(() => {
    let result = activeCategory === ALL_CATEGORY
      ? allStyles
      : allStyles.filter(s => s.category === activeCategory)

    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase()
      result = result.filter(s =>
        s.name_ko?.toLowerCase().includes(q) ||
        s.name_en?.toLowerCase().includes(q) ||
        s.prompt_en?.toLowerCase().includes(q)
      )
    }
    return result
  }, [activeCategory, allStyles, searchQuery])

  // 썸네일 미생성 수 (프리셋 + 이미지 없는 커스텀 스타일)
  const missingPresetCount = allStyles.filter(s => !thumbnails[s.id]).length
  const missingCustomCount = uploadedStyleRefs.filter(r => !hasImageData(r)).length
  const missingCount = missingPresetCount + missingCustomCount

  return (
    <div className="style-picker">
      {/* 카테고리 탭 */}
      <div className="sp-categories">
        <button
          className={`sp-cat-tab ${activeCategory === ALL_CATEGORY ? 'active' : ''}`}
          onClick={() => setActiveCategory(ALL_CATEGORY)}
        >
          {t('reference.allCategories')}
        </button>
        {categories.map(cat => {
          const count = allStyles.filter(s => s.category === cat.id).length
          return (
            <button
              key={cat.id}
              className={`sp-cat-tab ${activeCategory === cat.id ? 'active' : ''}`}
              onClick={() => setActiveCategory(cat.id)}
              title={isKo ? cat.name_ko : cat.name_en}
            >
              {cat.icon} {isKo ? cat.name_ko : cat.name_en}
              <span className="sp-cat-count">{count}</span>
            </button>
          )
        })}
      </div>

      {/* 검색 */}
      <div className="sp-search">
        <input
          type="text"
          className="sp-search-input"
          placeholder={isKo ? '스타일 검색...' : 'Search styles...'}
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
        />
        {searchQuery && (
          <button className="sp-search-clear" onClick={() => setSearchQuery('')}>✕</button>
        )}
      </div>

      {/* 업로드된 스타일 레퍼런스 (있으면) */}
      {uploadedStyleRefs.length > 0 && activeCategory === ALL_CATEGORY && (
        <div className="sp-uploaded-section">
          <div className="sp-section-label">{t('reference.uploadedStyles')}</div>
          <div className="sp-grid">
            {uploadedStyleRefs.map(ref => (
              <div
                key={`ref:${ref.id}`}
                className={`sp-card ${selectedId === `ref:${ref.id}` ? 'selected' : ''}`}
                onClick={() => onSelect(selectedId === `ref:${ref.id}` ? null : `ref:${ref.id}`)}
              >
                <div className="sp-thumb">
                  {hasImageData(ref) ? (
                    <img src={resolveImageSrc(ref)} alt={ref.name} />
                  ) : (
                    <span className="sp-icon">🖼️</span>
                  )}
                </div>
                <div className="sp-name">{ref.name || 'Style'}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 프리셋 스타일 그리드 */}
      <div className="sp-grid">
        {/* 스타일 없음 카드 */}
        <div
          className={`sp-card sp-no-style ${!selectedId ? 'selected' : ''}`}
          onClick={() => onSelect(null)}
        >
          <div className="sp-thumb">
            <span className="sp-icon">🚫</span>
          </div>
          <div className="sp-name">{t('reference.noStyle')}</div>
        </div>

        {filteredStyles.map(style => {
          const thumb = thumbnails[style.id]
          const cat = categories.find(c => c.id === style.category)
          const styleName = isKo ? style.name_ko : style.name_en
          return (
            <div
              key={style.id}
              className={`sp-card ${selectedId === `preset:${style.id}` ? 'selected' : ''}`}
              onClick={() => onSelect(selectedId === `preset:${style.id}` ? null : `preset:${style.id}`)}
              onContextMenu={(e) => {
                if (!thumb) return
                e.preventDefault()
                if (window.confirm(`"${styleName}" 썸네일을 삭제하시겠습니까?`)) {
                  onDeleteThumbnail?.(style.id)
                }
              }}
              title={styleName}
            >
              <div className="sp-thumb">
                {thumb ? (
                  <img
                    src={toFileUrl(thumb)}
                    alt={styleName}
                    loading="lazy"
                    onDoubleClick={(e) => {
                      e.stopPropagation()
                      setPreviewStyle({ ...style, thumb })
                    }}
                    onMouseEnter={(e) => {
                      const rect = e.currentTarget.getBoundingClientRect()
                      setHoverPreview({
                        style, thumb,
                        x: rect.right + 8,
                        y: rect.top
                      })
                    }}
                    onMouseLeave={() => setHoverPreview(null)}
                  />
                ) : (
                  <span className="sp-icon">{cat?.icon || '🎨'}</span>
                )}
              </div>
              <div className="sp-name">{styleName}</div>
            </div>
          )
        })}
      </div>

      {/* 하단: 썸네일 생성 버튼 + 진행 */}
      <div className="sp-footer">
        {generating ? (
          <div className="sp-progress-row">
            <div className="sp-progress-bar">
              <div
                className="sp-progress-fill"
                style={{ width: `${progress.total > 0 ? (progress.current / progress.total) * 100 : 0}%` }}
              />
            </div>
            <span className="sp-progress-text">
              {t('reference.thumbnailProgress', { current: progress.current, total: progress.total })}
              {elapsed > 0 && <span className="sp-elapsed"> {formatElapsedMs(elapsed)}</span>}
            </span>
            <button className={`sp-btn-stop ${stopping ? 'stopping' : ''}`} onClick={onStopGenerating} disabled={stopping}>
              {stopping ? `⏳ ${t('reference.stopping')}...` : t('reference.stop')}
            </button>
          </div>
        ) : missingCount > 0 ? (
          <button className="sp-btn-generate" onClick={() => {
            const customMissing = uploadedStyleRefs.filter(r => !hasImageData(r))
            onGenerateThumbnails?.(null, customMissing)
          }}>
            🎨 {t('reference.generateThumbnails')} ({missingCount})
          </button>
        ) : null}
      </div>
      {/* 호버 풍선 미리보기 */}
      {hoverPreview && (
        <div
          className="sp-hover-balloon"
          style={{
            top: Math.min(hoverPreview.y, window.innerHeight - 320),
            left: Math.min(hoverPreview.x, window.innerWidth - 280)
          }}
        >
          <img src={toFileUrl(hoverPreview.thumb)} alt="" />
          <div className="sp-hover-name">{isKo ? hoverPreview.style.name_ko : hoverPreview.style.name_en}</div>
        </div>
      )}

      {/* 미리보기 모달 */}
      {previewStyle && (
        <div className="sp-preview-overlay" onClick={() => setPreviewStyle(null)}>
          <div className="sp-preview" onClick={e => e.stopPropagation()}>
            <div className="sp-preview-header">
              <span>{isKo ? previewStyle.name_ko : previewStyle.name_en}</span>
              <button className="sp-preview-close" onClick={() => setPreviewStyle(null)}>✕</button>
            </div>
            <div className="sp-preview-image">
              <img src={toFileUrl(previewStyle.thumb)} alt={isKo ? previewStyle.name_ko : previewStyle.name_en} />
            </div>
            <div className="sp-preview-prompt">{previewStyle.prompt_en}</div>
          </div>
        </div>
      )}
    </div>
  )
}
