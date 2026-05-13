/**
 * useMcpServer — MCP HTTP 서버 관련 로직을 App.jsx에서 분리
 *
 * 역할:
 * 1. MCP HTTP 서버 시작/중지 (settings 기반)
 * 2. 글로벌 접근자 등록 (window.__mcp*)
 * 3. MCP HTTP 업데이트 수신 (onMcpUpdate)
 * 4. 배치/중지/상태 글로벌 핸들러
 */

import { useEffect, useRef } from 'react'
import { normalizeStyleId, findAutoStyle } from '../services/styleService'

/**
 * @param {object} params
 * @param {object} params.settings - 앱 설정 (mcpHttpEnabled, mcpHttpPort)
 * @param {Array}  params.scenes - 씬 배열
 * @param {Function} params.setScenes - 씬 setter
 * @param {Array}  params.references - 레퍼런스 배열
 * @param {Function} params.setReferences - 레퍼런스 setter
 * @param {Function} params.handleGenerateRef - 레퍼런스 생성 핸들러
 * @param {Function} params.handleGenerateScene - 씬 생성 핸들러
 * @param {Function} params.handleGenerateAllRefs - 전체 레퍼런스 생성
 * @param {Function} params.handleStart - 씬 배치 시작
 * @param {Function} params.handleStop - 중지
 * @param {Function} params.handleProjectChange - 프로젝트 변경
 * @param {Function} params.handleExportConfirm - CapCut 내보내기
 * @param {string}   params.selectedStyleRefId - 선택된 스타일 ID
 * @param {Function} params.setSelectedStyleRefId - 스타일 setter
 * @param {Function} params.refreshReviews - 오디오 리뷰 새로고침
 * @param {Array}    params.audioReviews - 오디오 리뷰 배열
 * @param {Function} params.importByPath - 오디오 폴더 임포트
 * @param {object}   params.audioPackage - 오디오 패키지
 * @param {object}   params.automationState - { isRunning, isPaused, progress, status, statusMessage }
 * @param {object}   params.videoAutomation - 비디오 자동화 상태
 * @param {Array}    params.generatingRefs - 생성 중인 레퍼런스 인덱스들
 */
