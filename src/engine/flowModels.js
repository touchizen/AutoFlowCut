/**
 * flowModels.js — Flow 모드용 정적 모델 목록.
 *
 * Flow UI는 자체 모델 목록 IPC가 없으므로, engineFlow.listModels()는
 * 이 정적 목록을 반환한다. FLOW_MODELS는 categorizeApiModels(rawModels)가
 * 기대하는 flat array 형태 — 각 항목에 methods 필드를 포함한다.
 *
 * categorizeApiModels 술어:
 *   - 이미지: methods.includes('generateContent') && /image/i.test(id) && !/imagen/i.test(id)
 *   - 비디오: methods.includes('predictLongRunning') || /^veo/i.test(id)
 *
 * 모델 id는 Flow/Touchizen이 사용하는 내부 enum 값을 그대로 사용.
 * label은 genModels.js의 VIDEO_MODELS와 동일 레벨 표기를 따름.
 */

/**
 * FLOW_MODELS — engineFlow.listModels()가 반환하는 flat array.
 * categorizeApiModels(FLOW_MODELS) 호출로 { imageModels, videoModels }를 얻는다.
 *
 * 각 항목 shape:
 *   { id, label, methods, cost?, unit?, allowedResolutions? }
 *
 * - 이미지: id에 'image' 포함 + methods=['generateContent'] → isImage 술어 통과
 * - 비디오: id가 'veo'로 시작 + methods=['predictLongRunning'] → isVideo 술어 통과
 */
import { VEO_RES_HD, VEO_RES_HD_4K } from '../utils/videoModels'

// id 는 Flow "에이전트 설정" 패널의 표시 이름(display name)을 그대로 쓴다 — applyAgentDefaults
//   setModel 이 norm(패널 텍스트).includes(norm(id)) 로 매칭하고(이모지/아이콘 prefix 는 norm 이
//   제거), OmniFlash 길이 감지(/omni.?flash/)도 id 로 한다. 분류는 /image/ 술어 대신 명시적
//   kind 필드로 한다(FLOW_STATIC_MODELS) — 표시 이름엔 'image' 가 없어 술어로는 못 거른다.
//   ⚠️ 모델 목록은 동적 스크랩(Flow UI drift 로 panel_not_found)을 버리고 이 정적 목록을 쓴다.
//   라이브 확인(2026-06-27 Cmd+Shift+E 덤프) 기준 현재 Flow 모델.
export const FLOW_MODELS = [
  // ── 이미지 모델 (Flow 에이전트 설정 '이미지 생성 기본값' 드롭다운) ──
  { id: 'Nano Banana Pro', label: 'Nano Banana Pro', displayName: 'Nano Banana Pro', kind: 'image', methods: ['generateContent'], cost: null, unit: 'image' },
  { id: 'Nano Banana 2',   label: 'Nano Banana 2',   displayName: 'Nano Banana 2',   kind: 'image', methods: ['generateContent'], cost: null, unit: 'image' },

  // ── 비디오 모델 (Flow 에이전트 설정 '동영상 생성 기본값' 드롭다운) ──
  //   Flow 는 비디오 모델을 "패밀리" 단위로 고르고(Omni Flash / Veo 3.1 Lite·Fast·Quality), t2v vs i2v
  //   는 시작이미지 유무로 Flow 가 자동 결정한다. 그래서 T2V/F2V 설정 둘 다 이 4개 패밀리에서 고른다.
  //   id=표시 이름(applyAgentDefaults setModel 매칭 + OmniFlash 길이 감지 /omni.?flash/).
  //   ⚠️ i2v 주입(injectI2VBody)은 Flow 요청의 videoModelKey(예 abra_t2v_8s)로 변환하지 이 id 에
  //   의존하지 않는다. 패밀리별 정확한 해상도 한계·OmniFlash i2v 키·duration 주입은 비디오(이슈4)
  //   세션에서 보강. allowedResolutions 는 보수적 기본값(확정 전).
  {
    id: 'Omni Flash',
    label: 'Omni Flash',
    displayName: 'Omni Flash',
    kind: 'video',
    methods: ['predictLongRunning'],
    cost: null,
    unit: 'sec',
    allowedResolutions: VEO_RES_HD,
  },
  {
    id: 'Veo 3.1 - Lite',
    label: 'Veo 3.1 - Lite',
    displayName: 'Veo 3.1 - Lite',
    kind: 'video',
    methods: ['predictLongRunning'],
    cost: null,
    unit: 'sec',
    allowedResolutions: VEO_RES_HD,
  },
  {
    id: 'Veo 3.1 - Fast',
    label: 'Veo 3.1 - Fast',
    displayName: 'Veo 3.1 - Fast',
    kind: 'video',
    methods: ['predictLongRunning'],
    cost: null,
    unit: 'sec',
    allowedResolutions: VEO_RES_HD_4K,
  },
  {
    id: 'Veo 3.1 - Quality',
    label: 'Veo 3.1 - Quality',
    displayName: 'Veo 3.1 - Quality',
    kind: 'video',
    methods: ['predictLongRunning'],
    cost: null,
    unit: 'sec',
    allowedResolutions: VEO_RES_HD_4K,
  },
]

// Flow 정적 모델 목록 — kind 로 분류(표시 이름 기반 id 라 /image/ 술어를 못 쓴다).
//   useAvailableModels 의 Flow 폴백/정적 목록이 이걸 그대로 쓴다.
export const FLOW_STATIC_MODELS = {
  imageModels: FLOW_MODELS.filter((m) => m.kind === 'image'),
  videoModels: FLOW_MODELS.filter((m) => m.kind === 'video'),
}

export default FLOW_MODELS
