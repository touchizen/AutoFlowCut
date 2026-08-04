/**
 * useGenerationEngine — 생성 엔진 facade 진입점.
 * mode('api'|'flow')에 따라 어댑터를 선택해 통일 계약(§3.1)을 노출한다.
 *
 * M4: engineFlow 추가. mode==='flow'이면 Flow DOM 자동화 어댑터, 아니면 API 어댑터.
 * 두 훅 모두 무조건 호출 (React Hook 규칙).
 *
 * 반환: { mode, capabilities, ready, ...엔진 계약(§3.1.1) }
 */
import { useGenAPI } from '../hooks/useGenAPI'
import { parseRoute, sourceForStage } from '../config/appRoute.js'
import { createEngineApi } from './engineApi'
import { useFlowEngine } from './engineFlow'

const IMAGE_METHODS = [
  'generateImage', 'submitGeneration', 'checkGeneration', 'collectGeneration',
  'clearGenerations', 'uploadReference', 'upscaleImage',
]
const VIDEO_METHODS = [
  'generateVideoT2V', 'generateVideoI2V', 'checkVideoStatus',
  'downloadVideo', 'upscaleVideo',
]

export function createStageRoutedEngine(route, { api, flow }) {
  const parsed = parseRoute(route)
  if (!parsed) return api
  const member = (source) => ({ api, flow })[source]
  const image = member(sourceForStage(parsed, 'image'))
  const video = member(sourceForStage(parsed, 't2v'))
  const base = parsed.mode === 'api' ? api : flow
  const routed = { ...base }
  for (const method of IMAGE_METHODS) routed[method] = image[method]
  for (const method of VIDEO_METHODS) routed[method] = video[method]
  routed.getAccessToken = image.getAccessToken || base.getAccessToken
  routed.clearTokenCache = image.clearTokenCache || base.clearTokenCache
  routed.setStopRequested = image.setStopRequested || base.setStopRequested
  return routed
}

export function useGenerationEngine(modeOrRoute, genApiOptions = {}) {
  const genAPI = useGenAPI(genApiOptions)
  const engineApi = createEngineApi(genAPI)
  // 두 훅 모두 무조건 호출 (React Hook 규칙 — 조건부 호출 금지)
  // #R3-1: genApiOptions.getFlowProjectId (lazy getter) 또는 flowProjectId (static) 를 전달.
  // App 에서 flowProjectIdRef 를 통해 최신 바운드 id 를 제공한다.
  const engineFlow = useFlowEngine({ ...genApiOptions })
  const route = typeof modeOrRoute === 'string'
    ? { mode: modeOrRoute, sessionTarget: genApiOptions.sessionTarget || 'flow' }
    : modeOrRoute
  const parsed = parseRoute(route) || { mode: 'api', sessionTarget: 'flow' }
  const active = createStageRoutedEngine(parsed, {
    api: engineApi,
    flow: engineFlow,
  })
  return {
    mode: parsed.mode,
    capabilities: {
      needsFlowView: parsed.mode === 'flow',
      hasFlowArchive: parsed.mode === 'flow' && parsed.sessionTarget === 'flow',
    },
    ready: !!active.accessToken,  // 인증 준비됨(api='byok' truthy, flow=raw bearer truthy, null→false)
    ...active,
  }
}

export default useGenerationEngine
