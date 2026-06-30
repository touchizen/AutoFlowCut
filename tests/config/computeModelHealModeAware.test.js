/**
 * computeModelHeal + computeModeSwitch combined-effects test
 *
 * 검증 대상:
 * (A) Flow 모드에서 videoModelF2V heal은 I2V-capable Flow 모델로 채워진다 (T2V 아님)
 * (B) 스테일 카탈로그 transient (loading=true) 동안 heal을 건너뜀 → 복원값 보존
 * (C) api→flow→api 라운드트립 후 원래 api imageModel/videoModelT2V/videoModelF2V 모두 보존
 * (D) API 모드 heal 불변: DEFAULT_IMAGE_MODEL_ID / DEFAULT_VIDEO_MODEL_ID 그대로
 */
import { describe, it, expect } from 'vitest'
import { computeModelHeal, computeModeSwitch, categorizeApiModels } from '../../src/config/genModels'
import { FLOW_STATIC_MODELS } from '../../src/engine/flowModels'

// --- Flow 모드 모델 카탈로그 (kind 로 split — 정적 Flow 목록) ---
const { imageModels: FLOW_IMAGE_MODELS, videoModels: FLOW_VIDEO_MODELS } = FLOW_STATIC_MODELS

// Flow 비디오 모델은 패밀리 단위(Omni Flash / Veo Lite·Fast·Quality) — t2v/i2v 구분이 없고
//   T2V/F2V 둘 다 같은 4개 패밀리에서 고른다. (이전엔 id 에 t2v/i2v 가 박혀 분리됐었다.)
const FLOW_VIDEO_IDS = FLOW_VIDEO_MODELS.map(m => m.id)
const FLOW_T2V_IDS = FLOW_VIDEO_IDS
const FLOW_I2V_IDS = FLOW_VIDEO_IDS

// --- API-mode 모델 카탈로그 (disjoint from Flow catalog) ---
const API_RAW_MODELS = [
  { id: 'gemini-2.5-flash-image', methods: ['generateContent'] },
  { id: 'gemini-3.1-flash-image', methods: ['generateContent'] },
  { id: 'veo-3.1-lite-generate-preview', methods: ['predictLongRunning'] },
  { id: 'veo-3.1-fast-generate-preview', methods: ['predictLongRunning'] },
  { id: 'veo-3.1-generate-preview', methods: ['predictLongRunning'] },
]
const { imageModels: API_IMAGE_MODELS, videoModels: API_VIDEO_MODELS } = categorizeApiModels(API_RAW_MODELS)

// Sentinel: Flow 카탈로그에 T2V ID와 I2V ID가 모두 있어야 테스트가 유효함
it('테스트 전제: Flow catalog에 T2V + I2V 모델이 모두 있음', () => {
  expect(FLOW_T2V_IDS.length).toBeGreaterThan(0)
  expect(FLOW_I2V_IDS.length).toBeGreaterThan(0)
})

describe('(A) Flow 모드 heal: stale API 비디오 모델 → Flow 패밀리로 채움', () => {
  it('API 모델 id 저장값을 Flow 패밀리(T2V·F2V 공통)로 heal 한다', () => {
    // API 모델 id가 저장된 채로 Flow 카탈로그로 heal
    const settings = {
      imageModel: 'gemini-3.1-flash-image',          // API 모델 (Flow catalog에 없음)
      videoModelT2V: 'veo-3.1-fast-generate-preview', // API 모델 (Flow catalog에 없음)
      videoModelF2V: 'veo-3.1-generate-preview',      // API 모델 (Flow catalog에 없음)
    }
    const flowAvailableModels = {
      imageModels: FLOW_IMAGE_MODELS,
      videoModels: FLOW_VIDEO_MODELS,
      loading: false,
      source: 'flow-static',
    }

    const heal = computeModelHeal(flowAvailableModels, settings, 'flow')

    // T2V·F2V 둘 다 Flow 패밀리 중 하나로 치유 (패밀리는 t2v/i2v 공통)
    expect(heal.videoModelT2V).toBeDefined()
    expect(FLOW_VIDEO_IDS).toContain(heal.videoModelT2V)
    expect(heal.videoModelF2V).toBeDefined()
    expect(FLOW_VIDEO_IDS).toContain(heal.videoModelF2V)
  })

  it('저장값이 이미 유효한 Flow 패밀리면 heal하지 않는다', () => {
    const settings = {
      imageModel: FLOW_IMAGE_MODELS[0]?.id,
      videoModelT2V: FLOW_VIDEO_IDS[0],
      videoModelF2V: FLOW_VIDEO_IDS[1],
    }
    const flowAvailableModels = {
      imageModels: FLOW_IMAGE_MODELS,
      videoModels: FLOW_VIDEO_MODELS,
      loading: false,
      source: 'flow-static',
    }
    const heal = computeModelHeal(flowAvailableModels, settings, 'flow')
    // 유효한 값이면 heal 없음 (videoModelF2V 변경 없음)
    expect(heal.videoModelF2V).toBeUndefined()
  })
})

