/**
 * LanguagePicker — 공용 언어 선택 드롭다운 (인라인 SVG 국기 + 언어코드).
 * Header / ModeSelector(첫 실행 피커) 등에서 공유한다.
 *
 * Props:
 *   current    — 현재 언어 코드 (예: 'ko' | 'en')
 *   languages  — [{ code, name, country }]
 *   onChange   — (code) => void
 *   tooltip    — 버튼 aria-label / data-tooltip 텍스트 (선택)
 */
import { useState, useRef, useEffect } from 'react'
import './LanguagePicker.css'

/**
 * FlagIcon — flag-icons CSS 라이브러리 클래스 사용.
 * Vite가 node_modules/flag-icons/flags 의 SVG 자산을 번들링.
 */
export function FlagIcon({ country, className = 'lang-flag' }) {
  if (!country) return <span className={className} />
  return <span className={`fi fi-${country} ${className}`} aria-hidden="true" />
}

export default function LanguagePicker({ current, languages, onChange, tooltip }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)

  useEffect(() => {
    const handler = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const currentLang = languages.find((l) => l.code === current) || languages[0]

  return (
    <div className="lang-picker" ref={ref} data-tooltip={tooltip}>
      <button
        type="button"
        className="lang-picker-button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label={tooltip}
      >
        <FlagIcon country={currentLang.country} />
        <span className="lang-code">{currentLang.name}</span>
        <svg className="lang-arrow" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
          <path strokeLinecap="round" strokeLinejoin="round" d="M6 9l6 6 6-6" />
        </svg>
      </button>
      {open && (
        <div className="lang-picker-menu">
          {languages.map((l) => (
            <button
              type="button"
              key={l.code}
              className={`lang-picker-item ${l.code === current ? 'active' : ''}`}
              onClick={() => {
                onChange(l.code)
                setOpen(false)
              }}
            >
              <FlagIcon country={l.country} />
              <span className="lang-code">{l.name}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
