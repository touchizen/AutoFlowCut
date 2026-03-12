/**
 * SelectablePromptList — 비디오 프롬프트 선택 리스트
 * 체크박스로 생성할 항목을 선택/해제
 */
import { useI18n } from '../hooks/useI18n'

export default function SelectablePromptList({ items, onToggle, onToggleAll, disabled = false }) {
  const { t } = useI18n()

  if (!items || items.length === 0) return null

  const allSelected = items.every(i => i.selected !== false)
  const selectedCount = items.filter(i => i.selected !== false).length

  return (
    <div className="selectable-prompt-list">
      <div className="select-header">
        <label className="select-all-label">
          <input
            type="checkbox"
            checked={allSelected}
            onChange={onToggleAll}
            disabled={disabled}
          />
          <span>{t('videoSelection.selectAll')} ({selectedCount}/{items.length})</span>
        </label>
      </div>
      <ul className="select-items">
        {items.map((item, i) => (
          <li key={item.id} className={`select-item ${item.selected === false ? 'deselected' : ''}`}>
            <input
              type="checkbox"
              checked={item.selected !== false}
              onChange={() => onToggle(item.id)}
              disabled={disabled}
            />
            <span className="item-num">{i + 1}.</span>
            <span className="item-prompt" title={item.prompt}>
              {item.prompt?.substring(0, 60) || ''}
              {(item.prompt?.length || 0) > 60 && '...'}
            </span>
            {item.status === 'done' && <span className="item-status">✅</span>}
            {item.status === 'complete' && <span className="item-status">✅</span>}
            {item.status === 'error' && <span className="item-status">❌</span>}
            {item.status === 'generating' && <span className="item-status spinner">⚙️</span>}
          </li>
        ))}
      </ul>
    </div>
  )
}
