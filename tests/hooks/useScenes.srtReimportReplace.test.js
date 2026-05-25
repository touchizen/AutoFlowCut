/**
 * useScenes hook — parseFromSRT { mode: 'replace' }
 *
 * "replace" 의미: 자막 트랙만 새 SRT 로 바꾸고, 씬 순서대로 1:1 끼워 넣음.
 * scene ID / prompt / 이미지 / 비디오 등 콘텐츠는 인덱스 위치별 보존.
 * 새 SRT 가 길면 초과 라인은 새 씬으로 append, 짧으면 초과 씬의 자막만 비움.
 *
 * 기본 모드(merge)는 텍스트 유사도 기반 fuzzy 매칭 (기존 smart-merge 동작).
 */
import { describe, it, expect, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useScenes } from '../../src/hooks/useScenes'

vi.mock('../../src/hooks/useFileSystem', () => ({
  fileSystemAPI: {
    readFileByPath: vi.fn().mockResolvedValue({ success: false }),
  },
}))

const BUNDLE_CSV = `scene,prompt,subtitle,start_time,end_time
1,"기존프롬프트A","자막1",0,1
1,,"자막2",1,2
2,"기존프롬프트B","자막3",2,3`

const NEW_SRT = `1
00:00:00,000 --> 00:00:02,000
완전히 새로운 자막 A

2
00:00:02,000 --> 00:00:04,000
완전히 새로운 자막 B

3
00:00:04,000 --> 00:00:06,000
완전히 새로운 자막 C`

const SHORT_SRT = `1
00:00:00,000 --> 00:00:02,000
짧은 자막`

describe('useScenes — parseFromSRT { mode: "replace" }', () => {
  it('replace 모드 → 인덱스 1:1 로 자막만 교체, 기존 prompt 는 위치별 보존', () => {
    const { result } = renderHook(() => useScenes())

    act(() => {
      result.current.parseFromCSV(BUNDLE_CSV)
    })
    expect(result.current.scenes).toHaveLength(2)
    expect(result.current.scenes[0].prompt).toBe('기존프롬프트A')
    expect(result.current.scenes[1].prompt).toBe('기존프롬프트B')

    act(() => {
      result.current.parseFromSRT(NEW_SRT, [], { mode: 'replace' })
    })

    expect(result.current.scenes).toHaveLength(3)
    // 기존 prompt 가 위치별로 보존됨 (replace 의 새 의미)
    expect(result.current.scenes[0].prompt).toBe('기존프롬프트A')
    expect(result.current.scenes[1].prompt).toBe('기존프롬프트B')
    expect(result.current.scenes[2].prompt).toBe('')
    // 자막은 새 SRT 로 전부 교체
    expect(result.current.scenes[0].subtitle).toBe('완전히 새로운 자막 A')
    expect(result.current.scenes[1].subtitle).toBe('완전히 새로운 자막 B')
    expect(result.current.scenes[2].subtitle).toBe('완전히 새로운 자막 C')
    // srtTrack 도 새 라인으로 교체
    expect(result.current.srtTrack).toHaveLength(3)
    expect(result.current.srtTrack[0].text).toBe('완전히 새로운 자막 A')
    // 시간/srtLineIds 도 새 SRT 기준으로 재매핑
    expect(result.current.scenes[0].srtLineIds).toEqual([result.current.srtTrack[0].id])
    expect(result.current.scenes[0].startTime).toBe(0)
    expect(result.current.scenes[0].endTime).toBe(2)
  })

  it('replace 모드 → 기존 scene ID 가 위치별로 보존됨 (framePairs 안전)', () => {
    const { result } = renderHook(() => useScenes())
    act(() => {
      result.current.parseFromCSV(BUNDLE_CSV)
    })
    const oldIds = result.current.scenes.map(s => s.id)
    expect(oldIds).toHaveLength(2)

    act(() => {
      result.current.parseFromSRT(NEW_SRT, [], { mode: 'replace' })
    })
    const newIds = result.current.scenes.map(s => s.id)
    expect(newIds).toHaveLength(3)
    // 기존 2 씬의 ID 는 그대로 유지 — framePairs.ownerSceneId 가 가리키던 씬이 살아 있음
    expect(newIds[0]).toBe(oldIds[0])
    expect(newIds[1]).toBe(oldIds[1])
    // 초과 씬만 새 ID
    expect(oldIds).not.toContain(newIds[2])
  })

  it('replace 모드 → 새 SRT 가 짧으면 초과 씬은 자막만 비우고 prompt/이미지/비디오 유지 (max 동작)', () => {
    const { result } = renderHook(() => useScenes())
    act(() => {
      result.current.parseFromCSV(BUNDLE_CSV)
    })
    expect(result.current.scenes).toHaveLength(2)

    act(() => {
      result.current.parseFromSRT(SHORT_SRT, [], { mode: 'replace' })
    })

    // 자막은 통째로 교체되지만 나머지는 max — 7씬+3라인 = 7씬 유지 패턴.
    expect(result.current.scenes).toHaveLength(2)
    expect(result.current.scenes[0].subtitle).toBe('짧은 자막')
    expect(result.current.scenes[0].prompt).toBe('기존프롬프트A')
    // 새 SRT 가 짧아 매칭 안 된 씬은 자막/srtLineIds 만 비고 prompt 는 보존.
    expect(result.current.scenes[1].subtitle).toBe('')
    expect(result.current.scenes[1].srtLineIds).toEqual([])
    expect(result.current.scenes[1].prompt).toBe('기존프롬프트B')
  })

  it('기본 모드 (mode 미지정) → 기존 smart-merge 동작 유지', () => {
    const { result } = renderHook(() => useScenes())

    act(() => {
      result.current.parseFromCSV(BUNDLE_CSV)
    })
    expect(result.current.scenes[0].prompt).toBe('기존프롬프트A')

    // 완전히 다른 SRT → smart-merge 는 fuzzy 매칭 실패 → 기존 씬은 자막 비고 새 라인 append.
    act(() => {
      result.current.parseFromSRT(NEW_SRT)
    })

    // 기존 2 씬 + append 3 새 씬 = 5 (smart-merge 동작)
    expect(result.current.scenes.length).toBeGreaterThanOrEqual(3)
    // 기존 첫 씬 prompt 유지
    expect(result.current.scenes[0].prompt).toBe('기존프롬프트A')
  })
})
