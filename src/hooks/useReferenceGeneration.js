/**
 * useReferenceGeneration - 레퍼런스 이미지 생성 (개별 + 일괄)
 */

import { useState, useRef, useCallback } from 'react'
import { RESOURCE, STYLE_PRESETS } from '../config/defaults'
import { fileSystemAPI } from './useFileSystem'
import { checkFolderPermission, checkAuthToken } from '../utils/guards'
import { cleanBase64, toDataURL } from '../utils/urls'
import { tryUpscaleImage, extractThumbnailBase64 } from '../utils/imageProcessing'
import { toast } from '../components/Toast'
import { createStyleResolver } from '../services/styleResolver'

// 1~3초 랜덤 딜레이
const randomDelay = () => new Promise(r => setTimeout(r, 1000 + Math.random() * 2000))

// 동시성 제한 매핑 — useAutomation 의 슬라이딩 윈도우 (MAX_CONCURRENT=5) 와 같은 의도.
// Promise.all 을 그대로 쓰면 한 폴링 창에 N 개가 동시에 Flow 를 두드려 429 risk.
async function mapWithConcurrency(items, mapper, concurrency = 5) {
  if (items.length === 0) return []
  const results = new Array(items.length)
  let cursor = 0
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (true) {
      const myIdx = cursor++
      if (myIdx >= items.length) return
      results[myIdx] = await mapper(items[myIdx], myIdx)
    }
  })
  await Promise.all(workers)
  return results
}

// uploadReference 429 retry — useAutomation.js 의 보호와 동일 패턴. 각 호출이 자체적으로
// rate-limit 을 견디게 함. 비-429 실패는 즉시 반환 (백오프 무의미).
async function uploadReferenceWithRetry(flowAPI, base64, category, logPrefix) {
  const MAX_RETRIES = 2
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const result = await flowAPI.uploadReference(base64, category)
      if (result.success) return result
      if (result.error?.includes('429') && attempt < MAX_RETRIES) {
        const backoff = (attempt + 1) * 2000 + Math.random() * 1000
        console.warn(`${logPrefix} uploadReference 429 — retry in ${Math.round(backoff)}ms (attempt ${attempt + 1}/${MAX_RETRIES})`)
        await new Promise(r => setTimeout(r, backoff))
        continue
      }
      return result
    } catch (e) {
      if (attempt < MAX_RETRIES && /429|rate/i.test(e?.message || '')) {
        const backoff = (attempt + 1) * 2000 + Math.random() * 1000
        await new Promise(r => setTimeout(r, backoff))
        continue
      }
      return { success: false, error: e?.message || String(e) }
    }
  }
  return { success: false, error: 'uploadReference exhausted retries' }
}

