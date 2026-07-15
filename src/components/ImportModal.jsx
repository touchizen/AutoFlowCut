/**
 * ImportModal Component - 파일 Import 모달
 */

import { useState, useRef } from 'react'
import { useI18n } from '../hooks/useI18n'
import { readTextFile } from '../utils/decodeTextFile'
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
      guideUrl: `${guideBaseUrl}/import-guide.html#plain-text`,
      sampleUrl: `${guideBaseUrl}/samples/sample-prompts.txt`,
      aiPromptUrl: `${guideBaseUrl}/import-guide.html#ai-text-prompt`
    },
    {
      id: 'csv',
      icon: '📊',
      title: t('import.csvTitle'),
      description: t('import.csvDesc'),
      accept: '.csv',
      hint: 'scene, prompt, subtitle, characters, scene_tag, style_tag, start_time, end_time',
      guideUrl: `${guideBaseUrl}/import-guide.html#scene-csv`,
      sampleUrl: `${guideBaseUrl}/samples/sample-scenes.csv`,
      aiPromptUrl: `${guideBaseUrl}/import-guide.html#ai-csv-prompt`
    },
    {
      id: 'reference',
      icon: '🖼️',
      title: t('import.refTitle'),
      description: t('import.refDesc'),
      accept: '.csv',
      hint: 'name, type, prompt',
      guideUrl: `${guideBaseUrl}/import-guide.html#reference-csv`,
      sampleUrl: `${guideBaseUrl}/samples/sample-references.csv`,
      aiPromptUrl: `${guideBaseUrl}/import-guide.html#ai-csv-prompt`
    },
    {
      id: 'srt',
      icon: '📺',
      title: t('import.srtTitle'),
      description: t('import.srtDesc'),
      accept: '.srt',
      hint: t('import.srtHint'),
      guideUrl: `${guideBaseUrl}/import-guide.html#srt-subtitle`,
      sampleUrl: `${guideBaseUrl}/samples/sample-subtitles.srt`,
      aiPromptUrl: `${guideBaseUrl}/import-guide.html#ai-srt-to-csv`
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

  const handleFileSelect = async (e) => {
    const file = e.target.files?.[0]
    if (!file || !selectedType) return

    // mode 토글이 노출되는 타입(text/csv) 에서만 importMode 전달.
    // SRT / reference 같이 mode 무관 타입에서는 다른 행의 토글 상태가 새어 나가지 않게 'image' 로 강제.
    const supportsModeToggle = selectedType === 'text' || selectedType === 'csv'
    const effectiveMode = supportsModeToggle ? importMode : 'image'

    e.target.value = ''
    setSelectedType(null)

    // readAsText 는 인코딩을 안 주면 UTF-8 을 강제한다 — Windows 의 UTF-16/CP949 자막이
    //   에러 없이 깨진 글자로 들어온다. 바이트를 보고 인코딩을 고른다.
    const text = await readTextFile(file)
    onImport(selectedType, text, effectiveMode)
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
                  {/* 이미지/비디오 모드 선택 — text/csv 에만 노출.
                      SRT 는 자막 데이터라 "비디오 모드 = 자막을 비디오 prompt 로 변환" 의미가 없어
                      토글 제거. (reference 도 무관) */}
                  {(option.id === 'text' || option.id === 'csv') && (
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
