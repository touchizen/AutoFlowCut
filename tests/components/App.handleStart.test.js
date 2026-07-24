/**
 * App.handleStart — force=true + requireStyle 가드 회귀 테스트
 *
 * 회귀 컨텍스트 (P3):
 *   handleStart의 requireStyle 가드는 styleResolver.autoAvailable (filterPendingScenes 기반)을 본다.
 *   모든 씬이 done인 프로젝트에서 MCP가 `app_start_scene_batch({ styleId: 'auto', force: true })`
 *   호출하면 autoAvailable=false로 평가되어 StylePicker 띄우고 return → 자동화 차단.
 *
 *   고침 (P3 v2): force=true면 force 대상(전체 prompt 씬) 기준으로 autoAvailable 재계산.
 *   requireStyle 의미 보존 (force=true + auto + 매칭 없음은 여전히 가드 발동).
 *
 *   가드 보조 로직은 src/services/startGuard.js의 computeGuardAvailable로 추출되어 있다.
 *   이 테스트는 실제 코드(import한 함수)를 호출 — App.jsx의 인라인 복제가 아님.
 */

import { describe, it, expect, vi } from 'vitest'
import {
  computeGuardAvailable,
  isStartBlocked,
  runOuterStartAuthPreflight,
  shouldStopRefWork,
} from '../../src/services/startGuard'

describe('runOuterStartAuthPreflight — provider-aware hook preflight 위임', () => {
  it('API 모드에서는 provider 없는 Google 기본 토큰 조회를 실행하지 않는다', async () => {
    const getAccessToken = vi.fn()

    await expect(runOuterStartAuthPreflight({ appMode: 'api', getAccessToken })).resolves.toBe(true)
    expect(getAccessToken).not.toHaveBeenCalled()
  })

  it('Flow 모드에서는 기존 Flow 인증 preflight를 유지한다', async () => {
    const getAccessToken = vi.fn().mockResolvedValue('flow-token')

    await expect(runOuterStartAuthPreflight({ appMode: 'flow', getAccessToken })).resolves.toBe(true)
    expect(getAccessToken).toHaveBeenCalledOnce()
    expect(getAccessToken).toHaveBeenCalledWith(false, true)
  })

  it('Flow 인증 실패는 시작을 중단시킨다', async () => {
    const getAccessToken = vi.fn().mockResolvedValue(null)

    await expect(runOuterStartAuthPreflight({ appMode: 'flow', getAccessToken })).resolves.toBe(false)
  })
})

// handleStop 이 ref 작업을 중단할지 — 진리표로 고정한다.
//
// 왜 술어로 뺐나: 이 판정은 App.jsx 안에 인라인이었고 테스트는 가드의 소스 문자열을 통째로
// 핀했다. 그 계기는 `||` → `&&` 뮤턴트를 잡긴 하지만, 의미가 같은 정상 리팩터(피연산자 순서
// 교환, 헬퍼 추출, 줄바꿈)에도 깨진다. 정상 리팩터에 깨지는 테스트는 사람을 "느슨하게 풀도록"
// 훈련시키고, 그게 애초에 이 버그가 들어온 경로였다.
//
// 결정적 케이스는 (refBatchRunning=false, gatePhase='busy') → 중단해야 함이다. 큐 대기와
// 아이템별 auth preflight 에서 lifecycle flag 가 전부 false 인데 gate 는 busy 인 그 창 —
// 옛 `if (refBatchRunning)` 가드에서 Stop 이 떠 있는 채 무반응이던 바로 그 상태다.
describe('shouldStopRefWork — handleStop 의 ref 중단 판정', () => {
  it.each([
    [true, null, true, 'ref 배치가 실제로 돌고 있음'],
    [true, 'busy', true, '둘 다 참'],
    [false, 'busy', true, '⭐ lifecycle flag 빈틈(큐 대기/아이템 preflight) — && 뮤턴트가 여기서 죽는다'],
    [false, 'confirm', false, '사용자가 아직 고르는 중 — 중단할 ref 작업 없음'],
    [false, 'failure', false, '이미 끝나고 실패 모달 — 중단할 것 없음'],
    [false, null, false, 'gate 도 배치도 없음'],
  ])('refBatchRunning=%s gatePhase=%s → %s (%s)', (refBatchRunning, gatePhase, expected) => {
    expect(shouldStopRefWork({ refBatchRunning, gatePhase })).toBe(expected)
  })

  it('gate 가 없어도(undefined) 안전하다', () => {
    expect(shouldStopRefWork({ refBatchRunning: false, gatePhase: undefined })).toBe(false)
    expect(shouldStopRefWork({ refBatchRunning: true, gatePhase: undefined })).toBe(true)
  })
})

