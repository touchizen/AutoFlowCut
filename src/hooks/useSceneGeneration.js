/**
 * useSceneGeneration - 씬 이미지 재생성 (상세 모달에서 개별)
 */

import { useState, useCallback } from 'react'
import { checkFolderPermission, checkAuthToken } from '../utils/guards'
import { resolveSceneStyle } from '../services/styleService'
import { finalizeGeneratedImage } from '../services/imageFinalize'
import { toast } from '../components/Toast'
import { isQuotaExhaustedError, emitQuotaStop } from '../utils/quotaStop'
import { stripMentionPrefixes, resolveMentions } from '../utils/mentionParser'

export function useSceneGeneration({ settings, scenes, scenesHook, genAPI, openSettings, setSelectedScene, t, generationQueue }) {
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

    // 폴더 설정 + 토큰 확인
    const folderCheck = await checkFolderPermission(settings, openSettings, t)
    if (!folderCheck.ok) {
      setSelectedScene(null)  // 모달 닫기
      return
    }
    if (!(await checkAuthToken(genAPI, t))) return

    setGeneratingSceneId(sceneId)
    scenesHook.updateScene(sceneId, { status: 'generating' })

    try {
      // 매칭되는 레퍼런스 찾기.
      // 공식 API 모드는 mediaId 대신 name 으로 base64 를 해석하므로
      // mediaId 또는 name 중 하나만 있어도 선택하고, name 을 보존한다.
      const matchedRefs = scenesHook.getMatchingReferences(scene)
        .filter(r => r.mediaId || r.name)
        .map(r => ({
          category: r.category,
          mediaId: r.mediaId || null,
          caption: r.caption || '',
          name: r.name
        }))

      // overrideStyleId 정규화 — 'auto' 는 null (style_tag fallback만), 'none' 은 그대로, 명시 ID는 그대로.
      const effectiveOverride =
        overrideStyleId === 'auto' ? null
        : overrideStyleId === 'none' ? 'none'
        : overrideStyleId == null ? null
        : overrideStyleId
      // `@name` 인라인 멘션 제거 → Gemini 가 본문에서 이름을 일반 명사로 읽도록.
      // 매칭된 ref 는 getMatchingReferences 가 이미 matchedRefs 에 포함했음.
      const allRefs = scenesHook.references || []
      const cleanPrompt = stripMentionPrefixes(scene.prompt, allRefs)
      const { missing } = resolveMentions(scene.prompt, allRefs)
      if (missing.length > 0) console.warn('[Scene]', sceneId, 'unknown @mentions:', missing.join(', '))
      // 스타일 프롬프트 합치기 (style_tag 프리셋 fallback + override)
      const { styledPrompt } = resolveSceneStyle(cleanPrompt, [], effectiveOverride, allRefs, matchedRefs, scene.style_tag)

      // seedLocked && seedNo 가 숫자일 때만 고정 seed, 그 외엔 Flow 자체 랜덤
      const seed = settings.seedLocked && typeof settings.seedNo === 'number' && Number.isFinite(settings.seedNo)
        ? settings.seedNo
        : null
      const result = await genAPI.generateImage(styledPrompt, matchedRefs, { batchCount: settings.imageBatchCount, seed, aspectRatio: settings.aspectRatio, model: settings.imageModel })

      const { success, sceneUpdate } = await finalizeGeneratedImage({
        result, genAPI,
        upscaleRes: settings.imageUpscale || 'off',
        saveMode: settings.saveMode,
        projectName: settings.projectName,
        sceneId, prompt: scene.prompt,
        seed,
        logPrefix: '[Scene]'
      })
      scenesHook.updateScene(sceneId, sceneUpdate)
      if (success) {
        toast.success(t('toast.sceneGenerateSuccess', { sceneId }))
      } else {
        // 단일 씬 실패도 quota 면 batch 와 동일하게 전역 stop+modal 트리거 — 사용자가 잇따른
        // 단일 재시도로 quota 를 더 소진하는 것을 막는다.
        const failErr = result?.error ?? sceneUpdate.error
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
  }, [settings, scenes, scenesHook, genAPI, openSettings, setSelectedScene, t])

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
