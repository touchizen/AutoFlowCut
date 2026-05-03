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

  // ── 오디오 timecode override (.audio_overrides.json) ──
  // 사용자가 타임라인에서 클립을 드래그하면 파일은 그대로 두고 보정값만 저장
  const getOverridePath = useCallback((folderPath) => {
    if (!folderPath) return null
    return `${folderPath}/.audio_overrides.json`
  }, [])

  const loadOverrides = useCallback(async (folderPath) => {
    const overridePath = getOverridePath(folderPath)
    if (!overridePath) return {}
    try {
      const result = await window.electronAPI?.readFileAbsolute({ filePath: overridePath })
      if (result?.success && result.data) {
        const base64 = result.data.split(',')[1]
        const json = new TextDecoder().decode(Uint8Array.from(atob(base64), c => c.charCodeAt(0)))
        return JSON.parse(json) || {}
      }
    } catch (e) {
      console.warn('[AudioOverride] load error:', e)
    }
    return {}
  }, [getOverridePath])

  // pkg 내 voices/sfx 파일에 override timecodeMs 적용
  const applyOverrides = (pkg, overrides) => {
    if (!pkg || !overrides || Object.keys(overrides).length === 0) return pkg
    const apply = (rel, file) => {
      const o = overrides[rel]
      if (o?.timecodeMs != null) file.timecodeMs = o.timecodeMs
    }
    for (const v of (pkg.voices || [])) {
      for (const f of v.files) {
        const rel = f.path.replace(pkg.folderPath + '/', '')
        apply(rel, f)
      }
    }
    for (const cat of (pkg.sfx || [])) {
      for (const f of cat.files) {
        const rel = f.path.replace(pkg.folderPath + '/', '')
        apply(rel, f)
      }
    }
    return pkg
  }

  // 클립 timecode 보정 저장 (드래그 후 호출)
  const saveTimecodeOverride = useCallback(async (relativePath, timecodeMs) => {
    const folderPath = audioPackage?.folderPath
    const overridePath = getOverridePath(folderPath)
    if (!overridePath || !relativePath) return

    const overrides = await loadOverrides(folderPath)
    overrides[relativePath] = {
      ...overrides[relativePath],
      timecodeMs: Math.max(0, Math.round(timecodeMs)),
      modifiedAt: new Date().toISOString(),
    }

    await window.electronAPI?.writeFileAbsolute({
      filePath: overridePath,
      content: JSON.stringify(overrides, null, 2)
    })

    // in-memory pkg 업데이트 → 즉시 반영
    setAudioPackage(prev => {
      if (!prev) return prev
      const next = { ...prev, voices: [...(prev.voices || [])], sfx: [...(prev.sfx || [])] }
      // voices 깊은 복사 (file 객체 변경 위해)
      next.voices = next.voices.map(v => ({
        ...v,
        files: v.files.map(f => ({ ...f }))
      }))
      next.sfx = next.sfx.map(c => ({
        ...c,
        files: c.files.map(f => ({ ...f }))
      }))
      return applyOverrides(next, overrides)
    })

    console.log('[AudioOverride] saved:', relativePath, '→', timecodeMs)
  }, [audioPackage?.folderPath, getOverridePath, loadOverrides])

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
   * 스캔 결과 → 패키지 구성 + localStorage 저장 + 트랙 생성 (공통 헬퍼)
   * @param {object} result - 스캔 결과
   * @param {{ skipReviews?: boolean }} options - skipReviews: true이면 리뷰 로드 생략 (refreshReviews에서 별도 처리)
   */
  const _processScanResult = async (result, { skipReviews = false } = {}) => {
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

    // .audio_overrides.json 적용 (드래그로 보정한 timecode)
    const overrides = await loadOverrides(result.folderPath)
    applyOverrides(pkg, overrides)

    setAudioPackage(pkg)

    // 프로젝트별 audioFolderPath 저장
    const projectName = localStorage.getItem('autoflowcut_settings') ? JSON.parse(localStorage.getItem('autoflowcut_settings')).projectName : null
    if (projectName) {
      const audioMap = JSON.parse(localStorage.getItem('audioFolderPaths') || '{}')
      audioMap[projectName] = result.folderPath
      localStorage.setItem('audioFolderPaths', JSON.stringify(audioMap))
    }
    localStorage.setItem('audioFolderPath', result.folderPath)

    if (!skipReviews) await loadReviews(result.folderPath)
    const tracks = buildAudioTracks(pkg, srtEntries)
    setAudioTracks(tracks)

    return pkg
  }

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

      return await _processScanResult(result)
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

      const pkg = await _processScanResult(result)
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
   * 폴더 재스캔 + 리뷰 자동 정리
   * - 폴더를 다시 스캔하여 새로 추가된 타임코드 파일 감지
   * - 타임코드 복사본이 생긴 원본 파일은 부적합에서 자동 제거
   * - 리뷰 파일 저장
   */
  const refreshReviews = useCallback(async () => {
    const folderPath = audioPackage?.folderPath
    if (!folderPath) return

    // 1. 폴더 재스캔 (다이얼로그 없이) → 패키지/트랙 업데이트 (리뷰는 아래서 별도 처리)
    const rescan = await window.electronAPI?.rescanAudioPackage?.({ folderPath })
    if (rescan?.success) {
      await _processScanResult(rescan, { skipReviews: true })
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
              // relative dir: media/sfx/{category}
              basesWithTimecode.add(`media/sfx/${cat.category}/${baseName}`)
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
    refreshReviews,
    saveTimecodeOverride
  }
}
