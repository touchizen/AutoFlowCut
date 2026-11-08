/**
 * GenerateMenu — 생성 버튼 옆 ▾ 드롭다운.
 *
 * 항목: "전체 재생성" — 완료된 씬을 포함해 모든 씬을 강제 재생성한다.
 * 기존 이미지를 덮어쓰는 파괴적 동작이라 확인 모달을 거친다.
 *
 * props:
 *   onForceRegenerate — 확인 시 호출 (App 의 handleStart force 경로)
 *   disabled          — 실행 중/큐 대기 시 trigger 비활성
 */

import { useState, useRef, useEffect } from 'react'
import { flushSync } from 'react-dom'
import { useImageRegenerationNotice } from '../hooks/useImageRegenerationNotice'
import Modal from './Modal'
import { useI18n } from '../hooks/useI18n'
import './GenerateMenu.css'

export default function GenerateMenu({ onForceRegenerate, disabled = false, appMode, scenes = [] }) {
  const { t } = useI18n()
  const regenerationNotice = useImageRegenerationNotice(appMode, scenes.filter(scene => scene.prompt), t)
  const [menuOpen, setMenuOpen] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const menuRef = useRef(null)

  // 외부 클릭 시 메뉴 닫기 (UserMenu 패턴)
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) setMenuOpen(false)
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const openConfirm = () => {
    setMenuOpen(false)
    setConfirmOpen(true)
  }

  const confirm = () => {
    if (regenerationNotice) return
    // Restore the Flow view before the batch authentication check starts.
    flushSync(() => setConfirmOpen(false))
    onForceRegenerate()
  }

  return (
    <div className="generate-menu" ref={menuRef}>
      <button
        className="generate-menu-trigger"
        onClick={() => setMenuOpen((o) => !o)}
        disabled={disabled}
        aria-label={t('actions.moreGenerateOptions')}
      >
        ▾
      </button>

      {menuOpen && (
        <div className="generate-menu-dropdown">
          <button className="generate-menu-item" onClick={openConfirm}>
            🔄 {t('actions.forceRegenerate')}
          </button>
        </div>
      )}

      <Modal
        isOpen={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        title={t('actions.forceRegenerate')}
        footer={
          <>
            <button className="btn-secondary" onClick={() => setConfirmOpen(false)}>
              {t('actions.cancel')}
            </button>
            <button className="btn-danger" onClick={confirm} disabled={!!regenerationNotice}
              aria-describedby={regenerationNotice ? 'batch-regeneration-notice' : undefined}>
              {t('actions.forceRegenerate')}
            </button>
          </>
        }
      >
        {regenerationNotice
          ? <p id="batch-regeneration-notice" role="alert">{regenerationNotice}</p>
          : <p>{t('actions.forceRegenerateWarn')}</p>}
      </Modal>
    </div>
  )
}
