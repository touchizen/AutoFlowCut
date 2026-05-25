/**
 * useScenes hook — Phase 2: srtTrack 상태 + parseFromSRT 갱신
 *
 * Plan: docs/superpowers/plans/2026-05-25-srt-csv-track-separation.md
 */
import { describe, it, expect, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useScenes } from '../../src/hooks/useScenes'

vi.mock('../../src/hooks/useFileSystem', () => ({
  fileSystemAPI: {
    readFileByPath: vi.fn().mockResolvedValue({ success: false }),
  },
}))

const SRT_3 = `1
00:00:00,000 --> 00:00:03,500
자막1

2
00:00:03,500 --> 00:00:07,000
자막2

3
00:00:07,000 --> 00:00:11,830
자막3`

const SRT_2 = `1
00:00:00,000 --> 00:00:02,000
새A

2
00:00:02,000 --> 00:00:04,000
새B`

describe('useScenes — srtTrack state', () => {
  it('초기 srtTrack 은 빈 배열', () => {
    const { result } = renderHook(() => useScenes())
    expect(result.current.srtTrack).toEqual([])
  })

  it('setSrtTrack 으로 직접 설정 가능 (project load 용)', () => {
    const { result } = renderHook(() => useScenes())
    const track = [
      { id: 'sub_1', startTime: 0, endTime: 1, text: 'a' },
      { id: 'sub_2', startTime: 1, endTime: 2, text: 'b' },
    ]
    act(() => {
      result.current.setSrtTrack(track)
    })
    expect(result.current.srtTrack).toEqual(track)
  })
})

