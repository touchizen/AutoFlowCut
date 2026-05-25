/**
 * srtTrack.js — 자막 트랙 데이터 모델 + 유틸리티 테스트
 *
 * Phase 1 of docs/superpowers/plans/2026-05-25-srt-csv-track-separation.md
 *
 * srtTrack 분리 모델:
 *   - srtTrack: [{ id, startTime, endTime, text }]
 *   - scene.srtLineIds: ["sub_1", "sub_2", ...] — 묶음 식별자
 *   - scene.subtitle 은 srtTrack 에서 계산 (저장 안 함)
 *   - scene.duration 은 srtLineIds 시간 합으로 자동 계산
 */
import { describe, it, expect } from 'vitest'
import {
  allocateSrtLineId,
  getSceneSubtitle,
  getSceneDuration,
  createSrtTrackFromScenes,
  migrateLegacyProject,
} from '../../src/utils/srtTrack'

// ============================================================
// allocateSrtLineId
// ============================================================

describe('allocateSrtLineId', () => {
  it('빈 srtTrack 이면 sub_1 반환', () => {
    expect(allocateSrtLineId([])).toBe('sub_1')
  })

  it('연속 ID 다음 번호 반환', () => {
    const track = [
      { id: 'sub_1', startTime: 0, endTime: 1, text: 'a' },
      { id: 'sub_2', startTime: 1, endTime: 2, text: 'b' },
    ]
    expect(allocateSrtLineId(track)).toBe('sub_3')
  })

  it('갭이 있는 ID 라도 최대 + 1 반환', () => {
    const track = [
      { id: 'sub_1', startTime: 0, endTime: 1, text: 'a' },
      { id: 'sub_5', startTime: 1, endTime: 2, text: 'b' },
    ]
    expect(allocateSrtLineId(track)).toBe('sub_6')
  })

  it('비표준 ID 가 섞여 있어도 sub_N 패턴만 보고 결정', () => {
    const track = [
      { id: 'sub_2', startTime: 0, endTime: 1, text: 'a' },
      { id: 'imported_abc', startTime: 1, endTime: 2, text: 'b' },
    ]
    expect(allocateSrtLineId(track)).toBe('sub_3')
  })

  it('sub_N 패턴이 하나도 없으면 sub_1 반환', () => {
    const track = [
      { id: 'imported_a', startTime: 0, endTime: 1, text: 'a' },
    ]
    expect(allocateSrtLineId(track)).toBe('sub_1')
  })
})

// ============================================================
// getSceneSubtitle
// ============================================================

describe('getSceneSubtitle', () => {
  const track = [
    { id: 'sub_1', startTime: 0,   endTime: 3.5,  text: '자막1' },
    { id: 'sub_2', startTime: 3.5, endTime: 7.0,  text: '자막2' },
    { id: 'sub_3', startTime: 7.0, endTime: 11.0, text: '자막3' },
  ]

  it('단일 라인이면 그 텍스트', () => {
    const scene = { id: 's1', srtLineIds: ['sub_2'] }
    expect(getSceneSubtitle(scene, track)).toBe('자막2')
  })

  it('여러 라인이면 \\n 으로 join', () => {
    const scene = { id: 's1', srtLineIds: ['sub_1', 'sub_2', 'sub_3'] }
    expect(getSceneSubtitle(scene, track)).toBe('자막1\n자막2\n자막3')
  })

  it('srtLineIds 비어있으면 빈 문자열', () => {
    const scene = { id: 's1', srtLineIds: [] }
    expect(getSceneSubtitle(scene, track)).toBe('')
  })

  it('srtLineIds 가 없으면 빈 문자열', () => {
    const scene = { id: 's1' }
    expect(getSceneSubtitle(scene, track)).toBe('')
  })

  it('존재하지 않는 ID 는 스킵', () => {
    const scene = { id: 's1', srtLineIds: ['sub_1', 'sub_999', 'sub_3'] }
    expect(getSceneSubtitle(scene, track)).toBe('자막1\n자막3')
  })

  it('빈 srtTrack 이면 빈 문자열', () => {
    const scene = { id: 's1', srtLineIds: ['sub_1'] }
    expect(getSceneSubtitle(scene, [])).toBe('')
  })

  it('srtTrack 이 undefined 여도 안전', () => {
    const scene = { id: 's1', srtLineIds: ['sub_1'] }
    expect(getSceneSubtitle(scene, undefined)).toBe('')
  })
})

// ============================================================
// getSceneDuration
// ============================================================

