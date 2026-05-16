/**
 * StorageTab - 저장 설정 탭 (저장 모드 + 폴더 설정 + 프로젝트 관리)
 */

import { useState, useEffect } from 'react'
import { fileSystemAPI } from '../../hooks/useFileSystem'
import { generateProjectName } from '../../utils/formatters'
import { toast } from '../Toast'
import AspectRatioSelector from './AspectRatioSelector'

// ============================================
// ProjectManager - 프로젝트 관리 컴포넌트
// ============================================

function ProjectManager({ projectName, aspectRatio = '16:9', onProjectChange, onCreateProject, t }) {
  const [projects, setProjects] = useState([])
  const [loading, setLoading] = useState(true)
  const [newProjectName, setNewProjectName] = useState('')
  const [newAspectRatio, setNewAspectRatio] = useState(aspectRatio)
  const [showNewProject, setShowNewProject] = useState(false)
  const [editMode, setEditMode] = useState(false)
  const [editName, setEditName] = useState('')
  const [renaming, setRenaming] = useState(false)

  useEffect(() => {
    loadProjects()
  }, [])

  const loadProjects = async (currentProjectName = projectName, excludeName = null) => {
    setLoading(true)
    const result = await fileSystemAPI.listProjects()
    if (result.success) {
      let projectList = result.projects

      // 이름 변경된 경우 이전 이름 제외 (폴더가 아직 남아있어도)
      if (excludeName) {
        projectList = projectList.filter(p => p !== excludeName)
      }

      // 현재 projectName이 목록에 없으면 추가 (아직 폴더 생성 전)
      if (currentProjectName && !projectList.includes(currentProjectName)) {
        projectList = [currentProjectName, ...projectList]
      }

      setProjects(projectList)

      // 현재 선택된 프로젝트가 없으면 첫 번째 또는 새로 생성
      if (!currentProjectName && projectList.length > 0) {
        onProjectChange(projectList[0])
      }
    }
    setLoading(false)
  }

  const handleCreateProject = async () => {
    // 공백 → 언더스코어 변환
    const name = (newProjectName.trim().replace(/\s+/g, '_')) || generateProjectName()

    // 이미 존재하는 이름이면 '신규 생성'이 아니다 — 막는다. 그대로 두면
    // handleProjectChange 가 선택한 화면비(opts.aspectRatio)로 기존 프로젝트의
    // project.json 화면비를 덮어쓴다.
    const exists = await fileSystemAPI.projectExists(name)
    if (exists) {
      toast.warning(t('settings.projectExists'))
      return
    }

    // 프로젝트 폴더 생성
    const result = await fileSystemAPI.getProjectFolder(name)
    if (result.success) {
      // onCreateProject 는 async (전환 + 메타 저장 + 실패 시 롤백) — fire-and-forget
      // 하지 않고 끝난 뒤 폼을 닫고 목록을 갱신한다 (loadProjects 가 전환과 경합 X).
      await onCreateProject(name, newAspectRatio)
      setNewProjectName('')
      setShowNewProject(false)
      await loadProjects(name)
    }
  }

  const handleStartEdit = () => {
    setEditName(projectName || '')
    setEditMode(true)
  }

  const handleCancelEdit = () => {
    setEditMode(false)
    setEditName('')
  }

  const handleRename = async () => {
    // 공백 → 언더스코어 변환
    const newName = editName.trim().replace(/\s+/g, '_')
    if (!newName || newName === projectName) {
      handleCancelEdit()
      return
    }

    // 유효한 폴더명인지 확인
    if (/[<>:"/\\|?*]/.test(newName)) {
      toast.warning(t('settings.invalidProjectName'))
      return
    }

    // 이전 프로젝트명 저장
    const oldName = projectName

    // 기존 폴더가 존재하는지 확인
    const exists = await fileSystemAPI.projectExists(oldName)

    if (!exists) {
      // 폴더 없음 - 메모리(설정)만 변경
      onProjectChange(newName)
      setEditMode(false)
      setEditName('')
      await loadProjects(newName, oldName)
      return
    }

    // 폴더 있음 - 실제 폴더명 변경
    setRenaming(true)
    const result = await fileSystemAPI.renameProject(oldName, newName)
    setRenaming(false)

    if (result.success) {
      onProjectChange(newName)
      setEditMode(false)
      setEditName('')
      await loadProjects(newName, oldName)
      toast.success(t('toast.projectRenamed'))
    } else if (result.error === 'already_exists') {
      toast.warning(t('settings.projectExists'))
    } else {
      toast.error(`${t('settings.renameFailed')}: ${result.error}`)
    }
  }

  return (
    <div className="setting-row project-manager">
      <label className="setting-label">{t('settings.project')}</label>

      {loading ? (
        <div className="project-loading">⏳ {t('common.loading')}</div>
      ) : (
        <>
          {/* 편집 모드 */}
          {editMode ? (
            <div className="project-edit-form">
              <input
                type="text"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleRename()
                  if (e.key === 'Escape') handleCancelEdit()
                }}
                autoFocus
                disabled={renaming}
              />
              <button
                className="btn-primary btn-small"
                onClick={handleRename}
                disabled={renaming}
              >
                {renaming ? '...' : t('common.confirm')}
              </button>
              <button
                className="btn-secondary btn-small"
                onClick={handleCancelEdit}
                disabled={renaming}
              >
                {t('common.cancel')}
              </button>
            </div>
          ) : (
            <>
              {/* 프로젝트 선택 드롭다운 */}
              <div className="project-selector">
                <select
                  value={projectName || ''}
                  onChange={(e) => onProjectChange(e.target.value)}
                >
                  {projects.length === 0 && (
                    <option value="">{t('settings.noProjects')}</option>
                  )}
                  {projects.map(p => (
                    <option key={p} value={p}>{p}</option>
                  ))}
                </select>

                {/* 이름 변경 버튼 */}
                {projectName && (
                  <button
                    className="btn-edit-project"
                    onClick={handleStartEdit}
                    title={t('settings.renameProject')}
                  >
                    ✏️
                  </button>
                )}

                <button
                  className="btn-new-project"
                  onClick={() => {
                    setNewAspectRatio(aspectRatio)
                    setShowNewProject(!showNewProject)
                  }}
                  title={t('settings.createProject')}
                >
                  ➕
                </button>
              </div>
            </>
          )}

          {/* 새 프로젝트 생성 */}
          {showNewProject && !editMode && (
            <div className="new-project-form">
              <div className="new-project-row">
                <input
                  type="text"
                  value={newProjectName}
                  onChange={(e) => setNewProjectName(e.target.value)}
                  placeholder={t('settings.projectNamePlaceholder')}
                />
                <button className="btn-primary btn-small" onClick={handleCreateProject}>
                  {t('settings.create')}
                </button>
                <button className="btn-secondary btn-small" onClick={() => setShowNewProject(false)}>
                  {t('common.cancel')}
                </button>
              </div>
              {/* 화면비: 롱폼(16:9) / 숏폼(9:16) */}
              <AspectRatioSelector value={newAspectRatio} onChange={setNewAspectRatio} t={t} />
            </div>
          )}

          {/* 현재 프로젝트 경로 표시 */}
          {projectName && !editMode && (
            <div className="project-path">
              📁 {projectName}/
            </div>
          )}
        </>
      )}
    </div>
  )
}

