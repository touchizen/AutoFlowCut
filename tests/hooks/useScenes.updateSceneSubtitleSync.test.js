/**
 * useScenes — review R20 fix
 *
 * updateScene 가 단일 srtLine 씬의 subtitle 변경 시 srtTrack 도 동기화.
 * SceneDetailModal 등 generic updateScene 호출 경로의 silent data loss 방지.
 */
import { describe, it, expect, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useScenes } from '../../src/hooks/useScenes'

vi.mock('../../src/hooks/useFileSystem', () => ({
  fileSystemAPI: { readFileByPath: vi.fn().mockResolvedValue({ success: false }) },
}))

describe('R20 — updateScene subtitle change syncs srtTrack', () => {
  it('단일 srtLine 씬의 updateScene({subtitle}) → srtTrack 라인도 갱신', () => {
    const { result } = renderHook(() => useScenes())
    act(() => {
      result.current.setSrtTrack([
        { id: 'sub_1', startTime: 0, endTime: 2, text: 'original' },
      ])
      result.current.setScenes([
        { id: 's1', srtLineIds: ['sub_1'], subtitle: 'original' },
      ])
    })

    act(() => {
      result.current.updateScene('s1', { subtitle: 'edited' })
    })

    expect(result.current.scenes[0].subtitle).toBe('edited')
    expect(result.current.srtTrack[0].text).toBe('edited')
  })

  it('묶음 (>1 srtLine) 씬은 subtitle 변경해도 srtTrack 안 건드림 (ambiguous → noop)', () => {
    const { result } = renderHook(() => useScenes())
    act(() => {
      result.current.setSrtTrack([
        { id: 'sub_1', startTime: 0, endTime: 1, text: 'A' },
        { id: 'sub_2', startTime: 1, endTime: 2, text: 'B' },
      ])
      result.current.setScenes([
        { id: 's1', srtLineIds: ['sub_1', 'sub_2'], subtitle: 'A\nB' },
      ])
    })

    act(() => {
      result.current.updateScene('s1', { subtitle: 'edited bundle' })
    })

    // scene.subtitle 은 갱신되지만 srtTrack 은 원본 유지 (어느 라인이 바뀐 건지 모호)
    expect(result.current.srtTrack[0].text).toBe('A')
    expect(result.current.srtTrack[1].text).toBe('B')
  })

  it('srtLineIds 없는 legacy 씬은 srtTrack 안 건드림', () => {
    const { result } = renderHook(() => useScenes())
    act(() => {
      result.current.setSrtTrack([
        { id: 'sub_1', startTime: 0, endTime: 1, text: 'unrelated' },
      ])
      result.current.setScenes([
        { id: 's1', subtitle: 'old' }, // srtLineIds 없음
      ])
    })

    act(() => {
      result.current.updateScene('s1', { subtitle: 'new' })
    })

    expect(result.current.scenes[0].subtitle).toBe('new')
    expect(result.current.srtTrack[0].text).toBe('unrelated') // 보존
  })

  it('subtitle 외 다른 필드만 변경 시 srtTrack 무관', () => {
    const { result } = renderHook(() => useScenes())
    act(() => {
      result.current.setSrtTrack([
        { id: 'sub_1', startTime: 0, endTime: 1, text: 'A' },
      ])
      result.current.setScenes([
        { id: 's1', srtLineIds: ['sub_1'], prompt: 'P' },
      ])
    })

    act(() => {
      result.current.updateScene('s1', { prompt: 'P-edited' })
    })

    expect(result.current.scenes[0].prompt).toBe('P-edited')
    expect(result.current.srtTrack[0].text).toBe('A') // unchanged
  })
})
