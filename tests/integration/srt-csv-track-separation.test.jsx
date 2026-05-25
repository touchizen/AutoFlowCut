/**
 * Integration tests — Phase 10
 *
 * Full SRT/CSV track-separation flow scenarios:
 *   1. 새 SRT import → 1자막=1씬, srtTrack 보존
 *   2. 새 SRT → 새 CSV 묶기 → 묶음 적용
 *   3. 새 CSV (자체 완결) import → srtTrack + 묶음 동시 생성
 *   4. 옛 CSV import → 옛 동작 + srtTrack 자동 채움 (회귀 검증)
 *   5. 옛 프로젝트 로드 → 자동 마이그레이션
 *   6. 묶기 후 동일 SRT 재import → 묶음 유지
 *   7. 묶기 후 다른 SRT (라인 수 변경) → 스마트 매칭
 *   8. 묶기 후 CapCut export → 자막 원본 타이밍, 이미지 묶음 duration
 */
import { describe, it, expect, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useScenes } from '../../src/hooks/useScenes'
import { generateSRT } from '../../src/exporters/capcut'
import { migrateLegacyProject } from '../../src/utils/srtTrack'

vi.mock('../../src/hooks/useFileSystem', () => ({
  fileSystemAPI: {
    readFileByPath: vi.fn().mockResolvedValue({ success: false }),
  },
}))

const SAMPLE_SRT = `1
00:00:00,000 --> 00:00:03,500
자막1

2
00:00:03,500 --> 00:00:07,000
자막2

3
00:00:07,000 --> 00:00:11,830
자막3

4
00:00:11,830 --> 00:00:15,500
자막4

5
00:00:15,500 --> 00:00:19,500
자막5

6
00:00:19,500 --> 00:00:23,840
자막6`

const BUNDLE_CSV = `scene,prompt,subtitle,start_time,end_time
1,"Wide shot","자막1",0,3.5
1,,"자막2",3.5,7
1,,"자막3",7,11.83
2,"Close-up","자막4",11.83,15.5
2,,"자막5",15.5,19.5
2,,"자막6",19.5,23.84`

