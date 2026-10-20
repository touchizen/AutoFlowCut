/**
 * Flow 이미지 모델 목록 갱신(2026-10-20) 통합 테스트 — useAvailableModels(flow) → computeModelHeal (App.jsx 와 같은 경로).
 *
 * Flow 모델 메뉴(덤프 flow-dom-dump-20261020-143043)는 Pro · 2 Lite · 2.1 이고 "Nano Banana 2" 는 사라졌다.
 * 저장된 "Nano Banana 2" 로 배치를 돌리면 드라이버가 메뉴에서 못 찾아 flow-image-model-mismatch 로 멈췄다.
 * 설정 > 씬 목록은 세 모델을 보여 주고, 저장값 "Nano Banana 2" 는 2.1 로 치유돼야 한다.
 */
import { describe, it, expect } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { useAvailableModels } from '../../src/hooks/useAvailableModels'
import { computeModelHeal } from '../../src/config/genModels'

describe('Flow 이미지 모델 — Nano Banana 2 → 2.1 (통합)', () => {
  it('Flow 모드 옵션은 Pro · 2.1 · 2 Lite, 저장값 "Nano Banana 2" 는 2.1 로 치유된다', async () => {
    const { result } = renderHook(() => useAvailableModels({}, 'flow'))
    await waitFor(() => expect(result.current.loading).toBe(false))
    const available = result.current

    expect(available.source).toBe('flow-static')
    expect(available.imageModels.map((m) => m.id)).toEqual(['Nano Banana Pro', 'Nano Banana 2.1', 'Nano Banana 2 Lite'])

    const video = available.videoModels[0].id
    const heal = computeModelHeal(available, { imageModel: 'Nano Banana 2', videoModelT2V: video, videoModelF2V: video }, 'flow')
    expect(heal.imageModel).toBe('Nano Banana 2.1')
  })

  it('저장값이 Pro 나 2 Lite 면 그대로 둔다(사용자 선택 존중)', async () => {
    const { result } = renderHook(() => useAvailableModels({}, 'flow'))
    await waitFor(() => expect(result.current.loading).toBe(false))
    const video = result.current.videoModels[0].id
    for (const kept of ['Nano Banana Pro', 'Nano Banana 2 Lite']) {
      const heal = computeModelHeal(result.current, { imageModel: kept, videoModelT2V: video, videoModelF2V: video }, 'flow')
      expect(heal.imageModel).toBeUndefined()
    }
  })
})
