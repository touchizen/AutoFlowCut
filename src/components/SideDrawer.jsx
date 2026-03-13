/**
 * SideDrawer - 사이드 메뉴 드로워
 */

import { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { useI18n } from '../hooks/useI18n'
import './SideDrawer.css'

// 앱 아이콘 컴포넌트 (One Click 마우스)
const AppIcon = ({ size = 32 }) => (
  <img src="/assets/icon128.png" alt="AutoFlowCut" width={size} height={size} style={{ borderRadius: '6px' }} />
)

// Vite에서 주입되는 버전 (vite.config.js의 define 참조)
const APP_VERSION = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '1.0.0'
const BUILD_TIME = typeof __BUILD_TIME__ !== 'undefined' ? __BUILD_TIME__ : ''

// YouTube 아이콘 SVG 컴포넌트
const YouTubeIcon = () => (
  <svg viewBox="0 0 24 24" width="22" height="22" fill="#FF0000">
    <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/>
  </svg>
)

// Discord 아이콘 SVG 컴포넌트
const DiscordIcon = () => (
  <svg viewBox="0 0 24 24" width="22" height="22" fill="#5865F2">
    <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z"/>
  </svg>
)

// 포탈 툴팁 컴포넌트
function PortalTooltip({ text, position }) {
  if (!text || !position) return null

  return createPortal(
    <div
      className="portal-tooltip"
      style={{
        position: 'fixed',
        top: position.y,
        left: position.x,
        zIndex: 99999,
        padding: '6px 10px',
        background: '#fef3c7',
        color: '#92400e',
        fontSize: '12px',
        fontWeight: 500,
        whiteSpace: 'nowrap',
        borderRadius: '6px',
        boxShadow: '0 4px 12px rgba(0, 0, 0, 0.3)',
        pointerEvents: 'none',
      }}
    >
      {text}
    </div>,
    document.body
  )
}

// 가이드 URL 생성 (언어별)
const getGuideUrl = (lang) => {
  const langCode = lang === 'ko' ? 'ko' : lang === 'ja' ? 'ja' : lang === 'de' ? 'de' : 'en'
  return `https://touchizen.com/guide/${langCode}/flow2capcut`
}

export function SideDrawer({ isOpen, onClose }) {
  const { t, lang } = useI18n()
  const [tooltip, setTooltip] = useState({ text: null, position: null })

  // 드로워 열릴 때 Flow 뷰 숨기기
  useEffect(() => {
    if (!isOpen) return
    window.electronAPI?.setModalVisible?.({ visible: true })
    return () => {
      window.electronAPI?.setModalVisible?.({ visible: false })
    }
  }, [isOpen])

  if (!isOpen) return null

  const handleMouseEnter = (e, url) => {
    const rect = e.currentTarget.getBoundingClientRect()
    setTooltip({
      text: url,
      position: { x: rect.right + 10, y: rect.top + rect.height / 2 - 12 }
    })
  }

  const handleMouseLeave = () => {
    setTooltip({ text: null, position: null })
  }

  const links = [
    {
      icon: '🪄',
      label: t('drawer.flow'),
      url: 'https://labs.google/fx/tools/flow',
      description: t('drawer.flowDesc')
    },
    {
      icon: <span style={{fontSize: '22px'}}>🎬</span>,
      label: t('drawer.website'),
      url: 'https://touchizen.com',
      description: t('drawer.websiteDesc')
    },
    {
      icon: <YouTubeIcon />,
      label: t('drawer.youtube'),
      url: 'https://youtube.com/@touchizen',
      description: t('drawer.youtubeDesc')
    },
    {
      icon: '𝕏',
      label: t('drawer.twitter'),
      url: 'https://x.com/touchizen',
      description: t('drawer.twitterDesc')
    },
    {
      icon: <DiscordIcon />,
      label: t('drawer.discord'),
      url: 'https://discord.gg/DTMMs8TZDN',
      description: t('drawer.discordDesc')
    },
    {
      icon: '📖',
      label: t('drawer.docs'),
      url: getGuideUrl(lang),
      description: t('drawer.docsDesc')
    },
    {
      icon: '🐛',
      label: t('drawer.feedback'),
      url: 'https://discord.gg/DTMMs8TZDN',
      description: t('drawer.feedbackDesc')
    }
  ]

  const handleLinkClick = (url) => {
    if (window.electronAPI?.openExternal) {
      window.electronAPI.openExternal(url)
    }
    onClose()
  }

  return (
    <>
      {/* 오버레이 */}
      <div className="drawer-overlay" onClick={onClose} />

      {/* 드로워 */}
      <div className="side-drawer">
        <div className="drawer-header">
          <div className="drawer-logo">
            <AppIcon size={32} />
            <div className="drawer-logo-text">
              <h2>AutoFlowCut</h2>
              <span className="drawer-version">v{APP_VERSION}{BUILD_TIME ? ` (${BUILD_TIME})` : ''}</span>
            </div>
          </div>
          <button className="drawer-close" onClick={onClose}>
            ✕
          </button>
        </div>

        <div className="drawer-content">
          <div className="drawer-section">
            <h3 className="drawer-section-title">{t('drawer.resources')}</h3>
            <div className="drawer-links">
              {links.map((link, index) => (
                <button
                  key={index}
                  className="drawer-link"
                  onClick={() => handleLinkClick(link.url)}
                  onMouseEnter={(e) => handleMouseEnter(e, link.url)}
                  onMouseLeave={handleMouseLeave}
                >
                  <span className="drawer-link-icon">{link.icon}</span>
                  <div className="drawer-link-info">
                    <span className="drawer-link-label">{link.label}</span>
                    <span className="drawer-link-desc">{link.description}</span>
                  </div>
                  <span className="drawer-link-arrow">→</span>
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="drawer-footer">
          <p>{t('drawer.madeWith')} ❤️ by Touchizen</p>
          <p className="drawer-copyright">{t('drawer.copyright')}</p>
        </div>
      </div>

      {/* 포탈 툴팁 */}
      <PortalTooltip text={tooltip.text} position={tooltip.position} />
    </>
  )
}

export default SideDrawer
