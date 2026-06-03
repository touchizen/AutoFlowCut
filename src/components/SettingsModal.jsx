/**
 * SettingsModal Component - 탭 방식 설정 모달
 */

import { useState, useEffect } from 'react'
import { fileSystemAPI } from '../hooks/useFileSystem'
import { useI18n } from '../hooks/useI18n'
import { TIMING } from '../config/defaults'
import Modal from './Modal'
import StorageTab from './settings/StorageTab'
import SceneTab from './settings/SceneTab'
import DisplayTab from './settings/DisplayTab'
import McpTab from './settings/McpTab'
import ApiKeyTab from './settings/ApiKeyTab'
import './SettingsModal.css'

const TABS = [
  { id: 'storage', icon: '📁', labelKey: 'settings.tabStorage' },
  { id: 'apiKey', icon: '🔑', labelKey: 'settings.tabApiKey' },
  { id: 'scene', icon: '🎬', labelKey: 'settings.tabScene' },
  { id: 'display', icon: '🖥️', labelKey: 'settings.tabDisplay' },
  { id: 'mcp', icon: '🔌', labelKey: 'settings.tabMcp' }
]

export default function SettingsModal({ settings, onSave, onClose, initialTab = null, onProjectChange, availableModels = {} }) {
  const { t } = useI18n()
  // 모델 선택 옵션 — App 에서 라이브 /models 로 채워 내려줌(undefined 면 SceneTab 이 정적 폴백).
  const [activeTab, setActiveTab] = useState(initialTab || 'storage')
  const [localSettings, setLocalSettings] = useState(() => ({ ...settings }))
  const [workFolder, setWorkFolder] = useState({ name: '', error: null })
  const [highlight, setHighlight] = useState(!!initialTab)

  useEffect(() => {
    checkWorkFolder()
  }, [])

  // 하이라이트 효과 해제 (3초 후)
  useEffect(() => {
    if (highlight) {
      const timer = setTimeout(() => setHighlight(false), TIMING.SETTINGS_HIGHLIGHT)
      return () => clearTimeout(timer)
    }
  }, [highlight])

  const checkWorkFolder = async () => {
    const result = await fileSystemAPI.checkPermission()
    if (result.success) {
      setWorkFolder({ name: result.name || '', error: null })
    } else if (result.error === 'folder_deleted') {
      setWorkFolder({ name: result.name || '', error: 'folder_deleted' })
    } else {
      setWorkFolder({ name: '', error: null })
    }
  }

  const handleSelectFolder = async () => {
    const result = await fileSystemAPI.selectWorkFolder()
    if (result.success) {
      setWorkFolder({ name: result.name, error: null })
    }
  }

  const handleSave = () => {
    onSave(localSettings)
  }

  const footer = (
    <>
      <button className="btn-secondary" onClick={onClose}>{t('settings.cancel')}</button>
      <button className="btn-primary" onClick={handleSave}>{t('settings.save')}</button>
    </>
  )

  // 폴더 미설정 경고
  const showFolderWarning = localSettings.saveMode === 'folder' && !workFolder.name

  return (
    <Modal onClose={onClose} title={`⚙️ ${t('settings.title')}`} className="settings-modal tabbed" footer={footer}>
      {/* 탭 네비게이션 */}
      <div className="settings-tabs">
        {TABS.map(tab => (
          <button
            key={tab.id}
            className={`settings-tab ${activeTab === tab.id ? 'active' : ''} ${tab.id === 'storage' && showFolderWarning ? 'warning' : ''}`}
            onClick={() => setActiveTab(tab.id)}
          >
            <span className="tab-icon">{tab.icon}</span>
            <span className="tab-label">{t(tab.labelKey)}</span>
            {tab.id === 'storage' && showFolderWarning && <span className="tab-badge">!</span>}
          </button>
        ))}
      </div>

      {/* 탭 컨텐츠 */}
      <div className="settings-content">
        {activeTab === 'storage' && (
          <StorageTab
            localSettings={localSettings}
            setLocalSettings={setLocalSettings}
            workFolder={workFolder}
            onSelectFolder={handleSelectFolder}
            onProjectChange={onProjectChange}
            highlight={highlight}
            t={t}
          />
        )}

        {activeTab === 'apiKey' && (
          <ApiKeyTab t={t} />
        )}

        {activeTab === 'scene' && (
          <SceneTab
            localSettings={localSettings}
            setLocalSettings={setLocalSettings}
            t={t}
            imageModels={availableModels.imageModels}
            videoModels={availableModels.videoModels}
          />
        )}

        {activeTab === 'display' && (
          <DisplayTab t={t} />
        )}

        {activeTab === 'mcp' && (
          <McpTab
            localSettings={localSettings}
            setLocalSettings={setLocalSettings}
            t={t}
          />
        )}
      </div>
    </Modal>
  )
}
