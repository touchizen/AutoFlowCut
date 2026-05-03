/**
 * useAudioPlayback - 단일 오디오 재생 상태 관리
 *
 * - 한 번에 하나의 파일만 재생 (toggle 패턴)
 * - 재생 중 진행도(0~1) 추적 (waveform 표시용)
 * - cleanup 자동 처리 (unmount / 새 재생 시작 시 이전 audio 정리)
 */

import { useState, useRef, useEffect } from 'react'

export function useAudioPlayback() {
  const [playingFile, setPlayingFile] = useState(null)
  const [playProgress, setPlayProgress] = useState(0)
  const audioRef = useRef(null)

  const stopAudio = () => {
    audioRef.current?.pause()
    audioRef.current = null
    setPlayingFile(null)
    setPlayProgress(0)
  }

  const playAudio = async (filePath) => {
    // 항상 이전 audio 정리하고 새로 시작 (toggle 동작은 handlePlay에서)
    if (audioRef.current) {
      audioRef.current.pause()
      audioRef.current = null
    }
    setPlayingFile(null)
    setPlayProgress(0)
    if (!filePath) return
    try {
      const result = await window.electronAPI?.readFileAbsolute({ filePath })
      if (!result?.success) {
        console.error('[useAudioPlayback] read failed:', filePath, result?.error)
        return
      }
      const audio = new Audio(result.data)
      audio.ontimeupdate = () => {
        if (audio.duration > 0) setPlayProgress(audio.currentTime / audio.duration)
      }
      audio.onended = () => {
        setPlayingFile(null); setPlayProgress(0); audioRef.current = null
      }
      audio.onerror = (e) => console.error('[useAudioPlayback] audio error:', filePath, e)
      audioRef.current = audio
      setPlayingFile(filePath)
      try {
        await audio.play()
      } catch (playErr) {
        console.error('[useAudioPlayback] play() rejected:', filePath, playErr)
      }
    } catch (err) {
      console.error('[useAudioPlayback] Play error:', err)
    }
  }

  // ▶ 버튼 클릭 (같은 파일 = 일시정지, 다른 파일 = 새로 재생)
  const handlePlay = async (filePath, e) => {
    e?.stopPropagation()
    if (playingFile === filePath) { stopAudio(); return }
    await playAudio(filePath)
  }

  // 컴포넌트 unmount 시 정리
  useEffect(() => () => {
    audioRef.current?.pause()
    audioRef.current = null
  }, [])

  return { playingFile, playProgress, playAudio, stopAudio, handlePlay }
}
