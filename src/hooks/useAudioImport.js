/**
 * useAudioImport Hook
 *
 * 오디오 패키지 폴더를 스캔하고, SRT와 매칭하여
 * CapCut 내보내기용 멀티트랙 오디오 데이터를 생성.
 */

import { useState, useCallback, useRef, useEffect } from 'react'
import { parseSRT, parseSfxTimecodes, buildAudioTracks } from '../utils/audioTimeline'
import { toast } from '../components/Toast'

export function useAudioImport(t) {
  const [audioPackage, setAudioPackage] = useState(null)
  const [audioTracks, setAudioTracks] = useState(null)
  const [importing, setImporting] = useState(false)
  const [audioReviews, setAudioReviews] = useState({})
  const reviewsRef = useRef({})

  const updateReviews = useCallback((reviews) => {
    reviewsRef.current = reviews
    setAudioReviews(reviews)
  }, [])

  const getReviewPath = useCallback((folderPath) => {
    if (!folderPath) return null
    return `${folderPath}/.audio_review.json`
  }, [])

  const loadReviews = useCallback(async (folderPath) => {
    const reviewPath = getReviewPath(folderPath)
    if (!reviewPath) return {}
    try {
      const result = await window.electronAPI?.readFileAbsolute({ filePath: reviewPath })
      if (result?.success && result.data) {
        const base64 = result.data.split(',')[1]
        const bytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0))
        const json = new TextDecoder().decode(bytes)
        const reviews = JSON.parse(json)
        updateReviews(reviews)
        console.log('[AudioReview] loaded:', reviewPath, Object.keys(reviews).length, 'entries')
        return reviews
      }
    } catch (e) {
      console.warn('[AudioReview] load error:', e)
    }
    updateReviews({})
    return {}
  }, [getReviewPath, updateReviews])

  const saveReview = useCallback(async (folderPath, relativePath, review) => {
    const reviewPath = getReviewPath(folderPath)
    if (!reviewPath) return
    const updated = { ...reviewsRef.current }
    if (review) {
      updated[relativePath] = { status: 'flagged', reason: review.reason, flaggedAt: new Date().toISOString() }
    } else {
      delete updated[relativePath]
    }
    updateReviews(updated)
    const writeResult = await window.electronAPI?.writeFileAbsolute({
      filePath: reviewPath,
      content: JSON.stringify(updated, null, 2)
    })
    console.log('[AudioReview] save:', reviewPath, writeResult, Object.keys(updated).length, 'entries')
  }, [getReviewPath, updateReviews])

  const saveBulkReviews = useCallback(async (folderPath, entries) => {
    const reviewPath = getReviewPath(folderPath)
    if (!reviewPath) return
    const updated = { ...reviewsRef.current }
    const now = new Date().toISOString()
    for (const { relativePath, reason } of entries) {
      updated[relativePath] = { status: 'flagged', reason, flaggedAt: now }
    }
    updateReviews(updated)
    const writeResult = await window.electronAPI?.writeFileAbsolute({
      filePath: reviewPath,
      content: JSON.stringify(updated, null, 2)
    })
    console.log('[AudioReview] bulk save:', reviewPath, writeResult, Object.keys(updated).length, 'entries')
  }, [getReviewPath, updateReviews])

  /**
   * 오디오 패키지 폴더 선택 및 스캔
   */
  const importAudioPackage = useCallback(async () => {
    if (!window.electronAPI?.scanAudioPackage) {
      toast.error(t('audioImport.electronRequired'))
      return null
    }

    setImporting(true)
    try {
      const result = await window.electronAPI.scanAudioPackage()

      if (!result.success) {
        if (result.error !== 'cancelled') {
          toast.error(t('audioImport.scanFailed').replace('{error}', result.error))
        }
        return null
      }

      // SRT 파싱
      let srtEntries = []
      if (result.srtContent) {
        srtEntries = parseSRT(result.srtContent)
      }

      // SFX 타임코드 파싱
      let sfxTimecodes = []
      if (result.sfxMdContent) {
        sfxTimecodes = parseSfxTimecodes(result.sfxMdContent)
      }

      // 오디오 패키지 구성
      const pkg = {
        folderPath: result.folderPath,
        media: result.media,
        voices: result.voices,
        sfx: result.sfx,
        sfxTimecodes,
        srtEntries,
        srtContent: result.srtContent || null,
        summary: result.summary
      }

      setAudioPackage(pkg)
      // 프로젝트별 audioFolderPath 저장
      const projectName = localStorage.getItem('flow2capcut_settings') ? JSON.parse(localStorage.getItem('flow2capcut_settings')).projectName : null
      if (projectName) {
        const audioMap = JSON.parse(localStorage.getItem('audioFolderPaths') || '{}')
        audioMap[projectName] = result.folderPath
        localStorage.setItem('audioFolderPaths', JSON.stringify(audioMap))
      }
      localStorage.setItem('audioFolderPath', result.folderPath)
      await loadReviews(result.folderPath)

      // 트랙 데이터 생성
      const tracks = buildAudioTracks(pkg, srtEntries)
      setAudioTracks(tracks)

      return pkg
    } catch (error) {
      console.error('[AudioImport] Error:', error)
      toast.error(t('audioImport.scanFailed').replace('{error}', error.message))
      return null
    } finally {
      setImporting(false)
    }
  }, [t, loadReviews])

  /**
   * 폴더 경로로 직접 오디오 패키지 import (다이얼로그 없이, MCP용)
   */
  const importByPath = useCallback(async (folderPath) => {
    if (!folderPath || !window.electronAPI?.rescanAudioPackage) return null
    try {
      const result = await window.electronAPI.rescanAudioPackage({ folderPath })
      if (!result?.success) return null

      let srtEntries = []
      if (result.srtContent) srtEntries = parseSRT(result.srtContent)
      let sfxTimecodes = []
      if (result.sfxMdContent) sfxTimecodes = parseSfxTimecodes(result.sfxMdContent)

      const pkg = {
        folderPath: result.folderPath,
        media: result.media,
        voices: result.voices,
        sfx: result.sfx,
        sfxTimecodes,
        srtEntries,
        srtContent: result.srtContent || null,
        summary: result.summary
      }
      setAudioPackage(pkg)
      // 프로젝트별 audioFolderPath 저장
      const projectName = localStorage.getItem('flow2capcut_settings') ? JSON.parse(localStorage.getItem('flow2capcut_settings')).projectName : null
      if (projectName) {
        const audioMap = JSON.parse(localStorage.getItem('audioFolderPaths') || '{}')
        audioMap[projectName] = result.folderPath
        localStorage.setItem('audioFolderPaths', JSON.stringify(audioMap))
      }
      localStorage.setItem('audioFolderPath', result.folderPath)
      await loadReviews(result.folderPath)
      const tracks = buildAudioTracks(pkg, srtEntries)
      setAudioTracks(tracks)
      console.log('[AudioImport] importByPath done:', folderPath, result.summary)
      return pkg
    } catch (e) {
      console.error('[AudioImport] importByPath error:', e)
      return null
    }
  }, [loadReviews])

  /**
   * 앱 시작 시 저장된 audioFolderPath로 자동 로드
   */
  useEffect(() => {
    const saved = localStorage.getItem('audioFolderPath')
    if (saved && !audioPackage && window.electronAPI?.rescanAudioPackage) {
      importByPath(saved).then(pkg => {
        if (pkg) console.log('[AudioImport] Auto-loaded from saved path:', saved)
      })
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  /**
   * 오디오 패키지 초기화
   */
  const clearAudioPackage = useCallback(() => {
    setAudioPackage(null)
    setAudioTracks(null)
  }, [])

  /**
   * 프로젝트 전환 시 해당 프로젝트의 오디오 복원
   */
  const switchAudioForProject = useCallback(async (newProjectName) => {
    // 현재 오디오 클리어
    setAudioPackage(null)
    setAudioTracks(null)

    // 새 프로젝트의 audioFolderPath 찾기
    const audioMap = JSON.parse(localStorage.getItem('audioFolderPaths') || '{}')
    const savedPath = audioMap[newProjectName]

    if (savedPath && window.electronAPI?.rescanAudioPackage) {
      console.log('[AudioImport] Restoring audio for project:', newProjectName, savedPath)
      localStorage.setItem('audioFolderPath', savedPath)
      await importByPath(savedPath)
    } else {
      localStorage.removeItem('audioFolderPath')
      console.log('[AudioImport] No audio for project:', newProjectName)
    }
  }, [importByPath])

  /**
   * 폴더 재스캔 + 리뷰 자동 정리
   * - 폴더를 다시 스캔하여 새로 추가된 타임코드 파일 감지
   * - 타임코드 복사본이 생긴 원본 파일은 부적합에서 자동 제거
   * - 리뷰 파일 저장
   */
  const refreshReviews = useCallback(async () => {
    const folderPath = audioPackage?.folderPath
    if (!folderPath) return

    // 1. 폴더 재스캔 (다이얼로그 없이)
    const rescan = await window.electronAPI?.rescanAudioPackage?.({ folderPath })
    if (rescan?.success) {
      // SRT/SFX 파싱
      let srtEntries = []
      if (rescan.srtContent) srtEntries = parseSRT(rescan.srtContent)
      let sfxTimecodes = []
      if (rescan.sfxMdContent) sfxTimecodes = parseSfxTimecodes(rescan.sfxMdContent)

      const pkg = {
        folderPath: rescan.folderPath,
        media: rescan.media,
        voices: rescan.voices,
        sfx: rescan.sfx,
        sfxTimecodes,
        srtEntries,
        srtContent: rescan.srtContent || null,
        summary: rescan.summary
      }
      setAudioPackage(pkg)

      const tracks = buildAudioTracks(pkg, srtEntries)
      setAudioTracks(tracks)

      console.log('[AudioRefresh] rescan done:', rescan.summary)

      // 2. 타임코드가 있는 SFX 원본 베이스네임 수집
      const basesWithTimecode = new Set()
      if (rescan.sfx) {
        for (const cat of rescan.sfx) {
          for (const f of cat.files) {
            if (f.timecodeMs != null) {
              const name = f.filename.replace(/\.\w+$/, '')
              const parts = name.split('_')
              parts.pop()
              const baseName = parts.join('_')
              // relative dir: voice_samples/sfx/{category}
              basesWithTimecode.add(`voice_samples/sfx/${cat.category}/${baseName}`)
            }
          }
        }
      }

      // 3. 리뷰 파일 다시 읽기
      const reviews = await loadReviews(folderPath)

      // 4. 타임코드 복사본이 생긴 파일은 자동 언플래그
      let cleaned = false
      const updated = { ...reviews }
      for (const key of Object.keys(updated)) {
        if (updated[key]?.reason === '타임코드 없음') {
          const filename = key.split('/').pop()
          const baseName = filename.replace(/\.\w+$/, '')
          const dir = key.replace(/\/[^/]+$/, '')
          if (basesWithTimecode.has(`${dir}/${baseName}`)) {
            delete updated[key]
            cleaned = true
            console.log('[AudioRefresh] auto-unflagged:', key)
          }
        }
      }

      if (cleaned) {
        updateReviews(updated)
        await window.electronAPI?.writeFileAbsolute({
          filePath: getReviewPath(folderPath),
          content: JSON.stringify(updated, null, 2)
        })
        console.log('[AudioRefresh] cleaned reviews:', Object.keys(updated).length, 'entries')
      }
    } else {
      // rescan 실패 시 기존 방식으로 리뷰만 읽기
      await loadReviews(folderPath)
    }

    console.log('[AudioReview] refreshed from:', folderPath)
  }, [audioPackage?.folderPath, loadReviews, updateReviews, getReviewPath])

  return {
    audioPackage,
    audioTracks,
    importing,
    audioReviews,
    importAudioPackage,
    importByPath,
    clearAudioPackage,
    setAudioPackage,
    setAudioTracks,
    saveReview,
    saveBulkReviews,
    loadReviews,
    refreshReviews
  }
}
