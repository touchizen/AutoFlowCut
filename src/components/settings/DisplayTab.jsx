/**
 * DisplayTab - 화면 설정 탭
 *
 * 구 Flow split 레이아웃(좌/우/상/하 + 비율) 컨트롤은 공식 API 전환으로 App 이
 * 전체폭 렌더링이 되면서 제거됐다(Shell.jsx 참고). 현재는 절전 방지만 남는다.
 */

import { useState, useEffect } from 'react'

export default function DisplayTab({ t }) {
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
