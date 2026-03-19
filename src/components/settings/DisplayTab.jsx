/**
 * DisplayTab - 화면 레이아웃 + 절전 방지 설정 탭
 */

import { useState, useEffect } from 'react'

const LAYOUT_OPTIONS = [
  { value: 'split-left', labelKey: 'settings.layoutSplitLeft' },
  { value: 'split-right', labelKey: 'settings.layoutSplitRight' },
  { value: 'split-top', labelKey: 'settings.layoutSplitTop' },
  { value: 'split-bottom', labelKey: 'settings.layoutSplitBottom' },
]

export default function DisplayTab({ localSettings, setLocalSettings, t }) {
  const layoutMode = localSettings.layoutMode || 'split-left'
  const [preventSleep, setPreventSleep] = useState(false)

  useEffect(() => {
    window.electronAPI?.getPreventSleep?.().then(r => {
      if (r) setPreventSleep(r.enabled)
    }).catch(() => {})
  }, [])

  const handlePreventSleep = async (enabled) => {
    setPreventSleep(enabled)
    try {
      await window.electronAPI?.setPreventSleep?.({ enabled })
    } catch {}
  }

  return (
    <div className="tab-panel">
      {/* 레이아웃 */}
      <div className="setting-row" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <label className="setting-label" style={{ margin: 0 }}>{t('settings.layoutMode')}</label>
        <div style={{ display: 'flex', gap: '2px' }}>
          {LAYOUT_OPTIONS.map(opt => (
            <button
              key={opt.value}
              onClick={() => setLocalSettings(s => ({ ...s, layoutMode: opt.value }))}
              style={{
                padding: '4px 10px',
                fontSize: '12px',
                border: '1px solid',
                borderColor: layoutMode === opt.value ? '#4a9eff' : '#555',
                background: layoutMode === opt.value ? '#4a9eff' : 'transparent',
                color: layoutMode === opt.value ? '#fff' : '#aaa',
                borderRadius: opt === LAYOUT_OPTIONS[0] ? '4px 0 0 4px' : opt === LAYOUT_OPTIONS[LAYOUT_OPTIONS.length - 1] ? '0 4px 4px 0' : '0',
                cursor: 'pointer',
              }}
            >
              {t(opt.labelKey)}
            </button>
          ))}
        </div>
      </div>

      <hr style={{ border: 'none', borderTop: '1px solid #333', margin: '12px 0' }} />

      {/* Flow 비율 */}
      <div className="setting-row">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <label className="setting-label" style={{ margin: 0 }}>{t('settings.splitRatio')}</label>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flex: 1, marginLeft: '16px' }}>
            <span style={{ fontSize: '11px', color: '#888', whiteSpace: 'nowrap' }}>20%</span>
            <input
              type="range"
              min="20" max="80" step="5"
              value={Math.round((localSettings.splitRatio || 0.5) * 100)}
              onChange={(e) => setLocalSettings(s => ({ ...s, splitRatio: parseInt(e.target.value) / 100 }))}
              style={{ flex: 1 }}
              className="setting-slider"
            />
            <span style={{ fontSize: '11px', color: '#888', whiteSpace: 'nowrap' }}>80%</span>
            <span style={{ fontSize: '12px', color: '#ccc', fontWeight: 'bold', minWidth: '35px', textAlign: 'right' }}>
              {Math.round((localSettings.splitRatio || 0.5) * 100)}%
            </span>
          </div>
        </div>
      </div>

      <hr style={{ border: 'none', borderTop: '1px solid #333', margin: '12px 0' }} />

      {/* 화면 꺼짐 방지 */}
      <div className="setting-row">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <label className="setting-label" style={{ margin: 0 }}>{t('settings.preventSleep')}</label>
          <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={preventSleep}
              onChange={(e) => handlePreventSleep(e.target.checked)}
            />
            <span style={{ fontSize: '12px', color: preventSleep ? '#4a9eff' : '#888' }}>
              {preventSleep ? t('settings.preventSleepOn') : t('settings.preventSleepOff')}
            </span>
          </label>
        </div>
        <div className="setting-hint" style={{ marginTop: '4px' }}>
          {t('settings.preventSleepHint')}
        </div>
      </div>
    </div>
  )
}