describe('computeGuardAvailable — handleStart requireStyle 가드 헬퍼 (P3)', () => {
  // App.jsx case 'text'/'list'의 가드 분기를 재현하는 wrapper.
  // 실제로는 import한 computeGuardAvailable이 핵심 의사결정. 이 wrapper는 그걸 호출.
  const guardAlgo = ({ force, targetScenes, references, autoAvailable, previewStyleMatchingFn,
                      requireStyle, effectiveStyleId, setShowStylePicker }) => {
    const guardAvailable = computeGuardAvailable({
      force, targetScenes, references, autoAvailable, previewStyleMatchingFn,
    })
    if (requireStyle && !effectiveStyleId) {
      if (!guardAvailable) {
        setShowStylePicker(true)
        return true  // aborted
      }
    }
    return false
  }

  it('force=false: autoAvailable=false → picker 띄우고 abort (기존 동작)', () => {
    const setShowStylePicker = vi.fn()
    const aborted = guardAlgo({
      force: false,
      targetScenes: [],  // 안 쓰임
      references: [],
      autoAvailable: false,
      previewStyleMatchingFn: vi.fn(),  // force=false 경로라 호출 안 됨
      requireStyle: true,
      effectiveStyleId: null,
      setShowStylePicker,
    })
    expect(aborted).toBe(true)
    expect(setShowStylePicker).toHaveBeenCalledWith(true)
  })

  it('force=false: autoAvailable=true → 통과', () => {
    const setShowStylePicker = vi.fn()
    const aborted = guardAlgo({
      force: false,
      targetScenes: [],
      references: [],
      autoAvailable: true,
      previewStyleMatchingFn: vi.fn(),
      requireStyle: true,
      effectiveStyleId: null,
      setShowStylePicker,
    })
    expect(aborted).toBe(false)
    expect(setShowStylePicker).not.toHaveBeenCalled()
  })

  it('force=true: previewStyleMatching matches.length > 0 → 통과 (autoAvailable=false 무시)', () => {
    const setShowStylePicker = vi.fn()
    const previewStyleMatchingFn = vi.fn(() => ({ matches: [{ sceneId: '1', styleName: 'noir' }] }))
    const targetScenes = [{ id: '1', prompt: 'p', style_tag: 'noir' }]
    const aborted = guardAlgo({
      force: true,
      targetScenes,
      references: [{ id: 'noir', type: 'style' }],
      autoAvailable: false,  // styleResolver 기준은 false지만 force 재계산은 true
      previewStyleMatchingFn,
      requireStyle: true,
      effectiveStyleId: null,
      setShowStylePicker,
    })
    expect(aborted).toBe(false)
    expect(setShowStylePicker).not.toHaveBeenCalled()
    // force 경로는 force 대상 기준 재계산 → previewStyleMatchingFn 호출
    expect(previewStyleMatchingFn).toHaveBeenCalledWith(targetScenes, expect.any(Array))
  })

  it('force=true: matches.length === 0 → 여전히 picker 띄우고 abort (requireStyle 의미 보존)', () => {
    // 회귀 가드: force=true가 requireStyle를 우회하지 않는다. 매칭 없으면 가드 발동.
    const setShowStylePicker = vi.fn()
    const previewStyleMatchingFn = vi.fn(() => ({ matches: [] }))
    const aborted = guardAlgo({
      force: true,
      targetScenes: [{ id: '1', prompt: 'p', style_tag: '' }],
      references: [],
      autoAvailable: false,
      previewStyleMatchingFn,
      requireStyle: true,
      effectiveStyleId: null,
      setShowStylePicker,
    })
    expect(aborted).toBe(true)
    expect(setShowStylePicker).toHaveBeenCalledWith(true)
  })

  it("effectiveStyleId='none': 가드 미적용 (명시 무스타일 허용)", () => {
    // 'none' sentinel은 truthy라 `!effectiveStyleId` 조건 통과 안 함 → 가드 fire 안 됨
    const setShowStylePicker = vi.fn()
    const aborted = guardAlgo({
      force: true,
      targetScenes: [],
      references: [],
      autoAvailable: false,
      previewStyleMatchingFn: vi.fn(() => ({ matches: [] })),
      requireStyle: true,
      effectiveStyleId: 'none',  // ← 명시 무스타일
      setShowStylePicker,
    })
    expect(aborted).toBe(false)
    expect(setShowStylePicker).not.toHaveBeenCalled()
  })

  it('requireStyle=false: 가드 미적용', () => {
    const setShowStylePicker = vi.fn()
    const aborted = guardAlgo({
      force: false,
      targetScenes: [],
      references: [],
      autoAvailable: false,
      previewStyleMatchingFn: vi.fn(),
      requireStyle: false,  // ← off
      effectiveStyleId: null,
      setShowStylePicker,
    })
    expect(aborted).toBe(false)
    expect(setShowStylePicker).not.toHaveBeenCalled()
  })
})

