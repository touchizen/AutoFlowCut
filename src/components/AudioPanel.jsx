/**
 * AudioPanel - Audio 탭 메인 컴포넌트
 * 요약 뷰 (AudioResultModal 레이아웃 재활용) + 타임라인 뷰
 */

import { useState, useMemo, useRef, useCallback } from 'react'
import { useI18n } from '../hooks/useI18n'
import { findSrtSegment } from '../utils/audioTimeline'
import { parseTimeToSeconds } from '../utils/parsers'
import AudioFlagPopover from './AudioFlagPopover'
import Modal from './Modal'
import './AudioPanel.css'

/** ms → MM:SS or HH:MM:SS */
function formatTimecode(ms) {
  if (ms == null) return ''
  const totalSec = Math.floor(ms / 1000)
  const hh = Math.floor(totalSec / 3600)
  const mm = Math.floor((totalSec % 3600) / 60)
  const ss = totalSec % 60
  const pad = (n) => String(n).padStart(2, '0')
  return hh > 0 ? `${pad(hh)}:${pad(mm)}:${pad(ss)}` : `${pad(mm)}:${pad(ss)}`
}

const VOICE_SORT_OPTIONS = ['character', 'timecode', 'count']
const SFX_SORT_OPTIONS = ['category', 'name', 'timecode']

/** 타임코드(ms)에 해당하는 씬을 찾는다 (시간 기반 → SRT 자막 기반 fallback) */
function findSceneAtTime(scenes, timecodeMs, srtEntries) {
  if (!scenes?.length || timecodeMs == null) return null
  // 1차: start_time/end_time 기반
  const timeSec = timecodeMs / 1000
  const byTime = scenes.find(s => {
    const start = parseTimeToSeconds(s.start_time)
    const end = parseTimeToSeconds(s.end_time)
    if (isNaN(start) || isNaN(end)) return false
    return timeSec >= start && timeSec < end
  })
  if (byTime) return byTime
  // 2차: SRT 자막 → 씬 subtitle 매칭
  if (!srtEntries?.length) return null
  const srt = findSrtSegment(srtEntries, timecodeMs)
  if (!srt?.text) return null
  const srtText = srt.text.trim()
  return scenes.find(s => s.subtitle && s.subtitle.includes(srtText)) ||
    scenes.find(s => s.subtitle && srtText.includes(s.subtitle)) || null
}