describe('(B) Stale-catalog guard: loading=true 동안 heal 스킵', () => {
  it('availableModels.loading=true면 heal 반환값이 비어야 한다', () => {
    const settings = {
      imageModel: 'stale-image-model',
      videoModelT2V: 'stale-t2v-model',
      videoModelF2V: 'stale-f2v-model',
    }
    // loading=true인 상태 — stale catalog guard 조건
    const loadingAvailableModels = {
      imageModels: FLOW_IMAGE_MODELS,
      videoModels: FLOW_VIDEO_MODELS,
      loading: true,
    }
    const heal = computeModelHeal(loadingAvailableModels, settings, 'flow')
    // loading 중엔 heal을 수행하면 안 됨 → 빈 패치
    expect(Object.keys(heal)).toHaveLength(0)
  })

  it('loading=false면 정상 heal 수행', () => {
    const settings = {
      imageModel: 'stale-image-model',
      videoModelT2V: 'stale-t2v-model',
      videoModelF2V: 'stale-f2v-model',
    }
    const loadedAvailableModels = {
      imageModels: FLOW_IMAGE_MODELS,
      videoModels: FLOW_VIDEO_MODELS,
      loading: false,
    }
    const heal = computeModelHeal(loadedAvailableModels, settings, 'flow')
    // loading 완료 후엔 heal 수행 → imageModel 변경 있어야 함
    expect(heal.imageModel).toBeDefined()
  })

  it('loading 필드 없으면 정상 heal 수행 (undefined은 false처럼 처리)', () => {
    const settings = {
      imageModel: 'stale-image-model',
      videoModelT2V: 'stale-t2v-model',
      videoModelF2V: 'stale-f2v-model',
    }
    const loadedAvailableModels = {
      imageModels: FLOW_IMAGE_MODELS,
      videoModels: FLOW_VIDEO_MODELS,
      // loading 없음
    }
    const heal = computeModelHeal(loadedAvailableModels, settings, 'flow')
    // loading 없으면 heal 수행
    expect(heal.imageModel).toBeDefined()
  })
})

