/**
 * AudioSummary - 오디오 패키지 요약 탭
 *
 * 요약 카드 + 음성/SFX/SRT/Media 상세 리스트.
 * 정렬/펼침 상태는 자체 보유. 재생/플래그는 부모(useAudioPlayback hook + 플래그 popover)와
 * 콜백으로 통신.
 */

import { useState, useMemo } from 'react'
import { useI18n } from '../hooks/useI18n'

const VOICE_SORT_OPTIONS = ['character', 'timecode', 'count']
const SFX_SORT_OPTIONS = ['category', 'name', 'timecode']

function formatTimecode(ms) {
  if (ms == null) return ''
  const totalSec = Math.floor(ms / 1000)
  const hh = Math.floor(totalSec / 3600)
  const mm = Math.floor((totalSec % 3600) / 60)
  const ss = totalSec % 60
  const pad = (n) => String(n).padStart(2, '0')
  return hh > 0 ? `${pad(hh)}:${pad(mm)}:${pad(ss)}` : `${pad(mm)}:${pad(ss)}`
}

export default function AudioSummary({
  audioPackage,
  audioReviews,
  srtEntries,
  onRefresh,
  onBulkReview,
  // 재생 (useAudioPlayback에서 옴)
  playingFile,
  onPlayToggle,
  // 플래그
  isFlagged,
  getFileReview,
  onFlagClick,
}) {
  const { t } = useI18n()
  const [voiceSortBy, setVoiceSortBy] = useState('character')
  const [sfxSortBy, setSfxSortBy] = useState('category')
  const [expandedVoice, setExpandedVoice] = useState(null)
  const [expandedSfx, setExpandedSfx] = useState(null)
  const [showCharacters, setShowCharacters] = useState(false)
  const [refreshTooltip, setRefreshTooltip] = useState(null)

  const { folderPath, media, voices, sfx, summary } = audioPackage || {}

  const getRelativePath = (filePath) => {
    if (!folderPath || !filePath) return filePath
    return filePath.replace(folderPath + '/', '')
  }

  // 타임코드 있는 SFX의 base name 셋 (원본 중복 제외용)
  const sfxWithTimecodeBaseNames = useMemo(() => {
    const bases = new Set()
    if (sfx) {
      for (const cat of sfx) {
        for (const f of cat.files) {
          if (f.timecodeMs != null) {
            const name = f.filename.replace(/\.\w+$/, '')
            const parts = name.split('_')
            parts.pop()
            const baseName = parts.join('_')
            const dir = getRelativePath(f.path).replace(/\/[^/]+$/, '')
            bases.add(`${dir}/${baseName}`)
          }
        }
      }
    }
    return bases
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sfx, folderPath])

  const noTimecodeFiles = useMemo(() => {
    const files = []
    if (voices) {
      for (const v of voices) {
        for (const f of v.files) {
          if (f.timecodeMs == null) {
            const rel = getRelativePath(f.path)
            files.push({ relativePath: rel, filename: f.filename, type: 'voice', character: v.character })
          }
        }
      }
    }
    if (sfx) {
      for (const cat of sfx) {
        for (const f of cat.files) {
          if (f.timecodeMs == null) {
            const rel = getRelativePath(f.path)
            const baseName = f.filename.replace(/\.\w+$/, '')
            const dir = rel.replace(/\/[^/]+$/, '')
            const hasTimecodeVariant = sfxWithTimecodeBaseNames.has(`${dir}/${baseName}`)
            if (!hasTimecodeVariant) {
              files.push({ relativePath: rel, filename: f.filename, type: 'sfx', category: cat.category })
            }
          }
        }
      }
    }
    return files
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [voices, sfx, sfxWithTimecodeBaseNames, folderPath])

  const handleBulkFlagNoTimecode = () => {
    if (!noTimecodeFiles.length || !onBulkReview) return
    const entries = noTimecodeFiles.map(f => ({
      relativePath: f.relativePath,
      reason: '타임코드 없음',
    }))
    onBulkReview(folderPath, entries)
  }

  // ── Voice 정렬 ──
  const sortedVoices = useMemo(() => {
    if (!voices) return []
    const list = [...voices]
    if (voiceSortBy === 'character') list.sort((a, b) => a.character.localeCompare(b.character))
    else if (voiceSortBy === 'count') list.sort((a, b) => b.files.length - a.files.length)
    else if (voiceSortBy === 'timecode') {
      list.sort((a, b) => {
        const getMinTc = (v) => {
          const tcs = v.files.map(f => f.timecodeMs).filter(t => t != null)
          return tcs.length > 0 ? Math.min(...tcs) : Infinity
        }
        return getMinTc(a) - getMinTc(b)
      })
    }
    return list
  }, [voices, voiceSortBy])

  const flatFiles = useMemo(() => {
    if (!voices) return []
    const all = voices.flatMap(v => v.files.map(f => ({ ...f, character: v.character })))
    if (voiceSortBy === 'timecode') {
      all.sort((a, b) => (a.timecodeMs || 0) - (b.timecodeMs || 0))
    } else if (voiceSortBy === 'count') {
      const countMap = {}
      voices.forEach(v => { countMap[v.character] = v.files.length })
      all.sort((a, b) => countMap[b.character] - countMap[a.character] || (a.timecodeMs || 0) - (b.timecodeMs || 0))
    } else {
      all.sort((a, b) => a.character.localeCompare(b.character) || (a.timecodeMs || 0) - (b.timecodeMs || 0))
    }
    return all
  }, [voices, voiceSortBy])

  // ── SFX 타임코드 매핑 ──
  const sfxTimecodeMap = useMemo(() => {
    if (!audioPackage?.sfxTimecodes) return {}
    const map = {}
    for (const tc of audioPackage.sfxTimecodes) {
      if (!map[tc.category]) map[tc.category] = []
      map[tc.category].push(tc)
    }
    return map
  }, [audioPackage?.sfxTimecodes])

  const sortedSfxCategories = useMemo(() => {
    if (!sfx) return []
    const list = [...sfx]
    if (sfxSortBy === 'category') list.sort((a, b) => a.category.localeCompare(b.category))
    return list
  }, [sfx, sfxSortBy])

  const flatSfxFiles = useMemo(() => {
    if (!sfx) return []
    const all = sfx.flatMap(cat => cat.files.map(f => ({ ...f, category: cat.category })))
    if (sfxSortBy === 'name') all.sort((a, b) => a.filename.localeCompare(b.filename))
    else if (sfxSortBy === 'timecode') all.sort((a, b) => (a.timecodeMs || Infinity) - (b.timecodeMs || Infinity))
    else {
      // category 정렬: 같은 카테고리 안에서는 sfxTimecodes의 timecode를 추가 정렬에 사용
      const tcByCategory = {}
      for (const cat of sfx) {
        const tcs = sfxTimecodeMap[cat.category] || []
        tcByCategory[cat.category] = [...tcs].sort((a, b) => a.timecodeMs - b.timecodeMs).map(tc => tc.timecodeMs)
      }
      all.forEach(file => {
        const catKey = Object.keys(tcByCategory).find(k =>
          file.category === k && tcByCategory[k].length > 0
        )
        if (catKey) {
          const tc = tcByCategory[catKey].shift()
          file.timecodeMs = tc
        }
      })
      all.sort((a, b) =>
        a.category.localeCompare(b.category) ||
        (a.timecodeMs || Infinity) - (b.timecodeMs || Infinity)
      )
    }
    return all
  }, [sfx, sfxSortBy, sfxTimecodeMap])

  // ── 작은 렌더 헬퍼 ──
  const renderPlayBtn = (filePath) => (
    <button
      className={`play-btn${playingFile === filePath ? ' playing' : ''}`}
      onClick={(e) => onPlayToggle?.(filePath, e)}
      title={playingFile === filePath ? 'Stop' : 'Play'}
    >
      {playingFile === filePath ? '■' : '▶'}
    </button>
  )

  const renderFlagBtn = (filePath, filename) => (
    <button
      className={`flag-btn${isFlagged?.(filePath) ? ' flagged' : ''}`}
      onClick={(e) => onFlagClick?.(filePath, filename, e)}
      title={getFileReview?.(filePath)?.reason || (t('audioTab.flagFile') || '부적합 마크')}
    >
      ⚠️
    </button>
  )

  return (
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
                        <div key={j} className={`voice-file-item${isFlagged?.(file.path) ? ' flagged-row' : ''}`}>
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
                  <div key={i} className={`voice-table-row${isFlagged?.(file.path) ? ' flagged-row' : ''}`}>
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
                          <div key={j} className={`voice-file-item${isFlagged?.(file.path) ? ' flagged-row' : ''}`}>
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
                  <div key={i} className={`voice-table-row${isFlagged?.(file.path) ? ' flagged-row' : ''}`}>
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

      {/* Refresh tooltip */}
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
    </>
  )
}
