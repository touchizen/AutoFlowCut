/**
 * useAutomation — retryErrors 가드 회귀 테스트
 *
 * 회귀 컨텍스트:
 *   App.jsx 의 "에러 재시도" 버튼이 `onClick={retryErrors}` 로 직접 바인딩 되어
 *   있어서 React SyntheticEvent 가 `options` 인자 자리에 들어갔다. 그 결과
 *   `start({...event, sceneIndices})` 호출에서 projectName 이 누락 → start() 가
 *   'Untitled' 로 폴백 → 새 이미지 저장이 다른 프로젝트로 잘못 가서 데이터
 *   손실(Lighthouse Keeper 의 image/project.json 미갱신) 발생.
 *
 *   고침: (1) App.jsx 버튼은 옵션을 명시적으로 전달, (2) retryErrors 자체도
 *   SyntheticEvent 누수 가드를 둠.
 */

import { describe, it, expect, vi } from 'vitest'

describe('retryErrors 가드 (SyntheticEvent 누수 방지)', () => {
  // retryErrors 의 핵심 알고리즘만 재현 (가드 + sceneIndices 계산 + start 호출)
  // 실 코드: src/hooks/useAutomation.js retryErrors
  //
  // 가드 정책: SyntheticEvent 흔적 감지 시 옵션을 비우는 대신 **즉시 return**.
  // 이유: 옵션만 비우고 start() 로 넘기면 start() 가 'Untitled' 로 폴백 →
  // 데이터 손실 경로가 그대로 살아있다 (절반-방어). 호출자 버그는 명시적으로
  // abort 하고 console.warn 으로 surface 하는 게 안전하다.
  const retryErrorsAlgo = async ({ scenes, start, options = {} }) => {
    if (options && typeof options.preventDefault === 'function') {
      return
    }
    const errorIndices = scenes
      .map((s, i) => s.status === 'error' ? i : -1)
      .filter(i => i !== -1)
    if (errorIndices.length === 0) return
    await start({ ...options, sceneIndices: errorIndices })
  }

  it('SyntheticEvent 가 options 자리에 들어오면 start 호출 안 함 (early return)', async () => {
    const start = vi.fn().mockResolvedValue(undefined)
    const scenes = [
      { id: 'scene_1', status: 'done' },
      { id: 'scene_2', status: 'error' },
      { id: 'scene_3', status: 'error' },
    ]
    // React SyntheticEvent 모방
    const fakeEvent = {
      preventDefault: () => {},
      stopPropagation: () => {},
      target: { tagName: 'BUTTON' },
      currentTarget: { tagName: 'BUTTON' },
    }

    await retryErrorsAlgo({ scenes, start, options: fakeEvent })

    // 가드는 abort — start() 가 호출되면 그 안에서 'Untitled' 폴백을 타게 되어
    // 데이터 손실 경로가 살아있다. 가드의 핵심은 start 자체를 막는 것.
    expect(start).not.toHaveBeenCalled()
  })

  it('정상 옵션은 그대로 통과 (가드가 옵션 객체엔 영향 없음)', async () => {
    const start = vi.fn().mockResolvedValue(undefined)
    const scenes = [
      { id: 'scene_1', status: 'error' },
      { id: 'scene_2', status: 'done' },
    ]
    const opts = {
      projectName: 'The Lighthouse Keeper',
      saveMode: 'folder',
      imageBatchCount: 1,
      imageUpscale: 'off',
      selectedStyleRefId: null,
      seed: 12345,
    }

    await retryErrorsAlgo({ scenes, start, options: opts })

    const callArgs = start.mock.calls[0][0]
    expect(callArgs.projectName).toBe('The Lighthouse Keeper')
    expect(callArgs.saveMode).toBe('folder')
    expect(callArgs.seed).toBe(12345)
    expect(callArgs.sceneIndices).toEqual([0])
  })

  it('error 씬 0개면 start 호출 안 함', async () => {
    const start = vi.fn().mockResolvedValue(undefined)
    const scenes = [
      { id: 'scene_1', status: 'done' },
      { id: 'scene_2', status: 'pending' },
    ]

    await retryErrorsAlgo({ scenes, start, options: { projectName: 'X' } })

    expect(start).not.toHaveBeenCalled()
  })

  it('error 씬 인덱스만 정확히 추출 (혼합 status)', async () => {
    const start = vi.fn().mockResolvedValue(undefined)
    const scenes = [
      { id: 'scene_1', status: 'done' },
      { id: 'scene_2', status: 'error' },     // → 1
      { id: 'scene_3', status: 'pending' },
      { id: 'scene_4', status: 'error' },     // → 3
      { id: 'scene_5', status: 'generating' },
      { id: 'scene_6', status: 'error' },     // → 5
    ]

    await retryErrorsAlgo({ scenes, start, options: { projectName: 'X' } })

    expect(start.mock.calls[0][0].sceneIndices).toEqual([1, 3, 5])
  })

  it('SyntheticEvent 의 다른 필드 (persist 등) 도 새어 들어가지 않음 (early return)', async () => {
    // SyntheticEvent 의 어떤 필드가 옵션 키와 우연히 매치돼도 start() 자체가 호출
    // 안 되므로 충돌 경로가 원천 차단된다. 가드는 detect → abort 모델.
    const start = vi.fn().mockResolvedValue(undefined)
    const scenes = [{ id: 'scene_1', status: 'error' }]
    const fakeEvent = {
      preventDefault: () => {},
      persist: () => {},
    }

    await retryErrorsAlgo({ scenes, start, options: fakeEvent })

    expect(start).not.toHaveBeenCalled()
  })
})