describe('(C) api→flow→api 라운드트립 후 api 모델 3개 모두 보존', () => {
  const API_IMG = 'gemini-3.1-flash-image'
  const API_T2V = 'veo-3.1-fast-generate-preview'
  const API_F2V = 'veo-3.1-generate-preview'

  it('라운드트립: 원래 api imageModel/videoModelT2V/videoModelF2V 모두 보존', () => {
    // 초기 API 설정
    const initialSettings = {
      imageModel: API_IMG,
      videoModelT2V: API_T2V,
      videoModelF2V: API_F2V,
    }

    // Step 1: api→flow 전환 (computeModeSwitch)
    const patch1 = computeModeSwitch(initialSettings, 'api', 'flow')
    let currentSettings = { ...initialSettings, ...patch1 }

    // Step 1b: Flow catalog heal (loading=false)
    const flowModelsLoaded = {
      imageModels: FLOW_IMAGE_MODELS,
      videoModels: FLOW_VIDEO_MODELS,
      loading: false,
    }
    const healInFlow = computeModelHeal(flowModelsLoaded, currentSettings, 'flow')
    currentSettings = { ...currentSettings, ...healInFlow }

    // Flow 모드에서 F2V는 I2V id여야 한다 (버그 A 검증)
    expect(FLOW_I2V_IDS).toContain(currentSettings.videoModelF2V)

    // Step 2: flow→api 전환 (computeModeSwitch) — api 기억에서 복원
    const patch2 = computeModeSwitch(currentSettings, 'flow', 'api')
    currentSettings = { ...currentSettings, ...patch2 }

    // api 기억에서 복원되어야 함
    expect(currentSettings.imageModel).toBe(API_IMG)
    expect(currentSettings.videoModelT2V).toBe(API_T2V)
    expect(currentSettings.videoModelF2V).toBe(API_F2V)

    // Step 3: API catalog heal (loading=false) — 유효한 값이므로 heal 없음
    const apiModelsLoaded = {
      imageModels: API_IMAGE_MODELS,
      videoModels: API_VIDEO_MODELS,
      loading: false,
    }
    const healInApi = computeModelHeal(apiModelsLoaded, currentSettings, 'api')
    currentSettings = { ...currentSettings, ...healInApi }

    // 원래 API 모델 3개 모두 보존 (api-invariance)
    expect(currentSettings.imageModel).toBe(API_IMG)
    expect(currentSettings.videoModelT2V).toBe(API_T2V)
    expect(currentSettings.videoModelF2V).toBe(API_F2V)
  })

  it('flow→api 복귀 직후 loading=true인 스테일 카탈로그 heal은 값을 덮어쓰지 않는다', () => {
    // api에서 flow로 전환했다가 바로 api로 복귀
    const initialSettings = {
      imageModel: API_IMG,
      videoModelT2V: API_T2V,
      videoModelF2V: API_F2V,
    }
    const patch1 = computeModeSwitch(initialSettings, 'api', 'flow')
    let currentSettings = { ...initialSettings, ...patch1 }

    // Flow heal로 모델이 바뀜
    const healInFlow = computeModelHeal(
      { imageModels: FLOW_IMAGE_MODELS, videoModels: FLOW_VIDEO_MODELS, loading: false },
      currentSettings,
      'flow',
    )
    currentSettings = { ...currentSettings, ...healInFlow }

    // flow→api 복귀 (api 기억 복원)
    const patch2 = computeModeSwitch(currentSettings, 'flow', 'api')
    currentSettings = { ...currentSettings, ...patch2 }

    // 이 시점에 api catalog가 아직 로딩 중 (stale Flow catalog + loading=true)
    const staleCatalogLoading = {
      imageModels: FLOW_IMAGE_MODELS, // 아직 이전 Flow 카탈로그
      videoModels: FLOW_VIDEO_MODELS,
      loading: true,
    }
    const staleHeal = computeModelHeal(staleCatalogLoading, currentSettings, 'api')
    currentSettings = { ...currentSettings, ...staleHeal }

    // stale heal이 건너뛰어야 함 → api 기억에서 복원된 값이 그대로
    expect(currentSettings.imageModel).toBe(API_IMG)
    expect(currentSettings.videoModelT2V).toBe(API_T2V)
    expect(currentSettings.videoModelF2V).toBe(API_F2V)
  })
})