export default function AudioPanel({ audioPackage, audioReviews, onSaveReview, onBulkReview, onRefresh, srtEntries, scenes }) {
  const { t } = useI18n()
  const [subTab, setSubTab] = useState('summary')
  const [voiceSortBy, setVoiceSortBy] = useState('character')
  const [sfxSortBy, setSfxSortBy] = useState('category')
  const [expandedVoice, setExpandedVoice] = useState(null)
  const [expandedSfx, setExpandedSfx] = useState(null)
  const [showCharacters, setShowCharacters] = useState(false)
  const [playingFile, setPlayingFile] = useState(null)
  const [flagTarget, setFlagTarget] = useState(null)
  const [refreshTooltip, setRefreshTooltip] = useState(null)
  const [selectedItem, setSelectedItem] = useState(null)
  const [hoverTooltip, setHoverTooltip] = useState(null)
  const audioRef = useRef(null)

  const { folderPath, media, voices, sfx, sfxTimecodes, summary } = audioPackage || {}

  // --- Shared logic (from AudioResultModal) ---

  const handlePlay = async (filePath, e) => {
    e?.stopPropagation()
    if (playingFile === filePath) {
      audioRef.current?.pause()
      audioRef.current = null
      setPlayingFile(null)
      return
    }
    if (audioRef.current) {
      audioRef.current.pause()
      audioRef.current = null
    }
    try {
      const result = await window.electronAPI?.readFileAbsolute({ filePath })
      if (!result?.success) return
      const audio = new Audio(result.data)
      audio.onended = () => { setPlayingFile(null); audioRef.current = null }
      audioRef.current = audio
      setPlayingFile(filePath)
      await audio.play()
    } catch (err) {
      console.error('[AudioPanel] Play error:', err)
      setPlayingFile(null)
    }
  }

  const getRelativePath = (filePath) => {
    if (!folderPath || !filePath) return filePath
    return filePath.replace(folderPath + '/', '')
  }

  const isFileFlagged = (filePath) => {
    const rel = getRelativePath(filePath)
    return !!audioReviews?.[rel]
  }

  const getFileReview = (filePath) => {
    const rel = getRelativePath(filePath)
    return audioReviews?.[rel]
  }

  const handleFlag = (filePath, filename, e) => {
    e?.stopPropagation()
    const rect = e?.currentTarget?.getBoundingClientRect()
    setFlagTarget({
      path: filePath,
      filename,
      relativePath: getRelativePath(filePath),
      x: rect?.left || 100,
      y: rect?.top || 100
    })
  }

  // 타임코드 없는 파일 일괄 마크
  // 타임코드가 있는 SFX 파일명 베이스 수집 (원본 제외용)
  const sfxWithTimecodeBaseNames = useMemo(() => {
    const bases = new Set()
    if (sfx) {
      for (const cat of sfx) {
        for (const f of cat.files) {
          if (f.timecodeMs != null) {
            // abacus_beads_01_0134.mp3 → abacus_beads_01 (타임코드 부분 제거)
            const name = f.filename.replace(/\.\w+$/, '')
            const parts = name.split('_')
            parts.pop() // 타임코드 부분 제거
            const baseName = parts.join('_')
            const dir = getRelativePath(f.path).replace(/\/[^/]+$/, '')
            bases.add(`${dir}/${baseName}`)
          }
        }
      }
    }
    return bases
  }, [sfx, folderPath])

  const noTimecodeFiles = useMemo(() => {
    const files = []
    if (voices) {
      for (const v of voices) {
        for (const f of v.files) {
          if (f.timecodeMs == null) {
            const rel = getRelativePath(f.path)
            if (!audioReviews?.[rel]) files.push({ relativePath: rel, filename: f.filename })
          }
        }
      }
    }
    if (sfx) {
      for (const cat of sfx) {
        for (const f of cat.files) {
          if (f.timecodeMs == null) {
            const rel = getRelativePath(f.path)
            // 타임코드 복사본이 존재하면 원본은 제외
            const baseName = f.filename.replace(/\.\w+$/, '')
            const dir = rel.replace(/\/[^/]+$/, '')
            const hasTimecodeVariant = sfxWithTimecodeBaseNames.has(`${dir}/${baseName}`)
            if (!hasTimecodeVariant && !audioReviews?.[rel]) {
              files.push({ relativePath: rel, filename: f.filename })
            }
          }
        }
      }
    }
    return files
  }, [voices, sfx, audioReviews, folderPath, sfxWithTimecodeBaseNames])

  const handleBulkFlagNoTimecode = () => {
    if (!noTimecodeFiles.length || !onBulkReview) return
    const entries = noTimecodeFiles.map(f => ({
      relativePath: f.relativePath,
      reason: '타임코드 없음'
    }))
    onBulkReview(folderPath, entries)
  }

  // --- Summary view data ---

  const sortedVoices = useMemo(() => {
    if (!voices?.length) return []
    const list = [...voices]
    switch (voiceSortBy) {
      case 'timecode': {
        const getMinTc = (v) => {
          const tcs = v.files.map(f => f.timecodeMs).filter(t => t != null)
          return tcs.length > 0 ? Math.min(...tcs) : Infinity
        }
        return list.sort((a, b) => getMinTc(a) - getMinTc(b))
      }
      case 'count':
        return list.sort((a, b) => b.files.length - a.files.length)
      default:
        return list.sort((a, b) => a.character.localeCompare(b.character))
    }
  }, [voices, voiceSortBy])

  const flatFiles = useMemo(() => {
    if (!voices?.length || voiceSortBy === 'character') return []
    const all = voices.flatMap(v => v.files.map(f => ({ ...f, character: v.character })))
    if (voiceSortBy === 'timecode') {
      all.sort((a, b) => (a.timecodeMs || 0) - (b.timecodeMs || 0))
    } else if (voiceSortBy === 'count') {
      const countMap = {}
      voices.forEach(v => { countMap[v.character] = v.files.length })
      all.sort((a, b) => countMap[b.character] - countMap[a.character] || (a.timecodeMs || 0) - (b.timecodeMs || 0))
    }
    return all
  }, [voices, voiceSortBy])

  const sfxTimecodeMap = useMemo(() => {
    if (!sfxTimecodes?.length) return {}
    const map = {}
    for (const tc of sfxTimecodes) {
      if (!map[tc.category]) map[tc.category] = []
      map[tc.category].push(tc)
    }
    return map
  }, [sfxTimecodes])

  const sortedSfxCategories = useMemo(() => {
    if (!sfx?.length || sfxSortBy !== 'category') return []
    return [...sfx].sort((a, b) => a.category.localeCompare(b.category))
  }, [sfx, sfxSortBy])

  const flatSfxFiles = useMemo(() => {
    if (!sfx?.length || sfxSortBy === 'category') return []
    const all = sfx.flatMap(cat => cat.files.map(f => ({ ...f, category: cat.category })))
    if (sfxTimecodes?.length) {
      const tcByCategory = {}
      for (const tc of sfxTimecodes) {
        if (!tcByCategory[tc.category]) tcByCategory[tc.category] = []
        tcByCategory[tc.category].push(tc)
      }
      for (const file of all) {
        const catKey = Object.keys(tcByCategory).find(k =>
          file.category.includes(k.replace(/^\d+_/, '')) || k.includes(file.category.replace(/^\d+_/, ''))
        )
        if (catKey && tcByCategory[catKey].length > 0) {
          const tc = tcByCategory[catKey].shift()
          file.timecodeMs = tc.timecodeMs
          file.description = tc.description
        }
      }
    }
    if (sfxSortBy === 'name') all.sort((a, b) => a.filename.localeCompare(b.filename))
    else if (sfxSortBy === 'timecode') all.sort((a, b) => (a.timecodeMs || Infinity) - (b.timecodeMs || Infinity))
    return all
  }, [sfx, sfxSortBy, sfxTimecodes])

  // --- Timeline view data ---

  const timelineItems = useMemo(() => {
    const items = []
    if (voices) {
      for (const v of voices) {
        for (const f of v.files) {
          items.push({
            type: 'voice', timecodeMs: f.timecodeMs,
            label: v.character, filename: f.filename, path: f.path
          })
        }
      }
    }
    if (sfx) {
      for (const cat of sfx) {
        for (const f of cat.files) {
          // 타임코드 복사본이 있는 원본은 타임라인에서 숨김
          if (f.timecodeMs == null) {
            const baseName = f.filename.replace(/\.\w+$/, '')
            const rel = getRelativePath(f.path)
            const dir = rel.replace(/\/[^/]+$/, '')
            if (sfxWithTimecodeBaseNames.has(`${dir}/${baseName}`)) continue
          }
          items.push({
            type: 'sfx', timecodeMs: f.timecodeMs || null,
            label: cat.category, filename: f.filename, path: f.path
          })
        }
      }
    }
    items.sort((a, b) => (a.timecodeMs ?? Infinity) - (b.timecodeMs ?? Infinity))
    return items
  }, [voices, sfx, sfxWithTimecodeBaseNames, folderPath])

  // --- Play/Flag button renderer ---

  const renderPlayBtn = (filePath) => (
    <button
      className={`play-btn${playingFile === filePath ? ' playing' : ''}`}
      onClick={(e) => handlePlay(filePath, e)}
      title={playingFile === filePath ? 'Stop' : 'Play'}
    >
      {playingFile === filePath ? '■' : '▶'}
    </button>
  )

  const renderFlagBtn = (filePath, filename) => (
    <button
      className={`flag-btn${isFileFlagged(filePath) ? ' flagged' : ''}`}
      onClick={(e) => handleFlag(filePath, filename, e)}
      title={getFileReview(filePath)?.reason || (t('audioTab.flagFile') || '부적합 마크')}
    >
      ⚠️
    </button>
  )

  // --- Summary View ---

  const renderSummary = () => (
    <>
      {/* Folder path */}
      {folderPath && (
        <div className="audio-panel-path">📂 {folderPath}</div>
      )}

      {/* Summary cards */}
      {summary && (
        <div className="audio-result-summary">
          <div className="summary-item summary-clickable" onClick={() => setShowCharacters(prev => !prev)}>
            <span className="summary-label">
              <span className="expand-icon">{showCharacters ? '▼' : '▶'}</span>
              👤 {t('audioResult.characters')}
            </span>
            <span className="summary-value">
              {summary.characters.length === 0 && summary.hasMedia
                ? <span className="summary-hint">{t('audioResult.voicesInMedia')}</span>
                : summary.characters.length}
            </span>
          </div>
          <div className="summary-item">
            <span className="summary-label">🎙️ {t('audioResult.voiceFiles')}</span>
            <span className="summary-value">
              {summary.totalVoiceFiles === 0 && summary.hasMedia
                ? <span className="summary-hint">{t('audioResult.voicesInMedia')}</span>
                : summary.totalVoiceFiles}
            </span>
          </div>
          <div className="summary-item">
            <span className="summary-label">🔊 {t('audioResult.sfxCategories')}</span>
            <span className="summary-value">{summary.totalSfxCategories}{summary.totalSfxFiles > 0 && ` (${summary.totalSfxFiles}${t('audioResult.files')})`}</span>
          </div>
          {summary.hasMedia && (
            <div className="summary-item">
              <span className="summary-label">🎬 {t('audioResult.media')}</span>
              <span className="summary-value">✅</span>
            </div>
          )}
          {summary.hasSrt && (
            <div className="summary-item">
              <span className="summary-label">📺 {t('audioResult.srt')}</span>
              <span className="summary-value">✅</span>
            </div>
          )}
          {/* Flagged count + refresh */}
          <div className="summary-item summary-flagged">
            <span className="summary-label">⚠️ {t('audioTab.flagged') || 'Flagged'}</span>
            <span className="summary-value">
              {Object.keys(audioReviews || {}).length}
              {onRefresh && (
                <span className="refresh-btn-wrapper">
                  <button
                    className="refresh-inline-btn"
                    onClick={(e) => { e.stopPropagation(); onRefresh() }}
                    onMouseEnter={(e) => {
                      const rect = e.currentTarget.getBoundingClientRect()
                      setRefreshTooltip({ x: rect.left + rect.width / 2, y: rect.top })
                    }}
                    onMouseLeave={() => setRefreshTooltip(null)}
                  >
                    🔄
                  </button>
                </span>
              )}
            </span>
          </div>
        </div>
      )}

      {/* Bulk flag button */}
      {noTimecodeFiles.length > 0 && (
        <div className="bulk-flag-bar">
          <button className="btn btn-sm btn-warning" onClick={handleBulkFlagNoTimecode}>
            ⚠️ 타임코드 없는 파일 일괄 마크 ({noTimecodeFiles.length}개)
          </button>
        </div>
      )}

      {/* Review guide */}
      <div className="audio-guide">
        <div className="audio-guide-title">💡 {t('audioTab.guideTitle')} <span className="audio-guide-badge">{t('audioTab.guideBadge')}</span></div>
        <ol className="audio-guide-steps">
          <li>▶️ {t('audioTab.guideStep1')}</li>
          <li>⚠️ {t('audioTab.guideStep2')}</li>
          <li>
            <strong>{t('audioTab.guideStep3Title')}</strong> ({t('audioTab.guideStep3Once')})<br/>
            <a href="https://docs.anthropic.com/en/docs/claude-code" target="_blank" rel="noreferrer">Claude Code</a> {t('audioTab.guideStep3Desc')}<br/>
            <code>claude mcp add autoflowcut node mcp-server/index.js</code><br/>
            <span className="audio-guide-note">* {t('audioTab.guideStep3Note')}</span>
          </li>
          <li>{t('audioTab.guideStep4')}</li>
          <li>{t('audioTab.guideStep5')}</li>
        </ol>
      </div>

      {/* Characters list */}
      {showCharacters && summary && (
        <div className="characters-list">
          {summary.characters.map((name, i) => (
            <span key={i} className="character-tag">👤 {name}</span>
          ))}
        </div>
      )}

      {/* Voice section */}
      {sortedVoices.length > 0 && (
        <div className="audio-result-section">
          <div className="section-title-row">
            <h4 className="section-title">🎙️ {t('audioResult.voiceDetail')}</h4>
            <div className="sort-segment" onClick={e => e.stopPropagation()}>
              {VOICE_SORT_OPTIONS.map(opt => (
                <button key={opt} className={`sort-btn${voiceSortBy === opt ? ' active' : ''}`}
                  onClick={() => setVoiceSortBy(opt)}>
                  {t(`audioResult.sort_${opt}`)}
                </button>
              ))}
            </div>
          </div>

          {voiceSortBy === 'character' ? (
            <div className="audio-detail-list">
              {sortedVoices.map((voice, i) => (
                <div key={i} className="voice-group">
                  <div className="audio-detail-item voice-header" onClick={() => setExpandedVoice(prev => prev === voice.character ? null : voice.character)}>
                    <span className="detail-name">
                      <span className="expand-icon">{expandedVoice === voice.character ? '▼' : '▶'}</span>
                      👤 {voice.character}
                    </span>
                    <span className="detail-count">{voice.files.length} {t('audioResult.files')}</span>
                  </div>
                  {expandedVoice === voice.character && (
                    <div className="voice-files">
                      {[...voice.files].sort((a, b) => (a.timecodeMs || 0) - (b.timecodeMs || 0)).map((file, j) => (
                        <div key={j} className={`voice-file-item${isFileFlagged(file.path) ? ' flagged-row' : ''}`}>
                          {renderPlayBtn(file.path)}
                          <span className="file-timecode">{formatTimecode(file.timecodeMs)}</span>
                          <span className="file-name">{file.filename}</span>
                          {renderFlagBtn(file.path, file.filename)}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <div className="voice-table">
              <div className="voice-table-header">
                <span className="vt-col-play"></span>
                <span className="vt-col-time">{t('audioResult.thTime')}</span>
                <span className="vt-col-char">{t('audioResult.thCharacter')}</span>
                <span className="vt-col-file">{t('audioResult.thFile')}</span>
                <span className="vt-col-flag"></span>
              </div>
              <div className="voice-table-body">
                {flatFiles.map((file, i) => (
                  <div key={i} className={`voice-table-row${isFileFlagged(file.path) ? ' flagged-row' : ''}`}>
                    <span className="vt-col-play">{renderPlayBtn(file.path)}</span>
                    <span className="vt-col-time file-timecode">{formatTimecode(file.timecodeMs)}</span>
                    <span className="vt-col-char">{file.character}</span>
                    <span className="vt-col-file file-name">{file.filename}</span>
                    <span className="vt-col-flag">{renderFlagBtn(file.path, file.filename)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* SFX section */}
      {sfx && sfx.length > 0 && (
        <div className="audio-result-section">
          <div className="section-title-row">
            <h4 className="section-title">🔊 {t('audioResult.sfxDetail')}</h4>
            <div className="sort-segment" onClick={e => e.stopPropagation()}>
              {SFX_SORT_OPTIONS.map(opt => (
                <button key={opt} className={`sort-btn${sfxSortBy === opt ? ' active' : ''}`}
                  onClick={() => setSfxSortBy(opt)}>
                  {t(`audioResult.sort_sfx_${opt}`)}
                </button>
              ))}
            </div>
          </div>

          {sfxSortBy === 'category' ? (
            <div className="audio-detail-list">
              {sortedSfxCategories.map((cat, i) => {
                const timecodes = sfxTimecodeMap[cat.category] || []
                return (
                  <div key={i} className="voice-group">
                    <div className="audio-detail-item voice-header" onClick={() => setExpandedSfx(prev => prev === cat.category ? null : cat.category)}>
                      <span className="detail-name">
                        <span className="expand-icon">{expandedSfx === cat.category ? '▼' : '▶'}</span>
                        🎵 {cat.category}
                      </span>
                      <span className="detail-count">
                        {timecodes.length > 0 && <span className="sfx-tc-badge">{timecodes.length} tc</span>}
                        {cat.files.length} {t('audioResult.files')}
                      </span>
                    </div>
                    {expandedSfx === cat.category && (
                      <div className="voice-files">
                        {timecodes.length > 0 && (
                          <div className="sfx-tc-list">
                            {timecodes.map((tc, k) => (
                              <div key={k} className="sfx-tc-entry">
                                <span className="file-timecode">{formatTimecode(tc.timecodeMs)}</span>
                                <span className="sfx-tc-desc">{tc.description}</span>
                              </div>
                            ))}
                          </div>
                        )}
                        {cat.files.map((file, j) => (
                          <div key={j} className={`voice-file-item${isFileFlagged(file.path) ? ' flagged-row' : ''}`}>
                            {renderPlayBtn(file.path)}
                            <span className="file-name">{file.filename}</span>
                            {renderFlagBtn(file.path, file.filename)}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          ) : (
            <div className="voice-table">
              <div className="voice-table-header">
                <span className="vt-col-play"></span>
                <span className="vt-col-time">{t('audioResult.thTime')}</span>
                <span className="vt-col-char">{t('audioResult.thCategory')}</span>
                <span className="vt-col-file">{t('audioResult.thFile')}</span>
                <span className="vt-col-flag"></span>
              </div>
              <div className="voice-table-body">
                {flatSfxFiles.map((file, i) => (
                  <div key={i} className={`voice-table-row${isFileFlagged(file.path) ? ' flagged-row' : ''}`}>
                    <span className="vt-col-play">{renderPlayBtn(file.path)}</span>
                    <span className="vt-col-time file-timecode">{formatTimecode(file.timecodeMs)}</span>
                    <span className="vt-col-char">{file.category}</span>
                    <span className="vt-col-file file-name">{file.filename}</span>
                    <span className="vt-col-flag">{renderFlagBtn(file.path, file.filename)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* SRT preview */}
      {srtEntries && srtEntries.length > 0 && (
        <div className="audio-result-section">
          <h4 className="section-title">📺 {t('audioResult.srtPreview')} ({srtEntries.length})</h4>
          <div className="srt-preview-list">
            {srtEntries.slice(0, 20).map((entry, i) => (
              <div key={i} className="srt-entry">
                <span className="srt-time">{formatTimecode(entry.startMs)} → {formatTimecode(entry.endMs)}</span>
                <span className="srt-text">{entry.text}</span>
              </div>
            ))}
            {srtEntries.length > 20 && (
              <div className="srt-more">... +{srtEntries.length - 20} {t('audioResult.more')}</div>
            )}
          </div>
        </div>
      )}

      {/* Media */}
      {media && (media.video || media.srt) && (
        <div className="audio-result-section">
          <h4 className="section-title">🎬 {t('audioResult.mediaDetail')}</h4>
          <div className="audio-detail-list">
            {media.video && <div className="audio-detail-item"><span className="detail-name">🎥 {media.video.filename}</span></div>}
            {media.srt && <div className="audio-detail-item"><span className="detail-name">📺 {media.srt.filename}</span></div>}
          </div>
        </div>
      )}
    </>
  )

  // --- Timeline View ---

  const renderTimeline = () => (
    <div className="audio-timeline">
      {noTimecodeFiles.length > 0 && (
        <div className="bulk-flag-bar">
          <button className="btn btn-sm btn-warning" onClick={handleBulkFlagNoTimecode}>
            ⚠️ 타임코드 없는 파일 일괄 마크 ({noTimecodeFiles.length}개)
          </button>
        </div>
      )}
      <div className="voice-table">
        <div className="voice-table-header">
          <span className="vt-col-play"></span>
          <span className="vt-col-time">{t('audioResult.thTime')}</span>
          <span className="vt-col-type">{t('audioTab.typeVoice') || '타입'}</span>
          <span className="vt-col-char">{t('audioResult.thCharacter')}</span>
          <span className="vt-col-file">{t('audioResult.thFile')}</span>
          <span className="vt-col-srt">{t('audioTab.srtMatch') || '자막'}</span>
          <span className="vt-col-scene">{t('audioTab.sceneContent') || '씬'}</span>
          <span className="vt-col-flag"></span>
        </div>
        <div className="voice-table-body">
          {timelineItems.map((item, i) => {
            const srtMatch = item.timecodeMs != null ? findSrtSegment(srtEntries || [], item.timecodeMs) : null
            const matchedScene = findSceneAtTime(scenes, item.timecodeMs, srtEntries)
            return (
              <div key={i} className={`voice-table-row${isFileFlagged(item.path) ? ' flagged-row' : ''}${selectedItem?.path === item.path ? ' selected-row' : ''}`}
                onClick={() => setSelectedItem({ ...item, srtMatch, matchedScene })}
                style={{ cursor: 'pointer' }}>
                <span className="vt-col-play">{renderPlayBtn(item.path)}</span>
                <span className="vt-col-time file-timecode">{formatTimecode(item.timecodeMs)}</span>
                <span className="vt-col-type">
                  <span className={`type-badge type-${item.type}`}>
                    {item.type === 'voice' ? '🎤' : '🔊'}
                  </span>
                </span>
                <span className="vt-col-char">{item.type === 'sfx' ? 'SFX' : item.label}</span>
                <span className="vt-col-file file-name">{item.filename}</span>
                <span className="vt-col-srt srt-match-text">{srtMatch?.text || ''}</span>
                <span className="vt-col-scene scene-match-text"
                  onMouseEnter={e => matchedScene && setHoverTooltip({ scene: matchedScene, x: e.clientX, y: e.clientY })}
                  onMouseLeave={() => setHoverTooltip(null)}
                >{matchedScene?.subtitle || matchedScene?.prompt_ko || ''}</span>
                <span className="vt-col-flag">{renderFlagBtn(item.path, item.filename)}</span>
              </div>
            )
          })}
        </div>
      </div>

      {/* Review guide */}
      <div className="audio-guide">
        <div className="audio-guide-title">💡 {t('audioTab.guideTitle')} <span className="audio-guide-badge">{t('audioTab.guideBadge')}</span></div>
        <ol className="audio-guide-steps">
          <li>▶️ {t('audioTab.guideStep1')}</li>
          <li>⚠️ {t('audioTab.guideStep2')}</li>
          <li>
            <strong>{t('audioTab.guideStep3Title')}</strong> ({t('audioTab.guideStep3Once')})<br/>
            <a href="https://docs.anthropic.com/en/docs/claude-code" target="_blank" rel="noreferrer">Claude Code</a> {t('audioTab.guideStep3Desc')}<br/>
            <code>claude mcp add autoflowcut node mcp-server/index.js</code><br/>
            <span className="audio-guide-note">* {t('audioTab.guideStep3Note')}</span>
          </li>
          <li>{t('audioTab.guideStep4')}</li>
          <li>{t('audioTab.guideStep5')}</li>
        </ol>
      </div>
    </div>
  )

  // --- Main render ---

  if (!audioPackage) {
    return (
      <div className="audio-panel-empty">
        <div className="audio-panel-empty-icon">🎵</div>
        <p>{t('audioTab.importFirst') || '오디오 패키지를 먼저 가져오세요'}</p>
      </div>
    )
  }

  return (
    <div className="audio-panel">
      <div className="audio-sub-tabs">
        <button className={`sub-tab-btn${subTab === 'summary' ? ' active' : ''}`}
          onClick={() => setSubTab('summary')}>
          📊 {t('audioTab.summary') || '요약'}
        </button>
        <button className={`sub-tab-btn${subTab === 'timeline' ? ' active' : ''}`}
          onClick={() => setSubTab('timeline')}>
          ⏱️ {t('audioTab.timeline') || '타임라인'}
        </button>
        {onRefresh && (
          <span className="refresh-btn-wrapper">
            <button
              className="sub-tab-refresh-btn"
              onClick={onRefresh}
              onMouseEnter={(e) => {
                const rect = e.currentTarget.getBoundingClientRect()
                setRefreshTooltip({ x: rect.left + rect.width / 2, y: rect.top })
              }}
              onMouseLeave={() => setRefreshTooltip(null)}
            >
              🔄
            </button>
          </span>
        )}
      </div>

      <div className="audio-panel-content">
        {subTab === 'summary' ? renderSummary() : renderTimeline()}
      </div>

      {flagTarget && (
        <AudioFlagPopover
          target={flagTarget}
          existingReview={audioReviews?.[flagTarget.relativePath]}
          onSave={(reason) => {
            onSaveReview(audioPackage.folderPath, flagTarget.relativePath, { reason })
            setFlagTarget(null)
          }}
          onRemove={() => {
            onSaveReview(audioPackage.folderPath, flagTarget.relativePath, null)
            setFlagTarget(null)
          }}
          onClose={() => setFlagTarget(null)}
        />
      )}

      {/* Audio Detail Modal */}
      <Modal
        isOpen={!!selectedItem}
        onClose={() => setSelectedItem(null)}
        title={selectedItem ? `${selectedItem.type === 'voice' ? '🎤' : '🔊'} ${formatTimecode(selectedItem.timecodeMs)} — ${selectedItem.filename}` : ''}
        className="audio-detail-modal"
      >
        {selectedItem && (
          <>
            {/* 씬 이미지 */}
            {selectedItem.matchedScene?.imagePath && (
              <img className="audio-detail-hero" src={`file://${selectedItem.matchedScene.imagePath}`} alt="" />
            )}

            {/* 오디오 재생 */}
            <div className="audio-detail-play-row">
              {renderPlayBtn(selectedItem.path)}
              <span className="audio-detail-filename">{selectedItem.filename}</span>
            </div>

            {/* 자막 */}
            {selectedItem.srtMatch?.text && (
              <div className="audio-detail-card">
                <div className="audio-detail-card-label">📝 자막</div>
                <div className="audio-detail-card-text">{selectedItem.srtMatch.text}</div>
              </div>
            )}

            {/* 씬 정보 */}
            {selectedItem.matchedScene && (
              <div className="audio-detail-card">
                <div className="audio-detail-card-label">🎬 씬</div>
                {selectedItem.matchedScene.prompt_ko && (
                  <div className="audio-detail-card-title">{selectedItem.matchedScene.prompt_ko}</div>
                )}
                {selectedItem.matchedScene.subtitle && (
                  <div className="audio-detail-card-text">{selectedItem.matchedScene.subtitle}</div>
                )}
                {selectedItem.matchedScene.characters && (
                  <div className="audio-detail-card-meta">👤 {selectedItem.matchedScene.characters}</div>
                )}
              </div>
            )}

            {/* 부적합 마크 */}
            {isFileFlagged(selectedItem.path) && (
              <div className="audio-detail-card audio-detail-card-flagged">
                <div className="audio-detail-card-label">⚠️ {t('audioTab.flagged')}</div>
                <div className="audio-detail-card-text">{audioReviews?.[getRelativePath(selectedItem.path)]?.reason || ''}</div>
              </div>
            )}
          </>
        )}
      </Modal>

      {/* Scene hover tooltip */}
      {hoverTooltip && (
        <div className="scene-hover-tooltip" style={{ left: hoverTooltip.x + 12, top: hoverTooltip.y - 8 }}>
          {hoverTooltip.scene.imagePath && (
            <img className="scene-hover-img" src={`file://${hoverTooltip.scene.imagePath}`} alt="" />
          )}
          {hoverTooltip.scene.prompt_ko && <div className="scene-hover-prompt">{hoverTooltip.scene.prompt_ko}</div>}
          {hoverTooltip.scene.subtitle && <div className="scene-hover-sub">{hoverTooltip.scene.subtitle}</div>}
          {hoverTooltip.scene.characters && <div className="scene-hover-chars">👤 {hoverTooltip.scene.characters}</div>}
        </div>
      )}

      {/* Custom refresh tooltip */}
      {refreshTooltip && (
        <div
          className="refresh-tooltip"
          style={{ left: refreshTooltip.x, top: refreshTooltip.y }}
        >
          <div className="refresh-tooltip-title">{t('audioTab.refresh') || '새로고침'}</div>
          <div className="refresh-tooltip-desc">
            {t('audioTab.refreshDesc') || '리뷰 파일(.audio_review.json)을 다시 읽어 부적합 마크 상태를 업데이트합니다.'}
          </div>
        </div>
      )}
    </div>
  )
}
