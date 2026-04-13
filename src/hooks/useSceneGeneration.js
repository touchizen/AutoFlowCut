/**
 * useSceneGeneration - 씬 이미지 재생성 (상세 모달에서 개별)
 */

import { useState, useCallback } from 'react'
import { checkFolderPermission, checkAuthToken } from '../utils/guards'
import { resolveSceneStyle } from '../services/styleService'
import { finalizeGeneratedImage } from '../services/imageFinalize'
import { toast } from '../components/Toast'

export function useSceneGeneration({ settings, scenes, scenesHook, flowAPI, openSettings, setSelectedScene, t, generationQueue }) {
  const [generatingSceneId, setGeneratingSceneId] = useState(null)

  // 핵심 생성 로직
  const _executeSceneGeneration = useCallback(async (sceneId) => {
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
    if (!(await checkAuthToken(flowAPI, t))) return

    setGeneratingSceneId(sceneId)
    scenesHook.updateScene(sceneId, { status: 'generating' })

    try {
      // 매칭되는 레퍼런스 찾기
      const matchedRefs = scenesHook.getMatchingReferences(scene)
        .filter(r => r.mediaId)
        .map(r => ({
          category: r.category,
          mediaId: r.mediaId,
          caption: r.caption || ''
        }))

      // 스타일 프롬프트 합치기 (style_tag 프리셋 fallback)
      const { styledPrompt } = resolveSceneStyle(scene.prompt, [], null, [], matchedRefs, scene.style_tag)

      // seedLocked && seedNo 가 숫자일 때만 고정 seed, 그 외엔 Flow 자체 랜덤
      const seed = settings.seedLocked && typeof settings.seedNo === 'number' && Number.isFinite(settings.seedNo)
        ? settings.seedNo
        : null
      const result = await flowAPI.generateImageDOM(styledPrompt, matchedRefs, { batchCount: settings.imageBatchCount, seed })

      const { success, sceneUpdate } = await finalizeGeneratedImage({
        result, flowAPI,
        upscaleRes: settings.imageUpscale || 'off',
        saveMode: settings.saveMode,
        projectName: settings.projectName,
        sceneId, prompt: scene.prompt,
        logPrefix: '[Scene]'
      })
      scenesHook.updateScene(sceneId, sceneUpdate)
      if (success) {
        toast.success(t('toast.sceneGenerateSuccess', { sceneId }))
      } else {
        toast.error(t('toast.sceneGenerateFailed', { error: sceneUpdate.error || 'Unknown error' }))
      }
    } catch (error) {
      console.error('Scene generation error:', error)
      scenesHook.updateScene(sceneId, { status: 'error' })
      toast.error(t('toast.sceneGenerateError', { error: error.message }))
    }

    setGeneratingSceneId(null)
  }, [settings, scenes, scenesHook, flowAPI, openSettings, setSelectedScene, t])

  // 큐를 통한 생성
  const handleGenerateScene = useCallback(async (sceneId) => {
    if (!generationQueue) {
      return _executeSceneGeneration(sceneId)
    }

    try {
      await generationQueue.enqueue({
        type: 'scene',
        label: `Scene #${sceneId}`,
        execute: () => _executeSceneGeneration(sceneId)
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