describe('getSceneDuration', () => {
  const track = [
    { id: 'sub_1', startTime: 0,   endTime: 3.5,  text: 'a' },
    { id: 'sub_2', startTime: 3.5, endTime: 7.0,  text: 'b' },
    { id: 'sub_3', startTime: 7.0, endTime: 11.0, text: 'c' },
  ]

  it('단일 라인이면 그 라인의 시간 길이', () => {
    const scene = { id: 's1', srtLineIds: ['sub_2'] }
    expect(getSceneDuration(scene, track)).toBeCloseTo(3.5, 5)
  })

  it('여러 라인이면 시간 합', () => {
    const scene = { id: 's1', srtLineIds: ['sub_1', 'sub_2', 'sub_3'] }
    expect(getSceneDuration(scene, track)).toBeCloseTo(11.0, 5)
  })

  it('srtLineIds 없으면 scene.duration fallback', () => {
    const scene = { id: 's1', duration: 4.2 }
    expect(getSceneDuration(scene, track)).toBeCloseTo(4.2, 5)
  })

  it('srtLineIds 없고 duration 도 없으면 0', () => {
    const scene = { id: 's1' }
    expect(getSceneDuration(scene, track)).toBe(0)
  })

  it('존재하지 않는 ID 는 0 으로 처리', () => {
    const scene = { id: 's1', srtLineIds: ['sub_1', 'sub_999'] }
    expect(getSceneDuration(scene, track)).toBeCloseTo(3.5, 5)
  })

  it('srtTrack 비어있고 duration 있으면 duration', () => {
    const scene = { id: 's1', srtLineIds: ['sub_1'], duration: 4.2 }
    expect(getSceneDuration(scene, [])).toBeCloseTo(4.2, 5)
  })
})

// ============================================================
// createSrtTrackFromScenes
// ============================================================

describe('createSrtTrackFromScenes', () => {
  it('빈 scenes 면 빈 srtTrack + 빈 scenes', () => {
    const result = createSrtTrackFromScenes([])
    expect(result.srtTrack).toEqual([])
    expect(result.scenes).toEqual([])
  })

  it('subtitle 있는 씬 1개 → srtTrack 라인 1개', () => {
    const scenes = [
      { id: 'scene_1', subtitle: '자막1', startTime: 0, endTime: 3.5, duration: 3.5, prompt: 'p1' },
    ]
    const result = createSrtTrackFromScenes(scenes)
    expect(result.srtTrack).toHaveLength(1)
    expect(result.srtTrack[0]).toMatchObject({
      startTime: 0,
      endTime: 3.5,
      text: '자막1',
    })
    expect(result.srtTrack[0].id).toMatch(/^sub_\d+$/)

    expect(result.scenes).toHaveLength(1)
    expect(result.scenes[0].srtLineIds).toEqual([result.srtTrack[0].id])
    // 원본 prompt 등 다른 필드 보존
    expect(result.scenes[0].prompt).toBe('p1')
  })

  it('subtitle 빈 씬은 srtTrack 라인 없음, srtLineIds 빈 배열', () => {
    const scenes = [
      { id: 'scene_1', subtitle: '', startTime: 0, endTime: 3.5 },
    ]
    const result = createSrtTrackFromScenes(scenes)
    expect(result.srtTrack).toEqual([])
    expect(result.scenes[0].srtLineIds).toEqual([])
  })

  it('subtitle undefined 인 씬도 srtLineIds 빈 배열', () => {
    const scenes = [
      { id: 'scene_1', startTime: 0, endTime: 3.5 },
    ]
    const result = createSrtTrackFromScenes(scenes)
    expect(result.srtTrack).toEqual([])
    expect(result.scenes[0].srtLineIds).toEqual([])
  })

  it('여러 씬 — 각자 1줄씩, ID 충돌 없음', () => {
    const scenes = [
      { id: 'scene_1', subtitle: 'A', startTime: 0,   endTime: 1 },
      { id: 'scene_2', subtitle: 'B', startTime: 1,   endTime: 2 },
      { id: 'scene_3', subtitle: 'C', startTime: 2,   endTime: 3 },
    ]
    const result = createSrtTrackFromScenes(scenes)
    expect(result.srtTrack).toHaveLength(3)
    const ids = result.srtTrack.map(l => l.id)
    expect(new Set(ids).size).toBe(3) // 모두 unique
    expect(result.srtTrack[0].text).toBe('A')
    expect(result.srtTrack[1].text).toBe('B')
    expect(result.srtTrack[2].text).toBe('C')

    // 각 scene 의 srtLineIds 가 해당 라인 가리킴
    expect(result.scenes[0].srtLineIds).toEqual([result.srtTrack[0].id])
    expect(result.scenes[1].srtLineIds).toEqual([result.srtTrack[1].id])
    expect(result.scenes[2].srtLineIds).toEqual([result.srtTrack[2].id])
  })

  it('시간 정보 없는 씬은 duration 으로 cursor 진행', () => {
    const scenes = [
      { id: 'scene_1', subtitle: 'A', duration: 2 },
      { id: 'scene_2', subtitle: 'B', duration: 3 },
    ]
    const result = createSrtTrackFromScenes(scenes)
    expect(result.srtTrack).toHaveLength(2)
    expect(result.srtTrack[0].startTime).toBe(0)
    expect(result.srtTrack[0].endTime).toBe(2)
    expect(result.srtTrack[1].startTime).toBe(2)
    expect(result.srtTrack[1].endTime).toBe(5)
  })

  it('원본 scenes 객체를 변형하지 않음 (immutable)', () => {
    const scenes = [
      { id: 'scene_1', subtitle: 'A', startTime: 0, endTime: 1 },
    ]
    const original = JSON.parse(JSON.stringify(scenes))
    createSrtTrackFromScenes(scenes)
    expect(scenes).toEqual(original) // 입력 그대로
  })
})

