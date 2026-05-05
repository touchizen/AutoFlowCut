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
  // refreshing: 폴더 재스캔(refreshReviews) / 자동 로드(importByPath) 진행 중 표시.
  // 여러 op가 동시에 setRefreshing(true/false)하면 race로 stale clear → counter로 추적.
  const [refreshing, setRefreshing] = useState(false)
  // refreshOpsRef: 진행 중인 op 카운터. 진입 시 ++ → 0→1이면 setRefreshing(true).
  // 종료 시 -- → 1→0이면 setRefreshing(false). version 가드와 무관하게 자기 op 항상 정리.
  const refreshOpsRef = useRef(0)
  const beginRefresh = () => {
    refreshOpsRef.current += 1
    if (refreshOpsRef.current === 1) setRefreshing(true)
  }
  const endRefresh = () => {
    refreshOpsRef.current = Math.max(0, refreshOpsRef.current - 1)
    if (refreshOpsRef.current === 0) setRefreshing(false)
  }
  // refreshingRef: refreshReviews 동시 호출 가드 (같은 폴더 path 중복 방지, double-click).
  const refreshingRef = useRef(false)
  // activeImportsRef: 현재 진행 중인 import 카운터.
  // 의미적 우선순위 — import는 refresh보다 우선.
  // refresh가 import의 토큰을 supersede하면 사용자가 명시적으로 시작한 프로젝트 전환이
  // silently drop되므로 (MCP 시나리오 포함), refreshReviews는 import in-flight 시 즉시 종료.
  const activeImportsRef = useRef(0)
  // opVersionRef: import / refresh 모든 비동기 op가 공유하는 버전 토큰.
  // 진입 시 ++ → 완료 단계마다 자기 버전이 최신인지 검사 → 아니면 mutation 전부 skip.
  // 이래야 stale refresh가 새 import 결과를 덮어쓰지 못함.
  const opVersionRef = useRef(0)
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

  // Pure read — no audioReviews mutation. stale-able 호출자는 이걸 쓰고 commit은 직접 가드.
  const _readReviewsFile = useCallback(async (folderPath) => {
    const reviewPath = getReviewPath(folderPath)
    if (!reviewPath) return {}
    try {
      const result = await window.electronAPI?.readFileAbsolute({ filePath: reviewPath })
      if (result?.success && result.data) {
        const base64 = result.data.split(',')[1]
        const bytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0))
        const json = new TextDecoder().decode(bytes)
        return JSON.parse(json) || {}
      }
    } catch (e) {
      console.warn('[AudioReview] read error:', e)
    }
    return {}
  }, [getReviewPath])

  // Public: read + commit (외부 caller / non-stale-able 컨텍스트용).
  const loadReviews = useCallback(async (folderPath) => {
    const reviews = await _readReviewsFile(folderPath)
    updateReviews(reviews)
    console.log('[AudioReview] loaded:', folderPath, Object.keys(reviews).length, 'entries')
    return reviews
  }, [_readReviewsFile, updateReviews])

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
   * @param {{ skipReviews?: boolean, shouldCommit?: () => boolean }} options
   *   - skipReviews: true이면 리뷰 로드 생략 (refreshReviews에서 별도 처리)
   *   - shouldCommit: 매 mutation 전에 호출되어 false면 즉시 종료. 호출자가 op 버전 검증.
   *     기본값은 항상 true (호출자가 아무 가드도 안 줄 때).
   *
   * 주의: await가 있는 모든 step 직후에 shouldCommit() 검사를 둠. await 동안 더 새로운 op가
   * opVersionRef를 올렸으면 stale 결과로 audioPackage / localStorage / audioTracks 더럽히면 안 됨.
   */
  const _processScanResult = async (result, { skipReviews = false, shouldCommit = () => true } = {}) => {
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
    if (!shouldCommit()) return null
    applyOverrides(pkg, overrides)

    if (!shouldCommit()) return null
    setAudioPackage(pkg)

    // 프로젝트별 audioFolderPath 저장 — stale write가 다른 프로젝트 경로를 덮지 않도록 가드
    if (!shouldCommit()) return null
    const projectName = localStorage.getItem('autoflowcut_settings') ? JSON.parse(localStorage.getItem('autoflowcut_settings')).projectName : null
    if (projectName) {
      const audioMap = JSON.parse(localStorage.getItem('audioFolderPaths') || '{}')
      audioMap[projectName] = result.folderPath
      localStorage.setItem('audioFolderPaths', JSON.stringify(audioMap))
    }
    localStorage.setItem('audioFolderPath', result.folderPath)

    if (!skipReviews) {
      // pure read → guarded commit. 안 그러면 stale 호출이 다른 프로젝트 reviews 덮어씀.
      const reviews = await _readReviewsFile(result.folderPath)
      if (!shouldCommit()) return null
      updateReviews(reviews)
    }
    const tracks = buildAudioTracks(pkg, srtEntries)
    if (!shouldCommit()) return null
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

    const myVersion = ++opVersionRef.current
    const shouldCommit = () => myVersion === opVersionRef.current
    activeImportsRef.current += 1
    setImporting(true)
    try {
      const result = await window.electronAPI.scanAudioPackage()
      if (!shouldCommit()) return null

      if (!result.success) {
        if (result.error !== 'cancelled') {
          toast.error(t('audioImport.scanFailed').replace('{error}', result.error))
        }
        return null
      }

      return await _processScanResult(result, { shouldCommit })
    } catch (error) {
      console.error('[AudioImport] Error:', error)
      toast.error(t('audioImport.scanFailed').replace('{error}', error.message))
      return null
    } finally {
      activeImportsRef.current = Math.max(0, activeImportsRef.current - 1)
      // importing은 manual import dialog 단일 호출 path → 자기가 항상 정리.
      setImporting(false)
    }
  }, [t, loadReviews])

  /**
   * 폴더 경로로 직접 오디오 패키지 import (다이얼로그 없이, MCP용)
   */
  const importByPath = useCallback(async (folderPath) => {
    if (!folderPath || !window.electronAPI?.rescanAudioPackage) return null
    // Latest-wins: 프로젝트 전환 같은 사용자 동작은 절대 drop되면 안 됨. 매 단계에서 shouldCommit 검사.
    const myVersion = ++opVersionRef.current
    const shouldCommit = () => myVersion === opVersionRef.current
    activeImportsRef.current += 1
    beginRefresh()
    try {
      const result = await window.electronAPI.rescanAudioPackage({ folderPath })
      if (!shouldCommit()) {
        console.log('[AudioImport] importByPath superseded:', folderPath)
        return null
      }
      if (!result?.success) return null
      const pkg = await _processScanResult(result, { shouldCommit })
      // _processScanResult가 shouldCommit으로 모든 mutation 가드 — 여기 도달하면 commit됐거나 null
      if (pkg) console.log('[AudioImport] importByPath done:', folderPath, result.summary)
      return pkg
    } catch (e) {
      console.error('[AudioImport] importByPath error:', e)
      return null
    } finally {
      activeImportsRef.current = Math.max(0, activeImportsRef.current - 1)
      // 자기 op는 무조건 카운터에서 빠짐 — 다른 op가 살아있으면 카운터가 0이 안 되어 spinner 유지
      endRefresh()
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
   * 오디오 패키지 초기화 — 프로젝트 전환 시 즉시 비우고 다음 import 호출.
   * opVersion을 bump해서 in-flight import가 클리어 직후 자기 데이터를 다시 commit하지 못하게 한다.
   */
  const clearAudioPackage = useCallback(() => {
    ++opVersionRef.current
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
    // import가 in-flight면 refresh는 silently 종료 — import가 의미적으로 우선.
    // (refresh가 import의 토큰을 supersede하면 사용자/MCP가 시작한 프로젝트 전환이 dropped.)
    if (activeImportsRef.current > 0) {
      console.warn('[AudioRefresh] refreshReviews skipped — import in flight')
      return
    }
    // 동시 refresh 가드 — 두 번 클릭 등 같은 path 중복 방지 (boolean lock)
    if (refreshingRef.current) {
      console.warn('[AudioRefresh] refreshReviews ignored — already in progress')
      return
    }
    refreshingRef.current = true
    // import와 같은 토큰 시스템에 참여 — 새 import가 들어오면 stale refresh의 mutation 차단
    const myVersion = ++opVersionRef.current
    const shouldCommit = () => myVersion === opVersionRef.current
    beginRefresh()
    try {
      // 1. 폴더 재스캔 → 패키지/트랙 업데이트 (리뷰는 아래서 별도 처리)
      const rescan = await window.electronAPI?.rescanAudioPackage?.({ folderPath })
      if (!shouldCommit()) {
        console.log('[AudioRefresh] superseded after rescan:', folderPath)
        return
      }
      if (rescan?.success) {
        const committedPkg = await _processScanResult(rescan, { skipReviews: true, shouldCommit })
        if (!shouldCommit() || !committedPkg) {
          // _processScanResult가 superseded됐거나 실패 — 후속 mutation 모두 skip
          return
        }
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
                basesWithTimecode.add(`media/sfx/${cat.category}/${baseName}`)
              }
            }
          }
        }

        // 3. 리뷰 파일 pure read — 그 사이 superseded 가능. 아래 commit 가드 거쳐 반영.
        const reviews = await _readReviewsFile(folderPath)
        if (!shouldCommit()) return

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

        // cleaned/raw 둘 중 무엇을 commit할지 결정 후 단일 가드
        const finalReviews = cleaned ? updated : reviews
        if (!shouldCommit()) return
        updateReviews(finalReviews)
        if (cleaned) {
          await window.electronAPI?.writeFileAbsolute({
            filePath: getReviewPath(folderPath),
            content: JSON.stringify(updated, null, 2)
          })
          console.log('[AudioRefresh] cleaned reviews:', Object.keys(updated).length, 'entries')
        }
      } else {
        // rescan 실패 시 pure read + 가드된 commit
        const reviews = await _readReviewsFile(folderPath)
        if (!shouldCommit()) return
        updateReviews(reviews)
      }

      console.log('[AudioReview] refreshed from:', folderPath)
    } finally {
      refreshingRef.current = false
      endRefresh()
    }
  }, [audioPackage?.folderPath, _readReviewsFile, updateReviews, getReviewPath])

  return {
    audioPackage,
    audioTracks,
    importing,
    refreshing,
    // 큰 프로젝트 import/refresh/auto-load 모두 비동기. UI는 한 가지 spinner로 다 처리.
    audioLoading: importing || refreshing,
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
