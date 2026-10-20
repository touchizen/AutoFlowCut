/**
 * AudioPanel findSceneAtTime — 오디오 클립 시각(ms)에 해당하는 씬.
 *
 * 앱 상태의 씬은 camelCase startTime/endTime(숫자)이다 — MCP load_csv 도 2026-10-20 부터 CSV 시각 칸(start_time/end_time)을
 * 빼고 camelCase 만 보낸다(렌더러 normalizeScene 이 snake 키를 먼저 읽어 0초·옛 시각 문제). snake 만 읽으면 시각 매칭이 죽는다.
 */
import { describe, it, expect, vi } from 'vitest'

vi.mock('../../src/hooks/useI18n', () => ({ useI18n: () => ({ t: (k) => k }) }))

const { findSceneAtTime } = await import('../../src/components/AudioPanel')

describe('findSceneAtTime', () => {
  it('camelCase startTime/endTime(앱 상태 형태)로 씬을 찾는다', () => {
    const scenes = [
      { id: 'scene_1', startTime: 0, endTime: 4 },
      { id: 'scene_2', startTime: 4, endTime: 8 },
    ]
    expect(findSceneAtTime(scenes, 5000, [])?.id).toBe('scene_2')
  })

  it('옛 snake 타임코드(start_time/end_time 문자열)도 계속 읽는다', () => {
    const scenes = [{ id: 'scene_1', start_time: '00:00:10,000', end_time: '00:00:12,500' }]
    expect(findSceneAtTime(scenes, 11000, [])?.id).toBe('scene_1')
  })

  it('어느 씬에도 없고 자막도 없으면 null', () => {
    expect(findSceneAtTime([{ id: 'scene_1', startTime: 0, endTime: 4 }], 9000, [])).toBeNull()
  })
})
