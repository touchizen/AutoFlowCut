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
  const retryErrorsAlgo = async ({ scenes, start, options = {} }) => {
    if (options && typeof options.preventDefault === 'function') {
      options = {}
    }
    const errorIndices = scenes
      .map((s, i) => s.status === 'error' ? i : -1)
      .filter(i => i !== -1)
    if (errorIndices.length === 0) return
    await start({ ...options, sceneIndices: errorIndices })
  }

  it('SyntheticEvent 가 options 자리에 들어와도 무시 (회귀 회피)', async () => {
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

    expect(start).toHaveBeenCalledTimes(1)
    const callArgs = start.mock.calls[0][0]
    // 가드가 SyntheticEvent 를 비웠으면 target/currentTarget 이 spread 되지 않음
    expect(callArgs.target).toBeUndefined()
    expect(callArgs.currentTarget).toBeUndefined()
    // sceneIndices 만 정상적으로 들어감
    expect(callArgs.sceneIndices).toEqual([1, 2])
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

  it('start() 가 호출될 때 projectName 폴백 가능성을 차단 (가드 후 통과)', async () => {
    // 시나리오: SyntheticEvent 가 들어오면 options 가 비워져서 start({sceneIndices})
    // 만 호출됨. 호출자가 따로 projectName 을 넘기지 않으면 start() 안에서 'Untitled'
    // 폴백 경고가 나오게 되어있음 (실 코드 useAutomation.js start()). 가드의 책임은
    // 적어도 SyntheticEvent 의 잡다한 필드가 옵션으로 새지 않도록 하는 것.
    const start = vi.fn().mockResolvedValue(undefined)
    const scenes = [{ id: 'scene_1', status: 'error' }]
    const fakeEvent = {
      preventDefault: () => {},
      // SyntheticEvent 의 다른 필드가 옵션처럼 보일 위험: e.g. event.persist
      persist: () => {},
      // imageBatchCount 같은 키가 우연히 매치될 가능성 — 가드는 객체 자체를 비워
      // 이런 충돌 경로를 원천 차단해야 함
    }

    await retryErrorsAlgo({ scenes, start, options: fakeEvent })

    const callArgs = start.mock.calls[0][0]
    expect(callArgs.persist).toBeUndefined()  // SyntheticEvent 필드 누수 없음
    expect(Object.keys(callArgs)).toEqual(['sceneIndices'])  // sceneIndices 만 남음
  })
})
