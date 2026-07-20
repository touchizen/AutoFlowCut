/**
 * useSceneGeneration - 씬 이미지 재생성 (상세 모달에서 개별)
 */

import { useState, useCallback } from 'react'
import { checkFolderPermission, checkAuthToken, checkFlowProjectReady } from '../utils/guards'
import { resolveSceneStyle } from '../services/styleService'
import { finalizeGeneratedImage } from '../services/imageFinalize'
import { toast } from '../components/Toast'
import { isQuotaExhaustedError, emitQuotaStop } from '../utils/quotaStop'
import { resolveMentions } from '../utils/mentionParser'
import { getAuthRequiredMessage } from '../utils/authMessages'
import { resolveSceneImageProvider } from '../utils/sceneProviderResolution'

export function useSceneGeneration({ settings, scenes, scenesHook, genAPI, openSettings, setSelectedScene, t, generationQueue, flowProjectReady = true }) {
  const [generatingSceneId, setGeneratingSceneId] = useState(null)

  // 핵심 생성 로직
  // overrideStyleId: MCP 호출 등에서 명시 styleId 줬을 때 사용. undefined면 기존 동작 (style_tag fallback만).
  //   - 'preset:*' / 'ref:*' / plain id → resolveSceneStyle에 전달 (해당 스타일 강제)
  //   - 'none' → 'none' sentinel pass-through (스타일 미적용 강제)
  //   - 'auto' → null로 취급 (style_tag 매칭 fallback)
  const _executeSceneGeneration = useCallback(async (sceneId, overrideStyleId = undefined) => {
    const scene = scenes.find(s => s.id === sceneId)
    if (!scene?.prompt) {
      toast.warning(t('toast.noPrompt'))
      return
    }
    const resolvedGeneration = resolveSceneImageProvider(scene, settings)
    if (resolvedGeneration.warning) console.warn('[Scene]', resolvedGeneration.warning)

    // #R27-1: preflight(folder/ready/auth) await 동안에도 busy 로 표시한다. 안 그러면 그 창에서
    //   project/mode 전환이 허용돼, 전환 뒤 stale 엔진으로 생성하고 결과를 현재 프로젝트의 씬
    //   (id 재사용)에 patch 한다. generatingSceneId 를 await 전에 켜고 조기 return 마다 해제한다.
    setGeneratingSceneId(sceneId)

    // 폴더 설정 + Flow 프로젝트 준비 + 토큰 확인
    const folderCheck = await checkFolderPermission(settings, openSettings, t)
    if (!folderCheck.ok) {
      setGeneratingSceneId(null)
      setSelectedScene(null)  // 모달 닫기
      return
    }
    const readyCheck = checkFlowProjectReady(flowProjectReady, t)
    if (!readyCheck.ok) { setGeneratingSceneId(null); return }
    if (!(await checkAuthToken(genAPI, t, resolvedGeneration.provider))) {
      const message = getAuthRequiredMessage(genAPI?.mode, t)
      scenesHook.updateScene(sceneId, { status: 'error', errorKind: 'auth', error: message })
      toast.warning(message)
      setGeneratingSceneId(null)
      return
    }

    // generatingStartedAt 을 새로 찍는다 — 안 그러면 이전 생성의 stale 시작시각이 남아
    //   경과시간이 엉뚱하게(예: 1분인데 1시간 25분) 표시된다. (배치/레퍼런스 경로는 이미 세팅.)
    scenesHook.updateScene(sceneId, { status: 'generating', generatingStartedAt: Date.now(), generatingEndedAt: null })

    try {
      // 매칭되는 레퍼런스 찾기.
      // 공식 API 모드는 mediaId 대신 name 으로 base64 를 해석하므로
      // mediaId 또는 name 중 하나만 있어도 선택하고, name 을 보존한다.
      //
      // R37 review fix: data/filePath 도 보존해야 한다. memory-only 레퍼런스
      // (디스크 저장 실패/스킵된 경우) 는 ref.data 에만 base64 가 있고
      // referenceResolver 는 data 우선 → name 디스크 fallback 순으로 읽는데,
      // 여기서 data 를 떨구면 디스크에 없는 ref 가 조용히 빈 inlineData parts 로
      // 넘어가 Gemini 가 캐릭터 일관성을 못 잡는다.
      const matchedRefs = scenesHook.getMatchingReferences(scene)
        .filter(r => r.mediaId || r.name || r.data || r.filePath)
        .map(r => ({
          category: r.category,
          mediaId: r.mediaId || null,
          caption: r.caption || '',
          name: r.name,
          data: r.data || null,
          filePath: r.filePath || null,
        }))

      // overrideStyleId 정규화 — 'auto' 는 null (style_tag fallback만), 'none' 은 그대로, 명시 ID는 그대로.
      const effectiveOverride =
        overrideStyleId === 'auto' ? null
        : overrideStyleId === 'none' ? 'none'
        : overrideStyleId == null ? null
        : overrideStyleId
      // `@name` 인라인 멘션은 engineApi 내부에서 제거됨 (M4 T7). 여기선 로깅 전용.
      const allRefs = scenesHook.references || []
      const { missing } = resolveMentions(scene.prompt, allRefs)
      if (missing.length > 0) console.warn('[Scene]', sceneId, 'unknown @mentions:', missing.join(', '))
      // 스타일 프롬프트 합치기 (style_tag 프리셋 fallback + override)
      // scene.prompt 그대로 전달 — strip은 engineApi.generateImage 내부에서 수행.
      const { styledPrompt } = resolveSceneStyle(scene.prompt, [], effectiveOverride, allRefs, matchedRefs, scene.style_tag)

      // seedLocked && seedNo 가 숫자일 때만 고정 seed, 그 외엔 Flow 자체 랜덤
      const seed = settings.seedLocked && typeof settings.seedNo === 'number' && Number.isFinite(settings.seedNo)
        ? settings.seedNo
        : null
      const result = await genAPI.generateImage(styledPrompt, matchedRefs, { batchCount: settings.imageBatchCount, seed, aspectRatio: settings.aspectRatio, model: resolvedGeneration.model, provider: resolvedGeneration.provider, references: allRefs })

      const { success, sceneUpdate } = await finalizeGeneratedImage({
        result, genAPI,
        upscaleRes: settings.imageUpscale || 'off',
        saveMode: settings.saveMode,
        projectName: settings.projectName,
        sceneId, prompt: scene.prompt,
        seed,
        // 선택 모델을 기록 — 안 넘기면 imageFinalize 기본값 'flow' 로 저장돼 ResultsTable 에
        //   엔진ID 가 뜬다(응답이 더 구체적 model 을 주면 그게 우선). batch 경로와 일관.
        model: resolvedGeneration.model,
        logPrefix: '[Scene]'
      })
      scenesHook.updateScene(sceneId, sceneUpdate)
      if (success) {
        toast.success(t('toast.sceneGenerateSuccess', { sceneId }))
      } else {
        // 단일 씬 실패도 quota 면 batch 와 동일하게 전역 stop+modal 트리거 — 사용자가 잇따른
        // 단일 재시도로 quota 를 더 소진하는 것을 막는다.
        const failErr = result && typeof result === 'object'
          ? result
          : (result?.error ?? sceneUpdate.error)
        if (isQuotaExhaustedError(failErr)) {
          emitQuotaStop({ scope: 'SceneGen' })
        } else {
          toast.error(t('toast.sceneGenerateFailed', { error: sceneUpdate.error || 'Unknown error' }))
        }
      }
    } catch (error) {
      console.error('Scene generation error:', error)
      const errorMessage = error?.message || String(error)
      scenesHook.updateScene(sceneId, {
        status: 'error',
        errorKind: null,
        error: errorMessage,
      })
      // throw 경로 quota 도 동일하게 처리.
      if (isQuotaExhaustedError(error)) {
        emitQuotaStop({ scope: 'SceneGen' })
      } else {
        toast.error(t('toast.sceneGenerateError', { error: errorMessage }))
      }
    }

    setGeneratingSceneId(null)
  // R2-5: flowProjectReady missing from dep array → stale closure could allow
  // generation when not ready, or block after recovery. Adding it here ensures
  // the callback sees the current value on every invocation.
  }, [settings, scenes, scenesHook, genAPI, openSettings, setSelectedScene, t, flowProjectReady])

  // 큐를 통한 생성. overrideStyleId 선택 — MCP `app_generate_scene(sceneId, styleId)`에서 사용.
  const handleGenerateScene = useCallback(async (sceneId, overrideStyleId = undefined) => {
    if (!generationQueue) {
      return _executeSceneGeneration(sceneId, overrideStyleId)
    }

    try {
      await generationQueue.enqueue({
        type: 'scene',
        label: `Scene #${sceneId}`,
        execute: () => _executeSceneGeneration(sceneId, overrideStyleId)
      })
    } catch (err) {
      console.warn('[SceneGen] Queue rejected:', err.message)
    }
  }, [generationQueue, _executeSceneGeneration])

  return {
    generatingSceneId,
    handleGenerateScene
  }
}
