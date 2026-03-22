/**
 * ImportModal Component - 파일 Import 모달
 */

import { useState, useRef } from 'react'
import { useI18n } from '../hooks/useI18n'
import Modal from './Modal'

// 가이드 URL 설정
const getGuideBaseUrl = (lang) => {
  const langCode = lang === 'ko' ? 'ko' : lang === 'ja' ? 'ja' : lang === 'de' ? 'de' : 'en'
  return `https://touchizen.com/guide/${langCode}/autoflowcut`
}

export default function ImportModal({ onImport, onImportAudio, onClose }) {
  const { t, lang } = useI18n()
  const [selectedType, setSelectedType] = useState(null)
  const [importMode, setImportMode] = useState('image') // 'image' | 'video'
  const fileInputRef = useRef(null)

  const guideBaseUrl = getGuideBaseUrl(lang)

  const importOptions = [
    {
      id: 'text',
      icon: '📝',
      title: t('import.textTitle'),
      description: t('import.textDesc'),
      accept: '.txt',
      hint: t('import.textHint'),
      guideUrl: `${guideBaseUrl}/#plain-text`,
      sampleUrl: `${guideBaseUrl}/samples/sample-prompts.txt`,
      aiPromptUrl: `${guideBaseUrl}/#ai-csv-prompt`
    },
    {
      id: 'csv',
      icon: '📊',
      title: t('import.csvTitle'),
      description: t('import.csvDesc'),
      accept: '.csv',
      hint: 'prompt, subtitle, characters, scene_tag, style_tag, duration',
      guideUrl: `${guideBaseUrl}/#scene-csv`,
      sampleUrl: `${guideBaseUrl}/samples/sample-scenes.csv`,
      aiPromptUrl: `${guideBaseUrl}/#ai-csv-prompt`
    },
    {
      id: 'reference',
      icon: '🖼️',
      title: t('import.refTitle'),
      description: t('import.refDesc'),
      accept: '.csv',
      hint: 'name, type, prompt',
      guideUrl: `${guideBaseUrl}/#reference-csv`,
      sampleUrl: `${guideBaseUrl}/samples/sample-references.csv`,
      aiPromptUrl: `${guideBaseUrl}/#ai-csv-prompt`
    },
    {
      id: 'srt',
      icon: '📺',
      title: t('import.srtTitle'),
      description: t('import.srtDesc'),
      accept: '.srt',
      hint: t('import.srtHint'),
      guideUrl: `${guideBaseUrl}/#srt-subtitle`,
      sampleUrl: `${guideBaseUrl}/samples/sample-subtitles.srt`,
      aiPromptUrl: `${guideBaseUrl}/#tts-srt`
    }
  ]

  // 오디오 패키지는 폴더 선택이므로 별도 처리
  const audioOption = window.electronAPI ? {
    id: 'audio',
    icon: '🎵',
    title: t('import.audioTitle'),
    description: t('import.audioDesc'),
    hint: t('import.audioHint'),
    isFolder: true
  } : null

  const handleOptionClick = (option) => {
    if (option.isFolder) {
      // 오디오 패키지: 폴더 선택 → onImportAudio 콜백
      onImportAudio?.()
      onClose()
      return
    }
    setSelectedType(option.id)
    fileInputRef.current.accept = option.accept
    fileInputRef.current.click()
  }

  const handleFileSelect = (e) => {
    const file = e.target.files?.[0]
    if (!file || !selectedType) return

    const reader = new FileReader()
    reader.onloadend = () => onImport(selectedType, reader.result, importMode)
    reader.readAsText(file)

    e.target.value = ''
    setSelectedType(null)
  }

  const openUrl = (url, e) => {
    e.stopPropagation()
    if (window.electronAPI?.openExternal) {
      window.electronAPI.openExternal(url)
    } else {
      chrome.tabs.create({ url })
    }
  }

  return (
    <Modal onClose={onClose} title={`📂 ${t('import.title')}`} className="import-modal">
      <p className="import-desc">{t('import.selectFormat')}</p>

      <div className="import-options">
        {importOptions.map(option => (
          <div key={option.id} className="import-option-wrapper">
            <div className="import-option" onClick={() => handleOptionClick(option)}>
              <div className="option-icon">{option.icon}</div>
              <div className="option-info">
                <div className="option-title-row">
                  <span className="option-title">{option.title}</span>
                  {option.id === 'text' && (
                    <div className="import-mode-segment" onClick={(e) => e.stopPropagation()}>
                      <button
                        className={`segment-btn${importMode === 'image' ? ' active' : ''}`}
                        onClick={() => setImportMode('image')}
                      >
                        🖼️ {t('import.modeImage')}
                      </button>
                      <button
                        className={`segment-btn${importMode === 'video' ? ' active' : ''}`}
                        onClick={() => setImportMode('video')}
                      >
                        🎬 {t('import.modeVideo')}
                      </button>
                    </div>
                  )}
                </div>
                <div className="option-desc">{option.description}</div>
                <div className="option-hint">{option.hint}</div>
              </div>
              <div className="option-arrow">→</div>
            </div>
            <div className="option-links">
              <button
                className="option-link-btn"
                onClick={(e) => openUrl(option.guideUrl, e)}
                title={t('import.guideTooltip')}
              >
                📖 {t('import.guide')}
              </button>
              <button
                className="option-link-btn"
                onClick={(e) => openUrl(option.sampleUrl, e)}
                title={t('import.sampleTooltip')}
              >
                📄 {t('import.sample')}
              </button>
              <button
                className="option-link-btn"
                onClick={(e) => openUrl(option.aiPromptUrl, e)}
                title={t('import.aiPromptTooltip')}
              >
                🤖 {t('import.aiPrompt')}
              </button>
            </div>
          </div>
        ))}

        {/* 오디오 패키지 (Electron 전용, 폴더 선택) */}
        {audioOption && (
          <div className="import-option-wrapper">
            <div className="import-option" onClick={() => handleOptionClick(audioOption)}>
              <div className="option-icon">{audioOption.icon}</div>
              <div className="option-info">
                <div className="option-title">{audioOption.title}</div>
                <div className="option-desc">{audioOption.description}</div>
                <div className="option-hint">{audioOption.hint}</div>
              </div>
              <div className="option-arrow">→</div>
            </div>
          </div>
        )}
      </div>

      <input type="file" ref={fileInputRef} onChange={handleFileSelect} style={{ display: 'none' }} />
    </Modal>
  )
}
