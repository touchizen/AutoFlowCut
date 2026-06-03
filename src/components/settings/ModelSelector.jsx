/**
 * ModelSelector — 모델 선택 카드 리스트. 옵션마다 이름·특징·비용을 보여준다.
 * 설정에서 T2I / T2V / F2V 각각에 재사용.
 */
import './ModelSelector.css'

export default function ModelSelector({ options, value, defaultValue, onChange, t }) {
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
        </button>
      ))}
    </div>
  )
}
