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
import { syncExplicitStyleId } from '../services/mcpStyle'
import { isSceneGenerationDone, isReferenceUploadedDone } from '../services/generationStatus'
import { clearedImageFields } from '../utils/refEntityRegistration'

/**
 * MCP load_csv(update-references) 병합. CSV 는 prompt/type/category 의 authoritative 소스지만,
 * 생성이 카드에 남긴 런타임 사실은 CSV 에 없다 — 여기서 보존하지 않으면 조용히 지워진다.
 * 스토리 파이프라인 W6/W7 QA 루프가 생성 도중 load_csv 를 부르므로 실제로 밟는 경로다.
 *
 *  - 이미지 포인터(data/filePath/mediaId/dataStorage/status/errorMessage): 지우면 배치 필터가
 *    모든 ref 를 재생성 대상으로 본다.
 *  - Flow entity 바인딩(entityId/workflowId/registered/flowNameSyncStatus): 지우면 @멘션이 끊기고
 *    사용자가 Ref 탭에서 다시 동기화해야 한다.
 *  - styleId/generatedAt: 지우면 카드가 "레거시(미기록)"로 되돌아가 재생성이 전역 스타일로 샌다.
 *    null("무스타일로 생성됨")과 undefined("기록 없음")는 다른 뜻이라 키째 보존한다.
 */
