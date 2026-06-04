/**
 * useScenes hook — video*Disabled 플래그 CSV 재파싱 보존
 *
 * 새 CSV 형식(scene 컬럼 있음)으로 재import 할 때
 * videoI2VDisabled / videoT2VDisabled 런타임 플래그가 유지되는지 확인한다.
 *
 * NOTE: SRT 경로는 {...scene} spread 로 자동 보존되므로 여기서는 테스트하지 않는다.
 * 오직 CSV new-format merge 경로의 allowlist만 검증한다.
 */
import { describe, it, expect, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useScenes } from '../../src/hooks/useScenes'

vi.mock('../../src/hooks/useFileSystem', () => ({
  fileSystemAPI: {
    readFileByPath: vi.fn().mockResolvedValue({ success: false }),
  },
}))

// scene 컬럼이 있는 새 형식 CSV → isNewSceneCSVFormat() === true 분기로 진입
const CSV_V1 = `scene,prompt,subtitle,start_time,end_time
1,"PromptA","자막1",0,3
2,"PromptB","자막2",3,6`

// 프롬프트만 살짝 바꾼 재import용 CSV (씬 수/구조 동일)
const CSV_V2 = `scene,prompt,subtitle,start_time,end_time
1,"PromptA-Refined","자막1",0,3
2,"PromptB-Refined","자막2",3,6`

describe('useScenes — video*Disabled 플래그 CSV 재파싱 보존', () => {
  it('videoI2VDisabled 설정 후 CSV 재파싱 → 보존', () => {
    const { result } = renderHook(() => useScenes())

    // 1. 초기 import
    act(() => { result.current.parseFromCSV(CSV_V1) })
    const id = result.current.scenes[0].id

    // 2. 런타임 플래그 + videoI2VPath 설정
    act(() => {
      result.current.updateScene(id, {
        videoI2VPath: '/mock/clip.mp4',
        videoI2VDisabled: true,
      })
    })
    expect(result.current.scenes[0].videoI2VDisabled).toBe(true)

    // 3. CSV 재import (→ new-format merge 경로 진입)
    act(() => { result.current.parseFromCSV(CSV_V2) })

    // 플래그가 보존돼야 함
    expect(result.current.scenes[0].videoI2VDisabled).toBe(true)
  })

  it('videoT2VDisabled 설정 후 CSV 재파싱 → 보존', () => {
    const { result } = renderHook(() => useScenes())

    act(() => { result.current.parseFromCSV(CSV_V1) })
    const id = result.current.scenes[1].id

    act(() => {
      result.current.updateScene(id, {
        videoT2VPath: '/mock/clip2.mp4',
        videoT2VDisabled: true,
      })
    })
    expect(result.current.scenes[1].videoT2VDisabled).toBe(true)

    act(() => { result.current.parseFromCSV(CSV_V2) })

    expect(result.current.scenes[1].videoT2VDisabled).toBe(true)
  })

  it('두 플래그 모두 설정 후 CSV 재파싱 → 둘 다 보존', () => {
    const { result } = renderHook(() => useScenes())

    act(() => { result.current.parseFromCSV(CSV_V1) })
    const id = result.current.scenes[0].id

    act(() => {
      result.current.updateScene(id, {
        videoI2VDisabled: true,
        videoT2VDisabled: true,
      })
    })

    act(() => { result.current.parseFromCSV(CSV_V2) })

    expect(result.current.scenes[0].videoI2VDisabled).toBe(true)
    expect(result.current.scenes[0].videoT2VDisabled).toBe(true)
  })

  it('플래그 미설정(undefined) 씬은 재파싱 후에도 undefined', () => {
    const { result } = renderHook(() => useScenes())

    act(() => { result.current.parseFromCSV(CSV_V1) })
    act(() => { result.current.parseFromCSV(CSV_V2) })

    // 플래그를 전혀 건드리지 않은 경우 — undefined여야 함 (false로 오염되면 안 됨)
    expect(result.current.scenes[0].videoI2VDisabled).toBeUndefined()
    expect(result.current.scenes[0].videoT2VDisabled).toBeUndefined()
  })
})
