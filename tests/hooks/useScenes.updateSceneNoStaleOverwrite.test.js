/**
 * useScenes — review R29 fix
 *
 * updateScene 이 incoming subtitle 이 현재 srtTrack 라인의 text 와 동일하면
 * 무동작. SceneDetailModal 의 stale editData 가 새로 갱신된 srtTrack 라인을
 * 덮어쓰는 회귀 방지.
 */
import { describe, it, expect, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useScenes } from '../../src/hooks/useScenes'

vi.mock('../../src/hooks/useFileSystem', () => ({
  fileSystemAPI: { readFileByPath: vi.fn().mockResolvedValue({ success: false }) },
}))

describe('R29 — updateScene 가 subtitle 동일하면 srtTrack 무동작', () => {
  it('SceneDetailModal stale overwrite 시나리오: 모달 열린 동안 외부에서 srtTrack 갱신됨', () => {
    const { result } = renderHook(() => useScenes())
    act(() => {
      result.current.setSrtTrack([
        { id: 'sub_1', startTime: 0, endTime: 2, text: 'ORIGINAL' },
      ])
      result.current.setScenes([
        { id: 's1', srtLineIds: ['sub_1'], subtitle: 'ORIGINAL', prompt: 'P' },
      ])
    })

    // 외부에서 srtTrack 라인이 'EXTERNAL_UPDATE' 로 바뀜 (예: MCP, 다른 UI)
    act(() => {
      result.current.updateSrtLine('sub_1', 'EXTERNAL_UPDATE')
    })
    expect(result.current.srtTrack[0].text).toBe('EXTERNAL_UPDATE')

    // 모달이 stale 한 editData (subtitle='ORIGINAL') 를 갖고 있다가 저장 시
    // 전체 patch 를 보냄 — subtitle 키는 변경 안 했지만 동일 값 그대로
    act(() => {
      result.current.updateScene('s1', {
        prompt: 'P-edited',
        subtitle: 'ORIGINAL', // stale — 사용자가 안 만진 옛 값
      })
    })

    // R29 fix: srtTrack 라인 (EXTERNAL_UPDATE) 가 stale ORIGINAL 로 덮어써지면 안 됨
    expect(result.current.srtTrack[0].text).toBe('EXTERNAL_UPDATE')
    // scene 의 prompt 갱신은 정상
    expect(result.current.scenes[0].prompt).toBe('P-edited')
  })

  it('동일 subtitle 값 incoming → srtTrack 무동작 (변경 없음)', () => {
    const { result } = renderHook(() => useScenes())
    act(() => {
      result.current.setSrtTrack([
        { id: 'sub_1', startTime: 0, endTime: 1, text: 'A' },
      ])
      result.current.setScenes([
        { id: 's1', srtLineIds: ['sub_1'], subtitle: 'A' },
      ])
    })
    const trackBefore = result.current.srtTrack

    act(() => {
      result.current.updateScene('s1', { subtitle: 'A' }) // 동일 값
    })

    // 같은 reference 유지 (re-render 없음)
    expect(result.current.srtTrack).toBe(trackBefore)
  })

  it('실제 다른 값이면 srtTrack 갱신 (R20 정상 동작)', () => {
    const { result } = renderHook(() => useScenes())
    act(() => {
      result.current.setSrtTrack([
        { id: 'sub_1', startTime: 0, endTime: 1, text: 'A' },
      ])
      result.current.setScenes([
        { id: 's1', srtLineIds: ['sub_1'], subtitle: 'A' },
      ])
    })

    act(() => {
      result.current.updateScene('s1', { subtitle: 'A-edited' })
    })

    expect(result.current.srtTrack[0].text).toBe('A-edited')
  })
})
