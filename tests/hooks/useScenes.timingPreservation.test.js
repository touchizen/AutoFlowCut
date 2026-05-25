/**
 * useScenes — review R4 fix
 *
 * cold import (parseFromCSV new format / parseFromSRT wholesale) 가 srtTrack 의
 * 절대 시간을 보존 (recalculateTimesArr 가 0부터 sequential 재배치하지 않음).
 */
import { describe, it, expect, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useScenes } from '../../src/hooks/useScenes'

vi.mock('../../src/hooks/useFileSystem', () => ({
  fileSystemAPI: { readFileByPath: vi.fn().mockResolvedValue({ success: false }) },
}))

describe('R4 — parseFromSRT cold import 절대 시간 보존', () => {
  it('SRT 의 첫 시작 gap (0이 아닌 시작) 보존', () => {
    const srt = `1
00:00:05,000 --> 00:00:08,000
첫 자막은 5초부터`
    const { result } = renderHook(() => useScenes())
    act(() => { result.current.parseFromSRT(srt) })

    expect(result.current.srtTrack[0].startTime).toBe(5)
    expect(result.current.srtTrack[0].endTime).toBe(8)
    // scene 도 그 시간 보존 (sequential 0~3 으로 압축 안 됨)
    expect(result.current.scenes[0].startTime).toBe(5)
    expect(result.current.scenes[0].endTime).toBe(8)
  })

  it('SRT 중간 gap 보존', () => {
    const srt = `1
00:00:00,000 --> 00:00:02,000
A

2
00:00:10,000 --> 00:00:12,000
B (gap 8 seconds)`
    const { result } = renderHook(() => useScenes())
    act(() => { result.current.parseFromSRT(srt) })

    expect(result.current.scenes).toHaveLength(2)
    expect(result.current.scenes[0].startTime).toBe(0)
    expect(result.current.scenes[0].endTime).toBe(2)
    // 두번째 씬은 10초부터 (sequential 로 2~ 가 아님)
    expect(result.current.scenes[1].startTime).toBe(10)
    expect(result.current.scenes[1].endTime).toBe(12)
  })
})

describe('R4 — parseFromCSV new format cold import 절대 시간 보존', () => {
  it('CSV start_time/end_time gap 보존', () => {
    const csv = `scene,prompt,subtitle,start_time,end_time
1,"P1","A",5,8
2,"P2","B",20,25`
    const { result } = renderHook(() => useScenes())
    act(() => { result.current.parseFromCSV(csv) })

    expect(result.current.scenes).toHaveLength(2)
    expect(result.current.scenes[0].startTime).toBe(5)
    expect(result.current.scenes[0].endTime).toBe(8)
    expect(result.current.scenes[1].startTime).toBe(20)
    expect(result.current.scenes[1].endTime).toBe(25)
  })

  it('CSV 의 묶음 씬도 첫 라인 startTime ~ 마지막 라인 endTime', () => {
    const csv = `scene,prompt,subtitle,start_time,end_time
1,"P1","A",5,7
1,,"B",7,10
1,,"C",10,15`
    const { result } = renderHook(() => useScenes())
    act(() => { result.current.parseFromCSV(csv) })

    expect(result.current.scenes).toHaveLength(1)
    expect(result.current.scenes[0].startTime).toBe(5)
    expect(result.current.scenes[0].endTime).toBe(15)
    expect(result.current.scenes[0].duration).toBe(10)
  })
})
