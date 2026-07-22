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

/**
 * @param {object} deps
 * @param {(req: {scene: object, names?: string[]}) => Promise<{proceeded: boolean, refs?: Array}>} [deps.requestMentionSync]
 *   flow 모드에서 "이 씬의 @멘션 중 동기화가 필요한 게 있으면 처리해 달라"는 요청. 호출부(App)가
 *   대상 판정과 동기화 게이트(모달)를 소유한다 — 배치(Start)와 같은 게이트를 재사용하기 위함.
 *   names 가 있으면 "엔진이 이 이름들을 미해결로 거절했다"는 사후 복구 요청이다.
 *   반환: proceeded=false 면 사용자가 취소한 것(생성하지 않는다), refs 가 있으면 그것이
 *   authoritative refs 다(React state 는 같은 tick 에 stale).
 */
export function useSceneGeneration({ settings, scenes, scenesHook, genAPI, openSettings, setSelectedScene, t, generationQueue, flowProjectReady = true, requestMentionSync }) {
  const [generatingSceneId, setGeneratingSceneId] = useState(null)

  // 핵심 생성 로직
  // overrideStyleId: MCP 호출 등에서 명시 styleId 줬을 때 사용. undefined면 기존 동작 (style_tag fallback만).
  //   - 'preset:*' / 'ref:*' / plain id → resolveSceneStyle에 전달 (해당 스타일 강제)
  //   - 'none' → 'none' sentinel pass-through (스타일 미적용 강제)
  //   - 'auto' → null로 취급 (style_tag 매칭 fallback)
  // sceneOverride: 상세 모달 재생성이 방금 편집한 스냅샷(editData)을 명시 전달(Issue #4/#5). undefined면
  //   closure scene 그대로. 모달이 onUpdate 직후 onGenerate 를 부르면 scenes 클로저가 stale 이라
  //   방금 편집한 prompt/characters/style_tag 를 못 보는 race 가 난다 — 스냅샷을 병합해 fresh 하게 쓴다.
  const _executeSceneGeneration = useCallback(async (sceneId, overrideStyleId = undefined, sceneOverride = undefined) => {
    const baseScene = scenes.find(s => s.id === sceneId)
    const scene = (baseScene && sceneOverride) ? { ...baseScene, ...sceneOverride } : baseScene
    if (!scene?.prompt) {
      toast.warning(t('toast.noPrompt'))
      return
    }

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
    if (!(await checkAuthToken(genAPI, t))) {
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
      // 배치(Start)와 같은 계약: 미동기화 @멘션 캐릭터는 생성 **전에** 동기화한다. 개별 생성만
      // 이 게이트가 없어서, 같은 프롬프트가 Start 로는 되고 씬 카드 버튼으로는 영구 실패했다.
      let effectiveRefs = scenesHook.references || []
      if (genAPI?.mode === 'flow' && requestMentionSync) {
        const gate = await requestMentionSync({ scene })
        if (gate && gate.proceeded === false) { setGeneratingSceneId(null); return }
        if (gate?.refs) effectiveRefs = gate.refs
      }

      const matchedRefs = scenesHook.getMatchingReferences(scene, effectiveRefs)
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
      const allRefs = effectiveRefs
      const { missing } = resolveMentions(scene.prompt, allRefs)
      if (missing.length > 0) console.warn('[Scene]', sceneId, 'unknown @mentions:', missing.join(', '))
      // 스타일 프롬프트 합치기 (style_tag 프리셋 fallback + override)
      // scene.prompt 그대로 전달 — strip은 engineApi.generateImage 내부에서 수행.
      // scene 은 sceneOverride 가 병합된 fresh 스냅샷 — prompt/style_tag 모두 편집본을 반영.
      const { styledPrompt } = resolveSceneStyle(scene.prompt, [], effectiveOverride, allRefs, matchedRefs, scene.style_tag)

      // seedLocked && seedNo 가 숫자일 때만 고정 seed, 그 외엔 Flow 자체 랜덤
      const seed = settings.seedLocked && typeof settings.seedNo === 'number' && Number.isFinite(settings.seedNo)
        ? settings.seedNo
        : null
      const callEngine = (refs) => genAPI.generateImage(
        styledPrompt,
        scenesHook.getMatchingReferences(scene, refs).filter(r => r.mediaId || r.name || r.data || r.filePath).map(r => ({
          category: r.category, mediaId: r.mediaId || null, caption: r.caption || '',
          name: r.name, data: r.data || null, filePath: r.filePath || null,
        })),
        { batchCount: settings.imageBatchCount, seed, aspectRatio: settings.aspectRatio, model: settings.imageModel, references: refs },
      )
      let result = await genAPI.generateImage(styledPrompt, matchedRefs, { batchCount: settings.imageBatchCount, seed, aspectRatio: settings.aspectRatio, model: settings.imageModel, references: allRefs })

      // 프리플라이트가 "동기화할 것 없음"으로 봤는데도 엔진이 미해결로 거절할 수 있다 — 앱이 들고
      // 있던 동기화 판정이 옛것이면 그렇다(Flow 에서 사용자가 직접 고친 경우 등). 그때 그냥 에러로
      // 끝내면 사용자는 손쓸 방법이 없다. 이름을 알고 있으니 그 자리에서 동기화를 제안하고 **한 번만**
      // 재시도한다(동기화 후에도 미해결이면 그대로 실패 — 무한 루프 금지).
      if (result?.errorKind === 'unresolved-mentions' && genAPI?.mode === 'flow' && requestMentionSync) {
        const recovery = await requestMentionSync({ scene, names: result.unresolvedNames || [] })
        if (recovery?.proceeded) {
          result = await callEngine(recovery.refs || effectiveRefs)
        }
      }

      const { success, sceneUpdate } = await finalizeGeneratedImage({
        result, genAPI,
        upscaleRes: settings.imageUpscale || 'off',
        saveMode: settings.saveMode,
        projectName: settings.projectName,
        sceneId, prompt: scene.prompt,
        seed,
        // 선택 모델을 기록 — 안 넘기면 imageFinalize 기본값 'flow' 로 저장돼 ResultsTable 에
        //   엔진ID 가 뜬다(응답이 더 구체적 model 을 주면 그게 우선). batch 경로와 일관.
        model: settings.imageModel,
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
  // R2-5: flowProjectReady missing from dep array → stale closure could allow
  // generation when not ready, or block after recovery. Adding it here ensures
  // the callback sees the current value on every invocation.
  }, [settings, scenes, scenesHook, genAPI, openSettings, setSelectedScene, t, flowProjectReady, requestMentionSync])

  // 큐를 통한 생성. overrideStyleId 선택 — MCP `app_generate_scene(sceneId, styleId)`에서 사용.
  // sceneOverride 선택 — 상세 모달 재생성이 방금 편집한 스냅샷(editData)을 명시 전달(Issue #4/#5).
  const handleGenerateScene = useCallback(async (sceneId, overrideStyleId = undefined, sceneOverride = undefined) => {
    if (!generationQueue) {
      return _executeSceneGeneration(sceneId, overrideStyleId, sceneOverride)
    }

    try {
      await generationQueue.enqueue({
        type: 'scene',
        label: `Scene #${sceneId}`,
        execute: () => _executeSceneGeneration(sceneId, overrideStyleId, sceneOverride)
      })
    } catch (err) {
      // 침묵 금지: quota-block 등으로 큐가 거부하면 사용자에겐 "버튼이 안 먹는" 것으로 보인다.
      // 단, 일괄 clear(전역 quota 모달이 이미 알림 — alreadySurfaced)는 씬당 toast 를 또 띄우지 않는다.
      console.warn('[SceneGen] Queue rejected:', err.message)
      if (!err.alreadySurfaced) toast.warning(err.message)
    }
  }, [generationQueue, _executeSceneGeneration])

  return {
    generatingSceneId,
    handleGenerateScene
  }
}
