/**
 * mcp-server csv.js — R2 review fix: isNewSceneCSVFormat + bundleSceneCSVRows
 *
 * Renderer 의 parseSceneCSVToTracks 와 동등한 결과 emit 확인.
 */
import { describe, it, expect } from 'vitest'
import { isNewSceneCSVFormat, bundleSceneCSVRows } from '../../mcp-server/lib/csv.js'

describe('isNewSceneCSVFormat', () => {
  it('scene 컬럼 + 정수값 → true', () => {
    expect(isNewSceneCSVFormat(['scene', 'subtitle'], [{ scene: '1', subtitle: 'a' }])).toBe(true)
  })

  it('scene 컬럼 없으면 false', () => {
    expect(isNewSceneCSVFormat(['prompt'], [{ prompt: 'x' }])).toBe(false)
  })

  it('scene 컬럼 비정수 → false (옛 scene_tag alias 케이스)', () => {
    expect(isNewSceneCSVFormat(['scene'], [{ scene: 'courtyard' }])).toBe(false)
  })

  it('빈 rows → false', () => {
    expect(isNewSceneCSVFormat(['scene'], [])).toBe(false)
  })
})

describe('bundleSceneCSVRows', () => {
  it('같은 scene 번호 행이 1개 씬으로 묶임', () => {
    const rows = [
      { scene: '1', prompt: 'P1', subtitle: 'A', start_time: '0', end_time: '1' },
      { scene: '1', prompt: '', subtitle: 'B', start_time: '1', end_time: '2' },
      { scene: '2', prompt: 'P2', subtitle: 'C', start_time: '2', end_time: '3' },
    ]
    const result = bundleSceneCSVRows(rows)
    expect(result.scenes).toHaveLength(2)
    expect(result.scenes[0].srtLineIds).toHaveLength(2)
    expect(result.scenes[1].srtLineIds).toHaveLength(1)
    expect(result.srtTrack).toHaveLength(3)
    expect(result.srtTrack.map(l => l.text)).toEqual(['A', 'B', 'C'])
  })

  it('씬 속성은 첫 행에서만', () => {
    const rows = [
      { scene: '1', prompt: 'FIRST', subtitle: 'a' },
      { scene: '1', prompt: 'IGNORED', subtitle: 'b' },
    ]
    const result = bundleSceneCSVRows(rows)
    expect(result.scenes[0].prompt).toBe('FIRST')
  })

  it('빈 subtitle 행은 srtTrack 에 push 안 됨 (renderer 와 동일)', () => {
    const rows = [
      { scene: '1', subtitle: 'A' },
      { scene: '1', subtitle: '' },
      { scene: '1', subtitle: 'C' },
    ]
    const result = bundleSceneCSVRows(rows)
    expect(result.srtTrack).toHaveLength(2)
    expect(result.srtTrack.map(l => l.text)).toEqual(['A', 'C'])
  })

  it('씬에 _sceneNum 보존 (id-based merge 용)', () => {
    const rows = [{ scene: '5', prompt: 'P' }]
    const result = bundleSceneCSVRows(rows)
    expect(result.scenes[0]._sceneNum).toBe(5)
  })

  it('start_time/end_time 절대값 보존', () => {
    const rows = [{ scene: '1', subtitle: 'A', start_time: '5', end_time: '10' }]
    const result = bundleSceneCSVRows(rows)
    expect(result.srtTrack[0].startTime).toBe(5)
    expect(result.srtTrack[0].endTime).toBe(10)
    expect(result.scenes[0].startTime).toBe(5)
    expect(result.scenes[0].endTime).toBe(10)
  })
})
