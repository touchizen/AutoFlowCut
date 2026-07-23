/**
 * useReferenceGeneration - 레퍼런스 이미지 생성 (개별 + 일괄)
 */

import { useState, useRef, useCallback } from 'react'
import { entityPatchForNewImage } from '../utils/refEntityRegistration'
import { RESOURCE, STYLE_PRESETS } from '../config/defaults'
import { fileSystemAPI } from './useFileSystem'
import { checkFolderPermission, checkAuthToken, checkFlowProjectReady } from '../utils/guards'
import { toDataURL } from '../utils/urls'
import { tryUpscaleImage } from '../utils/imageProcessing'
import { toast } from '../components/Toast'
import { createStyleResolver } from '../services/styleResolver'
import { isStyleReference } from '../services/styleService'
import { isQuotaExhaustedError, emitQuotaStop } from '../utils/quotaStop'
import { clampInt } from '../utils/clampInt'
import { getAuthErrorMessage, getAuthRequiredMessage } from '../utils/authMessages'
import { runFlowCharacterOperation, runFlowComposerRefresh } from '../utils/flowCharacterCoordinator'
import { resolveDisplayError } from '../utils/errorDisplay'
import { isReferenceImageEmpty, referenceGuardKey, sourceAvailable } from '../utils/refImageGuard'

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

