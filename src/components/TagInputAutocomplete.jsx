import { useState } from 'react'
import './TagInputAutocomplete.css'

export default function TagInputAutocomplete({
  type,
  value,
  onChange,
  references = [],
  presets = [],
  placeholder,
  disabled,
  title,
  className,
  isKo,
  t,
}) {
  const [isFocused, setIsFocused] = useState(false)

  const refOptions = references
    .filter(r => r.type === type && r.name)
    .map(r => ({ kind: 'ref', label: r.name, value: r.name }))

  const presetOptions = (type === 'style' ? presets : [])
    .map(p => ({
      kind: 'preset',
      label: isKo ? (p.name_ko || p.name_en) : (p.name_en || p.name_ko),
      value: isKo ? (p.name_ko || p.name_en) : (p.name_en || p.name_ko),
    }))

  const allOptions = [...refOptions, ...presetOptions]

  return (
    <div className="tag-autocomplete-wrapper">
      <input
        type="text"
        value={value || ''}
        placeholder={placeholder}
        disabled={disabled}
        title={title}
        className={className}
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => setIsFocused(true)}
        onBlur={() => setTimeout(() => setIsFocused(false), 150)}
      />
      {isFocused && !disabled && (
        <div className="tag-autocomplete-dropdown">
          {allOptions.length === 0 ? (
            <div className="tag-autocomplete-empty">{t('sceneList.noRefsForType')}</div>
          ) : (
            allOptions.map((opt, i) => (
              <div
                key={`${opt.kind}-${i}`}
                className={`tag-autocomplete-option ${opt.kind}`}
                onMouseDown={(e) => e.preventDefault()}
              >
                {opt.label}
                {opt.kind === 'preset' && <span className="preset-suffix"> (preset)</span>}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  )
}