export function useReferenceGeneration({ settings, references, setReferences, flowAPI, addPendingSave, openSettings, pendingSavesCount = 0, t, selectedStyleRefId, styleThumbnails, generationQueue }) {
  const [generatingRefs, setGeneratingRefs] = useState([])
  const [stoppingRefs, setStoppingRefs] = useState(false)
  const [preparingRefs, setPreparingRefs] = useState(false)  // 배치 준비 중 (권한/토큰/썸네일 업로드)
  const [saveFailedOnce, setSaveFailedOnce] = useState(false)  // 배치 중 저장 실패 알림 1회만
  const stopRequestedRef = useRef(false)
  const presetMediaCache = useRef({})  // 프리셋 썸네일 → Flow mediaId 캐시
  const referencesRef = useRef(references)
  referencesRef.current = references  // 매 렌더마다 최신 상태 반영

  const stopGenerateAllRefs = useCallback(() => {
    stopRequestedRef.current = true
    setStoppingRefs(true)
  }, [])

  // ─── 공통: 스타일 레퍼런스 준비 ───
  // 개별 생성과 배치 생성 모두에서 사용. 프리셋 썸네일은 캐시 miss 시 자동 업로드.
  const _prepareStyleRefs = async (ref, effectiveStyleId, logPrefix = '[StyleRef]') => {
    const styleRefImages = []
    let styledPrompt = ref.prompt

    if (ref.type === 'style' || !effectiveStyleId) {
      return { styledPrompt, styleRefImages }
    }

    if (effectiveStyleId.startsWith('ref:')) {
      const refId = effectiveStyleId.replace('ref:', '')
      const styleRef = referencesRef.current.find(r => r.id == refId && r.type === 'style')
      if (styleRef) {
        if (styleRef.mediaId) {
          styleRefImages.push({ category: styleRef.category, mediaId: styleRef.mediaId, caption: styleRef.caption || '' })
        }
        if (styleRef.prompt) {
          styledPrompt = `${ref.prompt}, ${styleRef.prompt}`
        }
      }
    } else if (effectiveStyleId.startsWith('preset:')) {
      const presetId = effectiveStyleId.replace('preset:', '')
      const preset = STYLE_PRESETS?.styles?.find(s => s.id === presetId)

      // 썸네일: 캐시 hit → 사용, miss → 업로드 후 캐시
      if (styleThumbnails?.[presetId]) {
        let mediaId = presetMediaCache.current[presetId]
        if (!mediaId) {
          const thumbBase64 = await extractThumbnailBase64(styleThumbnails[presetId], fileSystemAPI, logPrefix)
          if (thumbBase64) {
            try {
              const uploadResult = await flowAPI.uploadReference(thumbBase64, 'style')
              if (uploadResult.success) {
                mediaId = uploadResult.mediaId
                presetMediaCache.current[presetId] = mediaId
                console.log(logPrefix, 'Preset thumbnail uploaded, mediaId:', mediaId)
              }
            } catch (e) {
              console.warn(logPrefix, 'Preset thumbnail upload failed:', e)
            }
          }
        }
        if (mediaId) {
          styleRefImages.push({ category: 'style', mediaId, caption: preset?.prompt_en || '' })
        }
      }

      if (preset?.prompt_en) {
        styledPrompt = `${ref.prompt}, ${preset.prompt_en}`
      }
    }

    return { styledPrompt, styleRefImages }
  }

  // ─── 공통: 이미지 후처리 (업스케일 → 업로드 → 저장 → 상태 업데이트) ───
  // 개별 생성과 배치 비동기 수집 모두에서 사용.
  const _processAndSaveImage = async (images, index, ref, logPrefix = '[Ref]') => {
    const firstImage = images[0]
    let imageData = firstImage.base64 || firstImage

    // 업스케일 (style 카드 제외)
    const origMediaId = firstImage.mediaId || null
    if (ref.type !== 'style') {
      const upscaled = await tryUpscaleImage(flowAPI, origMediaId, settings.imageUpscale || 'off', logPrefix)
      if (upscaled) imageData = upscaled
    }

    const displayUrl = toDataURL(imageData)

    // Flow에 업로드 → mediaId + caption.
    // 429 retry 포함 (병렬 후처리 도입 후 동시 호출 시 rate-limit 보호; useAutomation 의
    // 자동 업로드 경로와 동일 패턴: MAX_RETRIES=2 + exponential backoff + jitter).
    const base64ForUpload = cleanBase64(imageData)
    let mediaId = null
    let caption = null
    console.log(logPrefix, 'Uploading to Flow for mediaId...', { category: ref.category, base64Len: base64ForUpload.length })
    const uploadResult = await uploadReferenceWithRetry(flowAPI, base64ForUpload, ref.category, logPrefix)
    console.log(logPrefix, 'Upload result:', uploadResult)
    if (uploadResult.success) {
      mediaId = uploadResult.mediaId
      caption = uploadResult.caption
    } else {
      console.error(logPrefix, 'Upload failed (after retries):', uploadResult.error)
    }

    // 파일 저장 (폴더 모드)
    let filePath = null
    let savedDataUrl = displayUrl
    if (settings.saveMode === 'folder') {
      // projectName 누락 방지: 호출 전에 App.jsx의 ensureProjectName()로 settings.projectName이
      // 채워져 있어야 한다. 여기서는 방어적 폴백만 수행('Untitled'), 새 타임스탬프 폴더는 만들지 않음.
      if (!settings.projectName) {
        console.warn('[useReferenceGeneration] settings.projectName missing — falling back to "Untitled"')
      }
      const projectName = settings.projectName || 'Untitled'
      const refName = ref.name || `ref_${index + 1}`
      const metadata = { mediaId, caption, category: ref.category }
      const permission = await fileSystemAPI.ensurePermission()
      console.log(logPrefix, 'Permission:', permission, 'projectName:', projectName, 'refName:', refName)

      let saveResult = { success: false }
      if (permission.hasPermission) {
        saveResult = await fileSystemAPI.saveReference(projectName, refName, imageData, 'flow', metadata)
          .catch(e => ({ success: false, error: e.message }))
      }
      console.log(logPrefix, 'saveResult:', saveResult.success, saveResult.error || '')

      if (saveResult.success) {
        filePath = saveResult.path
        savedDataUrl = saveResult.dataUrl || displayUrl
        console.log(logPrefix, 'Saved to:', filePath)
      } else {
        console.warn(logPrefix, 'Save failed:', saveResult.error, '- keeping in memory and continuing...')
        if (!saveFailedOnce) {
          setSaveFailedOnce(true)
          toast.warning(t('toast.permissionReleasedMemory'))
        }
        addPendingSave(async () => {
          const pendingSave = await fileSystemAPI.saveReference(projectName, refName, imageData, 'flow', metadata)
          if (pendingSave.success) {
            console.log(logPrefix, 'Pending save succeeded:', pendingSave.path)
            setReferences(prev => prev.map((r, i) =>
              i === index ? { ...r, filePath: pendingSave.path, dataStorage: 'file' } : r
            ))
          }
          return pendingSave
        })
        filePath = null
      }

      await fileSystemAPI.saveExtraToHistory(projectName, RESOURCE.REFERENCES, refName, images, ref.prompt, 'Reference')
    }

    // 레퍼런스 상태 업데이트
    setReferences(prev => prev.map((r, i) =>
      i === index
        ? { ...r, data: savedDataUrl, filePath, dataStorage: filePath ? 'file' : 'base64', mediaId, caption, status: 'done', errorMessage: null }
        : r
    ))
    setGeneratingRefs(prev => prev.filter(i => i !== index))
    return { success: true, savedToMemory: filePath === null && settings.saveMode === 'folder' }
  }

  // ─── 공통: effectiveStyleId 결정 ───
  // 우선순위: explicit override → UI 선택값 → 자동 fallback (첫 사용 가능한 style 카드).
  // 자동 탐색은 styleResolver.resolveEffectiveStyleIdForRef 단일 출처 사용 —
  // 내부적으로 styleService.findAutoStyle 호출 (prompt-only / mediaId-only 둘 다 잡힘,
  // production applyStyle 동작과 일치).
  const _resolveEffectiveStyleId = (overrideStyleId) => {
    // ref 도메인 — createStyleResolver의 ref-aware fallback 사용
    // (activeTab 무관 — ref 생성은 항상 동일 fallback chain)
    const resolver = createStyleResolver({
      activeTab: 'list',  // value irrelevant for resolveEffectiveStyleIdForRef
      references: referencesRef.current,
      selectedStyleRefId,
      t,
      isKo: false,  // labels not used here
    })
    const effective = resolver.resolveEffectiveStyleIdForRef(overrideStyleId)
    if (effective && !overrideStyleId && !selectedStyleRefId) {
      console.log('[StyleRef] Auto-detected style card:', effective)
    }
    return effective
  }

  // ─── 핵심 생성 로직 (개별) ───
  // overrideRef: 호출 측에서 최신 ref 객체를 직접 넘길 때 사용. ReferenceDetailModal의
  // 재생성 버튼처럼 onUpdate 직후 호출되는 경로에서, React state commit 이전이라
  // referencesRef.current가 아직 갱신 안 된 race를 회피한다.
  const _executeGenerateRef = async (index, skipPermissionCheck = false, overrideStyleId = null, overrideRef = null) => {
    const ref = overrideRef || referencesRef.current[index]
    if (!ref?.prompt) {
      toast.warning(t('toast.noPrompt'))
      return { success: false }
    }

    // 폴더 설정 + 토큰 확인 (배치 모드에서는 권한 체크 스킵)
    if (!skipPermissionCheck) {
      const folderCheck = await checkFolderPermission(settings, openSettings, t)
      if (!folderCheck.ok) return { success: false, permissionError: folderCheck.permissionError }
    }
    if (!(await checkAuthToken(flowAPI, t))) {
      setReferences(prev => prev.map((r, i) => i === index ? { ...r, status: 'error', errorMessage: 'Auth required' } : r))
      return { success: false, authError: true }
    }

    setGeneratingRefs(prev => [...prev, index])
    setReferences(prev => prev.map((r, i) => i === index ? { ...r, status: 'generating', errorMessage: null, generatingStartedAt: Date.now(), generatingEndedAt: null } : r))

    try {
      // 스타일 준비 (공통 함수)
      const effectiveStyleId = _resolveEffectiveStyleId(overrideStyleId)
      const { styledPrompt, styleRefImages } = await _prepareStyleRefs(ref, effectiveStyleId, '[Reference]')

      const refSeed = settings.seedLocked && typeof settings.seedNo === 'number' && Number.isFinite(settings.seedNo)
        ? settings.seedNo
        : null
      const result = await flowAPI.generateImageDOM(styledPrompt, styleRefImages, { batchCount: settings.imageBatchCount, seed: refSeed })

      if (result.success && result.images?.length > 0) {
        return await _processAndSaveImage(result.images, index, ref, '[Reference]')
      } else if (!result.success) {
        const errorMsg = result.error || ''
        const isAuthError = errorMsg.includes('401') || errorMsg.includes('auth') || errorMsg.includes('token') || errorMsg.includes('login')
        const isServerError = errorMsg.includes('500') || errorMsg.includes('502') || errorMsg.includes('503') || errorMsg.includes('server')
        toast.error(t('toast.generateFailed', { error: result.error || 'Unknown error' }))
        setGeneratingRefs(prev => prev.filter(i => i !== index))
        setReferences(prev => prev.map((r, i) => i === index ? { ...r, status: 'error', errorMessage: result.error || 'Generation failed' } : r))
        return { success: false, authError: isAuthError, serverError: isServerError }
      }
    } catch (error) {
      console.error('Reference generation error:', error)
      const errorMsg = error.message || ''
      const isAuthError = errorMsg.includes('401') || errorMsg.includes('auth') || errorMsg.includes('token') || errorMsg.includes('login')
      const isServerError = errorMsg.includes('500') || errorMsg.includes('502') || errorMsg.includes('503') || errorMsg.includes('server')
      toast.error(t('toast.generateError', { error: error.message }))
      setGeneratingRefs(prev => prev.filter(i => i !== index))
      setReferences(prev => prev.map((r, i) => i === index ? { ...r, status: 'error', errorMessage: error.message || 'Generation error' } : r))
      return { success: false, authError: isAuthError, serverError: isServerError }
    }

    setGeneratingRefs(prev => prev.filter(i => i !== index))
    setReferences(prev => prev.map((r, i) => i === index ? { ...r, status: 'error', errorMessage: 'Unknown failure' } : r))
    return { success: false }
  }

  // ─── 비동기 결과 수집 + 후처리 (배치용) ───
  const processAsyncResult = async (generationId, index, ref) => {
    const result = await flowAPI.collectGeneration(generationId)

    if (!result.success || !result.images?.length) {
      const errorMsg = result.error || ''
      const isAuthError = errorMsg.includes('401') || errorMsg.includes('auth') || errorMsg.includes('token')
      const isServerError = errorMsg.includes('500') || errorMsg.includes('502') || errorMsg.includes('503')
      toast.error(t('toast.generateFailed', { error: result.error || 'Unknown error' }))
      setGeneratingRefs(prev => prev.filter(i => i !== index))
      setReferences(prev => prev.map((r, i) => i === index ? { ...r, status: 'error', errorMessage: result.error || 'Generation failed' } : r))
      return { success: false, authError: isAuthError, serverError: isServerError }
    }

    return await _processAndSaveImage(result.images, index, ref, '[AsyncRef]')
  }

  // ─── 배치 생성 (비동기 fire-and-forget 방식) ───
  // AutoFlow 패턴: 제출 → 7~15초 대기 → 다음 제출, 결과는 별도 수집
  //
  // force=true (MCP 전용): 이미 완료된(image/filePath/status=done) ref도 재생성 대상에 포함.
  //                       prompt 있고 type !== 'style'인 모든 ref가 대상.
  // force=false (기본): 기존 동작 — image 없고 pending/error/idle 상태인 ref만.
  const _executeBatchRefs = async (overrideStyleId = null, force = false) => {
    const generatableIndices = referencesRef.current
      .map((ref, index) => {
        if (!ref.prompt || ref.type === 'style') return -1
        if (force) return index
        return (!ref.data && !ref.filePath && ref.status !== 'done') ? index : -1
      })
      .filter(i => i !== -1)

    if (generatableIndices.length === 0) {
      toast.info(t('toast.allRefsGenerated'))
      return
    }

    // force=true 재생성: done/error 상태 ref를 pending으로 리셋해 UI에 재생성 시작이 보이게 함.
    // data/filePath/mediaId는 유지 — 새 이미지가 도착할 때까지 이전 결과를 노출하면 비교 가능.
    if (force) {
      const idxSet = new Set(generatableIndices)
      setReferences(prev => prev.map((r, i) => {
        if (!idxSet.has(i)) return r
        if (r.status === 'done' || r.status === 'error') {
          return { ...r, status: 'pending', errorMessage: null }
        }
        return r
      }))
    }

    // 배치 시작 - 플래그 리셋
    stopRequestedRef.current = false
    setStoppingRefs(false)
    setPreparingRefs(true)
    let hasPendingSaves = false
    setSaveFailedOnce(false)

    // P2 v3 fix: 전체 lifecycle을 try/finally로 감싸 어느 종료 경로에서도 flag를 정리.
    // 이전엔 명시적 early return만 cleanup했지만, ensurePermission/checkAuthToken/_resolveEffectiveStyleId/
    // batch loop의 예상 못한 throw (IPC reject 등)에선 flag가 stuck → refBatchRunning이 영구 true,
    // 다음 MCP 호출이 waitForStopped 30s timeout 회귀.
    try {

    // 폴더 모드 권한 확인
    if (settings.saveMode === 'folder') {
      const permission = await fileSystemAPI.ensurePermission()
      if (permission.error === 'not_set') { openSettings('storage'); return }
      if (permission.error === 'folder_deleted') {
        toast.error(t('toast.folderDeleted'))
        openSettings('storage')
        return
      }
      if (!permission.hasPermission) {
        toast.warning(t('toast.folderPermissionNeeded'))
        openSettings('storage')
        return
      }
      console.log('[GenerateAllRefs] Permission granted:', permission.name)
    }

    // 토큰 확인
    if (!(await checkAuthToken(flowAPI, t))) return

    // 비동기 대기열
    const pendingQueue = []

    // 완료된 결과 수집 + 후처리
    //
    // 세 단계로 동작 — splice 타이밍에 주의:
    //   1) 상태 확인 (sequential) — checkGeneration 은 가벼운 HTTP. 병렬로 묶으면
    //      Flow 측 rate limit 위험이 있어 그대로 순차. 큐에서 아직 제거하지 않음.
    //   2) 후처리 (parallel) — 같은 폴링 창에 N개가 완료된 경우, 각 항목의 후처리
    //      (upscale → uploadReference → save → history → setReferences) 는 서로
    //      독립적이라 Promise.all 로 동시 실행.
    //   3) 성공 항목만 큐에서 제거 — 후처리 throw 한 항목은 큐에 남겨둬서 Phase 2
    //      타임아웃 cleanup 이 'error' 또는 'pending' 으로 정리하도록 함. (이전 직렬
    //      구현이 제공하던 안전망: processAsyncResult 가 throw 하면 splice 도달 못
    //      해서 큐에 남는 동작과 의미적으로 동일.)
    //
    //  setReferences/setGeneratingRefs 는 함수형 업데이트라 race-safe.
    //  hasPendingSaves 는 OR 누적이라 race-safe.
    //  단일 항목 완료 시엔 병렬 효과 없음 — 다중 클러스터 완료 시 wall-clock 단축.
    const collectCompleted = async () => {
      // Phase 1: 완료된 항목 식별 (큐에서 아직 제거하지 않음)
      const completed = []
      for (let i = pendingQueue.length - 1; i >= 0; i--) {
        const pending = pendingQueue[i]
        try {
          const status = await flowAPI.checkGeneration(pending.generationId)
          if (status?.success && status.completed) {
            completed.push(pending)
          }
        } catch (e) {
          console.warn('[GenerateAllRefs] Check failed for gen:', pending.generationId, e.message)
        }
      }

      if (completed.length === 0) return
      if (completed.length > 1) {
        console.log('[GenerateAllRefs] Processing', completed.length, 'completed in parallel')
      }

      // Phase 2: 후처리 — 동시성 5 제한 (useAutomation 자동 업로드 경로와 동일 한계).
      // 무제한 Promise.all 시 같은 폴링 창에 N개 완료된 ref 가 모두 동시에 Flow 를 두드려
      // 429 rate-limit risk. 성공한 항목만 succeeded set 에 등록 — 실패는 큐에 남겨
      // Phase 2 타임아웃 cleanup 으로 위임 (직렬 구현 안전망 보존).
      const succeeded = new Set()
      await mapWithConcurrency(completed, async (pending) => {
        try {
          console.log('[GenerateAllRefs] Collecting completed gen:', pending.generationId, 'index:', pending.index)
          const result = await processAsyncResult(pending.generationId, pending.index, pending.ref)
          if (result?.savedToMemory) hasPendingSaves = true
          succeeded.add(pending)
        } catch (e) {
          console.error('[GenerateAllRefs] Post-processing failed for gen:', pending.generationId, e?.message || e)
        }
      }, 5)

      // Phase 3: 성공한 항목만 큐에서 제거 (역순 splice 로 인덱스 안정성 유지)
      if (succeeded.size > 0) {
        for (let i = pendingQueue.length - 1; i >= 0; i--) {
          if (succeeded.has(pendingQueue[i])) pendingQueue.splice(i, 1)
        }
      }
    }

    // 스타일 결정 (공통 함수)
    const batchEffectiveStyleId = _resolveEffectiveStyleId(overrideStyleId)

    // ─── Phase 1: 비동기 제출 (fire-and-forget) ───
    setPreparingRefs(false)
    console.log('[GenerateAllRefs] Starting async batch for', generatableIndices.length, 'refs')
    let submitFailCount = 0

    for (const index of generatableIndices) {
      if (stopRequestedRef.current) {
        console.log('[GenerateAllRefs] Stop requested by user')
        toast.info(t('toast.batchStopped'))
        break
      }

      try {
        await collectCompleted()

        const ref = referencesRef.current[index]
        if (!ref) {
          console.warn('[GenerateAllRefs] Ref not found at index:', index, '— skipping')
          continue
        }
        const { styledPrompt, styleRefImages } = await _prepareStyleRefs(ref, batchEffectiveStyleId, '[GenerateAllRefs]')

        setGeneratingRefs(prev => [...prev, index])
        setReferences(prev => prev.map((r, i) => i === index ? { ...r, status: 'generating', errorMessage: null, generatingStartedAt: Date.now(), generatingEndedAt: null } : r))

        const batchSeed = settings.seedLocked && typeof settings.seedNo === 'number' && Number.isFinite(settings.seedNo)
          ? settings.seedNo
          : null
        const submitResult = await flowAPI.submitGenerationDOM(styledPrompt, styleRefImages, { batchCount: settings.imageBatchCount, seed: batchSeed })

        if (submitResult?.success && submitResult.generationId) {
          pendingQueue.push({ generationId: submitResult.generationId, index, ref })
          console.log('[GenerateAllRefs] Submitted index:', index, 'gen:', submitResult.generationId)
          submitFailCount = 0
        } else {
          console.warn('[GenerateAllRefs] Submit failed for index:', index, submitResult?.error)
          setGeneratingRefs(prev => prev.filter(i => i !== index))
          setReferences(prev => prev.map((r, i) => i === index ? { ...r, status: 'error', errorMessage: submitResult?.error || 'Submit failed' } : r))
          submitFailCount++

          if (submitFailCount >= 3) {
            toast.error(t('toast.serverErrorPersist'))
            break
          }
        }

        // AutoFlow 스타일 대기 (7~15초) — 마지막이 아닐 때만
        if (index !== generatableIndices[generatableIndices.length - 1]) {
          const delay = 7000 + Math.random() * 8000
          console.log('[GenerateAllRefs] Waiting', Math.round(delay / 1000), 's before next submit...')
          await new Promise(r => setTimeout(r, delay))
        }
      } catch (err) {
        console.error('[GenerateAllRefs] Error processing index:', index, err)
        setGeneratingRefs(prev => prev.filter(i => i !== index))
        setReferences(prev => prev.map((r, i) => i === index ? { ...r, status: 'error', errorMessage: err.message || 'Unexpected error' } : r))
        submitFailCount++
        if (submitFailCount >= 3) {
          console.error('[GenerateAllRefs] 3 consecutive errors — aborting batch')
          toast.error(t('toast.serverErrorPersist'))
          break
        }
      }
    }

    // ─── Phase 2: 남은 결과 전부 수집 (폴링) ───
    console.log('[GenerateAllRefs] All submitted. Waiting for', pendingQueue.length, 'remaining results...')
    const maxWait = 180000
    const pollStart = Date.now()

    while (pendingQueue.length > 0 && Date.now() - pollStart < maxWait) {
      if (stopRequestedRef.current) {
        console.log('[GenerateAllRefs] Stop requested during collection')
        toast.info(t('toast.batchStopped'))
        break
      }
      await new Promise(r => setTimeout(r, 3000))
      await collectCompleted()
    }

    // 미수집 항목 정리
    // 사용자 중단(stop) vs. 진짜 타임아웃은 다른 사건이다.
    //   - 중단: pending 상태로 되돌려 재실행 가능하게 (errorMessage 비움)
    //   - 타임아웃: error 상태로 마킹 (사용자가 무엇이 실패했는지 인지)
    if (pendingQueue.length > 0) {
      const userStopped = stopRequestedRef.current
      if (userStopped) {
        console.log('[GenerateAllRefs] User stopped — reverting', pendingQueue.length, 'pending generations to idle')
      } else {
        console.warn('[GenerateAllRefs] Timed out waiting for', pendingQueue.length, 'generations')
      }
      for (const pending of pendingQueue) {
        setGeneratingRefs(prev => prev.filter(i => i !== pending.index))
        setReferences(prev => prev.map((r, i) => {
          if (i !== pending.index) return r
          return userStopped
            ? { ...r, status: 'pending', errorMessage: null }
            : { ...r, status: 'error', errorMessage: 'Timed out' }
        }))
      }
    }

    await flowAPI.clearGenerations()

    console.log('[GenerateAllRefs] Batch completed, hasPendingSaves:', hasPendingSaves)

    if (hasPendingSaves) {
      toast.info(t('toast.batchCompleteNeedPermission'))
      openSettings('storage')
    }

    } finally {
      // P2 v3: 정상 종료 / early return / throw 어느 경로에서도 flag 정리 (P1 + P2 통합 fix).
      // 안 그러면 refBatchRunning이 stuck 되어 MCP stop-restart가 30s timeout.
      setPreparingRefs(false)
      setStoppingRefs(false)
    }
  }

  // 큐를 통한 개별 생성
  // overrideRef: ReferenceDetailModal의 재생성처럼 onUpdate 직후 호출되는 경로에서
  // 최신 ref 객체를 직접 전달해 React state commit race를 차단.
  const handleGenerateRef = async (index, skipPermissionCheck = false, overrideStyleId = null, overrideRef = null) => {
    if (skipPermissionCheck || !generationQueue) {
      return _executeGenerateRef(index, skipPermissionCheck, overrideStyleId, overrideRef)
    }
    try {
      return await generationQueue.enqueue({
        type: 'reference',
        label: `Ref #${index + 1}`,
        execute: () => _executeGenerateRef(index, false, overrideStyleId, overrideRef)
      })
    } catch (err) {
      console.warn('[RefGen] Queue rejected:', err.message)
      return { success: false }
    }
  }

  // 큐를 통한 배치 생성. options = { force?: boolean }.
  // force=true (MCP 전용): 이미 완료된 ref도 재생성 대상에 포함.
  const handleGenerateAllRefs = async (overrideStyleId = null, options = {}) => {
    const { force = false } = options
    if (!generationQueue) {
      return _executeBatchRefs(overrideStyleId, force)
    }
    try {
      await generationQueue.enqueue({
        type: 'reference_batch',
        label: 'Batch References',
        execute: () => _executeBatchRefs(overrideStyleId, force)
      })
    } catch (err) {
      console.warn('[RefGen] Batch queue rejected:', err.message)
    }
  }

  return {
    generatingRefs,
    stoppingRefs,
    preparingRefs,
    handleGenerateRef,
    handleGenerateAllRefs,
    stopGenerateAllRefs
  }
}