describe('(D) API 모드 heal 불변: DEFAULT_IMAGE_MODEL_ID / DEFAULT_VIDEO_MODEL_ID 그대로', () => {
  it('API 모드 heal — 저장값이 없을 때 API 기본값으로 채움', () => {
    const settings = {
      imageModel: 'unknown-stale-img',
      videoModelT2V: 'unknown-stale-t2v',
      videoModelF2V: 'unknown-stale-f2v',
    }
    const apiModelsLoaded = {
      imageModels: API_IMAGE_MODELS,
      videoModels: API_VIDEO_MODELS,
      loading: false,
    }
    const heal = computeModelHeal(apiModelsLoaded, settings, 'api')
    // API default는 gemini-3.1-flash-image, veo-3.1-fast-generate-preview
    expect(heal.imageModel).toBe('gemini-3.1-flash-image')
    expect(heal.videoModelT2V).toBe('veo-3.1-fast-generate-preview')
    // F2V도 API 모드에선 T2V 기본값 (같은 비디오 카탈로그이므로)
    expect(heal.videoModelF2V).toBe('veo-3.1-fast-generate-preview')
  })

  it('Flow 모드 이미지 기본값 = Nano Banana 2 (라벨 매칭, 첫 항목이 아니어도)', () => {
    const flowImg = [
      { id: 'nano-pro', label: 'Nano Banana Pro', methods: ['generateContent'] },
      { id: 'nb2', label: 'Nano Banana 2', methods: ['generateContent'] },
    ]
    const out = computeModelHeal(
      { imageModels: flowImg, videoModels: FLOW_VIDEO_MODELS, loading: false },
      { imageModel: 'gemini-3.1-flash-image', videoModelT2V: FLOW_T2V_IDS[0], videoModelF2V: FLOW_I2V_IDS[0] },
      'flow',
    )
    expect(out.imageModel).toBe('nb2')   // 첫 항목(nano-pro) 아니라 Nano Banana 2
  })

  it('Flow 실제 스크랩 형태(id=value, 라벨에 🍌 이모지)에서도 Nano Banana 2 로 — Pro(첫 항목)로 안 떨어짐', () => {
    // 라이브 listFlowAgentModels: value='Nano Banana Pro'/'Nano Banana 2', label='🍌 Nano Banana N'
    const flowImg = [
      { id: 'Nano Banana Pro', label: '🍌 Nano Banana Pro', methods: ['generateContent'] },
      { id: 'Nano Banana 2', label: '🍌 Nano Banana 2', methods: ['generateContent'] },
    ]
    const out = computeModelHeal(
      { imageModels: flowImg, videoModels: FLOW_VIDEO_MODELS, loading: false },
      { imageModel: 'flow_image_generate', videoModelT2V: FLOW_T2V_IDS[0], videoModelF2V: FLOW_I2V_IDS[0] }, // 무효(정적 id)
      'flow',
    )
    expect(out.imageModel).toBe('Nano Banana 2')   // 재시작 시 Pro 로 안 떨어짐
  })

  it('Flow 모드 이미지: 저장값이 이미 유효하면 유지(기본값으로 강제 안 함)', () => {
    const flowImg = [
      { id: 'nano-pro', label: 'Nano Banana Pro', methods: ['generateContent'] },
      { id: 'nb2', label: 'Nano Banana 2', methods: ['generateContent'] },
    ]
    const out = computeModelHeal(
      { imageModels: flowImg, videoModels: FLOW_VIDEO_MODELS, loading: false },
      { imageModel: 'nano-pro', videoModelT2V: FLOW_T2V_IDS[0], videoModelF2V: FLOW_I2V_IDS[0] },
      'flow',
    )
    expect(out.imageModel).toBeUndefined()  // 변경 없음
  })

  it('API 모드 heal — mode 파라미터 없어도 기존 동작 유지 (하위 호환)', () => {
    const settings = {
      imageModel: 'unknown-stale-img',
      videoModelT2V: 'unknown-stale-t2v',
      videoModelF2V: 'unknown-stale-f2v',
    }
    const apiModelsLoaded = {
      imageModels: API_IMAGE_MODELS,
      videoModels: API_VIDEO_MODELS,
      loading: false,
    }
    // mode 파라미터 없이 호출 (기존 코드와 동일)
    const heal = computeModelHeal(apiModelsLoaded, settings)
    expect(heal.imageModel).toBe('gemini-3.1-flash-image')
    expect(heal.videoModelT2V).toBe('veo-3.1-fast-generate-preview')
    expect(heal.videoModelF2V).toBe('veo-3.1-fast-generate-preview')
  })
})