describe('useScenes — parseFromSRT populates srtTrack', () => {
  it('SRT import 시 srtTrack 채워짐 (라인마다 1개)', () => {
    const { result } = renderHook(() => useScenes())
    act(() => {
      result.current.parseFromSRT(SRT_3)
    })
    expect(result.current.srtTrack).toHaveLength(3)
    expect(result.current.srtTrack.map(l => l.text)).toEqual(['자막1', '자막2', '자막3'])
  })

  it('각 씬은 srtLineIds 가짐 (1:1)', () => {
    const { result } = renderHook(() => useScenes())
    act(() => {
      result.current.parseFromSRT(SRT_3)
    })
    const scenes = result.current.scenes
    const track = result.current.srtTrack
    expect(scenes).toHaveLength(3)
    expect(scenes[0].srtLineIds).toEqual([track[0].id])
    expect(scenes[1].srtLineIds).toEqual([track[1].id])
    expect(scenes[2].srtLineIds).toEqual([track[2].id])
  })

  it('SRT 재import 동일 텍스트 → matcher 가 묶음 보존 + srtLineIds 새 ID 로 remap', () => {
    const { result } = renderHook(() => useScenes())
    act(() => {
      result.current.parseFromSRT(SRT_3)
    })
    const ids = result.current.scenes.map(s => s.id)
    act(() => {
      result.current.updateScene(ids[0], { prompt: 'P0', image: 'img0' })
      result.current.updateScene(ids[1], { prompt: 'P1', image: 'img1' })
      result.current.updateScene(ids[2], { prompt: 'P2', image: 'img2' })
    })

    // 동일 텍스트 SRT 재import — matcher 가 모두 매칭 → 묶음 유지
    act(() => {
      result.current.parseFromSRT(SRT_3)
    })

    const newScenes = result.current.scenes
    const newTrack = result.current.srtTrack
    expect(newScenes).toHaveLength(3) // 신규 씬 없음
    expect(newScenes[0].prompt).toBe('P0')
    expect(newScenes[0].image).toBe('img0')
    expect(newScenes[0].srtLineIds).toEqual([newTrack[0].id])
    expect(newScenes[1].srtLineIds).toEqual([newTrack[1].id])
    expect(newScenes[2].srtLineIds).toEqual([newTrack[2].id])
  })

  it('SRT 재import 텍스트 완전 변경 → 기존 씬 prompt/image 보존, 새 씬 append', () => {
    const { result } = renderHook(() => useScenes())
    act(() => {
      result.current.parseFromSRT(SRT_3)
    })
    const ids = result.current.scenes.map(s => s.id)
    act(() => {
      result.current.updateScene(ids[0], { prompt: 'P0', image: 'img0' })
    })

    // 완전히 다른 텍스트 SRT (matcher 임계 미만)
    const altSrt = `1
00:00:00,000 --> 00:00:05,000
완전히 다른 텍스트입니다

2
00:00:05,000 --> 00:00:10,000
이것도 매칭 안 됨

3
00:00:10,000 --> 00:00:15,000
세번째도 다름`
    act(() => {
      result.current.parseFromSRT(altSrt)
    })

    // 기존 3 씬 보존 + 3 새 씬 append → 총 6 씬
    expect(result.current.scenes).toHaveLength(6)
    expect(result.current.scenes[0].prompt).toBe('P0') // 보존
    expect(result.current.scenes[0].image).toBe('img0') // 보존
    expect(result.current.scenes[0].srtLineIds).toEqual([]) // 매칭 안 됨
    // 새 씬들은 새 srtTrack 가리킴
    const newTrack = result.current.srtTrack
    expect(newTrack).toHaveLength(3)
    expect(result.current.scenes[3].srtLineIds).toEqual([newTrack[0].id])
  })

  it('SRT 라인 수가 줄어들면 (텍스트 변경 포함): 기존 씬 보존 + 매칭 안 된 라인 append', () => {
    const { result } = renderHook(() => useScenes())
    act(() => {
      result.current.parseFromSRT(SRT_3) // 3개
    })
    const ids = result.current.scenes.map(s => s.id)
    act(() => {
      result.current.updateScene(ids[2], { prompt: 'keepP2', image: 'keepImg2' })
    })

    // 짧은 SRT 로 교체 (2개, 다른 텍스트)
    act(() => {
      result.current.parseFromSRT(SRT_2)
    })

    const scenes = result.current.scenes
    const track = result.current.srtTrack
    expect(track).toHaveLength(2)
    // 기존 3 + 새 2 append = 5
    expect(scenes).toHaveLength(5)
    // 콘텐츠 보존
    expect(scenes[2].prompt).toBe('keepP2')
    expect(scenes[2].image).toBe('keepImg2')
    expect(scenes[2].srtLineIds).toEqual([]) // 자막3 사라짐
  })

  it('SRT 라인 수가 늘어나면 (텍스트 변경 포함): 기존 씬 보존 + 새 라인 append', () => {
    const { result } = renderHook(() => useScenes())
    act(() => {
      result.current.parseFromSRT(SRT_2) // 2개
    })

    // 더 긴, 다른 텍스트 SRT (3개)
    act(() => {
      result.current.parseFromSRT(SRT_3)
    })

    const scenes = result.current.scenes
    const track = result.current.srtTrack
    expect(track).toHaveLength(3)
    // 기존 2 + 새 3 append = 5
    expect(scenes).toHaveLength(5)
    // 새 씬 3개는 새 라인 각자 가리킴
    expect(scenes[2].srtLineIds).toEqual([track[0].id])
    expect(scenes[3].srtLineIds).toEqual([track[1].id])
    expect(scenes[4].srtLineIds).toEqual([track[2].id])
  })

  it('초기 빈 상태에서 SRT import → 새 씬 N개', () => {
    const { result } = renderHook(() => useScenes())
    expect(result.current.scenes).toHaveLength(0)
    act(() => {
      result.current.parseFromSRT(SRT_3)
    })
    expect(result.current.scenes).toHaveLength(3)
    expect(result.current.srtTrack).toHaveLength(3)
  })

  it('parseFromSRT 반환값은 scenes 배열 (back-compat)', () => {
    const { result } = renderHook(() => useScenes())
    let returned
    act(() => {
      returned = result.current.parseFromSRT(SRT_3)
    })
    expect(returned).toHaveLength(3)
    expect(returned[0].subtitle).toBe('자막1') // 후방 호환 subtitle 필드
  })
})
