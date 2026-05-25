/**
 * useScenes hook — Phase 4: 옛 CSV 호환 + srtTrack 자동 채움
 */
import { describe, it, expect, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useScenes } from '../../src/hooks/useScenes'

vi.mock('../../src/hooks/useFileSystem', () => ({
  fileSystemAPI: {
    readFileByPath: vi.fn().mockResolvedValue({ success: false }),
  },
}))

const LEGACY_CSV = `prompt,subtitle,duration
"Prompt A","자막 A",3
"Prompt B","자막 B",3
"Prompt C","자막 C",3`

describe('useScenes — parseFromCSV (legacy format) populates srtTrack', () => {
  it('옛 CSV import → 3 씬 + 3 srtTrack 라인 (1:1)', () => {
    const { result } = renderHook(() => useScenes())
    act(() => {
      result.current.parseFromCSV(LEGACY_CSV)
    })
    expect(result.current.scenes).toHaveLength(3)
    expect(result.current.srtTrack).toHaveLength(3)
    expect(result.current.srtTrack.map(l => l.text)).toEqual(['자막 A', '자막 B', '자막 C'])
  })

  it('각 씬은 srtLineIds 1개 (자기 자막 가리킴)', () => {
    const { result } = renderHook(() => useScenes())
    act(() => {
      result.current.parseFromCSV(LEGACY_CSV)
    })
    const track = result.current.srtTrack
    const scenes = result.current.scenes
    expect(scenes[0].srtLineIds).toEqual([track[0].id])
    expect(scenes[1].srtLineIds).toEqual([track[1].id])
    expect(scenes[2].srtLineIds).toEqual([track[2].id])
  })

  it('옛 CSV scene 의 subtitle 필드도 보존 (후방 호환)', () => {
    const { result } = renderHook(() => useScenes())
    act(() => {
      result.current.parseFromCSV(LEGACY_CSV)
    })
    expect(result.current.scenes[0].subtitle).toBe('자막 A')
  })

  it('옛 CSV scene prompt 보존', () => {
    const { result } = renderHook(() => useScenes())
    act(() => {
      result.current.parseFromCSV(LEGACY_CSV)
    })
    expect(result.current.scenes[0].prompt).toBe('Prompt A')
    expect(result.current.scenes[2].prompt).toBe('Prompt C')
  })

  it('빈 subtitle 인 옛 CSV 씬 → srtTrack 라인 없음, srtLineIds=[]', () => {
    const csv = `prompt,subtitle\n"P1","S1"\n"P2",`
    const { result } = renderHook(() => useScenes())
    act(() => {
      result.current.parseFromCSV(csv)
    })
    expect(result.current.scenes).toHaveLength(2)
    expect(result.current.srtTrack).toHaveLength(1)
    expect(result.current.scenes[0].srtLineIds).toEqual([result.current.srtTrack[0].id])
    expect(result.current.scenes[1].srtLineIds).toEqual([])
  })

  it('옛 CSV 재import 시 srtTrack 도 재구성 (max-driver: 기존 씬 갯수 유지)', () => {
    const { result } = renderHook(() => useScenes())
    act(() => {
      result.current.parseFromCSV(LEGACY_CSV) // 3 lines
    })
    expect(result.current.srtTrack).toHaveLength(3)

    // alt 는 2행만 — max-driver merge 로 첫 2개만 갱신, 3번째는 보존
    const alt = `prompt,subtitle\n"X","NewA"\n"Y","NewB"`
    act(() => {
      result.current.parseFromCSV(alt)
    })
    // 3 씬 유지 (옛 max-driver 동작). srtTrack 도 그에 맞춰 3 라인
    expect(result.current.scenes).toHaveLength(3)
    expect(result.current.srtTrack).toHaveLength(3)
    expect(result.current.srtTrack.map(l => l.text)).toEqual(['NewA', 'NewB', '자막 C'])
  })

  it('옛 CSV merge 동작 보존 — CSV 에 없는 필드는 기존 보존', () => {
    const { result } = renderHook(() => useScenes())
    // 초기 set with prompt + image
    act(() => {
      result.current.setScenes([
        { id: 'scene_1', prompt: 'P1', subtitle: 'OLD_SUB', image: 'img1', duration: 3 },
      ])
    })
    // 옛 형식 CSV (image 컬럼 없음) → subtitle 만 갱신, image 보존
    act(() => {
      result.current.parseFromCSV(`subtitle\nNEW_SUB`)
    })
    expect(result.current.scenes[0].subtitle).toBe('NEW_SUB')
    expect(result.current.scenes[0].image).toBe('img1') // 보존
    expect(result.current.scenes[0].prompt).toBe('P1') // 보존
  })

  it('새 형식 CSV 와 옛 형식 CSV 가 서로 다른 경로 (srtTrack 라인 수 다름)', () => {
    const newCsv = `scene,prompt,subtitle\n1,"P1","A"\n1,,"B"\n1,,"C"`
    const oldCsv = `prompt,subtitle\n"P1","ABC"`
    const { result: r1 } = renderHook(() => useScenes())
    const { result: r2 } = renderHook(() => useScenes())
    act(() => {
      r1.current.parseFromCSV(newCsv) // 1 묶인 씬 + 3 라인
    })
    act(() => {
      r2.current.parseFromCSV(oldCsv) // 1 씬 + 1 라인 (묶음 텍스트)
    })
    expect(r1.current.scenes).toHaveLength(1)
    expect(r1.current.srtTrack).toHaveLength(3)
    expect(r2.current.scenes).toHaveLength(1)
    expect(r2.current.srtTrack).toHaveLength(1)
    expect(r2.current.srtTrack[0].text).toBe('ABC')
  })
})
