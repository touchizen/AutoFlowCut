/**
 * ModelSelector — 모델 선택 콤보(드롭다운). 접힌 상태엔 "라벨 · 비용"을, 아래 한 줄에
 * 선택 모델의 설명 + 문서/가격 링크를 보여준다. 설정에서 T2I / T2V / F2V 각각 재사용.
 * (카드 리스트는 셀렉터 3개가 너무 길어져 콤보로 전환.)
 */
import './ModelSelector.css'

const openExternal = (url) => window.electronAPI?.openExternal?.(url)

// 단위(장/sec 등)는 locale 로 — 비용 문자열에 한글 박지 않기 위함.
const UNIT_KEY = { image: 'settings.unitPerImage', sec: 'settings.unitPerSec' }
const costText = (m, t) => {
  if (!m.cost) return ''
  const unit = m.unit && UNIT_KEY[m.unit] ? `/${t(UNIT_KEY[m.unit])}` : ''
  return `${m.cost}${unit}`
}

export default function ModelSelector({ options, value, defaultValue, onChange, t, priceUrl }) {
  const list = options || []
  const selected = value || defaultValue
  const selectedModel = list.find((m) => m.id === selected)
  return (
    <div className="model-selector">
      <div className="model-select-row">
        <select
          className="model-select"
          value={selected || ''}
          onChange={(e) => onChange(e.target.value)}
        >
          {list.map((m) => (
            <option key={m.id} value={m.id}>
              {m.cost ? `${m.label} · ${costText(m, t)}` : m.label}
            </option>
          ))}
        </select>
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
      {selectedModel && (
        <div className="model-select-info">
          <span className="model-desc">{t(selectedModel.descKey)}</span>
          {selectedModel.url && (
            <button
              type="button"
              className="model-doc"
              title={selectedModel.url}
              onClick={() => openExternal(selectedModel.url)}
            >
              {t('settings.modelDocsLink')}
            </button>
          )}
        </div>
      )}
    </div>
  )
}
