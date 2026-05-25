/**
 * parseSceneCSVToTracks — Review fix 2 (C12)
 *
 * C12: 빈 subtitle 행은 srtTrack 에 push 안 함 (ghost line 방지)
 */
import { describe, it, expect } from 'vitest'
import { parseSceneCSVToTracks } from '../../src/utils/parsers'

describe('C12 — parseSceneCSVToTracks 빈 subtitle 행 처리', () => {
  it('빈 subtitle 행은 srtTrack 에 push 안 함', () => {
    const csv = `scene,subtitle,start_time,end_time
1,"A",0,1
1,,1,2
1,"C",2,3`
    const result = parseSceneCSVToTracks(csv)
    expect(result.srtTrack).toHaveLength(2)
    expect(result.srtTrack.map(l => l.text)).toEqual(['A', 'C'])
  })

  it('씬의 srtLineIds 도 빈 행 제외', () => {
    const csv = `scene,subtitle,start_time,end_time
1,"A",0,1
1,,1,2
1,"C",2,3`
    const result = parseSceneCSVToTracks(csv)
    expect(result.scenes[0].srtLineIds).toEqual([
      result.srtTrack[0].id,
      result.srtTrack[1].id,
    ])
  })

  it('모든 행이 빈 subtitle 이면 그 씬 srtLineIds=[] + srtTrack 비어있음', () => {
    const csv = `scene,prompt,subtitle\n1,"P",`
    const result = parseSceneCSVToTracks(csv)
    expect(result.scenes).toHaveLength(1)
    expect(result.scenes[0].srtLineIds).toEqual([])
    expect(result.srtTrack).toEqual([])
  })

  it('multi-scene, 중간 빈 행 + 후방 호환 subtitle 필드도 비-빈만 join', () => {
    const csv = `scene,prompt,subtitle,start_time,end_time
1,"P1","A",0,1
1,,,1,2
1,,"C",2,3
2,"P2","D",3,4`
    const result = parseSceneCSVToTracks(csv)
    expect(result.scenes).toHaveLength(2)
    expect(result.scenes[0].srtLineIds).toHaveLength(2)
    expect(result.scenes[0].subtitle).toBe('A\nC')
    expect(result.scenes[1].srtLineIds).toHaveLength(1)
  })
})
