/**
 * DisplayTab - 화면 설정 탭
 *
 * - 절전 방지 (항상)
 * - Flow split 레이아웃 방향 선택 (좌/우/상/하) — Flow 모드일 때만 표시.
 *   클릭 즉시 setLayout 으로 적용(main → layout-changed → Shell 갱신). 비율은 Shell 의
 *   드래그 리사이저로 조절.
 */

import { useState, useEffect } from 'react'

const LAYOUT_OPTIONS = [
  { value: 'split-left', labelKey: 'settings.layoutSplitLeft' },
  { value: 'split-right', labelKey: 'settings.layoutSplitRight' },
  { value: 'split-top', labelKey: 'settings.layoutSplitTop' },
  { value: 'split-bottom', labelKey: 'settings.layoutSplitBottom' },
]

export default function DisplayTab({ t, appMode }) {
  const [preventSleep, setPreventSleep] = useState(false)
  const [layoutMode, setLayoutMode] = useState('split-left')

  useEffect(() => {
    window.electronAPI?.getPreventSleep?.().then(r => { if (r) setPreventSleep(r.enabled) }).catch(() => {})
    window.electronAPI?.getLayout?.().then(r => { if (r?.mode) setLayoutMode(r.mode) }).catch(() => {})
  }, [])

  const handlePreventSleep = async (enabled) => {
    setPreventSleep(enabled)
    try { await window.electronAPI?.setPreventSleep?.({ enabled }) } catch {}
  }

  const handleLayout = async (mode) => {
    setLayoutMode(mode)
    // 현재 비율 유지하며 방향만 변경(없으면 0.5). Shell 이 layout-changed 로 동기화.
    let ratio = 0.5
    try { const r = await window.electronAPI?.getLayout?.(); if (typeof r?.splitRatio === 'number') ratio = r.splitRatio } catch {}
    try { await window.electronAPI?.setLayout?.({ mode, ratio }) } catch {}
  }

  return (
    <div className="tab-panel">
      {/* 로그인 모드의 active session view 레이아웃 */}
      {appMode === 'flow' && (
        <div className="setting-row">
          <label className="setting-label" style={{ margin: 0 }}>{t('settings.layoutMode')}</label>
          <div className="batch-selector" style={{ flexWrap: 'wrap' }}>
            {LAYOUT_OPTIONS.map(opt => (
              <button
                key={opt.value}
                className={`batch-btn ${layoutMode === opt.value ? 'active' : ''}`}
                onClick={() => handleLayout(opt.value)}
              >
                {t(opt.labelKey)}
              </button>
            ))}
          </div>
          <span className="setting-sublabel">{t('settings.layoutModeHint')}</span>
        </div>
      )}

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
