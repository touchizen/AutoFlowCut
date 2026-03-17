/**
 * AudioResultModal - 오디오 패키지 스캔 결과 모달
 */

import { useState, useMemo, useRef, useCallback } from 'react'
import Modal from './Modal'
import { useI18n } from '../hooks/useI18n'
import './AudioResultModal.css'

/** ms → MM:SS 또는 HH:MM:SS 포맷 */
function formatTimecode(ms) {
  if (ms == null) return ''
  const totalSec = Math.floor(ms / 1000)
  const hh = Math.floor(totalSec / 3600)
  const mm = Math.floor((totalSec % 3600) / 60)
  const ss = totalSec % 60
  const pad = (n) => String(n).padStart(2, '0')
  return hh > 0
    ? `${pad(hh)}:${pad(mm)}:${pad(ss)}`
    : `${pad(mm)}:${pad(ss)}`
}

/** 정렬 옵션 */
const SORT_OPTIONS = ['character', 'timecode', 'count']

export default function AudioResultModal({ audioPackage, loading, onClose }) {
  const { t } = useI18n()
  const [expandedVoice, setExpandedVoice] = useState(null)
  const [expandedSfx, setExpandedSfx] = useState(null)
  const [showCharacters, setShowCharacters] = useState(false)
  const [voiceSortBy, setVoiceSortBy] = useState('character')
  const [sfxSortBy, setSfxSortBy] = useState('category') // 'category' | 'timecode' | 'name'
  const [playingFile, setPlayingFile] = useState(null)
  const audioRef = useRef(null)

  const { folderPath, media, voices, sfx, sfxTimecodes, srtEntries, summary } = audioPackage || {}

  const toggleVoice = (character) => {
    setExpandedVoice(prev => prev === character ? null : character)
  }

  /** 오디오 파일 재생/정지 */
  const handlePlay = useCallback(async (filePath, e) => {
    e?.stopPropagation()

    // 이미 재생중이면 정지
    if (playingFile === filePath) {
      audioRef.current?.pause()
      audioRef.current = null
      setPlayingFile(null)
      return
    }

    // 기존 재생 정지
    if (audioRef.current) {
      audioRef.current.pause()
      audioRef.current = null
    }

    try {
      const result = await window.electronAPI?.readFileAbsolute({ filePath })
      if (!result?.success) return

      const audio = new Audio(result.data)
      audio.onended = () => {
        setPlayingFile(null)
        audioRef.current = null
      }
      audioRef.current = audio
      setPlayingFile(filePath)
      await audio.play()
    } catch (err) {
      console.error('[AudioResult] Play error:', err)
      setPlayingFile(null)
    }
  }, [playingFile])

  /** 정렬된 voices */
  const sortedVoices = useMemo(() => {
    if (!voices?.length) return []
    const list = [...voices]
    switch (voiceSortBy) {
      case 'timecode': {
        const getMinTimecode = (v) => {
          const tcs = v.files.map(f => f.timecodeMs).filter(t => t != null)
          return tcs.length > 0 ? Math.min(...tcs) : Infinity
        }
        return list.sort((a, b) => getMinTimecode(a) - getMinTimecode(b))
      }
      case 'count':
        return list.sort((a, b) => b.files.length - a.files.length)
      case 'character':
      default:
        return list.sort((a, b) => a.character.localeCompare(b.character))
    }
  }, [voices, voiceSortBy])

  /** 시간순/개수순일 때 전체 파일을 플랫 리스트로 */
  const flatFiles = useMemo(() => {
    if (!voices?.length || voiceSortBy === 'character') return []
    const all = voices.flatMap(v =>
      v.files.map(f => ({ ...f, character: v.character }))
    )
    if (voiceSortBy === 'timecode') {
      all.sort((a, b) => (a.timecodeMs || 0) - (b.timecodeMs || 0))
    } else if (voiceSortBy === 'count') {
      // 개수 많은 캐릭터 파일이 먼저, 같은 캐릭터 내에선 시간순
      const countMap = {}
      voices.forEach(v => { countMap[v.character] = v.files.length })
      all.sort((a, b) =>
        countMap[b.character] - countMap[a.character] ||
        (a.timecodeMs || 0) - (b.timecodeMs || 0)
      )
    }
    return all
  }, [voices, voiceSortBy])

  /** SFX 타임코드를 카테고리별로 매핑 */
  const sfxTimecodeMap = useMemo(() => {
    if (!sfxTimecodes?.length) return {}
    const map = {}
    for (const tc of sfxTimecodes) {
      if (!map[tc.category]) map[tc.category] = []
      map[tc.category].push(tc)
    }
    return map
  }, [sfxTimecodes])

  /** SFX: 카테고리순이면 아코디언, 시간순/이름순이면 플랫 테이블 */
  const sortedSfxCategories = useMemo(() => {
    if (!sfx?.length || sfxSortBy !== 'category') return []
    return [...sfx].sort((a, b) => a.category.localeCompare(b.category))
  }, [sfx, sfxSortBy])

  const flatSfxFiles = useMemo(() => {
    if (!sfx?.length || sfxSortBy === 'category') return []
    const all = sfx.flatMap(cat =>
      cat.files.map(f => ({ ...f, category: cat.category }))
    )
    // sfxTimecodes에서 각 파일에 타임코드 매핑 (카테고리 + 순번 기준)
    if (sfxTimecodes?.length) {
      const tcByCategory = {}
      for (const tc of sfxTimecodes) {
        if (!tcByCategory[tc.category]) tcByCategory[tc.category] = []
        tcByCategory[tc.category].push(tc)
      }
      for (const file of all) {
        // 카테고리명이 포함되는 타임코드 찾기
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
    if (sfxSortBy === 'name') {
      all.sort((a, b) => a.filename.localeCompare(b.filename))
    } else if (sfxSortBy === 'timecode') {
      all.sort((a, b) => (a.timecodeMs || Infinity) - (b.timecodeMs || Infinity))
    }
    return all
  }, [sfx, sfxSortBy, sfxTimecodes])

  const toggleSfx = (category) => {
    setExpandedSfx(prev => prev === category ? null : category)
  }

  return (
    <Modal
      onClose={() => {
        // 모달 닫을 때 재생 정지
        audioRef.current?.pause()
        audioRef.current = null
        setPlayingFile(null)
        onClose()
      }}
      title={`🎵 ${t('audioResult.title')}`}
      className="audio-result-modal"
      footer={!loading && (
        <button className="btn btn-primary" onClick={() => {
          audioRef.current?.pause()
          onClose()
        }}>
          {t('audioResult.confirm')}
        </button>
      )}
    >
      {/* 로딩 스피너 */}
      {loading && (
        <div className="audio-loading">
          <div className="audio-spinner" />
          <p>{t('audioResult.scanning')}</p>
        </div>
      )}

      {/* 폴더 경로 */}
      {!loading && folderPath && (
      <div className="audio-result-section">
        <div className="audio-result-path">
          📂 {folderPath}
        </div>
      </div>
      )}

      {/* 결과 영역 */}
      {!loading && summary && <>
      <div className="audio-result-summary">
        <div
          className="summary-item summary-clickable"
          onClick={() => setShowCharacters(prev => !prev)}
        >
          <span className="summary-label">
            <span className="expand-icon">{showCharacters ? '▼' : '▶'}</span>
            👤 {t('audioResult.characters')}
          </span>
          <span className="summary-value">{summary.characters.length}</span>
        </div>
        <div className="summary-item">
          <span className="summary-label">🎙️ {t('audioResult.voiceFiles')}</span>
          <span className="summary-value">{summary.totalVoiceFiles}</span>
        </div>
        <div className="summary-item">
          <span className="summary-label">🔊 {t('audioResult.sfxCategories')}</span>
          <span className="summary-value">{summary.totalSfxCategories}</span>
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
      </div>

      {/* 등장인물 목록 (펼침) */}
      {showCharacters && (
        <div className="characters-list">
          {summary.characters.map((name, i) => (
            <span key={i} className="character-tag">👤 {name}</span>
          ))}
        </div>
      )}

      {/* 인물별 음성 파일 */}
      {sortedVoices.length > 0 && (
        <div className="audio-result-section">
          <div className="section-title-row">
            <h4 className="section-title">🎙️ {t('audioResult.voiceDetail')}</h4>
            <div className="sort-segment" onClick={(e) => e.stopPropagation()}>
              {SORT_OPTIONS.map(opt => (
                <button
                  key={opt}
                  className={`sort-btn${voiceSortBy === opt ? ' active' : ''}`}
                  onClick={() => setVoiceSortBy(opt)}
                >
                  {t(`audioResult.sort_${opt}`)}
                </button>
              ))}
            </div>
          </div>
          {/* 인물순: 아코디언 */}
          {voiceSortBy === 'character' ? (
            <div className="audio-detail-list">
              {sortedVoices.map((voice, i) => (
                <div key={i} className="voice-group">
                  <div
                    className="audio-detail-item voice-header"
                    onClick={() => toggleVoice(voice.character)}
                  >
                    <span className="detail-name">
                      <span className="expand-icon">{expandedVoice === voice.character ? '▼' : '▶'}</span>
                      👤 {voice.character}
                    </span>
                    <span className="detail-count">{voice.files.length} {t('audioResult.files')}</span>
                  </div>
                  {expandedVoice === voice.character && (
                    <div className="voice-files">
                      {[...voice.files]
                        .sort((a, b) => (a.timecodeMs || 0) - (b.timecodeMs || 0))
                        .map((file, j) => (
                          <div key={j} className="voice-file-item">
                            <button
                              className={`play-btn${playingFile === file.path ? ' playing' : ''}`}
                              onClick={(e) => handlePlay(file.path, e)}
                              title={playingFile === file.path ? 'Stop' : 'Play'}
                            >
                              {playingFile === file.path ? '■' : '▶'}
                            </button>
                            <span className="file-timecode">{formatTimecode(file.timecodeMs)}</span>
                            <span className="file-name">{file.filename}</span>
                          </div>
                        ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          ) : (
            /* 시간순/개수순: 플랫 테이블 */
            <div className="voice-table">
              <div className="voice-table-header">
                <span className="vt-col-play"></span>
                <span className="vt-col-time">{t('audioResult.thTime')}</span>
                <span className="vt-col-char">{t('audioResult.thCharacter')}</span>
                <span className="vt-col-file">{t('audioResult.thFile')}</span>
              </div>
              <div className="voice-table-body">
                {flatFiles.map((file, i) => (
                  <div key={i} className="voice-table-row">
                    <span className="vt-col-play">
                      <button
                        className={`play-btn${playingFile === file.path ? ' playing' : ''}`}
                        onClick={(e) => handlePlay(file.path, e)}
                      >
                        {playingFile === file.path ? '■' : '▶'}
                      </button>
                    </span>
                    <span className="vt-col-time file-timecode">{formatTimecode(file.timecodeMs)}</span>
                    <span className="vt-col-char">{file.character}</span>
                    <span className="vt-col-file file-name">{file.filename}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* SFX */}
      {sfx && sfx.length > 0 && (
        <div className="audio-result-section">
          <div className="section-title-row">
            <h4 className="section-title">🔊 {t('audioResult.sfxDetail')}</h4>
            <div className="sort-segment" onClick={(e) => e.stopPropagation()}>
              {['category', 'name', 'timecode'].map(opt => (
                <button
                  key={opt}
                  className={`sort-btn${sfxSortBy === opt ? ' active' : ''}`}
                  onClick={() => setSfxSortBy(opt)}
                >
                  {t(`audioResult.sort_sfx_${opt}`)}
                </button>
              ))}
            </div>
          </div>

          {/* 카테고리순: 아코디언 */}
          {sfxSortBy === 'category' ? (
            <div className="audio-detail-list">
              {sortedSfxCategories.map((cat, i) => {
                const timecodes = sfxTimecodeMap[cat.category] || []
                return (
                <div key={i} className="voice-group">
                  <div
                    className="audio-detail-item voice-header"
                    onClick={() => toggleSfx(cat.category)}
                  >
                    <span className="detail-name">
                      <span className="expand-icon">{expandedSfx === cat.category ? '▼' : '▶'}</span>
                      🎵 {cat.category}
                    </span>
                    <span className="detail-count">
                      {timecodes.length > 0 && (
                        <span className="sfx-tc-badge">{timecodes.length} tc</span>
                      )}
                      {cat.files.length} {t('audioResult.files')}
                    </span>
                  </div>
                  {expandedSfx === cat.category && (
                    <div className="voice-files">
                      {/* 타임코드 정보 */}
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
                      {/* 파일 목록 */}
                      {cat.files.map((file, j) => (
                        <div key={j} className="voice-file-item">
                          <button
                            className={`play-btn${playingFile === file.path ? ' playing' : ''}`}
                            onClick={(e) => handlePlay(file.path, e)}
                          >
                            {playingFile === file.path ? '■' : '▶'}
                          </button>
                          <span className="file-name">{file.filename}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                )
              })}
            </div>
          ) : (
            /* 이름순/시간순: 플랫 테이블 */
            <div className="voice-table">
              <div className="voice-table-header">
                <span className="vt-col-play"></span>
                <span className="vt-col-time">{t('audioResult.thTime')}</span>
                <span className="vt-col-char">{t('audioResult.thCategory')}</span>
                <span className="vt-col-file">{t('audioResult.thFile')}</span>
              </div>
              <div className="voice-table-body">
                {flatSfxFiles.map((file, i) => (
                  <div key={i} className="voice-table-row">
                    <span className="vt-col-play">
                      <button
                        className={`play-btn${playingFile === file.path ? ' playing' : ''}`}
                        onClick={(e) => handlePlay(file.path, e)}
                      >
                        {playingFile === file.path ? '■' : '▶'}
                      </button>
                    </span>
                    <span className="vt-col-time file-timecode">{formatTimecode(file.timecodeMs)}</span>
                    <span className="vt-col-char">{file.category}</span>
                    <span className="vt-col-file file-name">{file.filename}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* SRT 자막 미리보기 */}
      {srtEntries && srtEntries.length > 0 && (
        <div className="audio-result-section">
          <h4 className="section-title">📺 {t('audioResult.srtPreview')} ({srtEntries.length})</h4>
          <div className="srt-preview-list">
            {srtEntries.slice(0, 20).map((entry, i) => (
              <div key={i} className="srt-entry">
                <span className="srt-time">
                  {formatTimecode(entry.startMs)} → {formatTimecode(entry.endMs)}
                </span>
                <span className="srt-text">{entry.text}</span>
              </div>
            ))}
            {srtEntries.length > 20 && (
              <div className="srt-more">
                ... +{srtEntries.length - 20} {t('audioResult.more')}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Media */}
      {media && (media.video || media.srt) && (
        <div className="audio-result-section">
          <h4 className="section-title">🎬 {t('audioResult.mediaDetail')}</h4>
          <div className="audio-detail-list">
            {media.video && (
              <div className="audio-detail-item">
                <span className="detail-name">🎥 {media.video.filename}</span>
              </div>
            )}
            {media.srt && (
              <div className="audio-detail-item">
                <span className="detail-name">📺 {media.srt.filename}</span>
              </div>
            )}
          </div>
        </div>
      )}
      </>}
    </Modal>
  )
}
