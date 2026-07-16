import { useState } from 'react'
import './SpeakerAudioSource.css'

/**
 * 화자 한 명의 오디오 출처 — TTS로 만들지, 이미 있는 (mp3, SRT)에서 잘라 쓸지.
 *
 * 나레이터든 등장인물이든 같은 컨트롤을 쓴다. 출처를 지정하면 ⑤가 그 화자의 대사를 자막에서
 * 찾아 mp3를 잘라 쓰고(TTS 호출 0), 지정 안 하면 평소대로 성우 TTS로 만든다.
 *
 * mp3와 SRT는 **짝이 다 있어야** 의미가 있다(자막이 있어야 어느 구간인지 안다). 그래서 하나만
 * 떨어뜨린 상태는 여기 로컬로 들고 있다가 둘 다 모이면 그때 위로 올린다 — 반쪽짜리 출처가
 * 화자 배정에 들어가면 ⑤가 "성우 미배정"으로 막힌다.
 *
 * 드롭은 파일 두 개를 한 번에 받아도 되고 하나씩 받아도 된다. Electron 36에서 File.path가
 * 없어져 경로는 webUtils(preload의 getPathForFile)로만 얻을 수 있다 — 주입 가능하게 열어둔다.
 */
export default function SpeakerAudioSource({
  source,
  disabled = false,
  onPick,
  onChange,
  t = (_k, fallback) => fallback,
  resolvePath = (f) => window.electronAPI?.getPathForFile?.(f) || f?.path || '',
}) {
  const [dragOver, setDragOver] = useState(false)
  const [draft, setDraft] = useState({})
  const [error, setError] = useState('')

  const mp3Path = source?.mp3Path || draft.mp3Path || ''
  const srtPath = source?.srtPath || draft.srtPath || ''
  const active = !!(source?.mp3Path && source?.srtPath)
  const baseName = (p) => (p ? String(p).split(/[\\/]/).pop() : '')

  // 둘 다 모이면 위로 올리고, 아니면 로컬에 들고 있는다.
  const commit = (next) => {
    setError('')
    if (next.mp3Path && next.srtPath) {
      setDraft({})
      onChange(next)
    } else {
      setDraft(next)
    }
  }

  const takeFiles = (files) => {
    const next = { mp3Path, srtPath }
    let touched = false
    let unresolved = false
    for (const f of files) {
      const p = resolvePath(f)
      // 경로를 못 얻은 경우와 확장자가 아닌 경우는 다른 문제다 — 뭉뚱그리면 mp3를 놓고도
      // "mp3만 놓으라"는 엉뚱한 안내를 보게 된다(Electron에서 File.path가 없어 경로 획득이
      // preload에 달려 있다).
      if (!p) { unresolved = true; continue }
      if (/\.mp3$/i.test(p)) { next.mp3Path = p; touched = true } else if (/\.srt$/i.test(p)) { next.srtPath = p; touched = true }
    }
    if (!touched) {
      setError(unresolved
        ? t('story.audio.source.errPath', '파일 경로를 읽지 못했습니다. 버튼으로 직접 선택해주세요.')
        : t('story.audio.source.errKind', 'mp3와 SRT 파일만 놓을 수 있습니다.'))
      return
    }
    commit(next)
  }

  const pick = async (kind) => {
    setError('')
    const res = await onPick(kind === 'srt'
      ? { kind, title: t('story.audioImport.pickSrt', '자막(SRT) 선택'), filterName: t('story.audioImport.srtFilter', 'SubRip 자막') }
      : { kind, title: t('story.audioImport.pickMp3', '나레이션 오디오 선택'), filterName: t('story.audioImport.mp3Filter', '오디오') })
    if (res?.canceled || !res?.filePath) return
    commit({ mp3Path, srtPath, [kind === 'srt' ? 'srtPath' : 'mp3Path']: res.filePath })
  }

  const clear = () => {
    setDraft({})
    setError('')
    onChange(null)
  }

  return (
    <div
      className={`story-src ${active ? 'on' : ''} ${dragOver ? 'over' : ''}`}
      data-testid="speaker-audio-source"
      onDragOver={(e) => { if (disabled) return; e.preventDefault(); setDragOver(true) }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        if (disabled) return
        e.preventDefault()
        setDragOver(false)
        takeFiles(Array.from(e.dataTransfer?.files || []))
      }}
    >
      {active ? (
        <>
          <button type="button" className="story-src-chip on" onClick={() => pick('mp3')} disabled={disabled} data-testid="src-mp3" title={mp3Path}>
            📁 {baseName(mp3Path)}
          </button>
          <button type="button" className="story-src-chip on" onClick={() => pick('srt')} disabled={disabled} data-testid="src-srt" title={srtPath}>
            📝 {baseName(srtPath)}
          </button>
          <button type="button" className="story-src-clear" onClick={clear} disabled={disabled} data-testid="src-clear" title={t('story.audio.source.clear', '가져오기 해제 — TTS로 생성')}>
            ✕
          </button>
        </>
      ) : (
        <>
          <button type="button" className={`story-src-chip ${mp3Path ? 'half' : ''}`} onClick={() => pick('mp3')} disabled={disabled} data-testid="src-mp3" title={mp3Path}>
            {mp3Path ? `📁 ${baseName(mp3Path)}` : t('story.audio.source.addMp3', '＋ mp3')}
          </button>
          <button type="button" className={`story-src-chip ${srtPath ? 'half' : ''}`} onClick={() => pick('srt')} disabled={disabled} data-testid="src-srt" title={srtPath}>
            {srtPath ? `📝 ${baseName(srtPath)}` : t('story.audio.source.addSrt', '＋ SRT')}
          </button>
        </>
      )}
      {!active && (mp3Path || srtPath) && (
        <span className="story-src-need" data-testid="src-need">
          {mp3Path
            ? t('story.audio.source.needSrt', 'SRT도 필요합니다 (어느 구간인지 알아야 자릅니다)')
            : t('story.audio.source.needMp3', 'mp3도 필요합니다')}
        </span>
      )}
      {error && <span className="story-src-error" role="alert">{error}</span>}
    </div>
  )
}