// ============================================================
// migrateLegacyProject
// ============================================================

describe('migrateLegacyProject', () => {
  it('schemaVersion 이미 2 이면 그대로 반환 (no-op)', () => {
    const project = {
      name: 'p',
      schemaVersion: 2,
      srtTrack: [{ id: 'sub_1', startTime: 0, endTime: 1, text: 'x' }],
      scenes: [{ id: 's1', srtLineIds: ['sub_1'] }],
    }
    const result = migrateLegacyProject(project)
    expect(result).toBe(project) // 같은 참조 (변형 없음)
  })

  it('srtTrack 없으면 scenes 의 subtitle 으로 채우고 schemaVersion=2 설정', () => {
    const project = {
      name: 'p',
      scenes: [
        { id: 's1', subtitle: '자막1', startTime: 0, endTime: 1, prompt: 'p1' },
        { id: 's2', subtitle: '자막2', startTime: 1, endTime: 2, prompt: 'p2' },
      ],
    }
    const result = migrateLegacyProject(project)
    expect(result.schemaVersion).toBe(2)
    expect(result.srtTrack).toHaveLength(2)
    expect(result.srtTrack[0].text).toBe('자막1')
    expect(result.srtTrack[1].text).toBe('자막2')

    expect(result.scenes[0].srtLineIds).toEqual([result.srtTrack[0].id])
    expect(result.scenes[1].srtLineIds).toEqual([result.srtTrack[1].id])
    // 원본 prompt 보존
    expect(result.scenes[0].prompt).toBe('p1')
  })

  it('빈 subtitle 인 씬은 srtLineIds 빈 배열로 처리', () => {
    const project = {
      name: 'p',
      scenes: [
        { id: 's1', subtitle: '자막1', startTime: 0, endTime: 1 },
        { id: 's2', subtitle: '',      startTime: 1, endTime: 2 },
      ],
    }
    const result = migrateLegacyProject(project)
    expect(result.srtTrack).toHaveLength(1)
    expect(result.scenes[0].srtLineIds).toHaveLength(1)
    expect(result.scenes[1].srtLineIds).toEqual([])
  })

  it('scenes 가 빈 배열이어도 안전', () => {
    const project = { name: 'p', scenes: [] }
    const result = migrateLegacyProject(project)
    expect(result.schemaVersion).toBe(2)
    expect(result.srtTrack).toEqual([])
    expect(result.scenes).toEqual([])
  })

  it('scenes 가 undefined 여도 안전', () => {
    const project = { name: 'p' }
    const result = migrateLegacyProject(project)
    expect(result.schemaVersion).toBe(2)
    expect(result.srtTrack).toEqual([])
    expect(result.scenes).toEqual([])
  })

  it('원본 project 객체를 변형하지 않음', () => {
    const project = {
      name: 'p',
      scenes: [{ id: 's1', subtitle: 'A', startTime: 0, endTime: 1 }],
    }
    const original = JSON.parse(JSON.stringify(project))
    migrateLegacyProject(project)
    expect(project).toEqual(original)
  })

  it('이미 srtTrack 가지지만 schemaVersion 없는 프로젝트도 buggy: schemaVersion 만 설정', () => {
    // 이론적으로 srtTrack 만 있는 경우 — 새 코드로 만들었지만 버전 표시 빠진 케이스
    const project = {
      name: 'p',
      srtTrack: [{ id: 'sub_1', startTime: 0, endTime: 1, text: 'x' }],
      scenes: [{ id: 's1', srtLineIds: ['sub_1'] }],
    }
    const result = migrateLegacyProject(project)
    expect(result.schemaVersion).toBe(2)
    // srtTrack 보존
    expect(result.srtTrack).toEqual(project.srtTrack)
    expect(result.scenes[0].srtLineIds).toEqual(['sub_1'])
  })
})
