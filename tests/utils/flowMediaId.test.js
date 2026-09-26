/**
 * isFlowMediaId — App handleVideoRetry · useVideoAutomation Phase 0 · videoRecovery #R34-1 · flow-rpc-protocol [3][0][0] 이 공유하는 Flow 미디어 id 모양(UUID) 술어 (M2-R5 J2)
 */
import { describe, it, expect } from 'vitest'
import { isFlowMediaId, isLegacyFlowGenerationFailure } from '../../src/utils/flowMediaId'

describe('isFlowMediaId — UUID 모양만 Flow 미디어 id', () => {
  it('UUID(대소문자·양끝 공백 허용)는 true', () => {
    expect(isFlowMediaId('0f3b9c1e-5d2a-4b7c-8e9f-0a1b2c3d4e5f')).toBe(true)
    expect(isFlowMediaId('0F3B9C1E-5D2A-4B7C-8E9F-0A1B2C3D4E5F')).toBe(true)
    expect(isFlowMediaId(' 00000011-0000-4000-8000-000000000000 ')).toBe(true)
  })
  it('API operation 이름·대시 없는 hex·마스크 토큰·빈 값·비문자열은 false', () => {
    for (const v of ['models/veo-3.1-fast-generate-preview/operations/op1', '0f3b9c1e5d2a4b7c8e9f0a1b2c3d4e5f', '<uuid#11>', 'gen-1', 'g1', '', null, undefined, 42, {}]) {
      expect(isFlowMediaId(v), String(v)).toBe(false)
    }
  })
  // M2-R6 K5(B4): 위 음성 케이스엔 UUID 가 **안에 든** 값이 없어 `^…$` 앵커를 지워도 초록이었다. 앵커 없는 규칙이면 파서가 UUID 를 품은 어떤 [3][0][0] 이든 과금 id 로 받고
  //   훅·App·복구가 `…/operations/<uuid>` 를 Flow 과금 항목으로 다룬다. 통째로 UUID 인 값만(양끝 공백은 trim) true.
  it('UUID 가 안에 든 값(operation 이름 뒤·앞뒤 글자·경로 안)은 false — 앵커 핀 (M2-R6 K5)', () => {
    const G = '0f3b9c1e-5d2a-4b7c-8e9f-0a1b2c3d4e5f'
    for (const v of ['models/veo-3.1-fast-generate-preview/operations/' + G, G + 'x', 'x' + G, 'projects/' + G + '/x', G + ' ' + G]) {
      expect(isFlowMediaId(v), v).toBe(false)
    }
    expect(isFlowMediaId(G)).toBe(true)
  })
})

// M2-R5 J3(B2): 옛 서버측 생성 실패 행(Flow 정책/위험 필터 문구가 error 에 그대로, kind 없음, 미디어 없음) — 과금된 in-flight 가 아니다.
describe('isLegacyFlowGenerationFailure — 넷 다 맞아야 true(errorKind null · error PUBLIC_ERROR_* · mediaId null · videoPath 없음)', () => {
  const G = '0f3b9c1e-5d2a-4b7c-8e9f-0a1b2c3d4e5f'
  const legacy = { status: 'error', error: 'PUBLIC_ERROR_DANGER_FILTER', errorKind: null, generationId: G, mediaId: null, videoPath: null }
  it('사용자 실데이터 모양 → true (errorKind 가 undefined 여도)', () => {
    expect(isLegacyFlowGenerationFailure(legacy)).toBe(true)
    expect(isLegacyFlowGenerationFailure({ ...legacy, errorKind: undefined, videoPath: undefined })).toBe(true)
    expect(isLegacyFlowGenerationFailure({ ...legacy, error: 'PUBLIC_ERROR_PROMINENT_PEOPLE_FILTER' })).toBe(true)
  })
  it('kind 가 있거나 · 문구가 PUBLIC_ERROR_ 로 시작하지 않거나 · mediaId 가 있거나 · videoPath 가 있으면 false; null/비객체도 false', () => {
    expect(isLegacyFlowGenerationFailure({ ...legacy, errorKind: 'flow-video-not-found' })).toBe(false)
    expect(isLegacyFlowGenerationFailure({ ...legacy, error: 'Stopped by user' })).toBe(false)
    expect(isLegacyFlowGenerationFailure({ ...legacy, error: 'x PUBLIC_ERROR_DANGER_FILTER' })).toBe(false)
    expect(isLegacyFlowGenerationFailure({ ...legacy, error: null })).toBe(false)
    expect(isLegacyFlowGenerationFailure({ ...legacy, mediaId: G })).toBe(false)
    expect(isLegacyFlowGenerationFailure({ ...legacy, videoPath: '/proj/videos/t2v_1.mp4' })).toBe(false)
    expect(isLegacyFlowGenerationFailure(null)).toBe(false)
    expect(isLegacyFlowGenerationFailure(undefined)).toBe(false)
  })
})
