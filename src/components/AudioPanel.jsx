/**
 * AudioPanel - Audio 탭 메인 컴포넌트
 * 요약 뷰 (AudioResultModal 레이아웃 재활용) + 타임라인 뷰
 */

import { useState, useEffect } from 'react'
import { useI18n } from '../hooks/useI18n'
import { useAudioPlayback } from '../hooks/useAudioPlayback'
import { findSrtSegment } from '../utils/audioTimeline'
import { parseTimeToSeconds } from '../utils/parsers'
import AudioFlagPopover from './AudioFlagPopover'
import AudioTimeline from './AudioTimeline/AudioTimeline'
import AudioDetailModal from './AudioDetailModal'
import AudioSummary from './AudioSummary'
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

export default function AudioPanel({ audioPackage, audioReviews, onSaveReview, onBulkReview, onRefresh, onSaveTimecodeOverride, srtEntries, scenes }) {
  const { t } = useI18n()
  const [subTab, setSubTab] = useState('timeline')
  const [flagTarget, setFlagTarget] = useState(null)
  const [refreshTooltip, setRefreshTooltip] = useState(null)
  const [selectedItem, setSelectedItem] = useState(null)
  const [hoverTooltip, setHoverTooltip] = useState(null)

  const { folderPath } = audioPackage || {}

  // 오디오 재생 (단일 파일, toggle 패턴) — useAudioPlayback hook이 audio 인스턴스/진행도 관리
  const { playingFile, playProgress, playAudio, stopAudio, handlePlay } = useAudioPlayback()

  // 모달이 열리면 자동 재생, 닫히면 정지
  useEffect(() => {
    if (selectedItem?.path) playAudio(selectedItem.path)
    else stopAudio()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedItem?.path])

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
        <button className={`sub-tab-btn${subTab === 'timeline' ? ' active' : ''}`}
          onClick={() => setSubTab('timeline')}>
          ⏱️ {t('audioTab.timeline') || '타임라인'}
        </button>
        <button className={`sub-tab-btn${subTab === 'summary' ? ' active' : ''}`}
          onClick={() => setSubTab('summary')}>
          📊 {t('audioTab.summary') || '요약'}
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
        {subTab === 'timeline' ? (
          <AudioTimeline
            audioPackage={audioPackage}
            scenes={scenes}
            srtEntries={srtEntries}
            onSaveTimecodeOverride={onSaveTimecodeOverride}
            onClipSelect={(clip) => {
              // 오디오 클립(narration/voice/sfx)만 상세 모달 표시
              // 이미지/자막 클립은 PreviewPanel에서 이미 보여주고 있음
              if (!clip.audioPath) return
              const matchedScene = findSceneAtTime(scenes, clip.startMs, srtEntries)
              const srtMatch = clip.startMs != null ? findSrtSegment(srtEntries || [], clip.startMs) : null
              setSelectedItem({
                type: clip.type || 'narration',
                timecodeMs: clip.startMs,
                filename: clip.filename || '',
                path: clip.audioPath,
                matchedScene,
                srtMatch,
              })
            }}
          />
        ) : (
          <AudioSummary
            audioPackage={audioPackage}
            audioReviews={audioReviews}
            srtEntries={srtEntries}
            onRefresh={onRefresh}
            onBulkReview={onBulkReview}
            playingFile={playingFile}
            onPlayToggle={handlePlay}
            isFlagged={isFileFlagged}
            getFileReview={getFileReview}
            onFlagClick={handleFlag}
          />
        )}
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
      <AudioDetailModal
        selectedItem={selectedItem}
        onClose={() => setSelectedItem(null)}
        audioReviews={audioReviews}
        getRelativePath={getRelativePath}
        isFlagged={isFileFlagged}
        playingFile={playingFile}
        playProgress={playProgress}
        onPlayToggle={handlePlay}
        t={t}
      />

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
