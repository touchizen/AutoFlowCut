/**
 * useScenes hook — Phase 9: SRT 재import 스마트 매칭 (bundling 보존)
 */
import { describe, it, expect, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useScenes } from '../../src/hooks/useScenes'

vi.mock('../../src/hooks/useFileSystem', () => ({
  fileSystemAPI: {
    readFileByPath: vi.fn().mockResolvedValue({ success: false }),
  },
}))

// 묶기 형식 CSV (scene 컬럼) — scene 1: 자막1+2+3, scene 2: 자막4
const BUNDLE_CSV = `scene,prompt,subtitle,start_time,end_time
1,"P1","자막1",0,1
1,,"자막2",1,2
1,,"자막3",2,3
2,"P2","자막4",3,4`

const ORIGINAL_SRT = `1
00:00:00,000 --> 00:00:01,000
자막1

2
00:00:01,000 --> 00:00:02,000
자막2

3
00:00:02,000 --> 00:00:03,000
자막3

4
00:00:03,000 --> 00:00:04,000
자막4`

describe('useScenes — SRT 재import 스마트 매칭 (Phase 9)', () => {
  it('동일 SRT 재import → 묶음 보존, srtLineIds 새 ID 로 remap', () => {
    const { result } = renderHook(() => useScenes())

    // Setup: 묶음 형식 CSV import → 씬 2개 (scene 1 = 3 묶음, scene 2 = 1)
    act(() => {
      result.current.parseFromCSV(BUNDLE_CSV)
    })
    expect(result.current.scenes[0].srtLineIds).toHaveLength(3)
    expect(result.current.scenes[1].srtLineIds).toHaveLength(1)

    // 같은 텍스트의 SRT 재import → 묶음 유지
    act(() => {
      result.current.parseFromSRT(ORIGINAL_SRT)
    })
    expect(result.current.scenes).toHaveLength(2) // 추가 씬 없음
    expect(result.current.scenes[0].srtLineIds).toHaveLength(3) // 묶음 유지
    expect(result.current.scenes[1].srtLineIds).toHaveLength(1)

    // 새 srtTrack 의 ID 로 매핑됨
    const track = result.current.srtTrack
    expect(track).toHaveLength(4)
    expect(result.current.scenes[0].srtLineIds).toEqual([
      track[0].id, track[1].id, track[2].id,
    ])
    expect(result.current.scenes[1].srtLineIds).toEqual([track[3].id])
  })

  it('일부 라인 텍스트 변경 → 유사도 매칭으로 묶음 보존', () => {
    const { result } = renderHook(() => useScenes())
    act(() => {
      result.current.parseFromCSV(BUNDLE_CSV)
    })

    // 자막2 만 "수정된 자막2 입니다" 로 변경 — 유사도 낮으므로 매칭 안 됨
    const altSrt = `1
00:00:00,000 --> 00:00:01,000
자막1

2
00:00:01,000 --> 00:00:02,000
완전히 다른 새 자막

3
00:00:02,000 --> 00:00:03,000
자막3

4
00:00:03,000 --> 00:00:04,000
자막4`
    act(() => {
      result.current.parseFromSRT(altSrt)
    })
    const track = result.current.srtTrack
    expect(track).toHaveLength(4)
    // scene 0 묶음: 자막1, 자막3 매치 (자막2 변경된 라인은 매치 실패) → 2개
    // 새 라인 (완전히 다른...) 은 added → 새 씬 추가
    const scene0Ids = result.current.scenes[0].srtLineIds
    expect(scene0Ids).toHaveLength(2)
    // 자막1, 자막3 모두 매칭됨 → track 의 해당 ID 가 포함됨
    const trackByText = new Map(track.map(l => [l.text, l.id]))
    expect(scene0Ids).toContain(trackByText.get('자막1'))
    expect(scene0Ids).toContain(trackByText.get('자막3'))
  })

  it('라인 1개 삭제 → 그 라인이 묶음에서 제외, 나머지 보존', () => {
    const { result } = renderHook(() => useScenes())
    act(() => {
      result.current.parseFromCSV(BUNDLE_CSV)
    })

    // 자막2 가 사라진 SRT
    const shorterSrt = `1
00:00:00,000 --> 00:00:01,000
자막1

2
00:00:01,000 --> 00:00:02,000
자막3

3
00:00:02,000 --> 00:00:03,000
자막4`
    act(() => {
      result.current.parseFromSRT(shorterSrt)
    })
    const track = result.current.srtTrack
    expect(track).toHaveLength(3)
    // scene 0 (was 자막1+2+3): 자막2 사라짐 → 자막1, 자막3 만
    expect(result.current.scenes[0].srtLineIds).toHaveLength(2)
    expect(result.current.scenes[1].srtLineIds).toHaveLength(1)
  })

  it('새 라인 추가 → 새 씬으로 append', () => {
    const { result } = renderHook(() => useScenes())
    act(() => {
      result.current.parseFromCSV(BUNDLE_CSV)
    })
    const initialSceneCount = result.current.scenes.length

    // 끝에 새 자막 추가
    const longerSrt = `1
00:00:00,000 --> 00:00:01,000
자막1

2
00:00:01,000 --> 00:00:02,000
자막2

3
00:00:02,000 --> 00:00:03,000
자막3

4
00:00:03,000 --> 00:00:04,000
자막4

5
00:00:04,000 --> 00:00:05,000
새 자막 5`
    act(() => {
      result.current.parseFromSRT(longerSrt)
    })
    expect(result.current.srtTrack).toHaveLength(5)
    // 새 라인 → 새 씬으로 추가
    expect(result.current.scenes.length).toBeGreaterThan(initialSceneCount)
    // 마지막 씬은 새 라인 가리킴
    const last = result.current.scenes[result.current.scenes.length - 1]
    const newLine = result.current.srtTrack.find(l => l.text === '새 자막 5')
    expect(last.srtLineIds).toContain(newLine.id)
  })

  it('빈 프로젝트 + SRT import → Phase 2 동작 (1:1)', () => {
    const { result } = renderHook(() => useScenes())
    act(() => {
      result.current.parseFromSRT(ORIGINAL_SRT)
    })
    expect(result.current.scenes).toHaveLength(4)
    expect(result.current.scenes[0].srtLineIds).toHaveLength(1)
    expect(result.current.srtTrack).toHaveLength(4)
  })
})
