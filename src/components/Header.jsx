/**
 * Header Component - 상단 바
 */

import { useState, useEffect, useRef } from 'react'
import { useI18n } from '../hooks/useI18n'
import { TIMING } from '../config/defaults'
import { fileSystemAPI } from '../hooks/useFileSystem'
import { UserMenu } from './UserMenu'
import { SideDrawer } from './SideDrawer'
import Modal from './Modal'
import './Header.css'

export default function Header({
  onSettings,
  onExport,
  hasImages,
  getAccessToken,
  authReady,
  projectName,
  onProjectChange,
  onNewProject,
  saveMode,
  onLoginClick,
  onUpgradeClick,
  disabled = false  // 생성 중일 때 프로젝트 전환 비활성화
}) {
  const { t, lang, changeLang, languages } = useI18n()
  const [authStatus, setAuthStatus] = useState('checking') // 'checking' | 'authenticated' | 'unauthenticated' | 'waiting'
  const [showProjectDropdown, setShowProjectDropdown] = useState(false)
  const [showDrawer, setShowDrawer] = useState(false)
  const [projects, setProjects] = useState([])
  const [deleteTarget, setDeleteTarget] = useState(null) // Confirm 모달용
  const dropdownRef = useRef(null)
  const pollingRef = useRef(null)
  
  // authReady가 바뀌면 상태 동기화
  useEffect(() => {
    if (authReady) {
      setAuthStatus('authenticated')
      stopPolling()
    } else {
      setAuthStatus('unauthenticated')
    }
  }, [authReady])

  // 컴포넌트 언마운트 시 폴링 정리
  useEffect(() => {
    return () => stopPolling()
  }, [])
  
  // authReady prop에만 의존 — 독립적인 checkAuth 제거
  // (기존: !authReady일 때 quickCheck → 캐시된 만료 토큰을 유효로 오판하는 경합 조건 발생)
  
  // 드롭다운 열릴 때 프로젝트 목록 로드
  useEffect(() => {
    if (showProjectDropdown && saveMode === 'folder') {
      loadProjects()
    }
  }, [showProjectDropdown])
  
  // 외부 클릭 시 드롭다운 닫기
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        setShowProjectDropdown(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])
  
  const loadProjects = async () => {
    const result = await fileSystemAPI.listProjects()
    if (result.success) {
      let projectList = result.projects
      
      // 현재 projectName이 목록에 없으면 추가 (아직 폴더 생성 전)
      if (projectName && !projectList.includes(projectName)) {
        projectList = [projectName, ...projectList]
      }
      
      setProjects(projectList)
    }
  }
  
  // projectName 변경 시 목록 갱신
  useEffect(() => {
    if (projectName && !projects.includes(projectName)) {
      setProjects(prev => {
        if (prev.includes(projectName)) return prev
        return [projectName, ...prev.filter(p => p !== projectName)]
      })
    }
  }, [projectName])
  
  const checkAuth = async (quickCheck = false) => {
    if (!getAccessToken) {
      setAuthStatus('unauthenticated')
      return
    }
    
    setAuthStatus('checking')
    try {
      // quickCheck: 탭 열기/대기 없이 빠르게 확인만
      const token = await getAccessToken(false, quickCheck)
      setAuthStatus(token ? 'authenticated' : 'unauthenticated')
    } catch (e) {
      setAuthStatus('unauthenticated')
    }
  }
  
  // 폴링 정리
  const stopPolling = () => {
    if (pollingRef.current) {
      clearInterval(pollingRef.current)
      pollingRef.current = null
    }
  }

  // Flow 사이트 열기 + 로그인 대기 폴링
  const openFlow = () => {
    if (window.electronAPI?.switchTab) {
      window.electronAPI.switchTab('flow')
    }
    setAuthStatus('waiting')
    stopPolling()
    pollingRef.current = setInterval(async () => {
      try {
        const token = await getAccessToken(true)
        if (token) {
          setAuthStatus('authenticated')
          stopPolling()
        }
      } catch {}
    }, TIMING.AUTH_POLL_INTERVAL || 2000)
  }
  
  const handleProjectSelect = (name) => {
    onProjectChange(name)
    setShowProjectDropdown(false)
  }
  
  const handleNewProject = () => {
    setShowProjectDropdown(false)
    onNewProject()
  }

  const handleDeleteClick = (e, name) => {
    e.stopPropagation()
    setDeleteTarget(name)
  }

  const handleDeleteConfirm = async () => {
    if (!deleteTarget) return
    const result = await fileSystemAPI.deleteProject(deleteTarget)
    if (result.success) {
      setProjects(prev => prev.filter(p => p !== deleteTarget))
      // 현재 프로젝트를 삭제한 경우 다른 프로젝트로 전환
      if (deleteTarget === projectName) {
        const remaining = projects.filter(p => p !== deleteTarget)
        if (remaining.length > 0) {
          onProjectChange(remaining[0])
        } else {
          onNewProject()
        }
      }
    } else {
      alert(`삭제 실패: ${result.error || 'Unknown error'}`)
    }
    setDeleteTarget(null)
    setShowProjectDropdown(false)
  }
  
  return (
    <>
    <header className="header">
      <div className="header-left">
        <button
          className="hamburger-btn"
          onClick={() => setShowDrawer(true)}
          data-tooltip={t('header.menu')}
        >
          <span className="hamburger-icon">☰</span>
        </button>
        <h1 className="logo">
          <span className="logo-text">{t('appName')}</span>
        </h1>
        
        {/* 프로젝트 선택기 (폴더 모드 + 로그인 상태일 때만) */}
        {saveMode === 'folder' && authStatus === 'authenticated' && (
          <div className={`project-selector-header ${disabled ? 'disabled' : ''}`} ref={dropdownRef}>
            <button
              className="project-current"
              onClick={() => !disabled && setShowProjectDropdown(!showProjectDropdown)}
              disabled={disabled}
              title={disabled ? t('headerExtra.cannotChangeProject') : ''}
            >
              <span className="project-icon">📁</span>
              <span className="project-name">{projectName || t('settings.noProjects')}</span>
              <span className="dropdown-arrow">{showProjectDropdown ? '▲' : '▼'}</span>
            </button>
            
            {showProjectDropdown && (
              <div className="project-dropdown">
                {projects.length === 0 ? (
                  <div className="project-empty">{t('settings.noProjects')}</div>
                ) : (
                  projects.map(p => (
                    <div
                      key={p}
                      className={`project-option ${p === projectName ? 'active' : ''}`}
                      onClick={() => handleProjectSelect(p)}
                    >
                      <span className="project-option-name">{p}</span>
                      <span className="project-option-actions">
                        {p === projectName && <span className="check">✓</span>}
                        <button
                          className="project-delete-btn"
                          onClick={(e) => handleDeleteClick(e, p)}
                          title={t('settings.deleteProject') || '삭제'}
                        >
                          ✕
                        </button>
                      </span>
                    </div>
                  ))
                )}
                <div className="project-divider"></div>
                <div className="project-option new-project" onClick={handleNewProject}>
                  <span>+</span> {t('settings.createProject')}
                </div>
              </div>
            )}
          </div>
        )}
        
        {/* 토큰 상태 표시 */}
        <div className="auth-status">
          {authStatus === 'checking' && (
            <span className="auth-badge checking" data-tooltip={t('header.checking')}>⏳</span>
          )}
          {authStatus === 'authenticated' && (
            <span className="auth-badge authenticated" data-tooltip={t('header.authenticated')} onClick={checkAuth}>🟢</span>
          )}
          {authStatus === 'waiting' && (
            <span className="auth-badge waiting" data-tooltip={t('header.waitingLogin')}>
              ⏳ {t('header.waitingLogin')}
            </span>
          )}
          {authStatus === 'unauthenticated' && (
            <button className="auth-btn" onClick={openFlow} data-tooltip={t('header.login')}>
              🔑 {t('header.login')}
            </button>
          )}
        </div>
      </div>
      
      <div className="header-right">
        {/* 언어 선택 */}
        <select
          className="lang-selector"
          value={lang}
          onChange={(e) => changeLang(e.target.value)}
          data-tooltip={t('header.language')}
        >
          {languages.map(l => (
            <option key={l.code} value={l.code}>{l.name}</option>
          ))}
        </select>

        <button
          className="btn-export"
          onClick={onExport}
          disabled={!hasImages}
          data-tooltip={t('header.export')}
        >
          <span className="btn-emoji">📦</span>
          <span className="btn-text">{t('header.export')}</span>
        </button>

        <button
          className="btn-settings"
          onClick={() => onSettings()}
          data-tooltip={t('header.settings')}
        >
          ⚙️
        </button>

        {/* 사용자 메뉴 (Firebase 인증) */}
        <UserMenu onLoginClick={onLoginClick} onUpgradeClick={onUpgradeClick} />
      </div>
    </header>

    {/* 프로젝트 삭제 확인 모달 */}
    <Modal
      isOpen={!!deleteTarget}
      onClose={() => setDeleteTarget(null)}
      title={t('settings.deleteProject') || '프로젝트 삭제'}
      className="modal-confirm-delete"
      footer={
        <div className="modal-confirm-actions">
          <button className="btn-cancel" onClick={() => setDeleteTarget(null)}>
            {t('common.cancel') || '취소'}
          </button>
          <button className="btn-danger" onClick={handleDeleteConfirm}>
            {t('common.delete') || '삭제'}
          </button>
        </div>
      }
    >
      <p className="modal-confirm-msg">
        <strong>"{deleteTarget}"</strong> {t('settings.deleteConfirm') || '프로젝트를 삭제하시겠습니까?\n모든 이미지와 데이터가 삭제됩니다.'}
      </p>
    </Modal>

    {/* 사이드 드로워 */}
    <SideDrawer isOpen={showDrawer} onClose={() => setShowDrawer(false)} />
    </>
  )
}
