import { useState, useMemo, useEffect } from 'react'
import { resolveImageSrc } from '../utils/formatters'
import { toFileUrl } from '../hooks/useStyleThumbnails'
import './TagInputAutocomplete.css'

// 마지막 토큰만 분리. splitTags와 동일한 separator(,;:) 사용.
function splitLastToken(value) {
  if (!value) return { last: '' }
  const match = value.match(/^(.*[,;:]\s*)(.*)$/)
  if (match) return { last: match[2] }
  return { last: value }
}

export default function TagInputAutocomplete({
  type,
  value,
  onChange,
  references = [],
  presets = [],
  thumbnails = {},   // preset id → file path/url (useStyleThumbnails 결과)
  placeholder,
  disabled,
  title,
  className,
  isKo,
  t,
}) {
  const [isFocused, setIsFocused] = useState(false)
  const [highlightedIndex, setHighlightedIndex] = useState(-1)

  const refOptions = useMemo(() =>
    references
      .filter(r => r.type === type && r.name)
      .map(r => ({ kind: 'ref', label: r.name, value: r.name, src: resolveImageSrc(r) || null })),
    [references, type]
  )

  const presetOptions = useMemo(() =>
    (type === 'style' ? presets : []).map(p => ({
      kind: 'preset',
      label: isKo ? (p.name_ko || p.name_en) : (p.name_en || p.name_ko),
      value: isKo ? (p.name_ko || p.name_en) : (p.name_en || p.name_ko),
      src: thumbnails[p.id] ? toFileUrl(thumbnails[p.id]) : null,
    })),
    [type, presets, isKo, thumbnails]
  )

  const allOptions = useMemo(
    () => [...refOptions, ...presetOptions],
    [refOptions, presetOptions]
  )

  // 알려진 옵션 값 집합 (소문자) — 확정 선택 판정용
  const optionValueSet = useMemo(
    () => new Set(allOptions.map(o => o.value.toLowerCase())),
    [allOptions]
  )

  const isMulti = type === 'character'

  const { last } = splitLastToken(value)
  const filterToken = last.trim().toLowerCase()

  const filteredOptions = useMemo(() => {
    if (!filterToken) return allOptions
    return allOptions.filter(o => o.label.toLowerCase().includes(filterToken))
  }, [allOptions, filterToken])

  // 옵션 리스트 변경 시 highlight reset (사용자가 타이핑할 때마다 -1로)
  useEffect(() => { setHighlightedIndex(-1) }, [filterToken])

  const applyOption = (opt) => {
    if (isMulti) {
      // 토글: 입력 중이던 미완성 마지막 토큰은 버린다
      const rawTokens = (value || '').split(/[,;:]/).map(s => s.trim()).filter(Boolean)
      const lastTrim = last.trim()
      const dropLast = lastTrim !== '' && !optionValueSet.has(lastTrim.toLowerCase())
      const tokens = dropLast ? rawTokens.slice(0, -1) : rawTokens
      const lc = opt.value.toLowerCase()
      const exists = tokens.some(tok => tok.toLowerCase() === lc)
      const next = exists
        ? tokens.filter(tok => tok.toLowerCase() !== lc)
        : [...tokens, opt.value]
      onChange(next.join(', '))
    } else {
      onChange(opt.value)
    }
    setHighlightedIndex(-1)
  }

  const handleKeyDown = (e) => {
    if (!isFocused || filteredOptions.length === 0) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setHighlightedIndex(i => Math.min(i + 1, filteredOptions.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setHighlightedIndex(i => Math.max(i - 1, 0))
    } else if (e.key === 'Enter') {
      if (highlightedIndex >= 0 && highlightedIndex < filteredOptions.length) {
        e.preventDefault()
        applyOption(filteredOptions[highlightedIndex])
      }
    } else if (e.key === 'Escape') {
      e.preventDefault()
      setIsFocused(false)
      setHighlightedIndex(-1)
    }
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
        onKeyDown={handleKeyDown}
      />
      {isFocused && !disabled && (
        <div className="tag-autocomplete-dropdown">
          {filteredOptions.length === 0 ? (
            <div className="tag-autocomplete-empty">{t('sceneList.noRefsForType')}</div>
          ) : (
            filteredOptions.map((opt, i) => (
              <div
                key={`${opt.kind}-${i}`}
                className={`tag-autocomplete-option ${opt.kind} ${i === highlightedIndex ? 'highlighted' : ''}`}
                onMouseDown={(e) => {
                  e.preventDefault()
                  applyOption(opt)
                }}
                onMouseEnter={() => setHighlightedIndex(i)}
              >
                {opt.src ? (
                  <img src={opt.src} alt="" className="tag-autocomplete-thumb" loading="lazy" />
                ) : (
                  <span className="tag-autocomplete-thumb empty" />
                )}
                <span className="tag-autocomplete-option-label">
                  {opt.label}
                  {opt.kind === 'preset' && <span className="preset-suffix"> (preset)</span>}
                </span>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  )
}
