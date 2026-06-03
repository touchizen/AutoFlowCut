/**
 * ModelSelector — 모델 선택 카드 리스트. 옵션마다 이름·특징·비용·문서링크를 보여준다.
 * 설정에서 T2I / T2V / F2V 각각에 재사용. priceUrl 주면 하단에 가격표 링크 표시.
 */
import './ModelSelector.css'

const openExternal = (url) => window.electronAPI?.openExternal?.(url)

export default function ModelSelector({ options, value, defaultValue, onChange, t, priceUrl }) {
  const selected = value || defaultValue
  return (
    <div className="model-selector">
      {(options || []).map((m) => (
        <button
          key={m.id}
          type="button"
          className={`model-option ${selected === m.id ? 'active' : ''}`}
          onClick={() => onChange(m.id)}
        >
          <span className="model-name">{m.label}</span>
          <span className="model-desc">{t(m.descKey)}</span>
          <span className="model-cost">{m.cost}</span>
          {m.url && (
            // 카드 내부지만 카드 선택(onChange)과 분리 — stopPropagation. (button 중첩 회피 위해 span)
            <span
              className="model-doc"
              role="link"
              tabIndex={0}
              title={m.url}
              onClick={(e) => { e.stopPropagation(); openExternal(m.url) }}
            >
              {t('settings.modelDocsLink')}
            </span>
          )}
        </button>
      ))}
      {priceUrl && (
        <button
          type="button"
          className="model-pricing-link"
          title={priceUrl}
          onClick={() => openExternal(priceUrl)}
        >
          {t('settings.modelPricingLink')}
        </button>
      )}
    </div>
  )
}
