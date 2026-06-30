/**
 * computeModeSwitch — 모드 전환 시 per-mode 모델 선택 스냅샷/복원 헬퍼 테스트
 *
 * 불변:
 * - api→flow: api 선택을 modelsByMode.api에 저장, flow 기억이 있으면 활성 필드에 복원
 * - flow→api: flow 선택을 modelsByMode.flow에 저장, api 기억이 있으면 복원
 * - round-trip api→flow→api: 양쪽 선택을 모두 보존 (서로 덮지 않음)
 * - 최초 전환(memory 없음): 현재 활성 값을 잃지 않음 (heal이 이후 채움)
 * - api 단독 사용자(전환 없음): modelsByMode 부재 시 동작 불변
 */
import { describe, it, expect } from 'vitest'
import { computeModeSwitch } from '../../src/config/genModels'

const API_IMG = 'gemini-3.1-flash-image'
const API_T2V = 'veo-3.1-fast-generate-preview'
const API_F2V = 'veo-3.1-generate-preview'
const FLOW_IMG = 'flow-image-model-1'
const FLOW_T2V = 'flow-video-t2v-1'
const FLOW_F2V = 'flow-video-f2v-1'

describe('computeModeSwitch', () => {
  it('api→flow: api 선택을 modelsByMode.api에 저장', () => {
    const settings = {
      imageModel: API_IMG,
      videoModelT2V: API_T2V,
      videoModelF2V: API_F2V,
    }
    const patch = computeModeSwitch(settings, 'api', 'flow')
    expect(patch.modelsByMode?.api).toEqual({
      imageModel: API_IMG,
      videoModelT2V: API_T2V,
      videoModelF2V: API_F2V,
    })
  })

  it('api→flow: flow 기억이 있으면 활성 필드에 복원', () => {
    const settings = {
      imageModel: API_IMG,
      videoModelT2V: API_T2V,
      videoModelF2V: API_F2V,
      modelsByMode: {
        flow: { imageModel: FLOW_IMG, videoModelT2V: FLOW_T2V, videoModelF2V: FLOW_F2V },
      },
    }
    const patch = computeModeSwitch(settings, 'api', 'flow')
    expect(patch.imageModel).toBe(FLOW_IMG)
    expect(patch.videoModelT2V).toBe(FLOW_T2V)
    expect(patch.videoModelF2V).toBe(FLOW_F2V)
  })

  it('api→flow: flow 기억이 없으면 활성 필드 변경 없음 (heal이 나중에 채움)', () => {
    const settings = {
      imageModel: API_IMG,
      videoModelT2V: API_T2V,
      videoModelF2V: API_F2V,
    }
    const patch = computeModeSwitch(settings, 'api', 'flow')
    expect('imageModel' in patch).toBe(false)
    expect('videoModelT2V' in patch).toBe(false)
    expect('videoModelF2V' in patch).toBe(false)
  })

  it('flow→api: flow 선택을 modelsByMode.flow에 저장 + api 기억 복원', () => {
    const settings = {
      imageModel: FLOW_IMG,
      videoModelT2V: FLOW_T2V,
      videoModelF2V: FLOW_F2V,
      modelsByMode: {
        api: { imageModel: API_IMG, videoModelT2V: API_T2V, videoModelF2V: API_F2V },
      },
    }
    const patch = computeModeSwitch(settings, 'flow', 'api')
    expect(patch.modelsByMode?.flow).toEqual({
      imageModel: FLOW_IMG,
      videoModelT2V: FLOW_T2V,
      videoModelF2V: FLOW_F2V,
    })
    expect(patch.imageModel).toBe(API_IMG)
    expect(patch.videoModelT2V).toBe(API_T2V)
    expect(patch.videoModelF2V).toBe(API_F2V)
  })

  it('round-trip api→flow→api: 원래 api 선택 보존 (서로 안 덮음)', () => {
    // Step 1: api→flow 전환
    const settingsApi = {
      imageModel: API_IMG,
      videoModelT2V: API_T2V,
      videoModelF2V: API_F2V,
    }
    const patch1 = computeModeSwitch(settingsApi, 'api', 'flow')
    // flow 상태로 진입 (flow 기억 없음 → 활성 필드 변경 없음, heal이 나중에 채움)
    // 사용자가 flow에서 다른 모델 선택했다고 가정
    const settingsInFlow = {
      ...settingsApi,
      ...patch1,
      imageModel: FLOW_IMG,
      videoModelT2V: FLOW_T2V,
      videoModelF2V: FLOW_F2V,
    }

    // Step 2: flow→api 복귀
    const patch2 = computeModeSwitch(settingsInFlow, 'flow', 'api')
    // api 기억에서 복원
    expect(patch2.imageModel).toBe(API_IMG)
    expect(patch2.videoModelT2V).toBe(API_T2V)
    expect(patch2.videoModelF2V).toBe(API_F2V)
    // flow 기억도 저장됨
    expect(patch2.modelsByMode?.flow).toEqual({
      imageModel: FLOW_IMG,
      videoModelT2V: FLOW_T2V,
      videoModelF2V: FLOW_F2V,
    })
  })

  it('round-trip api→flow→api: flow 선택도 보존 (api 복귀 시 flow 기억 손실 없음)', () => {
    const settingsApi = {
      imageModel: API_IMG,
      videoModelT2V: API_T2V,
      videoModelF2V: API_F2V,
    }
    const patch1 = computeModeSwitch(settingsApi, 'api', 'flow')
    const settingsInFlow = {
      ...settingsApi,
      ...patch1,
      imageModel: FLOW_IMG,
      videoModelT2V: FLOW_T2V,
      videoModelF2V: FLOW_F2V,
    }
    const patch2 = computeModeSwitch(settingsInFlow, 'flow', 'api')
    const settingsAfterReturn = { ...settingsInFlow, ...patch2 }
    // api→flow 재전환 시 flow 기억 복원
    const patch3 = computeModeSwitch(settingsAfterReturn, 'api', 'flow')
    expect(patch3.imageModel).toBe(FLOW_IMG)
    expect(patch3.videoModelT2V).toBe(FLOW_T2V)
    expect(patch3.videoModelF2V).toBe(FLOW_F2V)
  })

  it('최초 전환(memory 없음): 현재 활성 값을 패치에 포함시키지 않음 (잃지 않음)', () => {
    const settings = {
      imageModel: API_IMG,
      videoModelT2V: API_T2V,
      videoModelF2V: API_F2V,
      // modelsByMode 없음
    }
    const patch = computeModeSwitch(settings, 'api', 'flow')
    // 활성 필드 덮어쓰기 없음
    expect('imageModel' in patch).toBe(false)
    expect('videoModelT2V' in patch).toBe(false)
    expect('videoModelF2V' in patch).toBe(false)
    // 단, api 스냅샷은 저장됨
    expect(patch.modelsByMode?.api).toBeDefined()
  })

  it('prevMode === nextMode 면 빈 패치 반환 (noop)', () => {
    const settings = { imageModel: API_IMG, videoModelT2V: API_T2V, videoModelF2V: API_F2V }
    const patch = computeModeSwitch(settings, 'api', 'api')
    expect(patch).toEqual({})
  })

  it('api 단독 사용자 — modelsByMode 없어도 설정 불변 (additive, 읽기 경로 없음)', () => {
    // computeModeSwitch를 호출하지 않으면 modelsByMode는 설정에 없음 → 기존 동작 그대로
    const settings = { imageModel: API_IMG, videoModelT2V: API_T2V, videoModelF2V: API_F2V }
    // 단독 api 사용자는 이 함수를 호출하지 않으므로 settings 그대로
    expect(settings.imageModel).toBe(API_IMG)
    expect(settings.modelsByMode).toBeUndefined()
  })

  it('기존 modelsByMode 유지 — 스위치에 관계없는 다른 mode 기억 손실 없음', () => {
    const settings = {
      imageModel: FLOW_IMG,
      videoModelT2V: FLOW_T2V,
      videoModelF2V: FLOW_F2V,
      modelsByMode: {
        api: { imageModel: API_IMG, videoModelT2V: API_T2V, videoModelF2V: API_F2V },
        someOtherMode: { imageModel: 'x', videoModelT2V: 'y', videoModelF2V: 'z' },
      },
    }
    const patch = computeModeSwitch(settings, 'flow', 'api')
    // someOtherMode 보존
    expect(patch.modelsByMode?.someOtherMode).toEqual({ imageModel: 'x', videoModelT2V: 'y', videoModelF2V: 'z' })
  })
})