describe('(E) source 가드: 정적 폴백(Flow scrape 실패 등)은 heal하지 않는다', () => {
  it('Flow 스크랩 실패 폴백(source=static, FLOW_STATIC 카탈로그)은 저장된 동적 모델을 덮어쓰지 않는다', () => {
    // 시나리오: 이전 동적 스크랩으로 저장된 유효 Flow 모델 선택값을 가진 사용자.
    //   transient scrape 실패로 useAvailableModels가 FLOW_STATIC.{image,video}Models +
    //   source:'static'을 돌려준다. 이 정적 폴백 카탈로그에는 저장값이 없을 수 있다.
    //   reference-identity 가드(=== IMAGE_MODELS/VIDEO_MODELS)는 FLOW_STATIC을 못 걸러
    //   저장값을 폴백 id로 덮어썼다 → source 가드로 막아야 한다.
    const savedVideo = 'dynamic-only-i2v-id'  // 동적 스크랩에만 있던 id (정적 폴백엔 없음)
    const settings = {
      imageModel: 'dynamic-only-image-id',
      videoModelT2V: FLOW_T2V_IDS[0],
      videoModelF2V: savedVideo,
    }
    const flowStaticFallback = {
      imageModels: FLOW_IMAGE_MODELS,  // FLOW_STATIC.imageModels 와 동등 (≠ IMAGE_MODELS 참조)
      videoModels: FLOW_VIDEO_MODELS,
      loading: false,
      source: 'static',
    }
    const heal = computeModelHeal(flowStaticFallback, settings, 'flow')
    // 정적 폴백이므로 heal 없음 — 저장된 동적 선택값 보존
    expect(Object.keys(heal)).toHaveLength(0)
  })

  it('Flow 정적 목록(source=flow-static)은 권위 목록이라 stale API 모델을 Flow 모델로 heal 한다', () => {
    // 동적 스크랩 제거(2026-06-27) 후 Flow 는 항상 정적 FLOW_STATIC 목록(source:'flow-static')을 쓴다.
    //   이건 일시 폴백이 아니라 권위 목록 → 저장된 stale API 모델(gemini-*)을 Flow 모델로 치유해야
    //   한다(안 그러면 ModelSelector 가 stale 값을 옵션에 끼워 API 모델이 섞여 보인다).
    const settings = {
      imageModel: 'gemini-3.1-flash-image',  // API 모델 (Flow 목록에 없음)
      videoModelT2V: FLOW_T2V_IDS[0],
      videoModelF2V: FLOW_I2V_IDS[0],
    }
    const flowStatic = {
      imageModels: FLOW_IMAGE_MODELS,
      videoModels: FLOW_VIDEO_MODELS,
      loading: false,
      source: 'flow-static',
    }
    const heal = computeModelHeal(flowStatic, settings, 'flow')
    expect(heal.imageModel).toBe('Nano Banana 2')  // isNB2 기본값으로 치유
  })

  it('source=dynamic 인 Flow 카탈로그는 정상 heal한다', () => {
    const settings = {
      imageModel: 'stale-image-model',
      videoModelT2V: 'stale-t2v-model',
      videoModelF2V: 'stale-f2v-model',
    }
    const flowDynamic = {
      imageModels: FLOW_IMAGE_MODELS,
      videoModels: FLOW_VIDEO_MODELS,
      loading: false,
      source: 'dynamic',
    }
    const heal = computeModelHeal(flowDynamic, settings, 'flow')
    expect(heal.imageModel).toBeDefined()
  })

  it('mode=api 인데 stale flow-static 카탈로그면 heal하지 않는다 (모드 전환 중 복원값 보존)', () => {
    // Flow→API 전환 시 useAvailableModels 의 effect가 아직 mode 변경을 반영하지 못한
    //   렌더에서, heal effect 는 mode='api' + 직전 flow-static 카탈로그(stale)로 실행될 수 있다.
    //   이때 flow-static 을 권위로 보면 복원된 API 스냅샷을 Flow id 로 덮어쓴다 → 보존해야 한다.
    const settings = {
      imageModel: 'gemini-3.1-flash-image',           // 복원된 API 모델
      videoModelT2V: 'veo-3.1-fast-generate-preview', // 복원된 API 모델
      videoModelF2V: 'veo-3.1-fast-generate-preview', // 복원된 API 모델
    }
    const staleFlowStatic = {
      imageModels: FLOW_IMAGE_MODELS,
      videoModels: FLOW_VIDEO_MODELS,
      loading: false,
      source: 'flow-static',
    }
    const heal = computeModelHeal(staleFlowStatic, settings, 'api')
    expect(Object.keys(heal)).toHaveLength(0)
  })

  it('API 모드 정적 폴백(source=static, IMAGE_MODELS/VIDEO_MODELS)도 heal하지 않는다', () => {
    const settings = {
      imageModel: 'stale-image-model',
      videoModelT2V: 'stale-t2v-model',
      videoModelF2V: 'stale-f2v-model',
    }
    const apiStaticFallback = {
      imageModels: API_IMAGE_MODELS,
      videoModels: API_VIDEO_MODELS,
      loading: false,
      source: 'static',
    }
    const heal = computeModelHeal(apiStaticFallback, settings, 'api')
    expect(Object.keys(heal)).toHaveLength(0)
  })
})
