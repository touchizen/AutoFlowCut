/**
 * ExportSplitButton — 진입 export 버튼(헤더 + 메인 액션 공용).
 *
 * 본체: 마지막 선택 format 으로 동작/문구 (onSelect(format)).
 * ▾ 트리거: 포맷 드롭다운(CapCut/Premiere/Vrew) → 선택 시 onSelect(key).
 * 외부 클릭 시 메뉴 닫힘 (GenerateMenu 패턴).
 *
 * props:
 *   format          — 현재(마지막 선택) 포맷 'capcut' | 'premiere' | 'vrew'
 *   onSelect        — (format) => void. 본체/메뉴 선택 공통 진입.
 *   disabled        — 본체/트리거 비활성
 *   className        — 본체+트리거 공유 색상 클래스 (예: 'btn-success' | 'btn-export')
 *   wrapperClassName — 래퍼 sizing (예: 'half' → 행 채움)
 *   direction       — 메뉴 열림 방향 'down'(기본) | 'up'
 *   title           — 본체 버튼 tooltip
 */

import { useState, useRef, useEffect } from 'react'
import { useI18n } from '../hooks/useI18n'
import { normalizeExportFormat } from '../utils/exportFormat'
import './ExportSplitButton.css'

const FORMATS = [
  { key: 'capcut', label: '✂️ CapCut' },
  { key: 'premiere', label: '🎬 Premiere' },
  { key: 'vrew', label: '📝 Vrew' },
  { key: 'render', label: '🎞️ Render' },
]

export default function ExportSplitButton({ format = 'capcut', onSelect, disabled = false, className = '', wrapperClassName = '', direction = 'down', title }) {
  const { t } = useI18n()
  const [menuOpen, setMenuOpen] = useState(false)
  const ref = useRef(null)

  // 외부 클릭 시 닫기 (GenerateMenu 패턴)
  useEffect(() => {
    const onDown = (e) => { if (ref.current && !ref.current.contains(e.target)) setMenuOpen(false) }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [])

  const fmt = normalizeExportFormat(format)
  const primaryLabel = fmt === 'premiere'
    ? t('actions.exportPremiere')
    : fmt === 'vrew'
      ? t('actions.exportVrew')
      : fmt === 'render'
        ? t('actions.exportRender')
        : t('actions.exportCapcut')

  const pick = (key) => {
    setMenuOpen(false)
    onSelect?.(key)
  }

  return (
    <div className={`export-split ${wrapperClassName} ${direction === 'up' ? 'export-split--up' : ''}`} ref={ref}>
      <button
        type="button"
        className={`export-split-main ${className}`}
        onClick={() => onSelect?.(fmt)}
        disabled={disabled}
        title={title}
      >
        <span className="btn-emoji">📦</span>
        <span className="export-split-label btn-text">{primaryLabel}</span>
      </button>
      <button
        type="button"
        className={`export-split-trigger ${className}`}
        onClick={() => setMenuOpen((o) => !o)}
        disabled={disabled}
        aria-label={t('exportModal.formatSelectLabel')}
        aria-haspopup="menu"
        aria-expanded={menuOpen}
      >
        ▾
      </button>
      {menuOpen && (
        <div className="export-split-menu" role="menu">
          {FORMATS.map((f) => (
            <button
              key={f.key}
              type="button"
              role="menuitem"
              className="export-split-item"
              aria-current={f.key === fmt}
              onClick={() => pick(f.key)}
            >
              {f.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
