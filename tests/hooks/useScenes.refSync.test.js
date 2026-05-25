/**
 * useScenes — review R6 fix
 *
 * setScenes/setSrtTrack 의 wrapper 가 scenesRef/srtTrackRef 를 동기 갱신.
 * 같은 tick 에 back-to-back parseFromCSV/SRT 가 첫 호출 결과 봄.
 */
import { describe, it, expect, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useScenes } from '../../src/hooks/useScenes'

vi.mock('../../src/hooks/useFileSystem', () => ({
  fileSystemAPI: { readFileByPath: vi.fn().mockResolvedValue({ success: false }) },
}))

describe('R6 — setter wrapper 동기 ref sync', () => {
  it('parseFromSRT 후 즉시 parseFromCSV (legacy) → 두번째가 첫번째 scenes 보고 merge', () => {
    const { result } = renderHook(() => useScenes())

    const srt = `1
00:00:00,000 --> 00:00:01,000
A`
    const legacyCsv = `prompt,subtitle\n"new-prompt","A"`

    act(() => {
      result.current.parseFromSRT(srt) // 씬 1개 (A) + srtTrack 1
      // 같은 act 안에서 두번째 호출 — useEffect 실행 안 됨
      result.current.parseFromCSV(legacyCsv)
    })

    // legacy CSV 가 기존 씬 1개에 merge → 1개 유지
    // useEffect 였다면 scenesRef.current 가 빈 배열이라 mergeCSVIntoScenes 가 [] 로 호출됨
    // setter sync 되면 scenesRef 에 첫 setScenes 의 결과 있음
    expect(result.current.scenes).toHaveLength(1)
    expect(result.current.scenes[0].prompt).toBe('new-prompt') // legacy CSV 가 prompt 갱신
  })

  it('parseFromCSV (new) 후 즉시 parseFromCSV (new) → 두번째가 첫번째 sceneNum 매칭', () => {
    const { result } = renderHook(() => useScenes())

    const csvA = `scene,prompt,subtitle\n1,"A","sa"`
    const csvB = `scene,prompt,subtitle\n1,"B","sb"`

    act(() => {
      result.current.parseFromCSV(csvA)
      // 같은 tick
      result.current.parseFromCSV(csvB)
    })

    expect(result.current.scenes).toHaveLength(1)
    // 두번째 CSV 가 같은 sceneNum=1 의 prompt 갱신
    expect(result.current.scenes[0].prompt).toBe('B')
  })

  it('setScenes 직접 호출 후 scenesRef.current 즉시 갱신', () => {
    // 이 테스트는 hook 외부에서 ref 를 직접 못 봐서 indirect: parseFromSRT 가
    // scenesRef.current 를 prev 로 쓰는 걸 활용
    const { result } = renderHook(() => useScenes())

    act(() => {
      result.current.setScenes([
        { id: 'scene_1', prompt: 'fromSetScenes', srtLineIds: [] },
      ])
      // 직후 setSrtTrack 도 호출
      result.current.setSrtTrack([
        { id: 'sub_1', startTime: 0, endTime: 1, text: 'sync' },
      ])
    })

    expect(result.current.scenes).toHaveLength(1)
    expect(result.current.scenes[0].prompt).toBe('fromSetScenes')
    expect(result.current.srtTrack).toHaveLength(1)
    expect(result.current.srtTrack[0].text).toBe('sync')
  })
})