describe('Phase 10 integration — SRT/CSV track separation', () => {
  it('1. 새 SRT import → 1자막=1씬 + srtTrack 6 라인', () => {
    const { result } = renderHook(() => useScenes())
    act(() => {
      result.current.parseFromSRT(SAMPLE_SRT)
    })
    expect(result.current.scenes).toHaveLength(6)
    expect(result.current.srtTrack).toHaveLength(6)
    expect(result.current.scenes.every(s => s.srtLineIds?.length === 1)).toBe(true)
  })

  it('2. 새 SRT → 새 CSV (묶기) → 2 씬으로 묶임 + srtTrack 6 라인 유지', () => {
    const { result } = renderHook(() => useScenes())
    act(() => {
      result.current.parseFromSRT(SAMPLE_SRT) // 6 씬, 6 라인
    })
    act(() => {
      result.current.parseFromCSV(BUNDLE_CSV) // 2 묶인 씬, 6 라인
    })
    expect(result.current.scenes).toHaveLength(2)
    expect(result.current.scenes[0].srtLineIds).toHaveLength(3)
    expect(result.current.scenes[1].srtLineIds).toHaveLength(3)
    expect(result.current.srtTrack).toHaveLength(6)
  })

  it('3. 새 CSV 자체 완결 import → srtTrack + 묶음 동시 생성', () => {
    const { result } = renderHook(() => useScenes())
    act(() => {
      result.current.parseFromCSV(BUNDLE_CSV)
    })
    expect(result.current.scenes).toHaveLength(2)
    expect(result.current.srtTrack).toHaveLength(6)
    expect(result.current.scenes[0].prompt).toBe('Wide shot')
    expect(result.current.scenes[1].prompt).toBe('Close-up')
  })

  it('4. 옛 CSV (scene 컬럼 없음) → 옛 머지 + srtTrack 자동 채움', () => {
    const legacyCsv = `prompt,subtitle,duration
"P1","S1",3
"P2","S2",3`
    const { result } = renderHook(() => useScenes())
    act(() => {
      result.current.parseFromCSV(legacyCsv)
    })
    expect(result.current.scenes).toHaveLength(2)
    expect(result.current.srtTrack).toHaveLength(2)
    expect(result.current.scenes[0].prompt).toBe('P1')
    expect(result.current.scenes[0].srtLineIds).toEqual([result.current.srtTrack[0].id])
  })

  it('5. 옛 프로젝트 (schemaVersion 없음) → migrateLegacyProject 가 변환', () => {
    const legacyProject = {
      name: 'legacy',
      scenes: [
        { id: 's1', subtitle: '자막A', startTime: 0, endTime: 3, prompt: 'PA' },
        { id: 's2', subtitle: '자막B', startTime: 3, endTime: 6, prompt: 'PB' },
      ],
    }
    const migrated = migrateLegacyProject(legacyProject)
    expect(migrated.schemaVersion).toBe(2)
    expect(migrated.srtTrack).toHaveLength(2)
    expect(migrated.scenes[0].srtLineIds).toEqual([migrated.srtTrack[0].id])
    expect(migrated.scenes[0].prompt).toBe('PA') // 보존
  })

  it('6. 묶기 후 동일 SRT 재import → 묶음 유지 (smart matcher)', () => {
    const { result } = renderHook(() => useScenes())
    act(() => {
      result.current.parseFromCSV(BUNDLE_CSV) // 2 묶인 씬
    })
    expect(result.current.scenes[0].srtLineIds).toHaveLength(3)

    act(() => {
      result.current.parseFromSRT(SAMPLE_SRT) // 동일 텍스트
    })
    expect(result.current.scenes).toHaveLength(2) // 묶음 유지
    expect(result.current.scenes[0].srtLineIds).toHaveLength(3)
    expect(result.current.scenes[1].srtLineIds).toHaveLength(3)
  })

  it('7. 묶기 후 라인 1개 삭제된 SRT 재import → 묶음에서 해당 라인 제외', () => {
    const { result } = renderHook(() => useScenes())
    act(() => {
      result.current.parseFromCSV(BUNDLE_CSV)
    })

    // 자막3 빠진 SRT
    const shorterSrt = `1
00:00:00,000 --> 00:00:03,500
자막1

2
00:00:03,500 --> 00:00:07,000
자막2

3
00:00:11,830 --> 00:00:15,500
자막4

4
00:00:15,500 --> 00:00:19,500
자막5

5
00:00:19,500 --> 00:00:23,840
자막6`
    act(() => {
      result.current.parseFromSRT(shorterSrt)
    })
    expect(result.current.srtTrack).toHaveLength(5)
    // scene 0 (was 자막1+2+3): 자막3 사라짐 → 2 라인만
    expect(result.current.scenes[0].srtLineIds).toHaveLength(2)
    // scene 1 (was 자막4+5+6): 그대로 3 라인
    expect(result.current.scenes[1].srtLineIds).toHaveLength(3)
  })

  it('8. 묶기 후 CapCut export → 자막 원본 타이밍 (6 라인 모두 출력)', () => {
    const { result } = renderHook(() => useScenes())
    act(() => {
      result.current.parseFromCSV(BUNDLE_CSV)
    })
    const project = {
      srtTrack: result.current.srtTrack,
      scenes: result.current.scenes,
    }
    const srt = generateSRT(project, 'ko')
    expect(srt).toContain('자막1')
    expect(srt).toContain('자막2')
    expect(srt).toContain('자막3')
    expect(srt).toContain('자막4')
    expect(srt).toContain('자막5')
    expect(srt).toContain('자막6')
    // 원본 타이밍 보존
    expect(srt).toContain('00:00:00,000 --> 00:00:03,500')
    expect(srt).toContain('00:00:19,500 --> 00:00:23,840')
  })

  it('8b. 단일 묶인 씬 (3 자막) export → 한 씬이지만 SRT 3 블록 출력', () => {
    const csv = `scene,prompt,subtitle,start_time,end_time
1,"P","A",0,1
1,,"B",1,2
1,,"C",2,3`
    const { result } = renderHook(() => useScenes())
    act(() => {
      result.current.parseFromCSV(csv)
    })
    expect(result.current.scenes).toHaveLength(1)
    expect(result.current.srtTrack).toHaveLength(3)

    const srt = generateSRT({
      srtTrack: result.current.srtTrack,
      scenes: result.current.scenes,
    }, 'ko')
    // 3 SRT 블록 (인덱스 1, 2, 3)
    expect(srt.match(/^[1-3]$/gm)).toHaveLength(3)
    expect(srt).toContain('A')
    expect(srt).toContain('B')
    expect(srt).toContain('C')
  })
})
