/**
 * useSceneGeneration - 씬 이미지 재생성 (상세 모달에서 개별)
 */

import { useState, useCallback } from 'react'
import { RESOURCE } from '../config/defaults'
import { fileSystemAPI } from './useFileSystem'
import { generateProjectName, getImageSizeFromBase64 } from '../utils/formatters'
import { checkFolderPermission, checkAuthToken } from '../utils/guards'
import { tryUpscaleImage } from '../utils/imageProcessing'
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

      // seedLocked && seedNo 가 숫자일 때만 고정 seed, 그 외엔 Flow 자체 랜덤
      const seed = settings.seedLocked && typeof settings.seedNo === 'number' && Number.isFinite(settings.seedNo)
        ? settings.seedNo
        : null
      const result = await flowAPI.generateImageDOM(scene.prompt, matchedRefs, { batchCount: settings.imageBatchCount, seed })

      if (result.success && result.images?.length > 0) {
        // images는 [{ base64, mediaId }] 객체 배열
        const firstImage = result.images[0]
        let imageData = firstImage.base64 || firstImage  // backward compat
        const mediaId = firstImage.mediaId || null

        // 이미지 업스케일 (설정에 따라)
        const upscaled = await tryUpscaleImage(flowAPI, mediaId, settings.imageUpscale || 'off', '[Scene]')
        if (upscaled) imageData = upscaled

        // 이미지 크기 추출
        let imageSize = null
        try {
          imageSize = await getImageSizeFromBase64(imageData)
        } catch (e) {
          console.warn('[Scene] Failed to get image size:', e)
        }

        // 파일 저장 (폴더 모드일 때)
        let imagePath = null
        if (settings.saveMode === 'folder') {
          const projectName = settings.projectName || generateProjectName()
          // metadata: prompt + mediaId → history/*.json에 저장
          const metadata = {
            prompt: scene.prompt,
            mediaId,
            model: 'flow',
            timestamp: Date.now()
          }
          const saveResult = await fileSystemAPI.saveImage(projectName, sceneId, imageData, 'flow', metadata)
          if (saveResult.success) {
            imagePath = saveResult.path
            console.log('[Scene] Saved to:', imagePath)
          }

          // 여분 이미지(2장 이상 생성된 경우) → History에만 저장 (mediaId 포함)
          await fileSystemAPI.saveExtraToHistory(projectName, RESOURCE.SCENES, sceneId, result.images, scene.prompt, 'Scene')
        }

        scenesHook.updateScene(sceneId, {
          image: imagePath ? null : imageData,  // 파일 저장 성공 시 메모리 해제
          imagePath,
          mediaId,
          image_size: imageSize,
          status: 'done'
        })
        toast.success(t('toast.sceneGenerateSuccess', { sceneId }))
      } else {
        scenesHook.updateScene(sceneId, { status: 'error' })
        toast.error(t('toast.sceneGenerateFailed', { error: result.error || 'Unknown error' }))
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