// ============================================
// StorageTab - 저장 설정 메인 탭
// ============================================

export default function StorageTab({
  localSettings,
  setLocalSettings,
  workFolder,
  onSelectFolder,
  onProjectChange,
  highlight,
  t
}) {
  const showFolderWarning = localSettings.saveMode === 'folder' && !workFolder.name
  const showFolderDeletedWarning = localSettings.saveMode === 'folder' && workFolder.error === 'folder_deleted'

  return (
    <div className={`tab-panel ${highlight ? 'highlight' : ''}`}>
      {showFolderDeletedWarning && (
        <div className="settings-alert error">
          ❌ {t('settings.folderDeletedDesc')}
        </div>
      )}
      {showFolderWarning && !showFolderDeletedWarning && (
        <div className="settings-alert">
          ⚠️ {t('settings.folderRequired')}
        </div>
      )}

      <div className="setting-row">
        <label className="setting-label">{t('settings.saveMode')}</label>
        <div className="save-mode-selector">
          <button
            className={`save-mode-btn ${localSettings.saveMode === 'folder' ? 'active' : ''}`}
            onClick={() => setLocalSettings(s => ({ ...s, saveMode: 'folder' }))}
          >
            <span className="mode-icon">📁</span>
            <span className="mode-label">{t('settings.saveAuto')}</span>
            <span className="mode-desc">{t('settings.saveAutoDesc')}</span>
          </button>

          <button
            className={`save-mode-btn ${localSettings.saveMode === 'none' ? 'active' : ''}`}
            onClick={() => setLocalSettings(s => ({ ...s, saveMode: 'none' }))}
          >
            <span className="mode-icon">☁️</span>
            <span className="mode-label">{t('settings.saveFlow')}</span>
            <span className="mode-desc">{t('settings.saveFlowDesc')}</span>
          </button>
        </div>
      </div>

      {/* 폴더 저장 모드 - 폴더 선택 */}
      {localSettings.saveMode === 'folder' && (
        <div className={`setting-row folder-setting ${!workFolder.name ? 'highlight-box' : ''}`}>
          <label className="setting-label">{t('settings.workFolder')}</label>
          <div className="folder-status">
            {workFolder.name ? (
              <span className={`folder-name ${workFolder.error === 'folder_deleted' ? 'deleted' : ''}`}>
                📂 {workFolder.name}
                {workFolder.error === 'folder_deleted' && (
                  <span className="permission-badge deleted"> ❌ {t('settings.folderDeleted')}</span>
                )}
              </span>
            ) : (
              <span className="folder-empty">📂 {t('settings.folderNotSelected')}</span>
            )}
          </div>

          <div className="folder-actions">
            <button className="btn-primary" onClick={onSelectFolder}>
              {workFolder.name ? t('settings.changeFolder') : t('settings.selectFolder')}
            </button>
          </div>

          {/* 프로젝트 정보 */}
          {workFolder.name && !workFolder.error && (
            <div className="project-info">
              <span className="setting-sublabel">{t('settings.projectNote')}</span>
            </div>
          )}
        </div>
      )}

      {/* 폴더 모드 - 프로젝트 관리 */}
      {localSettings.saveMode === 'folder' && workFolder.name && !workFolder.error && (
        <ProjectManager
          projectName={localSettings.projectName}
          aspectRatio={localSettings.aspectRatio || '16:9'}
          onProjectChange={async (name) => {
            // projectName 을 optimistic 하게 먼저 갱신(드롭다운 즉시 반영)하되,
            // 전환이 실패하면(success:false) 이전 값으로 롤백한다 — 안 그러면 모달은
            // 새 프로젝트, 앱은 이전 프로젝트로 어긋난다.
            const prev = { projectName: localSettings.projectName, aspectRatio: localSettings.aspectRatio }
            setLocalSettings(s => ({ ...s, projectName: name }))
            if (onProjectChange) {
              const res = await onProjectChange(name)
              if (res && res.success === false) {
                setLocalSettings(s => ({ ...s, ...prev }))
              } else if (res?.aspectRatio) {
                setLocalSettings(s => ({ ...s, aspectRatio: res.aspectRatio }))
              }
            }
          }}
          onCreateProject={async (name, ratio) => {
            // 위와 동일 — 생성 경로도 optimistic 갱신 + 실패 시 롤백.
            const prev = { projectName: localSettings.projectName, aspectRatio: localSettings.aspectRatio }
            setLocalSettings(s => ({ ...s, projectName: name, aspectRatio: ratio }))
            if (onProjectChange) {
              // isNewProject: 신규 생성임을 명시 — handleProjectChange 가 기존
              // project.json 값 대신 이 화면비를 쓰도록.
              const res = await onProjectChange(name, { aspectRatio: ratio, isNewProject: true })
              if (res && res.success === false) {
                setLocalSettings(s => ({ ...s, ...prev }))
              }
            }
          }}
          t={t}
        />
      )}

    </div>
  )
}
