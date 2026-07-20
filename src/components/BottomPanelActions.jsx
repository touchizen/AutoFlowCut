/**
 * BottomPanelActions — 하단 패널의 확장 가능한 보조 액션 메뉴.
 */

import { useEffect, useRef, useState } from 'react'

export default function BottomPanelActions({ items, onUpscale, t = (key) => key }) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef(null)
  const triggerRef = useRef(null)
  const menuItems = items || [{
    id: 'image-upscale',
    label: `⬆️ ${t('bottomPanel.imageUpscale')}`,
    onSelect: onUpscale,
  }]

  useEffect(() => {
    if (!open) return undefined

    const handleOutside = (event) => {
      if (rootRef.current && !rootRef.current.contains(event.target)) setOpen(false)
    }
    const handleKeyDown = (event) => {
      if (event.key !== 'Escape') return
      setOpen(false)
      triggerRef.current?.focus()
    }

    document.addEventListener('mousedown', handleOutside)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('mousedown', handleOutside)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [open])

  const selectItem = (item) => {
    setOpen(false)
    item.onSelect?.()
  }

  return (
    <div ref={rootRef} style={{ position: 'relative', padding: '4px 8px' }}>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((previous) => !previous)}
        aria-label={t('bottomPanel.actionsMenu')}
        aria-haspopup="menu"
        aria-expanded={open}
        style={{
          minWidth: '32px',
          padding: '3px 9px',
          fontSize: '15px',
          lineHeight: 1,
          border: '1px solid #3a3a3a',
          background: 'transparent',
          color: '#999',
          borderRadius: '4px',
          cursor: 'pointer',
        }}
      >
        ≡
      </button>
      {open && (
        <div
          role="menu"
          aria-label={t('bottomPanel.actionsMenu')}
          style={{
            position: 'absolute',
            top: 'calc(100% - 2px)',
            right: '8px',
            minWidth: '170px',
            padding: '4px',
            border: '1px solid #3a3a3a',
            background: '#242424',
            borderRadius: '6px',
            boxShadow: '0 6px 18px rgba(0, 0, 0, 0.45)',
            zIndex: 200,
          }}
        >
          {menuItems.map((item) => (
            <button
              key={item.id}
              type="button"
              role="menuitem"
              onClick={() => selectItem(item)}
              style={{
                display: 'block',
                width: '100%',
                padding: '7px 10px',
                border: 0,
                background: 'transparent',
                color: '#ddd',
                borderRadius: '4px',
                cursor: 'pointer',
                fontSize: '12px',
                textAlign: 'left',
                whiteSpace: 'nowrap',
              }}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