export function useReferenceGeneration({ settings, references, setReferences, genAPI, addPendingSave, openSettings, pendingSavesCount = 0, t, selectedStyleRefId, styleThumbnails, generationQueue, flowProjectReady = true, flowProjectId = null, projectNameRef = null, beforeBatchActivation = null }) {
  const [generatingRefs, setGeneratingRefs] = useState([])
  const [stoppingRefs, setStoppingRefs] = useState(false)
  const [preparingRefs, setPreparingRefs] = useState(false)  // 배치 준비 중 (권한/토큰/썸네일 업로드)
  const [refBatchActive, setRefBatchActive] = useState(false)  // 실제 target이 있는 batch execute 전체 수명
  const [saveFailedOnce, setSaveFailedOnce] = useState(false)  // 배치 중 저장 실패 알림 1회만
  const stopRequestedRef = useRef(false)
  const stopRequestVersionRef = useRef(0)
  const pendingRefBatchCallsRef = useRef(0)
  // #R24-4: 배치가 '인증 실패'로 멈췄는지 구분. user-stop 정리는 pending(재실행 가능)으로
  //   되돌리지만, auth-stop 은 죽은 인증을 숨긴 채 재시도 루프가 돌지 않도록 error(auth)로 남긴다.
  const authStoppedRef = useRef(false)
  const authErrorMessage = () => getAuthErrorMessage(genAPI?.mode, t)
  const authRequiredMessage = () => getAuthRequiredMessage(genAPI?.mode, t)
  const resultErrorKind = (result) => result?.authFailed ? 'auth' : (result?.errorKind ?? null)
  const displayResultError = (result, fallback) => resolveDisplayError(
    t,
    resultErrorKind(result),
    result?.error || fallback,
  )

  // quota stop 공통 모듈 위임 — queue clear 는 useGenerationQueue 가 직접 subscribe 함.
  const _maybeTriggerQuotaStop = (err) => {
    if (!isQuotaExhaustedError(err)) return false
    stopRequestVersionRef.current += 1
    emitQuotaStop({ stopRequestedRef, scope: 'GenerateRef' })
    return true
  }
  const referencesRef = useRef(references)
  referencesRef.current = references  // 매 렌더마다 최신 상태 반영
  const getLiveProjectName = () => projectNameRef?.current ?? settings.projectName
  const batchGeneratingRefCountsRef = useRef(new Map())
  const addBatchGeneratingRef = (index) => {
    const counts = batchGeneratingRefCountsRef.current
    counts.set(index, (counts.get(index) || 0) + 1)
    setGeneratingRefs(prev => prev.includes(index) ? prev : [...prev, index])
  }
  const removeBatchGeneratingRef = (index) => {
    const counts = batchGeneratingRefCountsRef.current
    const nextCount = (counts.get(index) || 0) - 1
    if (nextCount > 0) {
      counts.set(index, nextCount)
      return
    }
    counts.delete(index)
    setGeneratingRefs(prev => prev.filter(i => i !== index))
  }

  // Targeted batch는 MCP가 배열을 delete/reorder하는 동안에도 같은 카드를 따라가야 한다.
  // index는 UI 표시용 힌트일 뿐이고, guardKey가 있으면 매 patch 직전에 stable key로 다시 찾는다.
  const resolveReferenceIndex = (pool, index, guardKey = null) => {
    if (!guardKey) return pool[index] ? index : -1
    if (referenceGuardKey(pool[index]) === guardKey) return index
    return pool.findIndex(ref => referenceGuardKey(ref) === guardKey)
  }
  const patchReferenceByIdentity = (pool, index, guardKey, updater) => {
    const resolvedIndex = resolveReferenceIndex(pool, index, guardKey)
    if (resolvedIndex < 0) return pool
    return pool.map((ref, refIndex) =>
      refIndex === resolvedIndex ? updater(ref) : ref
    )
  }

  const stopGenerateAllRefs = useCallback(() => {
    stopRequestVersionRef.current += 1
    stopRequestedRef.current = true
    setStoppingRefs(pendingRefBatchCallsRef.current > 0)
  }, [])

  // ─── 공통: 스타일 레퍼런스 준비 ───
  // 개별 생성과 배치 생성 모두에서 사용. 프리셋 썸네일은 캐시 miss 시 자동 업로드.
  const _prepareStyleRefs = async (ref, effectiveStyleId, logPrefix = '[StyleRef]') => {
    const styleRefImages = []
    let styledPrompt = ref.prompt

    if (isStyleReference(ref) || !effectiveStyleId) {
      return { styledPrompt, styleRefImages }
    }

    if (effectiveStyleId.startsWith('ref:')) {
      const refId = effectiveStyleId.replace('ref:', '')
      const styleRef = referencesRef.current.find(r => r.id == refId && isStyleReference(r))
      if (styleRef) {
        // 공식 API 모드는 data 우선, name+filePath 디스크 fallback 으로 해석한다.
        // memory-only / file-backed style image 모두 payload 를 보존해야 한다.
        let styleMediaId = styleRef.mediaId || null
        // #R19: Flow 모드는 reference 를 mediaId 로만 주입한다(flow-page-injection: name=ref.mediaId).
        //   API 모드에서 만든 style ref 는 mediaId 가 없어 { name: null } 로 주입되면 무효 →
        //   on-demand 로 Flow 에 업로드해 mediaId 를 확보하고 ref 에 patch(재사용 대비). API 모드는 no-op.
        if (!styleMediaId && genAPI?.mode === 'flow') {
          let base64 = styleRef.data
          if (!base64 && styleRef.filePath) {
            const fr = await fileSystemAPI.readFileByPath(styleRef.filePath)
            if (fr.success) base64 = fr.data
          }
          if (base64) {
            const stripped = String(base64).replace(/^data:[^;]+;base64,/, '')
            const up = await genAPI.uploadReference(stripped, { category: styleRef.category, name: styleRef.name, type: styleRef.type, refId: styleRef.id })
            if (up?.success && up.mediaId) {
              styleMediaId = up.mediaId
              setReferences(prev => prev.map(r => r.id === styleRef.id ? { ...r, mediaId: up.mediaId } : r))
            } else {
              console.warn(logPrefix, 'Flow style ref upload failed — style image not injected:', up?.error)
            }
          }
        }
        if (styleMediaId || styleRef.name || styleRef.data || styleRef.filePath) {
          styleRefImages.push({
            id: styleRef.id,
            category: styleRef.category,
            mediaId: styleMediaId,
            caption: styleRef.caption || '',
            name: styleRef.name,
            data: styleRef.data || null,
            filePath: styleRef.filePath || null,
          })
        }
        if (styleRef.prompt) {
          styledPrompt = `${ref.prompt}, ${styleRef.prompt}`
        }
      }
    } else if (effectiveStyleId.startsWith('preset:')) {
      const presetId = effectiveStyleId.replace('preset:', '')
      const preset = STYLE_PRESETS?.styles?.find(s => s.id === presetId)
      // cloud(Veo): 프리셋은 프롬프트(prompt_en)로만 적용. (구 Flow 는 썸네일을 업로드해
      // image-ref 로 주입했으나 cloud 엔 mediaId 업로드가 없다.)
      if (preset?.prompt_en) {
        styledPrompt = `${ref.prompt}, ${preset.prompt_en}`
      }
    }

    return { styledPrompt, styleRefImages }
  }

  // ─── 공통: 이미지 후처리 (업스케일 → 업로드 → 저장 → 상태 업데이트) ───
  // 개별 생성과 배치 비동기 수집 모두에서 사용.
  // genResult: 생성 응답 전체. Flow /characters 경로는 여기에 entityId/workflowId/registered 를 실어온다.
  //   이걸 카드에 저장해야 Flow 에 캐릭터가 등록된 상태가 되고, '동기화'로 같은 이미지를
  //   다시 업로드할 필요가 없어진다. entityId 가 없으면(API 모드·scene/style) 기존 동작 그대로.
  const _processAndSaveImage = async (
    images,
    index,
    ref,
    logPrefix = '[Ref]',
    genResult = null,
    guardKey = null,
    busyIndex = index,
    batchBusy = false,
  ) => {
    const releaseBusy = () => {
      if (batchBusy) removeBatchGeneratingRef(busyIndex)
      else setGeneratingRefs(prev => prev.filter(i => i !== busyIndex))
    }
    const firstImage = images[0]
    let imageData = firstImage.base64 || firstImage

    // 업스케일 (style 카드 제외)
    const origMediaId = firstImage.mediaId || null
    if (!isStyleReference(ref)) {
      const upscaled = await tryUpscaleImage(genAPI, origMediaId, settings.imageUpscale || 'off', logPrefix)
      if (upscaled) imageData = upscaled
    }

    const displayUrl = toDataURL(imageData)

    // #R18: Flow 모드에서 생성된 레퍼런스는 firstImage.mediaId 를 가진다 — 이를 보존해야
    //   같은 배치에서 이 ref 를 style ref 로 재사용할 때 Flow 의 mediaId 계약을 지킨다(안 그러면
    //   { name: null } 로 주입돼 무효). API(cloud)는 mediaId 가 없어 그대로 null → 동작 불변.
    const mediaId = firstImage.mediaId || null
    const caption = firstImage.caption || null

    // 파일 저장 (폴더 모드)
    let filePath = null
    let savedDataUrl = displayUrl
    if (settings.saveMode === 'folder') {
      // ensureProjectName은 같은 tick에 backing ref를 먼저 갱신한다. render closure의 settings보다
      // 그 live authority를 읽어 방금 mint한 프로젝트명이 Untitled로 갈라지지 않게 한다.
      const liveProjectName = getLiveProjectName()
      if (!liveProjectName) {
        console.warn('[useReferenceGeneration] projectName missing — falling back to "Untitled"')
      }
      const projectName = liveProjectName || 'Untitled'
      const refName = ref.name || `ref_${index + 1}`
      // #R32-3: 엔진 라벨/provenance 를 실제 모드로 — API(BYOK) ref 를 'flow' 로 잘못 라벨하던 것을 고친다.
      //   Flow 모드는 'flow', API 모드는 선택된 이미지 모델 id(없으면 'api'). model 도 메타에 기록.
      const engineLabel = genAPI?.mode === 'flow' ? 'flow' : (settings.imageModel || 'api')
      const metadata = { mediaId, caption, category: ref.category, model: settings.imageModel || null }
      const permission = await fileSystemAPI.ensurePermission()
      console.log(logPrefix, 'Permission:', permission, 'projectName:', projectName, 'refName:', refName)

      let saveResult = { success: false }
      if (permission.hasPermission) {
        saveResult = await fileSystemAPI.saveReference(projectName, refName, imageData, engineLabel, metadata)
          .catch(e => ({ success: false, error: e.message }))
      }
      console.log(logPrefix, 'saveResult:', saveResult.success, saveResult.error || '')

      if (saveResult.success) {
        filePath = saveResult.path
        savedDataUrl = saveResult.dataUrl || displayUrl
        console.log(logPrefix, 'Saved to:', filePath)
      } else {
        // 디스크 저장 실패 — base64 를 메모리에 유지하고 계속 진행. desktop 의 addPendingSave 는
        // no-op 이라 재시도하지 않는 대신, project 저장이 filePath 없는 ref 의 base64 를 strip
        // 하지 않으므로(stripReferencesForSave) project.json 에 보존돼 재오픈 시 유실되지 않는다.
        console.warn(logPrefix, 'Save failed:', saveResult.error, '- keeping base64 in project (no disk file)')
        if (!saveFailedOnce) {
          setSaveFailedOnce(true)
          toast.warning(t('toast.permissionReleasedMemory'))
        }
        filePath = null
      }

      await fileSystemAPI.saveExtraToHistory(projectName, RESOURCE.REFERENCES, refName, images, ref.prompt, 'Reference')
    }

    // 레퍼런스 상태 업데이트
    // R27 review fix: generatedAt 세팅 — references/{name}.png 가 같은 경로를
    // 덮어쓰므로 resolveImageSrc 의 ?v=<version> 캐시 키가 갱신되어야 Chromium
    // 이 이전 디코딩 캐시를 버리고 새 이미지 표시.
    // #R37: fresh entity 가 없으면(API 모드 재생성) character 의 옛 entityId/workflowId 를 비운다 —
    //   안 그러면 이미지만 새것이고 id 는 옛 캐릭터를 가리켜, 이후 Sync 가 repair 로 빠져 옛 entity 만
    //   다시 PATCH 하고 새 이미지는 영영 업로드되지 않는다(ReferenceCard #R31-3 와 동일 정책).
    const entityPatch = entityPatchForNewImage({ ...ref, mediaId }, genResult)
    // 상세 DOM의 nameApplied 성공 여부와 무관하게 목록/멘션 피커 캐시는 옛 이름을 유지할 수 있다.
    // character entity가 생겼으면 generate-character 보호 구간이 settle 된 뒤 호출측이 refresh를 await한다.
    const composerRefreshNeeded = !!genResult?.entityId
    const resolvedIndex = resolveReferenceIndex(
      referencesRef.current,
      index,
      guardKey
    )
    if (resolvedIndex < 0) {
      // 생성 도중 target이 삭제됐으면 결과는 폐기한다. stale index를 패치하면 이동한 다른 카드가 오염된다.
      releaseBusy()
      return { success: false, skipped: true, skipStage: 'not-found' }
    }
    const donePatch = { name: ref.name || `ref_${index + 1}`, data: savedDataUrl, filePath, dataStorage: filePath ? 'file' : 'base64', mediaId, caption, status: 'done', errorMessage: null, generatedAt: Date.now(), ...(entityPatch || {}) }
    setReferences(prev => patchReferenceByIdentity(
      prev,
      resolvedIndex,
      guardKey,
      current => ({ ...current, ...donePatch })
    ))
    // 동기 갱신: 같은 batch flow 의 다음 phase(_prepareStyleRefs)가 React 재렌더 전에
    // referencesRef.current 를 읽어도 방금 만든 style 카드의 mediaId 를 보장받게 한다.
    referencesRef.current = patchReferenceByIdentity(
      referencesRef.current,
      resolvedIndex,
      guardKey,
      current => ({ ...current, ...donePatch })
    )
    releaseBusy()
    return {
      success: true,
      savedToMemory: filePath === null && settings.saveMode === 'folder',
      composerRefreshNeeded,
    }
  }

  // ─── 공통: effectiveStyleId 결정 ───
  // 우선순위: explicit override → UI 선택값 → 자동 fallback (첫 사용 가능한 style 카드).
  // 자동 탐색은 styleResolver.resolveEffectiveStyleIdForRef 단일 출처 사용 —
  // 내부적으로 styleService.findAutoStyle 호출 (prompt 또는 GenAI에서 읽을 수 있는
  // data/name+filePath 스타일 이미지가 잡힘, production applyStyle 동작과 일치).
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
  const _executeGenerateRef = async (
    index,
    skipPermissionCheck = false,
    overrideStyleId = null,
    overrideRef = null,
    guardKey = null,
    batchBusy = false,
  ) => {
    const ref = overrideRef || referencesRef.current[index]
    if (!ref?.prompt) {
      toast.warning(t('toast.noPrompt'))
      return { success: false }
    }

    // #R27-2: 단일 ref 생성도 preflight(folder/ready/auth) await 동안 busy 로 표시한다.
    //   안 그러면 그 창에서 project/mode 전환이 허용돼, 전환 뒤 stale 엔진으로 생성하고 결과를
    //   현재 프로젝트의 ref(index 재사용)에 patch 한다. busy flag(generatingRefs)를 await 전에 켜고
    //   조기 return 마다 해제. 배치 경로(skipPermissionCheck)는 preparingRefs 가 이미 덮으므로 제외.
    const trackPreflightBusy = !skipPermissionCheck
    if (trackPreflightBusy) setGeneratingRefs(prev => prev.includes(index) ? prev : [...prev, index])
    const releasePreflightBusy = () => {
      if (trackPreflightBusy) setGeneratingRefs(prev => prev.filter(i => i !== index))
    }
    const addGeneratingBusy = () => {
      if (batchBusy) addBatchGeneratingRef(index)
      else setGeneratingRefs(prev => prev.includes(index) ? prev : [...prev, index])
    }
    const releaseGeneratingBusy = () => {
      if (batchBusy) removeBatchGeneratingRef(index)
      else setGeneratingRefs(prev => prev.filter(i => i !== index))
    }
    let characterOperationTimedOut = false
    let characterScopeToken = null
    const failureGuardKey = guardKey ?? referenceGuardKey(ref)
    const markFlowRefreshFailed = () => {
      if (`flow::${getLiveProjectName() ?? ''}` !== characterScopeToken) return
      const applyPatch = prev => patchReferenceByIdentity(
        prev,
        index,
        failureGuardKey,
        current => ({ ...current, flowNameSyncStatus: 'failed', registered: false })
      )
      referencesRef.current = applyPatch(referencesRef.current)
      setReferences(prev => applyPatch(prev))
    }

    // 폴더 설정 + Flow 프로젝트 준비 + 토큰 확인 (배치 모드에서는 권한 체크 스킵)
    if (!skipPermissionCheck) {
      const folderCheck = await checkFolderPermission(settings, openSettings, t)
      if (!folderCheck.ok) { releasePreflightBusy(); return { success: false, permissionError: folderCheck.permissionError } }
      const readyCheck = checkFlowProjectReady(flowProjectReady, t)
      if (!readyCheck.ok) { releasePreflightBusy(); return { success: false } }
    }
    if (!(await checkAuthToken(genAPI, t))) {
      const message = authRequiredMessage()
      releasePreflightBusy()
      setReferences(prev => patchReferenceByIdentity(
        prev,
        index,
        guardKey,
        current => ({ ...current, status: 'error', errorMessage: message, errorKind: 'auth' })
      ))
      return { success: false, authError: true }
    }

    // 이미지가 없는 미생성 카드는 실패/중지 때 남은 stale styleId 대신 현재 선택 스타일을 따른다.
    //   이미지가 있는 재생성만 카드가 실제로 쓴 스타일을 유지하며, styleId===null 도
    //   "무스타일로 생성했다"는 기록이므로 값으로 판정한다(undefined = 기억 없음).
    //   명시적 overrideStyleId 는 이미지 유무보다 우선(배치/MCP의 스타일 지정 생성).
    //   스타일 카드에는 스타일을 적용하지 않는다(_prepareStyleRefs 조기 반환) — findAutoStyle 이
    //   그 카드 자신을 고른 값을 찍으면 "ref:1 로 생성됨"이라는 거짓 기록이 남는다(배치는 null).
    const effectiveStyleId = isStyleReference(ref)
      ? null
      : overrideStyleId ?? (!sourceAvailable(ref)
          ? _resolveEffectiveStyleId(null)
          : (ref.styleId !== undefined ? ref.styleId : _resolveEffectiveStyleId(null)))

    addGeneratingBusy()
    // styleId 는 성공 시점이 아니라 시작 시점에 남겨 실패/중지 원인과 적용 시도를 추적한다.
    //   이미지 없이 다시 생성할 때는 위 정책대로 당시의 현재 선택 스타일을 새로 해석한다.
    setReferences(prev => patchReferenceByIdentity(
      prev,
      index,
      guardKey,
      current => ({ ...current, status: 'generating', styleId: effectiveStyleId, errorMessage: null, errorKind: null, generatingStartedAt: Date.now(), generatingEndedAt: null })
    ))

    try {
      // 스타일 준비 (공통 함수)
      const { styledPrompt, styleRefImages } = await _prepareStyleRefs(ref, effectiveStyleId, '[Reference]')

      const refSeed = settings.seedLocked && typeof settings.seedNo === 'number' && Number.isFinite(settings.seedNo)
        ? settings.seedNo
        : null
      const generateAndPublish = async () => {
        const submitIndex = resolveReferenceIndex(
          referencesRef.current,
          index,
          guardKey
        )
        if (submitIndex < 0) {
          releaseGeneratingBusy()
          return { success: false, skipped: true, skipStage: 'not-found' }
        }
        const submitRef = guardKey
          ? referencesRef.current[submitIndex]
          : ref
        // #R32-2: 선택된 이미지 모델(settings.imageModel)을 전달 — 안 넘기면 useGenAPI 가 DEFAULT 로
        //   폴백해 비-기본 BYOK 모델 선택이 ref 생성에 반영되지 않는다(씬 생성과 동일하게 model 전달).
        const result = await genAPI.generateImage(styledPrompt, styleRefImages, { batchCount: settings.imageBatchCount, seed: refSeed, aspectRatio: settings.aspectRatio, model: settings.imageModel, purpose: 'reference', ref: { id: submitRef.id, name: submitRef.name, type: submitRef.type, category: submitRef.category, entityId: submitRef.entityId, workflowId: submitRef.workflowId } })

        if (result.success && result.images?.length > 0) {
          const processed = await _processAndSaveImage(
            result.images,
            submitIndex,
            submitRef,
            '[Reference]',
            result,
            guardKey,
            index,
            batchBusy,
          )
          // coordinator timeout은 호출자만 먼저 풀고 inner는 계속된다. 늦게 끝난 저장이 synced를
          // 다시 쓰더라도 repair 경로가 사라지지 않게 마지막 상태를 failed로 되돌린다.
          if (characterOperationTimedOut && processed?.success) markFlowRefreshFailed()
          return processed
        } else if (!result.success) {
          const errorMsg = result.error || ''
          const isAuthError = errorMsg.includes('401') || errorMsg.includes('auth') || errorMsg.includes('token') || errorMsg.includes('login')
          const isServerError = errorMsg.includes('500') || errorMsg.includes('502') || errorMsg.includes('503') || errorMsg.includes('server')
          const isQuota = _maybeTriggerQuotaStop(errorMsg)
          if (!isQuota) toast.error(t('toast.generateFailed', { error: displayResultError(result, 'Unknown error') }))
          releaseGeneratingBusy()
          // #R26-5: 단일-ref 경로도 배치 경로(R25-5)와 동일하게 인증 실패를 errorKind:'auth' 로 분류.
          setReferences(prev => patchReferenceByIdentity(
            prev,
            submitIndex,
            guardKey,
            current => ({
                ...current,
                status: 'error',
                errorMessage: result.error || 'Generation failed',
                errorKind: (result.authFailed || isAuthError) ? 'auth' : (result.errorKind ?? null),
              })
          ))
          return { success: false, authError: isAuthError, serverError: isServerError, quotaExhausted: isQuota }
        }
        releaseGeneratingBusy()
        setReferences(prev => patchReferenceByIdentity(
          prev,
          submitIndex,
          guardKey,
          current => ({ ...current, status: 'error', errorMessage: 'Unknown failure' })
        ))
        return { success: false }
      }

      if (genAPI?.mode === 'flow' && ref.type === 'character') {
        const scopeToken = `flow::${getLiveProjectName() ?? ''}`
        characterScopeToken = scopeToken
        const coordinated = await runFlowCharacterOperation({
          ref,
          projectId: flowProjectId,
          scopeToken,
          refIndex: index,
          operation: 'generate-character',
          task: generateAndPublish,
        })
        if (coordinated?.busy) {
          releaseGeneratingBusy()
          setReferences(prev => patchReferenceByIdentity(
            prev,
            index,
            guardKey,
            current => ({ ...current, status: 'pending', errorMessage: null })
          ))
          return { success: false, busy: true, error: coordinated.error }
        }
        if (coordinated?.composerRefreshNeeded) {
          addGeneratingBusy()
          try {
            const refreshResult = await runFlowComposerRefresh({
              projectId: flowProjectId,
              scopeToken,
              shouldRun: () => `flow::${getLiveProjectName() ?? ''}` === scopeToken,
            })
            if (refreshResult?.success !== true) {
              markFlowRefreshFailed()
              return {
                ...coordinated,
                success: true,
                refreshFailed: true,
                error: refreshResult?.error || 'Composer refresh failed',
              }
            }
          } catch (error) {
            markFlowRefreshFailed()
            return {
              ...coordinated,
              success: true,
              refreshFailed: true,
              error: error?.message || String(error),
            }
          } finally {
            releaseGeneratingBusy()
          }
        }
        return coordinated
      }
      return await generateAndPublish()
    } catch (error) {
      console.error('Reference generation error:', error)
      const errorMsg = error.message || ''
      const isAuthError = errorMsg.includes('401') || errorMsg.includes('auth') || errorMsg.includes('token') || errorMsg.includes('login')
      const isServerError = errorMsg.includes('500') || errorMsg.includes('502') || errorMsg.includes('503') || errorMsg.includes('server')
      const operationTimedOut = genAPI?.mode === 'flow'
        && ref.type === 'character'
        && errorMsg.includes('Flow character operation timed out')
      if (operationTimedOut) {
        characterOperationTimedOut = true
        markFlowRefreshFailed()
      }
      toast.error(t('toast.generateError', { error: error.message }))
      releaseGeneratingBusy()
      setReferences(prev => patchReferenceByIdentity(
        prev,
        index,
        guardKey,
        current => ({ ...current, status: 'error', errorMessage: error.message || 'Generation error', ...(isAuthError ? { errorKind: 'auth' } : {}) })
      ))
      if (guardKey && resolveReferenceIndex(referencesRef.current, index, guardKey) < 0) {
        return { success: false, skipped: true, skipStage: 'not-found' }
      }
      return { success: false, authError: isAuthError, serverError: isServerError, operationTimedOut }
    }

    return { success: false }
  }

  // ─── 비동기 결과 수집 + 후처리 (배치용) ───
  const processAsyncResult = async (
    generationId,
    index,
    ref,
    guardKey = null,
    busyIndex = index,
  ) => {
    const result = await genAPI.collectGeneration(generationId)

    if (!result.success || !result.images?.length) {
      // #R21-1: authFailed 센티넬 → 토큰이 죽었으니 배치 즉시 중단(개별 ref 실패로 흘리지 않음).
      if (result.authFailed) {
        stopRequestedRef.current = true
        authStoppedRef.current = true
        window.dispatchEvent(new CustomEvent('flow-login-expired'))
      }
      const errorMsg = result.error || ''
      const isAuthError = errorMsg.includes('401') || errorMsg.includes('auth') || errorMsg.includes('token')
      const isServerError = errorMsg.includes('500') || errorMsg.includes('502') || errorMsg.includes('503')
      const isQuota = _maybeTriggerQuotaStop(errorMsg)
      if (!isQuota) toast.error(t('toast.generateFailed', { error: displayResultError(result, 'Unknown error') }))
      removeBatchGeneratingRef(busyIndex)
      // #R25-5: authFailed 면 errorKind:'auth' 도 같이 남긴다 — cleanup 은 pendingQueue 항목에만
      //   auth 마커를 붙이므로, 실제 인증 실패를 맞은 이 ref 가 안정적 auth 표식을 놓치지 않게 한다.
      setReferences(prev => patchReferenceByIdentity(
        prev,
        index,
        guardKey,
        current => ({
            ...current,
            status: 'error',
            errorMessage: result.error || 'Generation failed',
            errorKind: resultErrorKind(result),
          })
      ))
      return {
        success: false,
        error: result.error || 'Generation failed',
        authError: isAuthError,
        serverError: isServerError,
        quotaExhausted: isQuota,
      }
    }

    const resolvedIndex = resolveReferenceIndex(
      referencesRef.current,
      index,
      guardKey
    )
    if (resolvedIndex < 0) {
      removeBatchGeneratingRef(busyIndex)
      return { success: false, skipped: true, skipStage: 'not-found' }
    }
    const resolvedRef = guardKey
      ? referencesRef.current[resolvedIndex]
      : ref
    return await _processAndSaveImage(
      result.images,
      resolvedIndex,
      resolvedRef,
      '[AsyncRef]',
      result,
      guardKey,
      busyIndex,
      true,
    )
  }

  // ─── 배치 생성 (비동기 fire-and-forget 방식) ───
  // 제출 → 동시성 게이트 → 다음 제출, 결과는 별도 수집
  //
  // force=true (MCP 전용): 이미 완료된(image/filePath/status=done) ref도 재생성 대상에 포함.
  //                       prompt 있는 모든 ref가 대상.
  // force=false (기본): 기존 동작 — image 없고 pending/error/idle 상태인 ref만.
  //
  // options = { force?, targetRefKeys?, reason? }
  //   targetRefKeys == null : 기존 Ref 탭 전체 배치 / MCP 전체 배치 (pending 의미 그대로)
  //   targetRefKeys: string[] : 그 key 의 ref 만 대상 (M2 targeted). [] 면 정상 noop.
  //   reason 은 호출 출처 식별자일 뿐 생성 의미나 스타일 해석을 바꾸지 않는다.
  const _executeBatchRefs = async (
    overrideStyleId = null,
    options = {},
    stopVersionAtEnqueue = stopRequestVersionRef.current,
  ) => {
    const { force = false, targetRefKeys = null } = options
    const targetKeySet = targetRefKeys == null ? null : new Set(targetRefKeys)
    const isTargeted = targetKeySet !== null
    const requestedKeys = targetRefKeys == null ? [] : [...targetRefKeys]

    // 선택 시 stable key도 같이 캡처한다. targeted batch가 오래 기다리는 동안 index는 이동할 수 있다.
    const pickTargets = (refMatches) => referencesRef.current
      .map((ref, index) => {
        if (!ref.prompt || !refMatches(ref)) return null
        const key = referenceGuardKey(ref)
        if (isTargeted && !targetKeySet.has(key)) return null
        if (force) return { index, key }
        // targeted: 실제 이미지 4필드만 본다. status=done 같은 workflow 표식은
        // 이미지 존재 증거가 아니므로 M2 빈카드 생성 대상을 막지 않는다.
        // global: Ref 탭/MCP의 기존 pending 의미를 그대로 둬 회귀를 막는다.
        const selected = isTargeted
          ? isReferenceImageEmpty(ref)
          : (!ref.data && !ref.filePath && ref.status !== 'done')
        return selected ? { index, key } : null
      })
      .filter(Boolean)

    const styleTargets = pickTargets(isStyleReference)
    const nonStyleTargets = pickTargets(ref => !isStyleReference(ref))
    const allTargets = [...styleTargets, ...nonStyleTargets]

    // 구조화 결과 accumulator — 기존 setReferences 상태 갱신은 그대로 두고,
    // fail-closed 호출자가 읽을 lifecycle 결과만 별도로 집계한다.
    const succeededKeys = new Set()
    const attemptedKeys = new Set()
    const failedByKey = new Map()
    const skippedByKey = new Map()
    const recordFail = (key, stage, error) => {
      if (!failedByKey.has(key)) {
        failedByKey.set(key, { key, stage, error: error ?? null })
      }
    }
    const recordSkip = (key, stage) => {
      if (!skippedByKey.has(key)) skippedByKey.set(key, { key, stage })
    }

    // targeted 선택에서 실행 시점에 탈락한 요청을 원인별로 명시한다.
    // status는 이미지 존재 증거가 아니며, force면 이미 채워진 카드도 생성 대상이다.
    if (isTargeted) {
      const refsByKey = new Map(
        referencesRef.current.map(ref => [referenceGuardKey(ref), ref])
      )
      for (const key of requestedKeys) {
        const ref = refsByKey.get(key)
        if (!ref) {
          recordSkip(key, 'not-found')
        } else if (!ref.prompt) {
          recordSkip(key, 'missing-prompt')
        } else if (!force && !isReferenceImageEmpty(ref)) {
          recordSkip(key, 'already-filled')
        }
      }
    }

    const buildResult = () => {
      // 선택 뒤 pool에서 삭제된 target도 실제 존재 여부를 다시 확인해 not-found로 남긴다.
      // 존재하지만 stop/연속 실패로 아직 시도되지 않은 target을 not-found로 오분류하지 않는다.
      if (isTargeted) {
        const liveKeys = new Set(
          referencesRef.current.map(ref => referenceGuardKey(ref))
        )
        for (const key of requestedKeys) {
          if (
            !liveKeys.has(key) &&
            !succeededKeys.has(key) &&
            !failedByKey.has(key) &&
            !skippedByKey.has(key)
          ) {
            recordSkip(key, 'not-found')
          }
        }
      }

      const stopped = allTargets.length > 0 &&
        (stopRequestedRef.current || authStoppedRef.current)
      const failed = [...failedByKey.values()]
      const outcome = stopped
        ? 'stopped'
        : failed.length > 0
          ? 'failed'
          : attemptedKeys.size === 0 && succeededKeys.size === 0
            ? 'noop'
            : 'completed'

      return {
        ok: !stopped && failed.length === 0,
        outcome,
        requestedKeys,
        attemptedKeys: [...attemptedKeys],
        succeededKeys: [...succeededKeys],
        skipped: [...skippedByKey.values()],
        failed,
        currentRefs: referencesRef.current,
      }
    }

    // #R22-3: force 리셋은 permission/auth/flowProjectReady 게이트 통과 후로 이동(아래 gate 뒤).
    //   게이트가 막으면 done/error ref 가 pending 으로 리셋된 채 생성이 안 돼 영구 pending 으로 stuck.

    // enqueue 이후 stop version이 바뀐 경우만 이 batch의 queued Stop이다.
    // enqueue 전에 개별 생성/quota가 남긴 stale flag는 기존 동작대로 새 batch 시작 시 버린다.
    const queuedStopRequested =
      stopRequestVersionRef.current !== stopVersionAtEnqueue
    stopRequestedRef.current = queuedStopRequested
    if (!queuedStopRequested) setStoppingRefs(false)
    authStoppedRef.current = false
    let hasPendingSaves = false
    setSaveFailedOnce(false)

    // P2 v3 fix: 전체 lifecycle을 try/finally로 감싸 어느 종료 경로에서도 flag를 정리.
    // 이전엔 명시적 early return만 cleanup했지만, ensurePermission/checkAuthToken/_resolveEffectiveStyleId/
    // batch loop의 예상 못한 throw (IPC reject 등)에선 flag가 stuck → refBatchRunning이 영구 true,
    // 다음 MCP 호출이 waitForStopped 30s timeout 회귀.
    try {

    // 테스트에서만 조기 반환과 producer 사이의 위치 계약을 관측한다. production은 null이라 yield 없음.
    if (beforeBatchActivation) await beforeBatchActivation()

    if (allTargets.length === 0) {
      // targeted 정상 noop은 전체 Ref 배치가 끝났다는 인상을 주면 안 된다.
      if (!isTargeted) toast.info(t('toast.allRefsGenerated'))
      return buildResult()
    }

    // individual job 뒤에 대기하던 동안 들어온 Stop은 이 batch가 소비한다.
    // preflight/submit까지 진행하지 않고 구조화 stopped 결과로 즉시 끝낸다.
    if (stopRequestedRef.current) {
      return buildResult()
    }

    // target과 queued Stop을 모두 확인한 뒤부터 outer finally까지가 실제 Ref batch의 수명이다.
    setRefBatchActive(true)
    setPreparingRefs(true)

    // 폴더 모드 권한 확인
    if (settings.saveMode === 'folder') {
      const permission = await fileSystemAPI.ensurePermission()
      if (permission.error === 'not_set') {
        openSettings('storage')
        recordFail(null, 'permission', permission.error)
        return buildResult()
      }
      if (permission.error === 'folder_deleted') {
        toast.error(t('toast.folderDeleted'))
        openSettings('storage')
        recordFail(null, 'permission', permission.error)
        return buildResult()
      }
      if (!permission.hasPermission) {
        toast.warning(t('toast.folderPermissionNeeded'))
        openSettings('storage')
        recordFail(
          null,
          'permission',
          permission.error || t('toast.folderPermissionNeeded')
        )
        return buildResult()
      }
      console.log('[GenerateAllRefs] Permission granted:', permission.name)
    }

    // 토큰 확인
    if (!(await checkAuthToken(genAPI, t))) {
      toast.warning(authRequiredMessage())
      recordFail(null, 'auth', authRequiredMessage())
      return buildResult()
    }

    // Flow 프로젝트 준비 확인
    const readyCheck = checkFlowProjectReady(flowProjectReady, t)
    if (!readyCheck.ok) {
      recordFail(
        null,
        'flow-ready',
        readyCheck.error || t('toast.flowProjectNotReady')
      )
      return buildResult()
    }

    // #R22-3: 모든 게이트 통과 후에만 force 리셋(done/error → pending). 게이트가 막으면 리셋 안 함.
    if (force) {
      const idxSet = new Set(allTargets.map(target => target.index))
      const keySet = new Set(allTargets.map(target => target.key))
      setReferences(prev => prev.map((r, i) => {
        const selected = isTargeted
          ? keySet.has(referenceGuardKey(r))
          : idxSet.has(i)
        if (!selected) return r
        if (r.status === 'done' || r.status === 'error') return { ...r, status: 'pending', errorMessage: null }
        return r
      }))
    }

    // ─── 단일 배치 phase 의 lifecycle (제출 → 폴링 → 정리) ───
    // style phase / non-style phase 가 각각 fresh 큐로 호출한다.
    const runPhase = async (targets, effectiveStyleId) => {
      if (targets.length === 0) return

      // 비동기 대기열
      const pendingQueue = []
      let submitFailCount = 0
      // 손상된 저장값('x'/NaN/0/음수)은 게이트 무력화(폭주) 유발 → clampInt 로 기본 5 폴백 (useAutomation 과 동일).
      const concurrency = clampInt(settings.concurrency, 1, 15, 5)
      const GATE_POLL_MS = 600
      const resolveBatchTarget = (target, preferredIndex = target.index) => {
        if (!isTargeted) {
          const ref = referencesRef.current[preferredIndex]
          return ref ? { index: preferredIndex, ref } : null
        }
        const index = resolveReferenceIndex(
          referencesRef.current,
          preferredIndex,
          target.key
        )
        if (index < 0) {
          recordSkip(target.key, 'not-found')
          return null
        }
        return { index, ref: referencesRef.current[index] }
      }

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
            const status = await genAPI.checkGeneration(pending.generationId)
            // #R23-5: checkGeneration 자체가 401/403 → authFailed 를 표면화할 수 있다(완료 안 돼도).
            //   무시하면 죽은 인증으로 maxWait(3분)까지 pending 으로 매달린다 → 배치 즉시 중단
            //   (processAsyncResult 의 R21-1 collectGeneration 경로와 동일 stop 시맨틱).
            if (status?.authFailed) {
              console.warn('[GenerateAllRefs] checkGeneration authFailed — stopping batch:', status.error)
              stopRequestedRef.current = true
              authStoppedRef.current = true
              window.dispatchEvent(new CustomEvent('flow-login-expired'))
              break
            }
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
            const result = await processAsyncResult(
              pending.generationId,
              pending.index,
              pending.ref,
              isTargeted ? pending.key : null,
              pending.busyIndex,
            )
            if (result?.savedToMemory) hasPendingSaves = true
            if (result?.skipped) {
              recordSkip(pending.key, result.skipStage || 'not-found')
            } else if (result?.success) {
              succeededKeys.add(pending.key)
            } else {
              recordFail(pending.key, 'collect', result?.error || 'Collect failed')
            }
            succeeded.add(pending)
          } catch (e) {
            console.error('[GenerateAllRefs] Post-processing failed for gen:', pending.generationId, e?.message || e)
            recordFail(
              pending.key,
              'collect',
              e?.message || String(e)
            )
          }
        }, 5)

        // Phase 3: 성공한 항목만 큐에서 제거 (역순 splice 로 인덱스 안정성 유지)
        if (succeeded.size > 0) {
          for (let i = pendingQueue.length - 1; i >= 0; i--) {
            if (succeeded.has(pendingQueue[i])) pendingQueue.splice(i, 1)
          }
        }
      }

      // ─── Phase 1: 비동기 제출 (fire-and-forget) ───
      console.log('[GenerateAllRefs] Starting async batch for', targets.length, 'refs')

      for (const target of targets) {
        if (stopRequestedRef.current) {
          console.log('[GenerateAllRefs] Stop requested by user')
          toast.info(t('toast.batchStopped'))
          break
        }

        let busyIndex = null
        try {
          // 기회적 수집 (quota 감지 + 완료분 즉시 드레인)
          await collectCompleted()
          if (stopRequestedRef.current) break

          // 동시성 게이트 — in-flight(pendingQueue) 가 concurrency 이상이면 슬롯 빌 때까지 대기
          while (pendingQueue.length >= concurrency && !stopRequestedRef.current) {
            await collectCompleted()
            if (pendingQueue.length >= concurrency) {
              await new Promise(r => setTimeout(r, GATE_POLL_MS))
            }
          }
          if (stopRequestedRef.current) break

          let currentTarget = resolveBatchTarget(target)
          if (!currentTarget) continue
          let { index, ref } = currentTarget
          // Flow character submitGeneration 은 내부적으로 동기 DOM 생성인데 결과 publish 는 나중 collect 로
          // 미뤘다. 그 사이 coordinator key 가 풀리면 모달/MCP 가 같은 ref 를 또 생성할 수 있다.
          // 단건 경로를 그대로 재사용해 generate→저장→setReferences 전 수명을 한 lock 안에 둔다.
          if (genAPI?.mode === 'flow' && ref.type === 'character') {
            const direct = await _executeGenerateRef(
              index,
              true,
              effectiveStyleId,
              ref,
              isTargeted ? target.key : null,
              true,
            )
            if (direct?.skipped) {
              recordSkip(target.key, direct.skipStage || 'not-found')
            } else if (direct?.busy) {
              recordFail(target.key, 'busy', direct.error)
            } else if (direct?.operationTimedOut) {
              recordFail(target.key, 'operation-timeout', direct.error || 'Character operation timed out')
              if (options.reason !== 'm2-empty-reference-gate') toast.error(t('toast.flowCharacterOperationTimedOut'))
              break
            } else if (direct?.refreshFailed) {
              recordFail(target.key, 'refresh', direct.error || 'Composer refresh failed')
              if (options.reason !== 'm2-empty-reference-gate') toast.error(t('toast.flowComposerRefreshFailed'))
              break
            } else if (direct?.success) {
              attemptedKeys.add(target.key)
              succeededKeys.add(target.key)
              submitFailCount = 0
            } else {
              recordFail(target.key, 'submit', direct?.error || 'Generation failed')
              submitFailCount++
            }
            continue
          }
          // #R28-4: style-ref 업로드(_prepareStyleRefs)도 busy 로 덮는다 — preparingRefs 는 runPhase
          //   직전에 꺼지고 generatingRefs 는 prepare 후에야 켜져, 그 사이 첫 item 의 Flow style upload
          //   동안 refBatchRunning 이 false 가 되어 project/mode 전환이 열린다. prepare 전에 켜두면
          //   busy 가 연속된다(prepare 가 throw 하면 아래 catch 가 index 를 제거).
          busyIndex = index
          addBatchGeneratingRef(busyIndex)
          // 배치는 위저드에서 고른 스타일이 명시적 의사표시다 — 카드의 이전 기억을 덮어쓴다.
          //   (스타일 카드 자신은 runPhase(styleIndices, null) 이라 null 이 기록된다.)
          //   _prepareStyleRefs 는 Flow 스타일 업로드 등 실패할 수 있는 I/O 다. 그 전에 찍어야
          //   준비 단계에서 죽은 카드도 같은 스타일로 재생성된다.
          const stampedStyleId = effectiveStyleId ?? null
          setReferences(prev => patchReferenceByIdentity(
            prev,
            index,
            isTargeted ? target.key : null,
            current => ({ ...current, status: 'generating', styleId: stampedStyleId, errorMessage: null, generatingStartedAt: Date.now(), generatingEndedAt: null })
          ))

          const { styledPrompt, styleRefImages } = await _prepareStyleRefs(ref, effectiveStyleId, '[GenerateAllRefs]')

          const batchSeed = settings.seedLocked && typeof settings.seedNo === 'number' && Number.isFinite(settings.seedNo)
            ? settings.seedNo
            : null
          // prepare/동시성 대기 사이 MCP delete/reorder가 가능하므로 실제 submit 바로 앞에서 다시 찾는다.
          currentTarget = resolveBatchTarget(target, index)
          if (!currentTarget) {
            removeBatchGeneratingRef(busyIndex)
            continue
          }
          ;({ index, ref } = currentTarget)
          const submitResult = await genAPI.submitGeneration(styledPrompt, styleRefImages, { batchCount: settings.imageBatchCount, seed: batchSeed, aspectRatio: settings.aspectRatio, model: settings.imageModel, purpose: 'reference', ref: { id: ref.id, name: ref.name, type: ref.type, category: ref.category, entityId: ref.entityId, workflowId: ref.workflowId } })

          if (submitResult?.success && submitResult.generationId) {
            attemptedKeys.add(target.key)
            pendingQueue.push({
              generationId: submitResult.generationId,
              index,
              busyIndex,
              ref,
              key: target.key,
            })
            console.log('[GenerateAllRefs] Submitted index:', index, 'gen:', submitResult.generationId)
            submitFailCount = 0
          } else {
            console.warn('[GenerateAllRefs] Submit failed for index:', index, submitResult?.error)
            recordFail(
              target.key,
              'submit',
              submitResult?.error || 'Submit failed'
            )
            // #R21-1: authFailed → 죽은 인증, 배치 즉시 중단.
            if (submitResult?.authFailed) {
              stopRequestedRef.current = true
              authStoppedRef.current = true
              window.dispatchEvent(new CustomEvent('flow-login-expired'))
            }
            removeBatchGeneratingRef(busyIndex)
            // #R25-5: authFailed 면 errorKind:'auth' 도 남겨 안정적 auth 표식 유지.
            setReferences(prev => patchReferenceByIdentity(
              prev,
              index,
              isTargeted ? target.key : null,
              current => ({
                  ...current,
                  status: 'error',
                  errorMessage: submitResult?.error || 'Submit failed',
                  errorKind: resultErrorKind(submitResult),
                })
            ))

            if (_maybeTriggerQuotaStop(submitResult?.error)) {
              break
            }
            submitFailCount++

            if (submitFailCount >= 3) {
              toast.error(t('toast.serverErrorPersist'))
              break
            }
          }

        } catch (err) {
          console.error('[GenerateAllRefs] Error processing key:', target.key, err)
          recordFail(
            target.key,
            'exception',
            err?.message || String(err)
          )
          if (busyIndex !== null) {
            removeBatchGeneratingRef(busyIndex)
          }
          setReferences(prev => patchReferenceByIdentity(
            prev,
            target.index,
            isTargeted ? target.key : null,
            current => ({ ...current, status: 'error', errorMessage: err.message || 'Unexpected error' })
          ))
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
          const cleanupIndex = resolveReferenceIndex(
            referencesRef.current,
            pending.index,
            isTargeted ? pending.key : null
          )
          if (cleanupIndex < 0) {
            recordSkip(pending.key, 'not-found')
            removeBatchGeneratingRef(pending.busyIndex)
            continue
          }
          if (!userStopped) {
            recordFail(
              pending.key,
              'timeout',
              'Timed out'
            )
          }
          removeBatchGeneratingRef(pending.busyIndex)
          setReferences(prev => patchReferenceByIdentity(
            prev,
            cleanupIndex,
            isTargeted ? pending.key : null,
            current => {
            // #R24-4: auth-stop 은 user-stop 처럼 pending(에러 없음)으로 되돌리면 죽은 인증을
            //   숨긴 채 다음 배치가 같은 인증으로 재시도(silent loop). error(auth)로 남겨 사용자가
            //   재로그인을 인지하게 한다. user-stop 은 기존대로 재실행 가능한 pending.
            if (authStoppedRef.current) {
              return { ...current, status: 'error', errorMessage: authErrorMessage(), errorKind: 'auth' }
            }
            return userStopped
              ? { ...current, status: 'pending', errorMessage: null }
              : { ...current, status: 'error', errorMessage: 'Timed out' }
            }
          ))
        }
      }
    }

    setPreparingRefs(false)

    // Phase 1: style refs first — they generate standalone (no style applied to a style ref).
    await runPhase(styleTargets, null)

    // Phase 2: non-style refs — resolve style AFTER phase 1 so freshly-generated
    // style cards are picked up by the auto-fallback. 스타일 단계 도중 사용자가
    // 중단했다면 비스타일 단계는 통째로 건너뛴다 (중복 stop 토스트 + 무의미한 호출 방지).
    if (!stopRequestedRef.current) {
      const batchEffectiveStyleId = _resolveEffectiveStyleId(overrideStyleId)
      await runPhase(nonStyleTargets, batchEffectiveStyleId)
    }

    await genAPI.clearGenerations()

    console.log('[GenerateAllRefs] Batch completed, hasPendingSaves:', hasPendingSaves)

    if (hasPendingSaves) {
      toast.info(t('toast.batchCompleteNeedPermission'))
      openSettings('storage')
    }

    return buildResult()

    } finally {
      // P2 v3: 정상 종료 / early return / throw 어느 경로에서도 flag 정리 (P1 + P2 통합 fix).
      // 안 그러면 refBatchRunning이 stuck 되어 MCP stop-restart가 30s timeout.
      stopRequestedRef.current = false
      authStoppedRef.current = false
      setRefBatchActive(false)
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

  // 큐를 통한 배치 생성. options = { force?, targetRefKeys?, reason? }.
  // force=true (MCP 전용): 이미 완료된 ref도 재생성 대상에 포함.
  // #M2: 결과를 반드시 return 한다 — fail-closed가 batchResult.ok를 읽으므로 예전처럼
  //   queue 경로에서 await만 하고 버리면 조용히 undefined가 되어 씬 배치 판단이 깨진다.
  const handleGenerateAllRefs = async (overrideStyleId = null, options = {}) => {
    const stopVersionAtEnqueue = stopRequestVersionRef.current
    pendingRefBatchCallsRef.current += 1
    try {
      if (!generationQueue) {
        return await _executeBatchRefs(
          overrideStyleId,
          options,
          stopVersionAtEnqueue,
        )
      }
      try {
        return await generationQueue.enqueue({
          type: 'reference_batch',
          label: 'Batch References',
          execute: () => _executeBatchRefs(
            overrideStyleId,
            options,
            stopVersionAtEnqueue,
          )
        })
      } catch (err) {
        console.warn('[RefGen] Batch queue rejected:', err.message)
        return {
          ok: false,
          outcome: 'failed',
          requestedKeys: options.targetRefKeys == null ? [] : [...options.targetRefKeys],
          attemptedKeys: [],
          succeededKeys: [],
          skipped: [],
          failed: [{
            key: null,
            stage: 'exception',
            error: err?.message || String(err),
          }],
          currentRefs: referencesRef.current,
        }
      }
    } finally {
      pendingRefBatchCallsRef.current = Math.max(
        0,
        pendingRefBatchCallsRef.current - 1,
      )
      if (pendingRefBatchCallsRef.current === 0) {
        stopRequestedRef.current = false
        authStoppedRef.current = false
        setStoppingRefs(false)
      }
    }
  }

  return {
    generatingRefs,
    stoppingRefs,
    preparingRefs,
    refBatchActive,
    handleGenerateRef,
    handleGenerateAllRefs,
    stopGenerateAllRefs
  }
}