export function useMcpServer({
  settings,
  scenes, setScenes,
  references, setReferences,
  handleGenerateRef, handleGenerateScene,
  handleGenerateAllRefs, handleStart, handleStop,
  handleProjectChange, handleExportConfirm,
  selectedStyleRefId, setSelectedStyleRefId,
  refreshReviews, audioReviews,
  importByPath, audioPackage,
  automationState, videoAutomation, generatingRefs
}) {
  // 글로벌 핸들러는 mount 시 한 번만 등록되므로 closure가 stale —
  // 호출 시점의 최신 references가 필요한 곳(MCP 자동 fallback 등)은 ref로 접근.
  const referencesRef = useRef(references)
  useEffect(() => { referencesRef.current = references }, [references])

  // MCP HTTP 서버 시작/중지
  useEffect(() => {
    if (settings.mcpHttpEnabled) {
      window.electronAPI?.startMcpHttp?.({ port: settings.mcpHttpPort || 3210 })
    } else {
      window.electronAPI?.stopMcpHttp?.()
    }
  }, [settings.mcpHttpEnabled, settings.mcpHttpPort])

  // MCP HTTP GET 요청을 위한 글로벌 접근자 등록
  useEffect(() => {
    window.__mcpOpenProject = (name) => handleProjectChange(name)
    window.__mcpGetReferences = () => references.map(({ data, ...rest }) => rest)
    window.__mcpGetScenes = () => scenes.map(({ image, videoT2V, videoI2V, ...rest }) => rest)
    // styleId override를 직접 받음 (전역 상태 setSelectedStyleRefId + setTimeout race 회피).
    // styleId 형식은 normalizeStyleId로 정규화됨 ('ref:*' / 'preset:*' / plain → 'preset:*' / null).
    // 'auto' sentinel은 ref 컨텍스트에 의미 없음 (씬 매칭 부재) — null로 취급해 자연스러운 fallback 발동.
    //
    // styleId 생략 시 호출 측에서 findAutoStyle fallback을 미리 적용해 override로 전달.
    // 그래야 useReferenceGeneration 내부의 selectedStyleRefId(UI 선택값)에 끌려가지 않음 —
    // MCP 정책: 자동화 호출은 UI 상태와 독립적이어야 함.
    window.__mcpGenerateRef = (index, styleId) => {
      if (styleId === 'auto') {
        console.warn('[MCP] generate-reference received styleId="auto"; ignored (refs have no per-scene matching). Falling back as if styleId were omitted.')
        styleId = null
      } else if (styleId === 'none') {
        // 'none' sentinel — pass through to handler. styleService.applyStyle/_resolveEffectiveStyleId
        // recognize 'none' and skip all style application (prompt + ref override).
        return handleGenerateRef(index, false, 'none').catch(e => ({ success: false, error: e.message }))
      }
      const effective = normalizeStyleId(styleId) ?? findAutoStyle(referencesRef.current)
      return handleGenerateRef(index, false, effective).catch(e => ({ success: false, error: e.message }))
    }
    // styleId override (선택). 형식은 normalizeStyleId / 'none' / 'auto' 등 styleService와 동일.
    // 생략하면 handleGenerateScene 내부에서 기존 동작 (scene.style_tag 매칭 fallback) 적용.
    window.__mcpGenerateScene = (sceneId, styleId) => handleGenerateScene(sceneId, styleId)
    window.__mcpSetStyle = (styleId) => { setSelectedStyleRefId(styleId); return styleId }
    window.__mcpGetStyle = () => selectedStyleRefId
    window.__mcpRefreshAudioReviews = () => refreshReviews()
    window.__mcpGetAudioReviews = () => audioReviews
    window.__mcpImportAudio = async (folderPath) => {
      const pkg = await importByPath(folderPath)
      if (!pkg) return { success: false, error: 'Failed to import audio' }
      return { success: true, summary: pkg.summary }
    }
    window.__mcpExportCapcut = async (options = {}) => {
      try {
        // 0. audioPackage가 없으면 자동 로드
        if (!audioPackage && options.audioFolderPath) {
          const pkg = await importByPath(options.audioFolderPath)
          if (!pkg) console.warn('[MCP Export] Audio import failed, continuing without audio')
        }
        // 1. CapCut 경로 자동 감지
        let capcutProjectNumber = options.capcutProjectNumber
        if (!capcutProjectNumber) {
          const pathResult = await window.electronAPI?.detectCapcutPath?.()
          if (!pathResult?.success) return { success: false, error: 'CapCut path not detected' }
          const numResult = await window.electronAPI?.getNextProjectNumber?.({ basePath: pathResult.basePath })
          if (!numResult?.success) return { success: false, error: 'Cannot determine project number' }
          const info = await window.electronAPI?.getSystemInfo?.()
          const sep = info?.platform === 'darwin' ? '/' : '\\'
          capcutProjectNumber = `${pathResult.basePath}${sep}${numResult.folderName}`
        }
        // 2. 저장된 export 설정 읽기
        let saved = {}
        try { saved = JSON.parse(localStorage.getItem('exportSettings') || '{}') } catch {}
        const exportOptions = {
          capcutProjectNumber,
          scaleMode: options.scaleMode || saved.scaleMode || 'none',
          kenBurns: options.kenBurns ?? saved.kenBurns ?? true,
          kenBurnsMode: options.kenBurnsMode || saved.kenBurnsMode || 'random',
          kenBurnsCycle: options.kenBurnsCycle || saved.kenBurnsCycle || 5,
          kenBurnsScaleMin: (options.kenBurnsScaleMin || saved.kenBurnsScaleMin || 100) / 100,
          kenBurnsScaleMax: (options.kenBurnsScaleMax || saved.kenBurnsScaleMax || 130) / 100,
          subtitleOption: options.subtitleOption || (saved.includeSubtitle !== false ? 'ko' : 'none'),
          subtitleFontSize: options.subtitleFontSize || saved.subtitleFontSize || 8
        }
        // 3. handleExportConfirm 호출
        await handleExportConfirm(exportOptions)
        return { success: true, path: capcutProjectNumber }
      } catch (e) {
        return { success: false, error: e.message }
      }
    }
    return () => {
      delete window.__mcpGetReferences
      delete window.__mcpGetScenes
      delete window.__mcpGenerateRef
      delete window.__mcpGenerateScene
      delete window.__mcpSetStyle
      delete window.__mcpGetStyle
      delete window.__mcpRefreshAudioReviews
      delete window.__mcpGetAudioReviews
      delete window.__mcpImportAudio
      delete window.__mcpExportCapcut
    }
  }, [references, scenes, handleGenerateRef, handleGenerateScene, selectedStyleRefId, refreshReviews, audioReviews, handleExportConfirm, importByPath, audioPackage])

  // MCP HTTP 서버에서 오는 데이터 업데이트 수신
  useEffect(() => {
    const cleanup = window.electronAPI?.onMcpUpdate?.((data) => {
      if (data.type === 'update-references') {
        // Merge CSV/API data over existing in-memory refs by name so that
        // runtime fields (data, filePath, mediaId, dataStorage, caption,
        // status, errorMessage) survive a CSV reload. Without this merge,
        // load_csv during W6/W7 wipes generated-image pointers and the
        // batch filter treats every ref as regeneratable → full regen.
        setReferences(prev => {
          const byName = new Map(prev.map(r => [r.name, r]))
          return (data.references || []).map(incoming => {
            const existing = incoming.name ? byName.get(incoming.name) : null
            if (!existing) return incoming
            return {
              ...incoming,                      // CSV-authoritative: prompt, type, category, caption(if in CSV)
              data: existing.data,              // preserve runtime-generated image payload
              filePath: existing.filePath,      // preserve saved image path
              mediaId: existing.mediaId,        // preserve uploaded Flow mediaId
              dataStorage: existing.dataStorage,
              status: existing.status,          // preserve generation status
              errorMessage: existing.errorMessage,
            }
          })
        })
        console.log('[MCP] References merged via HTTP:', data.references.length)
      } else if (data.type === 'update-reference') {
        setReferences(prev => prev.map((ref, i) => i === data.index ? { ...prev[i], ...data.fields } : ref))
        console.log('[MCP] Reference', data.index, 'updated via HTTP')
      } else if (data.type === 'remove-reference') {
        setReferences(prev => prev.filter((_, i) => i !== data.index))
        console.log('[MCP] Reference', data.index, 'removed via HTTP')
      } else if (data.type === 'clear-reference-image') {
        setReferences(prev => prev.map((ref, i) => i === data.index ? { ...ref, data: null, filePath: null, mediaId: null, caption: null, dataStorage: null } : ref))
        console.log('[MCP] Reference', data.index, 'image cleared via HTTP')
      } else if (data.type === 'clear-all-reference-images') {
        setReferences(prev => prev.map(ref => ({ ...ref, data: null, filePath: null, mediaId: null, caption: null, dataStorage: null })))
        console.log('[MCP] All reference images cleared via HTTP')
      } else if (data.type === 'update-scenes') {
        // Merge incoming CSV/API rows over existing in-memory scenes by id so
        // runtime fields (image, imagePath, status, mediaId, generatingStartedAt)
        // survive a CSV reload. Without this merge, load_csv during W6/W7 wipes
        // generated-image pointers and a subsequent batch treats every scene as
        // pending → full regeneration of an entire episode (ep4 sat-fire).
        setScenes(prev => {
          const byId = new Map(prev.map(s => [s.id, s]))
          return (data.scenes || []).map((incoming, i) => {
            const id = incoming.id || `scene_${i + 1}`
            const existing = byId.get(id)
            if (!existing) {
              return { ...incoming, id, status: incoming.status || 'pending' }
            }
            return {
              ...incoming,                             // CSV-authoritative: prompt, subtitle, characters, scene_tag, etc.
              id,
              image: existing.image,                   // preserve in-memory image payload (if any)
              imagePath: existing.imagePath,           // preserve saved image path
              status: existing.status || incoming.status || 'pending',
              mediaId: existing.mediaId,
              generatingStartedAt: existing.generatingStartedAt,
              image_size: existing.image_size,
            }
          })
        })
        console.log('[MCP] Scenes merged via HTTP:', (data.scenes || []).length)
      } else if (data.type === 'update-scene') {
        setScenes(prev => prev.map((s, i) => i === data.index ? { ...prev[i], ...data.fields } : s))
        console.log('[MCP] Scene', data.index, 'updated via HTTP')
      } else if (data.type === 'generate-reference') {
        console.log('[MCP] Generate reference requested:', data.index, 'style:', data.styleId)
        // styleId를 override로 직접 전달 — 전역 selectedStyleRefId 오염 없음, race 없음.
        window.__mcpGenerateRef?.(data.index, data.styleId)
      } else if (data.type === 'generate-scene') {
        console.log('[MCP] Generate scene requested:', data.sceneId, 'style:', data.styleId)
        window.__mcpGenerateScene?.(data.sceneId, data.styleId)
      } else if (data.type === 'open-project') {
        console.log('[MCP] Open project requested:', data.projectName)
        window.__mcpOpenProject?.(data.projectName)
      } else if (data.type === 'start-scene-batch') {
        console.log('[MCP] Scene batch generation start requested, styleId:', data.styleId, 'force:', data.force)
        window.__mcpStartBatch?.(data.styleId, data.force ? { force: true } : undefined)
      } else if (data.type === 'start-ref-batch') {
        console.log('[MCP] Reference batch generation start requested, styleId:', data.styleId, 'force:', data.force)
        window.__mcpStartRefBatch?.(data.styleId, data.force ? { force: true } : undefined)
      } else if (data.type === 'reload-project') {
        console.log('[MCP] Project reload requested')
      } else if (data.type === 'qa-progress') {
        window.__qaProgressUpdate?.(data)
        console.log('[MCP] QA progress:', data)
      }
    })
    return cleanup
  }, [])

  // 배치 핸들러 글로벌 등록 (handleStart 등이 정의된 이후에 등록)
  useEffect(() => {
    // Batch 핸들러: styleId를 정규화 후 override로만 직접 전달.
    // 전역 setSelectedStyleRefId는 호출하지 않음 — MCP 호출이 UI에 선택된 스타일을
    // 덮어쓰면 다음 호출/UI 동작에 누수됨. 호출별 스타일은 호출별로만 유효.
    //
    // scene batch styleId 의미 모델:
    //   - 'auto' (sentinel)         → 씬별 style_tag 매칭만 사용 (UI 자동 카드와 동일)
    //   - 명시 'ref:*' / 'preset:*' → 그 스타일을 모든 씬에 강제 적용
    //   - plain id (legacy)         → 'preset:'으로 wrap
    //   - 생략/null/''              → MCP default: 첫 style 카드 자동 fallback
    //                                 (자동화 호출자가 매번 styleId 명시 부담 줄임)
    //
    // ref batch는 씬 매칭 개념 자체가 없음 → 'auto' 토큰 미지원.
    // 생략 시 useReferenceGeneration._resolveEffectiveStyleId가 첫 카드 fallback 적용.
    // options = { force?: boolean } (선택). 없으면 handleStart 1-arg 호출 (백워드 호환).
    // options 있으면 handleStart(effective, options) — App.jsx의 handleStart가 force 등을 추출.
    window.__mcpStartBatch = (styleId, options) => {
      const callHandleStart = options
        ? (effective) => handleStart(effective, options)
        : (effective) => handleStart(effective)
      if (styleId === 'auto') {
        // 명시적 씬별 매칭 모드 — fallback 발동 안 함, useAutomation이 style_tag로만 결정
        callHandleStart(null)
        return
      }
      if (styleId === 'none') {
        // 'none' sentinel — pass through to handler. styleService.resolveSceneStyle recognizes
        // 'none' and skips auto-match, preset fallback, and override.
        callHandleStart('none')
        return
      }
      const effective = normalizeStyleId(styleId) ?? findAutoStyle(referencesRef.current)
      callHandleStart(effective)
    }
    // options = { force?: boolean } (선택). 없으면 handleGenerateAllRefs 1-arg 호출 (백워드 호환).
    window.__mcpStartRefBatch = (styleId, options) => {
      const callHandler = options
        ? (effective) => handleGenerateAllRefs(effective, options)
        : (effective) => handleGenerateAllRefs(effective)
      // 'auto'는 ref batch에 의미 없음 — null로 취급해 normalizeStyleId가 'preset:auto'로
      // 잘못 wrap하지 않도록 한다 (silent fail 회피).
      if (styleId === 'auto') {
        console.warn('[MCP] start-ref-batch received styleId="auto"; ignored (refs have no per-scene matching). Falling back as if styleId were omitted.')
        callHandler(null)
        return
      }
      if (styleId === 'none') {
        // 'none' sentinel — pass through. applyStyle recognizes 'none' and skips style application.
        callHandler('none')
        return
      }
      // scene batch와 동일하게 호출 측 fallback — UI selectedStyleRefId 누수 방지.
      const effective = normalizeStyleId(styleId) ?? findAutoStyle(referencesRef.current)
      callHandler(effective)
    }
    window.__mcpStopBatch = () => handleStop()
    window.__mcpBatchStatus = () => {
      const { isRunning, isPaused, progress, status, statusMessage } = automationState
      const total = scenes.length
      const done = scenes.filter(s => s.image || s.imagePath).length
      const pending = scenes.filter(s => s.status === 'pending').length
      const generating = scenes.filter(s => s.status === 'generating').length
      const error = scenes.filter(s => s.status === 'error').length

      // 레퍼런스 배치 상태
      const refTotal = references.filter(r => r.type !== 'style').length
      const refDone = references.filter(r => r.type !== 'style' && r.mediaId).length
      const refGenerating = generatingRefs.length
      const refPending = refTotal - refDone - refGenerating
      const refIsRunning = generatingRefs.length > 0

      return {
        isRunning: isRunning || videoAutomation.isRunning || refIsRunning,
        isPaused: isPaused || videoAutomation.isPaused,
        progress: isRunning ? progress : videoAutomation.progress,
        total, done, pending, generating, error,
        status: isRunning ? status : videoAutomation.status,
        statusMessage: isRunning ? statusMessage : videoAutomation.statusMessage,
        ref: { total: refTotal, done: refDone, generating: refGenerating, pending: refPending, isRunning: refIsRunning }
      }
    }
    return () => {
      delete window.__mcpStartBatch
      delete window.__mcpStartRefBatch
      delete window.__mcpStopBatch
      delete window.__mcpBatchStatus
    }
  }, [handleStart, handleStop, handleGenerateAllRefs, scenes, references, generatingRefs, automationState, videoAutomation])
}
