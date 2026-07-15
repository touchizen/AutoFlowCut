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
import { createEngineApi } from './engineApi'
import { useFlowEngine } from './engineFlow'

export function useGenerationEngine(mode, genApiOptions) {
  const genAPI = useGenAPI(genApiOptions)
  const engineApi = createEngineApi(genAPI)
  // 두 훅 모두 무조건 호출 (React Hook 규칙 — 조건부 호출 금지)
  // #R3-1: genApiOptions.getFlowProjectId (lazy getter) 또는 flowProjectId (static) 를 전달.
  // App 에서 flowProjectIdRef 를 통해 최신 바운드 id 를 제공한다.
  const engineFlow = useFlowEngine({ ...genApiOptions })
  const active = mode === 'flow' ? engineFlow : engineApi
  return {
    mode,
    capabilities: {
      needsFlowView: mode === 'flow',   // 분할뷰/WebContentsView (M3/M5)
      hasFlowArchive: mode === 'flow',  // 아카이브 버튼 게이팅 (M5)
    },
    ready: !!active.accessToken,  // 인증 준비됨(api='byok' truthy, flow=raw bearer truthy, null→false)
    ...active,
    // M4 agent video는 앱 UI mode와 무관하게 공식 GenAI/BYOK 경로를 쓴다. renderer admission이
    // 이 참조를 내부 context에만 넣으며 Tool args에는 엔진 선택 표면을 열지 않는다.
    agentVideoEngine: engineApi,
  }
}

export default useGenerationEngine