export function mergeReferencesPreservingRuntime(prev, incomingRefs) {
  const byName = new Map((prev || []).map(r => [r.name, r]))
  // load_csv 는 {name,type,category,prompt} 만 보낸다 — incoming 에 id 가 없다. 보존하지 않으면
  //   모든 ref 의 id 가 undefined 가 되어, styleId:'ref:N' 이 가리킬 스타일 카드를 못 찾고
  //   (조용히 무스타일 생성) ReferencePanel 의 id 기반 갱신이 모든 ref 에 매칭된다.
  //   씬 병합(R9)이 이미 같은 이유로 id:matched.id 를 유지한다.
  let maxId = (prev || []).reduce((max, r) => (typeof r?.id === 'number' && r.id > max ? r.id : max), 0)
  const freshId = () => (maxId += 1)
  return (incomingRefs || []).map(incoming => {
    const existing = incoming.name ? byName.get(incoming.name) : null
    // 매칭된 카드는 소비한다 — CSV 에 같은 이름이 두 번 나오면 두 행이 같은 id 와 같은 런타임
    //   필드를 복제받아, ReferencePanel 의 id 기반 갱신이 두 카드를 동시에 건드린다(씬 병합 R15).
    if (existing) byName.delete(incoming.name)
    // incoming.id 는 신뢰하지 않는다 — 매칭 카드가 이미 쓰는 id 와 충돌할 수 있고, 유일한
    //   in-repo 생산자(load_csv)는 애초에 id 를 보내지 않는다.
    if (!existing) return { ...incoming, id: freshId() }
    return {
      ...incoming,                      // CSV-authoritative: prompt, type, category, caption(if in CSV)
      id: existing.id,                  // 기존 stable id 유지 (incoming.id 무시 — 씬 병합 R9 와 동일)
      data: existing.data,              // preserve runtime-generated image payload
      filePath: existing.filePath,      // preserve saved image path
      mediaId: existing.mediaId,        // preserve uploaded Flow mediaId
      dataStorage: existing.dataStorage,
      status: existing.status,          // preserve generation status
      errorMessage: existing.errorMessage,
      entityId: existing.entityId,      // preserve Flow character entity binding
      workflowId: existing.workflowId,
      registered: existing.registered,
      flowNameSyncStatus: existing.flowNameSyncStatus,
      styleId: existing.styleId,        // preserve which style this card was generated with
      // CSV 에 없는 생성 시각. 떨어뜨리면 inheritStyleIdFromCards 의 '가장 최근 카드' 선택이 tie 되고
      //   resolveImageSrc 의 ?v= 캐시 키가 바뀌어 이미지가 불필요하게 재디코딩된다.
      generatedAt: existing.generatedAt,
    }
  })
}


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
  srtTrack = [], setSrtTrack = null,
  handleGenerateRef, handleGenerateScene,
  handleGenerateAllRefs, handleStart, handleStop,
  handleProjectChange, handleExportConfirm, handleExportPremiere,
  selectedStyleRefId, setSelectedStyleRefId,
  refreshReviews, audioReviews,
  importByPath, audioPackage,
  automationState, videoAutomation, generatingRefs,
  isRunning = false,  // Phase 2: 진행 중 MCP batch 호출 시 auto stop-restart 트리거 (anyRunning 등 권장)
  refBatchRunning = false  // ref batch가 preparing/stopping/generating 어느 단계든 true (P1 fix)
}) {
  // 글로벌 핸들러는 mount 시 한 번만 등록되므로 closure가 stale —
  // 호출 시점의 최신 references가 필요한 곳(MCP 자동 fallback 등)은 ref로 접근.
  const referencesRef = useRef(references)
  useEffect(() => { referencesRef.current = references }, [references])

  // Phase 2: isRunning을 ref로 mirror — global 핸들러 closure가 polling 시 최신 값 읽음.
  const isRunningRef = useRef(isRunning)
  useEffect(() => { isRunningRef.current = isRunning }, [isRunning])

  // handleStop도 ref로 mirror — closure가 stale 안 되게.
  const handleStopRef = useRef(handleStop)
  useEffect(() => { handleStopRef.current = handleStop }, [handleStop])

  // handleStart/handleGenerateAllRefs도 ref로 mirror — Phase 2 auto stop-restart에서
  // 같은 __mcpStartBatch 호출의 await가 끝난 뒤 호출되는데, 그 사이 re-render로 handleStart가
  // 새로 만들어지지만 closure는 옛 버전을 잡고 있음. 옛 버전은 stale `isRunning=true`를 들고
  // 있어서 첫 줄 가드에 막혀 restart fail. ref로 항상 최신 handleStart를 부르도록 한다.
  const handleStartRef = useRef(handleStart)
  useEffect(() => { handleStartRef.current = handleStart }, [handleStart])
  const handleGenerateAllRefsRef = useRef(handleGenerateAllRefs)
  useEffect(() => { handleGenerateAllRefsRef.current = handleGenerateAllRefs }, [handleGenerateAllRefs])

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
    window.__mcpGetReferences = () => references.map(({ data, ...rest }) => ({
      ...rest,
      hasData: !!data,
      ready: isReferenceUploadedDone({ ...rest, data }),
    }))
    window.__mcpGetScenes = () => scenes.map(({ image, videoT2V, videoI2V, ...rest }) => rest)
    // styleId override를 직접 받음 (전역 상태 setSelectedStyleRefId + setTimeout race 회피).
    // styleId 형식은 normalizeStyleId로 정규화됨 ('ref:*' / 'preset:*' / plain → 'preset:*' / null).
    // 'auto' sentinel은 ref 컨텍스트에 의미 없음 (씬 매칭 부재) — caller-side fallback만 사용.
    //
    // styleId 생략 시 호출 측에서 findAutoStyle fallback을 미리 적용해 override로 전달.
    // 그래야 useReferenceGeneration 내부의 selectedStyleRefId(UI 선택값)에 끌려가지 않음 —
    // MCP 정책: 자동화 호출은 UI 상태와 독립적이어야 함.
    window.__mcpGenerateRef = (index, styleId) => {
      if (styleId === 'auto') {
        console.warn('[MCP] generate-reference received styleId="auto"; ignored (refs have no per-scene matching). Falling back as if styleId were omitted.')
        const effective = findAutoStyle(referencesRef.current) ?? 'none'
        return handleGenerateRef(index, false, effective).catch(e => ({ success: false, error: e.message }))
      } else if (styleId === 'none') {
        // 'none' sentinel — pass through to handler. styleService.applyStyle/_resolveEffectiveStyleId
        // recognize 'none' and skip all style application (prompt + ref override).
        return handleGenerateRef(index, false, 'none').catch(e => ({ success: false, error: e.message }))
      }
      const effective = normalizeStyleId(styleId) ?? findAutoStyle(referencesRef.current) ?? 'none'
      return handleGenerateRef(index, false, effective).catch(e => ({ success: false, error: e.message }))
    }
    // styleId override (선택). 형식은 styleService와 동일.
    //   - 'auto' / 'none' / null / undefined / '': 그대로 forward (sentinel 의미 보존)
    //   - 'ref:*' / 'preset:*': 그대로 forward
    //   - plain id (예: 'noir'): normalizeStyleId가 'preset:noir'로 wrap (다른 MCP path와 일관).
    //     안 하면 applyStyle()이 prefix 없는 id를 인식 못 해서 조용히 스타일 미적용 회귀.
    window.__mcpGenerateScene = (sceneId, styleId) => {
      if (styleId === 'auto' || styleId === 'none' || styleId == null || styleId === '') {
        return handleGenerateScene(sceneId, styleId)
      }
      const normalized = normalizeStyleId(styleId) ?? styleId
      return handleGenerateScene(sceneId, normalized)
    }
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
        const exportResult = await handleExportConfirm(exportOptions)
        if (exportResult?.success === false) return exportResult
        return { success: true, path: exportResult?.targetPath || capcutProjectNumber }
      } catch (e) {
        return { success: false, error: e.message }
      }
    }
    window.__mcpExportPremiere = async (options = {}) => {
      try {
        // 0. audioPackage가 없으면 자동 로드
        if (!audioPackage && options.audioFolderPath) {
          const pkg = await importByPath(options.audioFolderPath)
          if (!pkg) console.warn('[MCP Export] Audio import failed, continuing without audio')
        }
        // 1. 출력 폴더 경로 결정 (capcutProjectNumber 재사용 = .prproj 를 쓸 폴더).
        //    명시 안 하면 CapCut 경로 자동 감지를 그대로 사용한다.
        let capcutProjectNumber = options.capcutProjectNumber
        if (!capcutProjectNumber) {
          const pathResult = await window.electronAPI?.detectCapcutPath?.()
          if (!pathResult?.success) return { success: false, error: 'Output path not detected' }
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
        // 3. handleExportPremiere 호출
        const exportResult = await handleExportPremiere(exportOptions)
        if (exportResult?.success === false) return exportResult
        return { success: true, path: exportResult?.targetPath || capcutProjectNumber }
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
      delete window.__mcpExportPremiere
    }
  }, [references, scenes, handleGenerateRef, handleGenerateScene, selectedStyleRefId, refreshReviews, audioReviews, handleExportConfirm, handleExportPremiere, importByPath, audioPackage])

  // MCP HTTP 서버에서 오는 데이터 업데이트 수신
  useEffect(() => {
    const cleanup = window.electronAPI?.onMcpUpdate?.((data) => {
      if (data.type === 'update-references') {
        setReferences(prev => mergeReferencesPreservingRuntime(prev, data.references))
        console.log('[MCP] References merged via HTTP:', data.references.length)
      } else if (data.type === 'update-reference') {
        // #R37: fields 가 새 이미지(data/filePath)를 실어오면 옛 Flow entity 를 함께 비운다 —
        //   안 그러면 이미지는 새것인데 entityId 는 옛 캐릭터를 가리켜, 이후 Sync 가 repair 로 빠져
        //   새 이미지를 영영 안 올리고 옛 얼굴로 @멘션된다(UI 교체 경로 #R31-3 와 동일 정책).
        const bringsNewImage = data.fields && ('data' in data.fields || 'filePath' in data.fields)
        const entityReset = bringsNewImage && !data.fields.entityId
          ? { entityId: null, workflowId: null, registered: null, flowNameSyncStatus: null }
          : {}
        setReferences(prev => prev.map((ref, i) => i === data.index ? { ...prev[i], ...data.fields, ...entityReset } : ref))
        console.log('[MCP] Reference', data.index, 'updated via HTTP')
      } else if (data.type === 'remove-reference') {
        setReferences(prev => prev.filter((_, i) => i !== data.index))
        console.log('[MCP] Reference', data.index, 'removed via HTTP')
      } else if (data.type === 'clear-reference-image') {
        // #R37: Flow entity 필드도 함께 비운다 — 안 그러면 이미지 없는 ref 가 옛 entityId 를 들고 남아
        //   Sync 가 옛 entity 를 다시 등록한다(UI 의 '이미지 제거' 와 동일 정책).
        setReferences(prev => prev.map((ref, i) => i === data.index ? { ...ref, ...clearedImageFields() } : ref))
        console.log('[MCP] Reference', data.index, 'image cleared via HTTP')
      } else if (data.type === 'clear-all-reference-images') {
        setReferences(prev => prev.map(ref => ({ ...ref, ...clearedImageFields() })))
        console.log('[MCP] All reference images cleared via HTTP')
      } else if (data.type === 'update-scenes') {
        // Merge incoming CSV/API rows over existing in-memory scenes by id so
        // runtime fields (image, imagePath, status, mediaId, generatingStartedAt)
        // survive a CSV reload. Without this merge, load_csv during W6/W7 wipes
        // generated-image pointers and a subsequent batch treats every scene as
        // pending → full regeneration of an entire episode (ep4 sat-fire).
        setScenes(prev => {
          const byId = new Map(prev.map(s => [s.id, s]))
          // R9 review fix: incoming._sceneNum 우선 매칭 (renderer parseFromCSV
          // 와 같은 전략). MCP bundler 가 매번 scene_1/2 새 id 부여하므로 id 만
          // 으로 매칭하면 reorder/insert 시 generated image 가 엉뚱한 prompt 에
          // 붙음. _sceneNum 매칭 → id fallback → index fallback 순.
          const byNum = new Map()
          prev.forEach(s => { if (s._sceneNum != null) byNum.set(s._sceneNum, s) })
          const prevHasSceneNums = byNum.size > 0
          // R15 review fix: result 의 id 가 유니크해야 React key/state 가 깨지지
          // 않음. taken 추적 — 이미 prev 에 있거나 result 에 이미 할당된 id 와
          // 충돌하면 fresh scene_N 할당.
          // R18 review fix: freshId 는 monotonic — gap 재사용 안 함. prev + incoming
          // 의 max scene_N + 1 부터 시작 (useScenes 의 stable id 정책과 일관).
          const taken = new Set(prev.map(s => s.id))
          let maxSceneN = 0
          const incomingScenes = data.scenes || []
          for (const s of prev) {
            const m = /^scene_(\d+)$/.exec(s.id || '')
            if (m) {
              const n = parseInt(m[1], 10)
              if (n > maxSceneN) maxSceneN = n
            }
          }
          for (const s of incomingScenes) {
            const m = /^scene_(\d+)$/.exec(s.id || '')
            if (m) {
              const n = parseInt(m[1], 10)
              if (n > maxSceneN) maxSceneN = n
            }
          }
          let nextFreshN = maxSceneN + 1
          const freshId = () => {
            while (taken.has(`scene_${nextFreshN}`)) nextFreshN++
            const fid = `scene_${nextFreshN}`
            nextFreshN++
            return fid
          }
          return (data.scenes || []).map((incoming, i) => {
            const incomingId = incoming.id || `scene_${i + 1}`
            // R11 review fix: prev 에 _sceneNum 있고 incoming 도 가지면 byNum 만
            // 신뢰. MCP bundler 가 매번 scene_N 새 id 부여 → byId fallback 하면
            // 새 _sceneNum 의 incoming 이 옛 id 와 충돌해 엉뚱한 image 가 붙음.
            // _sceneNum 가 어느 쪽이라도 없으면 옛 동작 (id → index) 유지 (legacy 호환).
            let matched
            if (prevHasSceneNums && incoming._sceneNum != null) {
              matched = byNum.get(incoming._sceneNum) || null
            } else {
              matched = byId.get(incomingId) || (prevHasSceneNums ? null : prev[i])
            }
            // R15: 한 prev 가 두 incoming 에 매칭되면 두번째는 fresh id 필요.
            // 매칭 즉시 maps 에서 제거해 다음 incoming 이 동일 prev 재매칭 못 하게.
            if (matched) {
              byId.delete(matched.id)
              if (matched._sceneNum != null) byNum.delete(matched._sceneNum)
            }
            if (!matched) {
              // R18 review fix: prev 비어있으면 (첫 로드) incoming.id 신뢰 (충돌만
              // 회피). prev 가 있으면 unmatched 는 stable-id 정책상 항상 monotonic
              // fresh id — gap (예: prev=[scene_1, scene_3] 에 새 scene 들어왔을
              // 때 scene_2 재사용) 금지. useScenes 의 in-session-monotonic 정책과
              // 일관.
              let assignedId
              if (prev.length === 0) {
                assignedId = taken.has(incomingId) ? freshId() : incomingId
              } else {
                assignedId = freshId()
              }
              taken.add(assignedId)
              return { ...incoming, id: assignedId, status: incoming.status || 'pending' }
            }
            // matched: matched.id 는 prev 에서 왔으니 이미 taken — 중복 체크 불필요
            taken.add(matched.id)
            // Issue #2 parity: CSV 재적용이 Done 씬(이미지 보유)의 프롬프트를 바꾸면 재생성 대상이
            //   되도록 pending 으로 되돌린다. load_csv 는 에이전트가 per-row status 를 표현할 수 없어
            //   여기서 규칙을 적용(updateScene / .txt import 와 동일). 프롬프트 불변이면 matched.status
            //   보존(ep4 sat-fire 가드 — 안 바뀐 Done 행을 pending 으로 덮지 않음).
            const csvPromptChanged = incoming.prompt !== matched.prompt
            const matchedHasImage = !!(matched.image || matched.imagePath)
            const mergedStatus = (csvPromptChanged && matchedHasImage)
              ? 'pending'
              : (matched.status || incoming.status || 'pending')
            return {
              ...incoming,                             // CSV-authoritative: prompt, subtitle, characters, scene_tag, etc.
              id: matched.id,                          // R9 fix: 기존 stable id 유지 (incoming.id 무시)
              image: matched.image,                    // preserve in-memory image payload (if any)
              imagePath: matched.imagePath,            // preserve saved image path
              status: mergedStatus,
              mediaId: matched.mediaId,
              generatingStartedAt: matched.generatingStartedAt,
              image_size: matched.image_size,
              donePrompt: matched.donePrompt,          // 생성 기준 스냅샷 — 되돌림 done 복원 유지
              // C9 fix: incoming 이 srtLineIds 안 보내면 기존 보존
              srtLineIds: incoming.srtLineIds ?? matched.srtLineIds ?? [],
            }
          })
        })
        // Phase 11: MCP 가 srtTrack 동봉 시 함께 적용 (새 형식 CSV 경로용)
        if (Array.isArray(data.srtTrack) && setSrtTrack) {
          setSrtTrack(data.srtTrack)
          console.log('[MCP] srtTrack synced via HTTP:', data.srtTrack.length)
        }
        console.log('[MCP] Scenes merged via HTTP:', (data.scenes || []).length)
      } else if (data.type === 'update-srt-track') {
        // Phase 11: 자막 트랙만 갱신하고 싶을 때
        if (Array.isArray(data.srtTrack) && setSrtTrack) {
          setSrtTrack(data.srtTrack)
          console.log('[MCP] srtTrack replaced via HTTP:', data.srtTrack.length)
        }
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

  // Phase 2: 진행 중 batch 호출 시 사용 — isRunning이 false가 될 때까지 polling.
  // timeout 시 false 반환 (caller가 restart abort).
  const waitForStopped = (timeoutMs = 30000, intervalMs = 50) => new Promise((resolve) => {
    if (!isRunningRef.current) { resolve(true); return }
    const startTs = Date.now()
    const timer = setInterval(() => {
      if (!isRunningRef.current) {
        clearInterval(timer)
        resolve(true)
      } else if (Date.now() - startTs > timeoutMs) {
        clearInterval(timer)
        resolve(false)
      }
    }, intervalMs)
  })

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
    // options = { force?: boolean } (선택). App.jsx가 MCP caller를 구분할 수 있게
    // options 유무와 관계없이 source:'mcp'를 합쳐 handleStart(effective, options)로 호출한다.
    //
    // Phase 2: 진행 중이면 자동 stop → waitForStopped → start. 확인 모달 없음 (MCP 자동화 의도 명확).
    // timeout 시 restart abort, console.warn.
    //
    // Phase 2 sync: 명시 styleId ('preset:*', 'ref:*', plain id)면 selectedStyleRefId도 갱신
    // → Start 버튼 라벨이 새 스타일 자동 표시. 'auto'/'none'/생략은 UI 유지 (사용자 의도 보존).
    window.__mcpStartBatch = async (styleId, options) => {
      // ref로 항상 최신 handleStart 호출 — stop 후 stale `isRunning=true` 가드에 막히는 회귀 방지.
      const callHandleStart = effective => handleStartRef.current?.(effective, {
        ...(options || {}),
        source: 'mcp',
      })
      const resolveEffective = () => {
        if (styleId === 'auto') return null
        if (styleId === 'none') return 'none'
        return normalizeStyleId(styleId) ?? findAutoStyle(referencesRef.current)
      }

      syncExplicitStyleId(styleId, { normalizeStyleId, setSelectedStyleRefId })

      if (isRunningRef.current) {
        handleStopRef.current?.()
        const stopped = await waitForStopped()
        if (!stopped) {
          console.warn('[MCP] start-scene-batch: stop timeout (30s), aborting restart')
          return
        }
      }
      callHandleStart(resolveEffective())
    }
    // options = { force?: boolean } (선택). 없으면 handleGenerateAllRefs 1-arg 호출 (백워드 호환).
    // Phase 2: 진행 중이면 자동 stop → waitForStopped → start.
    // Phase 2 sync: 명시 styleId면 selectedStyleRefId 갱신 (UI 라벨).
    window.__mcpStartRefBatch = async (styleId, options) => {
      // ref로 항상 최신 handleGenerateAllRefs — stop-restart 후 stale closure 가드 회귀 방지.
      const callHandler = options
        ? (effective) => handleGenerateAllRefsRef.current?.(effective, options)
        : (effective) => handleGenerateAllRefsRef.current?.(effective)
      const resolveEffective = () => {
        // 'auto'는 ref batch에 의미 없음 — null로 취급해 normalizeStyleId가 'preset:auto'로
        // 잘못 wrap하지 않도록 한다 (silent fail 회피). usable auto style 이 없으면
        // 'none'을 넘겨 UI selectedStyleRefId 로 fallback하지 않게 한다.
        if (styleId === 'auto') {
          console.warn('[MCP] start-ref-batch received styleId="auto"; ignored (refs have no per-scene matching). Falling back as if styleId were omitted.')
          return findAutoStyle(referencesRef.current) ?? 'none'
        }
        if (styleId === 'none') return 'none'
        return normalizeStyleId(styleId) ?? findAutoStyle(referencesRef.current) ?? 'none'
      }

      syncExplicitStyleId(styleId, { normalizeStyleId, setSelectedStyleRefId })

      if (isRunningRef.current) {
        handleStopRef.current?.()
        const stopped = await waitForStopped()
        if (!stopped) {
          console.warn('[MCP] start-ref-batch: stop timeout (30s), aborting restart')
          return
        }
      }
      callHandler(resolveEffective())
    }
    window.__mcpStopBatch = () => handleStop()
    window.__mcpBatchStatus = () => {
      const { isRunning, isPaused, progress, status, statusMessage } = automationState
      // P2/P3 v2/v3: done 판정은 services/generationStatus의 공통 helper 사용.
      // status가 in-flight (pending/generating/error)면 image/mediaId 있어도 done에서 제외 —
      // force 재생성 중 progress가 100% stuck 회귀 차단.
      const total = scenes.length
      const done = scenes.filter(isSceneGenerationDone).length
      const pending = scenes.filter(s => s.status === 'pending').length
      const generating = scenes.filter(s => s.status === 'generating').length
      const error = scenes.filter(s => s.status === 'error').length

      // 레퍼런스 배치 상태 — total/done 은 같은 모집단(refEligible)에서 계산해
      // done ⊆ total 을 보장한다 (prompt 없는 수동 업로드 ref 가 done 만 키우는 모순 차단).
      const refEligible = references.filter(r => r.prompt)
      const refTotal = refEligible.length
      const refDone = refEligible.filter(isReferenceUploadedDone).length
      const refGenerating = generatingRefs.length
      const refPending = Math.max(0, refTotal - refDone - refGenerating)
      // refBatchRunning prop은 preparing/stopping/generating 모두 포함 — P1 회귀 가드.
      // generatingRefs.length만 보면 preparingRefs 구간에 isRunning이 false로 평가돼서
      // 중복 batch 진행 가능 (auto stop-restart 우회).
      const refIsRunning = refBatchRunning || generatingRefs.length > 0

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
  }, [handleStart, handleStop, handleGenerateAllRefs, scenes, references, generatingRefs, automationState, videoAutomation, refBatchRunning])
}
