/**
 * useScenes hook — Phase 3: 새 CSV (scene 컬럼) 인식
 */
import { describe, it, expect, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useScenes } from '../../src/hooks/useScenes'

vi.mock('../../src/hooks/useFileSystem', () => ({
  fileSystemAPI: {
    readFileByPath: vi.fn().mockResolvedValue({ success: false }),
  },
}))

const NEW_CSV = `scene,prompt,subtitle,start_time,end_time
1,"P1","자막1",0,3.5
1,,"자막2",3.5,7
1,,"자막3",7,11.83
2,"P2","자막4",11.83,15.5
2,,"자막5",15.5,19.5
2,,"자막6",19.5,23.84`

describe('useScenes — parseFromCSV (new scene-column format)', () => {
  it('새 형식 CSV import → 2개 묶인 씬 + srtTrack 6 라인', () => {
    const { result } = renderHook(() => useScenes())
    act(() => {
      result.current.parseFromCSV(NEW_CSV)
    })
    expect(result.current.scenes).toHaveLength(2)
    expect(result.current.srtTrack).toHaveLength(6)
    expect(result.current.scenes[0].srtLineIds).toHaveLength(3)
    expect(result.current.scenes[1].srtLineIds).toHaveLength(3)
  })

  it('씬 prompt 가 그룹 첫 행에서 추출됨', () => {
    const { result } = renderHook(() => useScenes())
    act(() => {
      result.current.parseFromCSV(NEW_CSV)
    })
    expect(result.current.scenes[0].prompt).toBe('P1')
    expect(result.current.scenes[1].prompt).toBe('P2')
  })

  it('srtTrack 라인 텍스트가 행 subtitle 순서대로', () => {
    const { result } = renderHook(() => useScenes())
    act(() => {
      result.current.parseFromCSV(NEW_CSV)
    })
    expect(result.current.srtTrack.map(l => l.text)).toEqual([
      '자막1', '자막2', '자막3', '자막4', '자막5', '자막6',
    ])
  })

  it('각 씬의 srtLineIds 가 해당 라인 가리킴', () => {
    const { result } = renderHook(() => useScenes())
    act(() => {
      result.current.parseFromCSV(NEW_CSV)
    })
    const track = result.current.srtTrack
    expect(result.current.scenes[0].srtLineIds).toEqual([track[0].id, track[1].id, track[2].id])
    expect(result.current.scenes[1].srtLineIds).toEqual([track[3].id, track[4].id, track[5].id])
  })

  it('옛 형식 CSV (scene 컬럼 없음) → 옛 동작 (srtTrack 변경 없음)', () => {
    const oldCsv = `prompt,subtitle,duration\n"P1","S1",3\n"P2","S2",3`
    const { result } = renderHook(() => useScenes())
    act(() => {
      result.current.parseFromCSV(oldCsv)
    })
    // 씬은 2개 (옛 동작)
    expect(result.current.scenes).toHaveLength(2)
    // srtTrack 은 비어있어야 함 (Phase 3 은 옛 형식 srtTrack 안 채움 — Phase 4 가 처리)
    expect(result.current.srtTrack).toHaveLength(0)
  })

  it('새 CSV 재import 시 srtTrack 도 교체', () => {
    const { result } = renderHook(() => useScenes())
    act(() => {
      result.current.parseFromCSV(NEW_CSV)
    })
    expect(result.current.srtTrack).toHaveLength(6)

    const alt = `scene,prompt,subtitle\n1,"AltP","Alt1"`
    act(() => {
      result.current.parseFromCSV(alt)
    })
    expect(result.current.srtTrack).toHaveLength(1)
    expect(result.current.srtTrack[0].text).toBe('Alt1')
    expect(result.current.scenes).toHaveLength(1)
  })

  it('parseFromCSV 반환값은 scenes 배열 (back-compat)', () => {
    const { result } = renderHook(() => useScenes())
    let returned
    act(() => {
      returned = result.current.parseFromCSV(NEW_CSV)
    })
    expect(returned).toHaveLength(2)
  })
})
