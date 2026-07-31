/**
 * Header Component - 상단 바
 */

import { useState, useEffect, useRef } from 'react'
import { useI18n } from '../hooks/useI18n'
import { TIMING } from '../config/defaults'
import { fileSystemAPI } from '../hooks/useFileSystem'
import { useMode } from '../contexts/ModeContext'
import { isFlowTarget, isChatgptTarget } from '../config/appRoute.js'
import { flowLayoutForMode } from '../utils/appLayout'
import { SESSION_TARGET_INFO } from './modeInfo.js'
import { UserMenu } from './UserMenu'
import ModeToggle from './ModeToggle'
import LanguagePicker from './LanguagePicker'
import { SideDrawer } from './SideDrawer'
import Modal from './Modal'
import ExportSplitButton from './ExportSplitButton'
import { toast } from './Toast'
import './Header.css'

export default function Header({
  onSettings,
  onExport,
  exportFormat = 'capcut',
  hasImages,
  getAccessToken,
  authReady,
  onAuthRecovered,  // App.authReady=false 후 re-auth 성공 시 호출 — App이 invalidation 풀고 authReady=true 복구
  projectName,
  onProjectChange,
  onNewProject,
  saveMode,
  onLoginClick,
  onUpgradeClick,
  onRouteRequest,
  disabled = false,  // 생성 중일 때 프로젝트 전환 비활성화
  modeBusy = false,  // 배치 생성 중일 때 모드 전환 차단
  storyActive = false,   // Story 뷰 진입 상태(버튼 active 표시)
  onStoryClick,           // Story 뷰 진입/복귀 토글
}) {
  const { t, lang, changeLang, languages } = useI18n()
  const { mode, sessionTarget = 'flow' } = useMode()
  const flowTargetActive = isFlowTarget({ mode, sessionTarget })
  const chatgptTargetActive = isChatgptTarget({ mode, sessionTarget })
  const loginLabelKey = SESSION_TARGET_INFO[sessionTarget]?.loginKey || 'header.flowLogin'
  const authenticatedLabelKey = SESSION_TARGET_INFO[sessionTarget]?.authenticatedKey || 'header.flowAuthenticated'
  const [authStatus, setAuthStatus] = useState('checking') // 'checking' | 'authenticated' | 'unauthenticated' | 'waiting'
  const [showProjectDropdown, setShowProjectDropdown] = useState(false)
  const [showDrawer, setShowDrawer] = useState(false)
  const [projects, setProjects] = useState([])
  const [deleteTarget, setDeleteTarget] = useState(null) // Confirm 모달용
  const dropdownRef = useRef(null)
  const pollingRef = useRef(null)
  // #R8-7: checkAuth 의 비동기 결과를 적용하기 전 가드용 — 언마운트/모드변경 감지.
  const mountedRef = useRef(true)
  // #R11-7: 겹치는 auth 폴링 중 최신 호출만 반영하기 위한 시퀀스 카운터.
  const authCheckSeqRef = useRef(0)
  // #R14-5: flow 지역 제한(unavailable) sticky 플래그 — flow 모드에서 폴링/authReady 가 덮지 않게.
  const flowUnavailableRef = useRef(false)
  const modeRef = useRef(mode)
  const flowTargetActiveRef = useRef(flowTargetActive)
  useEffect(() => {
    modeRef.current = mode
    flowTargetActiveRef.current = flowTargetActive
  }, [mode, flowTargetActive])
  // #R9-7: setup 에서 true 로 되돌린다 — StrictMode 의 cleanup→재실행 후에도 mounted 가 false 로
  //   고착되지 않게(고착되면 dev 에서 checkAuth 결과가 버려지고 onAuthRecovered 가 안 뜬다).
  useEffect(() => { mountedRef.current = true; return () => { mountedRef.current = false } }, [])

  // authReady가 바뀌면 상태 동기화
  useEffect(() => {
    // #R12-5: authReady 변경 시 진행 중인 auth 폴링을 무효화 — 오래된 폴링 결과가 배지를
    //   복구된 상태에서 다시 unauthenticated 로 뒤집지 못하게 한다.
    authCheckSeqRef.current += 1
    // #R14-5: flow 모드의 unavailable(지역 제한)은 authReady/폴링으로 덮지 않는다(sticky).
    if (flowUnavailableRef.current && flowTargetActive) return
    if (authReady) {
      setAuthStatus('authenticated')
      stopPolling()
    } else {
      setAuthStatus('unauthenticated')
    }
  }, [authReady, flowTargetActive])

  // Flow 지역 제한 감지 — #R7-17: flow 모드일 때만 반영(늦게 도착한 unavailable 이 api 모드 배지를
  //   가리지 않게). mode 를 dep 에 넣어 재구독 + 핸들러가 현재 mode 를 본다.
  useEffect(() => {
    const handleFlowStatus = (data) => {
      if (data?.unavailable && flowTargetActive) {
        flowUnavailableRef.current = true // #R14-5: sticky
        authCheckSeqRef.current += 1       // 진행 중인 폴링 결과 무효화
        setAuthStatus('unavailable')
        stopPolling()
      }
    }
    // preload 가 반환하는 unsubscribe 를 cleanup 에서 호출 — listener leak 방지.
    const off = window.electronAPI?.onFlowStatus?.(handleFlowStatus)
    return () => {
      off?.()
      stopPolling()
    }
  }, [flowTargetActive])

  // #R7-17: API 모드로 전환 시 flow-unavailable 잔상 제거 → authReady 기준으로 되돌린다.
  useEffect(() => {
    if (!flowTargetActive) {
      flowUnavailableRef.current = false // #R14-5: flow 떠나면 sticky 해제
      setAuthStatus(s => (s === 'unavailable' ? (authReady ? 'authenticated' : 'unauthenticated') : s))
    }
  }, [flowTargetActive, authReady])
  
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
    if (chatgptTargetActive) return
    // #R15-3: flow 모드의 sticky unavailable 은 'checking' 으로도 덮지 않는다(조기 반환).
    if (flowUnavailableRef.current && flowTargetActiveRef.current) return
    if (!getAccessToken) {
      setAuthStatus('unauthenticated')
      return
    }

    const startMode = modeRef.current
    // #R11-7: 폴링이 겹칠 때 오래된 결과가 새 결과를 덮지 않도록 seq 가드 — 최신 호출만 반영.
    const mySeq = ++authCheckSeqRef.current
    setAuthStatus('checking')
    try {
      // quickCheck: 탭 열기/대기 없이 빠르게 확인만
      const token = await getAccessToken(false, quickCheck)
      // #R8-7/#R11-7/#R14-5: 언마운트/모드변경/오래된 호출/flow-unavailable 이면 결과 무시.
      if (!mountedRef.current || modeRef.current !== startMode || mySeq !== authCheckSeqRef.current) return
      if (flowUnavailableRef.current && flowTargetActiveRef.current) return
      setAuthStatus(token ? 'authenticated' : 'unauthenticated')
      // Token came back via badge-click re-check → tell App so authReady recovers.
      if (token) onAuthRecovered?.()
    } catch (e) {
      if (!mountedRef.current || modeRef.current !== startMode || mySeq !== authCheckSeqRef.current) return
      if (flowUnavailableRef.current && flowTargetActiveRef.current) return // #R15-3
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

  // 인증 미완 배지 클릭 핸들러 — 모드에 따라 분기.
  // API 모드: API Key 설정 탭을 연다 (BYOK). 폴링 없음 — 키 저장 시 useApiKey 가 쏘는
  //   'byok-key-changed' 이벤트를 App 이 받아 authReady 를 갱신하면, authReady
  //   동기화 effect 가 배지를 🟢 로 바꾼다.
  // Flow 모드: Flow WebContentsView 를 재연결하고 split 레이아웃을 보이도록 하여
  //   사용자가 Flow 창에서 직접 Google 계정으로 로그인할 수 있게 안내한다.
  //   useFlowEvents 가 'flow-login-expired' 이벤트를 무시하므로 직접 IPC 호출.
  const openFlow = async () => {
    if (!flowTargetActive) return
    // Re-attach Flow WebContentsView and ensure split layout is visible.
    // 레이아웃은 flowLayoutForMode 기본값(split-left = Flow 왼쪽). Shell 이 단일 소유자.
    // #R14-10: setMode/setLayout 을 await 하고, 실패 시 안내/폴링을 시작하지 않는다(뷰 미부착 상태에서
    //   로그인 안내/폴링은 오해를 부른다). 실패는 toast 로 알린다.
    try {
      const currentRoute = { mode, sessionTarget }
      const result = onRouteRequest
        ? await onRouteRequest(currentRoute)
        : await window.electronAPI?.setRoute?.(currentRoute)
      if (result && result.ok === false) throw new Error(result.error || 'route-set-failed')
      const layout = flowLayoutForMode('flow')
      if (layout) await window.electronAPI?.setLayout?.(layout)
    } catch (e) {
      console.warn('[Header] flow re-attach failed:', e?.message)
      toast.error?.(t('toast.flowReattachFailed'))
      return
    }
    // #R15-2: await 동안 모드 전환/언마운트됐으면 안내/폴링을 시작하지 않는다(stale flow polling 방지).
    if (!mountedRef.current || !flowTargetActiveRef.current) return
    toast.info(t('toast.flowLoginHint'))
    // #R7-16: 재연결 후 인증 상태를 능동적으로 폴링 — flow-status 이벤트가 안 와도
    //   사용자가 Flow 창에서 로그인 완료하면 배지가 🟢 로 회복되도록.
    startAuthPolling()
  }

  // #R7-16: Flow 로그인 회복용 짧은 인증 폴링. 인증되면 authReady→effect 가 stopPolling.
  const startAuthPolling = () => {
    stopPolling()
    let attempts = 0
    pollingRef.current = setInterval(() => {
      attempts += 1
      if (attempts > 20) { stopPolling(); return } // ~60s 후 포기
      checkAuth(true)
    }, 3000)
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
      alert(t('header.projectDeleteFailed', { error: result.error || 'Unknown error' }))
    }
    setDeleteTarget(null)
    setShowProjectDropdown(false)
  }

  const handleUnauthenticated = () => {
    if (mode === 'api') return onSettings?.('apiKey')
    if (flowTargetActive) return openFlow()
    if (chatgptTargetActive) return undefined
  }

  const authActionLabel = mode === 'api' ? t('header.apiKey') : t(loginLabelKey)
  const authActionIcon = mode === 'flow' ? '👤' : '🔑'
  const authenticatedLabel = mode === 'api' ? t('header.apiAuthenticated') : t(authenticatedLabelKey)
  
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
        
        {/* 프로젝트 선택기 (폴더 모드면 표시 — 프로젝트는 로컬이라 API 키와 무관) */}
        {saveMode === 'folder' && (
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
            <span className="auth-badge authenticated" data-tooltip={authenticatedLabel} onClick={checkAuth}>🟢</span>
          )}
          {authStatus === 'unavailable' && (
            <span className="auth-badge unavailable" data-tooltip={t('header.unavailable')}>
              🌍 {t('header.unavailable')}
            </span>
          )}
          {authStatus === 'waiting' && (
            <span className="auth-badge waiting" data-tooltip={t('header.waitingLogin')}>
              ⏳ {t('header.waitingLogin')}
            </span>
          )}
          {authStatus === 'unauthenticated' && (
            <button className="auth-btn" onClick={handleUnauthenticated} data-tooltip={authActionLabel}>
              {authActionIcon} {authActionLabel}
            </button>
          )}
        </div>
      </div>
      
      <div className="header-right">
        {/* 언어 선택 (커스텀 드롭다운 — flag-icons SVG + 언어코드) */}
        <LanguagePicker
          current={lang}
          languages={languages}
          onChange={changeLang}
          tooltip={t('header.language')}
        />

        <ModeToggle busy={modeBusy} />

        {onStoryClick && (
          <button
            type="button"
            className={`btn-settings ${storyActive ? 'active' : ''}`}
            onClick={onStoryClick}
            data-tooltip={t('header.story') || 'Story'}
          >
            📖 Story
          </button>
        )}

        <ExportSplitButton
          format={exportFormat}
          onSelect={onExport}
          disabled={!hasImages}
          className="btn-export"
          direction="down"
        />

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
