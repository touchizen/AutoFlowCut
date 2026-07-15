/**
 * ImportModal Component - 파일 Import 모달
 */

import { useMemo, useState, useRef } from 'react'
import { useI18n } from '../hooks/useI18n'
import { parseStoryboardCSVRows } from '../utils/parsers'
import { readTextFile } from '../utils/decodeTextFile'
import Modal from './Modal'

// 가이드 URL 설정
const getGuideBaseUrl = (lang) => {
  const langCode = lang === 'ko' ? 'ko' : lang === 'ja' ? 'ja' : lang === 'de' ? 'de' : 'en'
  return `https://touchizen.com/guide/${langCode}/autoflowcut`
}

const errorLocaleKey = (error) => error
  ? `import.${error.replace(/-([a-z])/g, (_match, letter) => letter.toUpperCase())}`
  : 'import.imageFirstFailed'

export default function ImportModal({ onImport, onImportAudio, onImportImageFirst, onClose }) {
  const { t, lang } = useI18n()
  const [selectedType, setSelectedType] = useState(null)
  const [importMode, setImportMode] = useState('image') // 'image' | 'video'
  const [showImageFirst, setShowImageFirst] = useState(false)
  const [imageRows, setImageRows] = useState([])
  const [storyboardCsv, setStoryboardCsv] = useState('')
  const [storyboardFilename, setStoryboardFilename] = useState('')
  const [fileErrors, setFileErrors] = useState({})
  const [boardErrors, setBoardErrors] = useState({})
  const [storyboardFileError, setStoryboardFileError] = useState(null)
  const [globalError, setGlobalError] = useState(null)
  const [countMismatch, setCountMismatch] = useState(null)
  const [submitting, setSubmitting] = useState(false)
  const [confirmed, setConfirmed] = useState(false)
  const fileInputRef = useRef(null)
  const cancelRequestedRef = useRef(false)
  const closeAfterCancelRef = useRef(false)

  const parsedStoryboard = useMemo(
    () => parseStoryboardCSVRows(storyboardCsv),
    [storyboardCsv],
  )

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

  const releasePreviews = (rows) => {
    if (typeof URL?.revokeObjectURL !== 'function') return
    for (const row of rows) {
      if (row.previewUrl) URL.revokeObjectURL(row.previewUrl)
    }
  }

  const handleClose = () => {
    if (submitting) {
      cancelRequestedRef.current = true
      closeAfterCancelRef.current = true
      return
    }
    releasePreviews(imageRows)
    onClose()
  }

  const handleImageFiles = (event) => {
    const files = Array.from(event.target.files || [])
    releasePreviews(imageRows)
    setImageRows(files.map((file, index) => ({
      id: `image-row-${index + 1}`,
      file,
      previewUrl: typeof URL?.createObjectURL === 'function' ? URL.createObjectURL(file) : '',
    })))
    setFileErrors({})
    setGlobalError(null)
    setCountMismatch(null)
    setConfirmed(false)
    event.target.value = ''
  }

  const moveImage = (index, direction) => {
    if (confirmed || submitting) return
    const target = index + direction
    if (target < 0 || target >= imageRows.length) return
    setImageRows((rows) => {
      const next = [...rows]
      ;[next[index], next[target]] = [next[target], next[index]]
      return next
    })
  }

  const handleStoryboardFile = async (event) => {
    const file = event.target.files?.[0]
    if (!file) return
    try {
      const text = await readTextFile(file)
      setStoryboardCsv(text)
      setStoryboardFilename(file.name)
      setBoardErrors({})
      setStoryboardFileError(null)
      setGlobalError(null)
      setCountMismatch(null)
    } catch (error) {
      setStoryboardFileError(error.message)
    }
    event.target.value = ''
  }

  const errorText = (error, params = {}) => {
    const translated = t(errorLocaleKey(error), params)
    return translated.startsWith('import.') ? error : translated
  }

  const handleImageFirstConfirm = async () => {
    if (submitting || imageRows.length === 0) return
    setSubmitting(true)
    setConfirmed(true)
    cancelRequestedRef.current = false
    closeAfterCancelRef.current = false
    setFileErrors({})
    setBoardErrors({})
    setStoryboardFileError(null)
    setGlobalError(null)
    setCountMismatch(null)
    try {
      const result = await onImportImageFirst?.({
        imageRows: imageRows.map(({ id, file }) => ({ id, file })),
        imageFirstVariant: 'storyboard',
        storyboardCsv,
        isCancelled: () => cancelRequestedRef.current,
      })
      if (result?.success) {
        releasePreviews(imageRows)
        onClose()
        return
      }
      if (result?.error === 'image-first-import-cancelled' && closeAfterCancelRef.current) {
        releasePreviews(imageRows)
        onClose()
        return
      }
      if (result?.fileRowId) {
        setFileErrors({ [result.fileRowId]: result.error })
      } else {
        const mismatch = result?.countMismatch || null
        const displayError = mismatch ? 'image-first-count-mismatch' : result?.error
        const sceneGroups = []
        for (const row of parsedStoryboard.rows) {
          const previous = sceneGroups[sceneGroups.length - 1]
          if (!previous || previous.sceneOrdinal !== row.sceneOrdinal) {
            sceneGroups.push({ sceneOrdinal: row.sceneOrdinal, sourceRowIds: [row.sourceRowId] })
          } else {
            previous.sourceRowIds.push(row.sourceRowId)
          }
        }
        const violationRowIds = (Array.isArray(result?.violations) ? result.violations : []).flatMap((violation) => {
          if (typeof violation?.sourceRowId === 'string' && violation.sourceRowId) return [violation.sourceRowId]
          if (Number.isInteger(violation?.ordinal) && violation.ordinal > 0) {
            return sceneGroups[violation.ordinal - 1]?.sourceRowIds || []
          }
          return []
        })
        const sourceRowIds = [...new Set([
          ...(Array.isArray(result?.sourceRowIds) ? result.sourceRowIds : []),
          ...violationRowIds,
        ])].filter((id) => parsedStoryboard.rows.some((row) => row.sourceRowId === id))
        setCountMismatch(mismatch)
        if (sourceRowIds.length > 0) {
          setBoardErrors(Object.fromEntries(sourceRowIds.map((id) => [id, displayError])))
        } else if (String(result?.error || '').startsWith('storyboard-')) {
          setStoryboardFileError(result.error)
        } else {
          setGlobalError(displayError || 'image-first-import-failed')
        }
      }
    } catch (error) {
      setGlobalError(error.message || 'image-first-import-failed')
    } finally {
      setSubmitting(false)
    }
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
    <Modal onClose={handleClose} title={`📂 ${t('import.title')}`} className="import-modal">
      {showImageFirst ? (
        <div className="image-first-import">
          <div className="image-first-toolbar">
            <button type="button" className="btn btn-secondary" onClick={() => setShowImageFirst(false)} disabled={submitting}>
              ← {t('import.imageFirstBack')}
            </button>
            <label className="btn btn-secondary">
              {t('import.imageFirstSelectImages')}
              <input
                aria-label="image-first-images"
                type="file"
                accept="image/png,image/jpeg,.png,.jpg,.jpeg"
                multiple
                onChange={handleImageFiles}
                disabled={submitting}
                hidden
              />
            </label>
            <label className="btn btn-secondary">
              {t('import.imageFirstSelectStoryboard')}
              <input
                aria-label="image-first-storyboard"
                type="file"
                accept=".csv,text/csv"
                onChange={handleStoryboardFile}
                disabled={submitting}
                hidden
              />
            </label>
          </div>

          <p className="import-desc">{t('import.imageFirstOrderHint')}</p>
          <div className="image-first-file-list">
            {imageRows.map((row, index) => (
              <div className="image-first-file-row" data-testid="image-first-file-row" key={row.id}>
                <span className="image-first-ordinal">{index + 1}</span>
                {row.previewUrl && <img src={row.previewUrl} alt="" className="image-first-thumb" />}
                <span className="image-first-filename">{row.file.name}</span>
                <button
                  type="button"
                  aria-label={`Move ${row.file.name} up`}
                  onClick={() => moveImage(index, -1)}
                  disabled={confirmed || submitting || index === 0}
                >↑</button>
                <button
                  type="button"
                  aria-label={`Move ${row.file.name} down`}
                  onClick={() => moveImage(index, 1)}
                  disabled={confirmed || submitting || index === imageRows.length - 1}
                >↓</button>
                {fileErrors[row.id] && <div role="alert" className="image-first-alert">{errorText(fileErrors[row.id])}</div>}
              </div>
            ))}
          </div>

          {storyboardFilename && <div className="image-first-storyboard-name">{storyboardFilename}</div>}
          {storyboardFileError && (
            <div role="alert" data-testid="storyboard-file-alert" className="image-first-alert">
              {errorText(storyboardFileError)}
            </div>
          )}
          {parsedStoryboard.rows.length > 0 && (
            <div className="image-first-board-preview">
              {parsedStoryboard.rows.map((row) => (
                <div
                  key={row.sourceRowId}
                  data-source-row-id={row.sourceRowId}
                  data-testid={row.sourceRowId}
                  className="image-first-board-row"
                >
                  <span>{row.sceneOrdinal ?? '—'}</span>
                  <span>{row.prompt || row.prompt_ko || '—'}</span>
                  <span>{row.subtitle || '—'}</span>
                  <span>{row.speaker || '—'}</span>
                  {boardErrors[row.sourceRowId] && (
                    <div role="alert" className="image-first-alert">{errorText(boardErrors[row.sourceRowId], countMismatch || {})}</div>
                  )}
                </div>
              ))}
            </div>
          )}
          {globalError && <div role="alert" className="image-first-alert">{errorText(globalError, countMismatch || {})}</div>}
          <div className="image-first-actions">
            <button
              type="button"
              className="btn btn-primary"
              aria-label="Confirm image-first import"
              disabled={submitting || imageRows.length === 0 || !storyboardCsv}
              onClick={handleImageFirstConfirm}
            >
              {submitting ? t('import.imageFirstImporting') : t('import.imageFirstConfirm')}
            </button>
          </div>
        </div>
      ) : (
        <>
          <p className="import-desc">{t('import.selectFormat')}</p>

          <div className="import-options">
            <div
              className="import-option"
              data-testid="image-first-option"
              onClick={() => setShowImageFirst(true)}
            >
              <div className="option-icon">🧩</div>
              <div className="option-info">
                <div className="option-title">{t('import.imageFirstTitle')}</div>
                <div className="option-desc">{t('import.imageFirstDesc')}</div>
                <div className="option-hint">PNG/JPEG + storyboard CSV</div>
              </div>
              <div className="option-arrow">→</div>
            </div>
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
        </>
      )}
    </Modal>
  )
}
