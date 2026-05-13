import { useState, useMemo } from 'react'
import './TagInputAutocomplete.css'

// 마지막 토큰 + 그 앞의 prefix를 분리. splitTags와 동일한 separator(,;:) 사용.
function splitLastToken(value) {
  if (!value) return { prefix: '', last: '' }
  const match = value.match(/^(.*[,;:]\s*)(.*)$/)
  if (match) return { prefix: match[1], last: match[2] }
  return { prefix: '', last: value }
}

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

  const refOptions = useMemo(() =>
    references
      .filter(r => r.type === type && r.name)
      .map(r => ({ kind: 'ref', label: r.name, value: r.name })),
    [references, type]
  )

  const presetOptions = useMemo(() =>
    (type === 'style' ? presets : []).map(p => ({
      kind: 'preset',
      label: isKo ? (p.name_ko || p.name_en) : (p.name_en || p.name_ko),
      value: isKo ? (p.name_ko || p.name_en) : (p.name_en || p.name_ko),
    })),
    [type, presets, isKo]
  )

  const { prefix, last } = splitLastToken(value)
  const filterToken = last.trim().toLowerCase()

  const filteredOptions = useMemo(() => {
    const all = [...refOptions, ...presetOptions]
    if (!filterToken) return all
    return all.filter(o => o.label.toLowerCase().includes(filterToken))
  }, [refOptions, presetOptions, filterToken])

  const applyOption = (opt) => {
    const newValue = prefix + opt.value
    onChange(newValue)
  }

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
          {filteredOptions.length === 0 ? (
            <div className="tag-autocomplete-empty">{t('sceneList.noRefsForType')}</div>
          ) : (
            filteredOptions.map((opt, i) => (
              <div
                key={`${opt.kind}-${i}`}
                className={`tag-autocomplete-option ${opt.kind}`}
                onMouseDown={(e) => {
                  e.preventDefault()
                  applyOption(opt)
                }}
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
