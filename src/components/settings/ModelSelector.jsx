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
        // 선택 버튼과 문서 링크를 sibling 으로 — button 안에 interactive(tabindex) 자손을 두는
        // HTML 위반/키보드 불가를 피한다. 둘 다 독립 button 이라 클릭 버블도 자연 분리.
        <div key={m.id} className="model-option-row">
          <button
            type="button"
            className={`model-option ${selected === m.id ? 'active' : ''}`}
            onClick={() => onChange(m.id)}
          >
            <span className="model-name">{m.label}</span>
            <span className="model-desc">{t(m.descKey)}</span>
            <span className="model-cost">{m.cost}</span>
          </button>
          {m.url && (
            <button
              type="button"
              className="model-doc"
              title={m.url}
              onClick={() => openExternal(m.url)}
            >
              {t('settings.modelDocsLink')}
            </button>
          )}
        </div>
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