describe('computeGuardAvailable — pure function direct tests', () => {
  it('force=true without previewStyleMatchingFn throws (caller bug guard)', () => {
    expect(() => computeGuardAvailable({ force: true, targetScenes: [], references: [], autoAvailable: false }))
      .toThrow('previewStyleMatchingFn required')
  })

  it('force=false ignores previewStyleMatchingFn (uses autoAvailable directly)', () => {
    const fn = vi.fn()
    expect(computeGuardAvailable({ force: false, targetScenes: [], references: [], autoAvailable: true, previewStyleMatchingFn: fn })).toBe(true)
    expect(fn).not.toHaveBeenCalled()
  })

  it('force=true delegates to previewStyleMatchingFn', () => {
    const fn = vi.fn(() => ({ matches: [{ sceneId: 's1', styleName: 'x' }, { sceneId: 's2', styleName: 'y' }] }))
    const targetScenes = [{ id: 's1' }, { id: 's2' }]
    const references = [{ id: 'x', type: 'style' }]
    expect(computeGuardAvailable({ force: true, targetScenes, references, autoAvailable: false, previewStyleMatchingFn: fn })).toBe(true)
    expect(fn).toHaveBeenCalledWith(targetScenes, references)
  })
})

describe('isStartBlocked — handleStart entry guard', () => {
  it.each([
    ['scene automation', { isRunning: true }],
    ['video automation', { videoRunning: true }],
    ['pending batch latch', { hasPendingBatch: true }],
    ['video retry', { retryInFlight: true }],
    ['Ref batch', { refBatchRunning: true }],
  ])('%s가 진행 중이면 시작을 차단한다', (_label, overrides) => {
    expect(isStartBlocked({
      isRunning: false,
      videoRunning: false,
      hasPendingBatch: false,
      retryInFlight: false,
      refBatchRunning: false,
      ...overrides,
    })).toBe(true)
  })

  it('모든 실행/latch 신호가 false면 통과한다', () => {
    expect(isStartBlocked({
      isRunning: false,
      videoRunning: false,
      hasPendingBatch: false,
      retryInFlight: false,
      refBatchRunning: false,
    })).toBe(false)
  })

  it('개별 씬 생성만으로는 Start를 차단하지 않는다', () => {
    expect(isStartBlocked({
      isRunning: false,
      videoRunning: false,
      hasPendingBatch: false,
      retryInFlight: false,
      refBatchRunning: false,
      generatingSceneId: 'scene-1',
    })).toBe(false)
  })
})
