/**
 * syncVideosIntoScenes — derived scene path 동기화 정책 단위 테스트
 *
 * 회귀 방지 — 이전 정책 ("scene path 가 비어있을 때만 채움")은
 *   recovery / regen 으로 source path 가 바뀌어도 scene 에 옛 path 가 남아 있으면
 *   동기화가 skip 되어 SceneList/export 가 옛 비디오를 사용하는 버그를 만들었다.
 *
 * 새 정책: source 가 권위. source path 가 다르면 overwrite.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { syncVideosIntoScenes } from '../../src/services/mediaSync'

beforeEach(() => {
  // 동기화 로그가 테스트 출력을 어지럽히지 않도록 silence — 호출 횟수는 검증 안 함
  vi.spyOn(console, 'log').mockImplementation(() => {})
})

// ─── 헬퍼 ────────────────────────────────────────────────
function makeScene(id, overrides = {}) {
  return {
    id,
    image: null,
    imagePath: null,
    videoT2VPath: null,
    videoI2VPath: null,
    videoT2VDuration: null,
    videoI2VDuration: null,
    duration: 3,
    ...overrides,
  }
}

function makeT2V(id, overrides = {}) {
  // id 는 'vscene_N' — syncVideosIntoScenes 가 'scene_N' 으로 매핑
  return {
    id,
    status: 'complete',
    videoPath: '/path/new.mp4',
    duration: 8,
    ...overrides,
  }
}

function makeFramePair(overrides = {}) {
  return {
    status: 'complete',
    videoPath: '/path/new-i2v.mp4',
    duration: 8,
    startSceneId: 'scene_1',
    ...overrides,
  }
}

// ─── T2V ────────────────────────────────────────────────
describe('syncVideosIntoScenes — T2V', () => {
  it('scene 에 path 가 비어 있고 vscene 에 새 path 있으면 채운다', () => {
    const scenes = [makeScene('scene_1')]
    const videoScenes = [makeT2V('vscene_1', { videoPath: '/path/v1.mp4' })]

    const synced = syncVideosIntoScenes(scenes, videoScenes, [])

    expect(synced).toBe(true)
    expect(scenes[0].videoT2VPath).toBe('/path/v1.mp4')
  })

  it('scene 에 옛 path 가 있고 vscene 의 새 path 와 다르면 overwrite (회귀 방지)', () => {
    const scenes = [makeScene('scene_1', { videoT2VPath: '/path/old.mp4' })]
    const videoScenes = [makeT2V('vscene_1', { videoPath: '/path/new.mp4' })]

    const synced = syncVideosIntoScenes(scenes, videoScenes, [])

    expect(synced).toBe(true)
    expect(scenes[0].videoT2VPath).toBe('/path/new.mp4')
  })

  it('scene path 와 vscene path 가 같으면 변경 없음 (synced=false)', () => {
    // duration 도 같게 맞춰야 path-only 검증이 됨 (duration 불일치 시 그쪽에서 synced=true 가 됨)
    const scenes = [makeScene('scene_1', {
      videoT2VPath: '/path/same.mp4',
      videoT2VDuration: 8,
    })]
    const videoScenes = [makeT2V('vscene_1', { videoPath: '/path/same.mp4', duration: 8 })]

    const synced = syncVideosIntoScenes(scenes, videoScenes, [])

    expect(synced).toBe(false)
    expect(scenes[0].videoT2VPath).toBe('/path/same.mp4')
  })

  it('vscene 의 videoPath 가 비어 있으면 scene 에 path 가 있어도 null 로 정리 (drain stale)', () => {
    // 정책 결정: source 가 권위 — source 에 path 가 없으면 scene 에도 없어야 한다.
    const scenes = [makeScene('scene_1', { videoT2VPath: '/path/stale.mp4' })]
    // videoPath 없지만 video(base64) 가 있는 케이스 → fallback 가드 통과만 함, 실제 path 는 null
    const videoScenes = [makeT2V('vscene_1', { videoPath: null, video: 'data:base64...' })]

    const synced = syncVideosIntoScenes(scenes, videoScenes, [])

    expect(synced).toBe(true)
    expect(scenes[0].videoT2VPath).toBeNull()
  })

  it('vscene 의 status 가 complete/done 이 아니면 동기화 안 함', () => {
    const scenes = [makeScene('scene_1')]
    const videoScenes = [makeT2V('vscene_1', { status: 'pending' })]

    const synced = syncVideosIntoScenes(scenes, videoScenes, [])

    expect(synced).toBe(false)
    expect(scenes[0].videoT2VPath).toBeNull()
  })

  it('vscene 에 video/videoPath 둘 다 없으면 동기화 안 함 (불완전 상태)', () => {
    const scenes = [makeScene('scene_1', { videoT2VPath: '/path/old.mp4' })]
    const videoScenes = [makeT2V('vscene_1', { videoPath: null, video: null })]

    const synced = syncVideosIntoScenes(scenes, videoScenes, [])

    expect(synced).toBe(false)
    expect(scenes[0].videoT2VPath).toBe('/path/old.mp4')
  })

  it('status="done" 도 complete 와 동일하게 처리', () => {
    const scenes = [makeScene('scene_1')]
    const videoScenes = [makeT2V('vscene_1', { status: 'done', videoPath: '/path/done.mp4' })]

    const synced = syncVideosIntoScenes(scenes, videoScenes, [])

    expect(synced).toBe(true)
    expect(scenes[0].videoT2VPath).toBe('/path/done.mp4')
  })

  it('vscene 에 매칭되는 scene 이 없으면 무시', () => {
    const scenes = [makeScene('scene_1')]
    const videoScenes = [makeT2V('vscene_99')] // scene_99 없음

    const synced = syncVideosIntoScenes(scenes, videoScenes, [])

    expect(synced).toBe(false)
  })

  it('duration 도 다를 때 overwrite 한다', () => {
    const scenes = [makeScene('scene_1', { videoT2VDuration: 3 })]
    const videoScenes = [makeT2V('vscene_1', { duration: 8 })]

    const synced = syncVideosIntoScenes(scenes, videoScenes, [])

    expect(synced).toBe(true)
    expect(scenes[0].videoT2VDuration).toBe(8)
  })

  it('duration 만 같고 path 만 다르면 path 만 동기화', () => {
    const scenes = [makeScene('scene_1', {
      videoT2VPath: '/path/old.mp4',
      videoT2VDuration: 8,
    })]
    const videoScenes = [makeT2V('vscene_1', {
      videoPath: '/path/new.mp4',
      duration: 8,
    })]

    const synced = syncVideosIntoScenes(scenes, videoScenes, [])

    expect(synced).toBe(true)
    expect(scenes[0].videoT2VPath).toBe('/path/new.mp4')
    expect(scenes[0].videoT2VDuration).toBe(8)
  })
})

// ─── I2V ────────────────────────────────────────────────
describe('syncVideosIntoScenes — I2V (framePairs)', () => {
  it('scene 에 path 가 비어 있고 framePair 에 새 path 있으면 채운다', () => {
    const scenes = [makeScene('scene_1')]
    const framePairs = [makeFramePair({
      videoPath: '/path/i1.mp4',
      startSceneId: 'scene_1',
    })]

    const synced = syncVideosIntoScenes(scenes, [], framePairs)

    expect(synced).toBe(true)
    expect(scenes[0].videoI2VPath).toBe('/path/i1.mp4')
  })

  it('scene 에 옛 path 가 있고 framePair 의 새 path 와 다르면 overwrite (회귀 방지)', () => {
    const scenes = [makeScene('scene_1', { videoI2VPath: '/path/old-i2v.mp4' })]
    const framePairs = [makeFramePair({
      videoPath: '/path/new-i2v.mp4',
      startSceneId: 'scene_1',
    })]

    const synced = syncVideosIntoScenes(scenes, [], framePairs)

    expect(synced).toBe(true)
    expect(scenes[0].videoI2VPath).toBe('/path/new-i2v.mp4')
  })

  it('scene path 와 framePair path 가 같으면 변경 없음', () => {
    const scenes = [makeScene('scene_1', {
      videoI2VPath: '/path/same-i2v.mp4',
      videoI2VDuration: 8,
    })]
    const framePairs = [makeFramePair({
      videoPath: '/path/same-i2v.mp4',
      duration: 8,
      startSceneId: 'scene_1',
    })]

    const synced = syncVideosIntoScenes(scenes, [], framePairs)

    expect(synced).toBe(false)
    expect(scenes[0].videoI2VPath).toBe('/path/same-i2v.mp4')
  })

  it('startSceneId 가 "gallery::"로 시작하면 scene 동기화 안 함 (gallery 전용)', () => {
    const scenes = [makeScene('scene_1', { videoI2VPath: '/path/old.mp4' })]
    const framePairs = [makeFramePair({
      videoPath: '/path/new.mp4',
      startSceneId: 'gallery::abc123',
    })]

    const synced = syncVideosIntoScenes(scenes, [], framePairs)

    expect(synced).toBe(false)
    expect(scenes[0].videoI2VPath).toBe('/path/old.mp4')
  })

  it('framePair status 가 complete/done 이 아니면 동기화 안 함', () => {
    const scenes = [makeScene('scene_1')]
    const framePairs = [makeFramePair({
      status: 'pending',
      startSceneId: 'scene_1',
    })]

    const synced = syncVideosIntoScenes(scenes, [], framePairs)

    expect(synced).toBe(false)
  })

  it('startSceneId 가 없으면 동기화 안 함', () => {
    const scenes = [makeScene('scene_1')]
    const framePairs = [makeFramePair({ startSceneId: null })]

    const synced = syncVideosIntoScenes(scenes, [], framePairs)

    expect(synced).toBe(false)
  })

  it('I2V duration 도 다를 때 overwrite 한다', () => {
    const scenes = [makeScene('scene_1', { videoI2VDuration: 3 })]
    const framePairs = [makeFramePair({
      duration: 8,
      startSceneId: 'scene_1',
    })]

    const synced = syncVideosIntoScenes(scenes, [], framePairs)

    expect(synced).toBe(true)
    expect(scenes[0].videoI2VDuration).toBe(8)
  })
})

// ─── Edge cases ────────────────────────────────────────────
describe('syncVideosIntoScenes — edge cases', () => {
  it('scenes 가 비어 있으면 false 반환', () => {
    expect(syncVideosIntoScenes([], [{ status: 'complete', videoPath: '/x' }], [])).toBe(false)
  })

  it('scenes 가 null 이어도 throw 없이 false', () => {
    expect(syncVideosIntoScenes(null, [], [])).toBe(false)
  })

  it('videoScenes / framePairs 가 null/undefined 이어도 정상 진행', () => {
    const scenes = [makeScene('scene_1')]
    expect(() => syncVideosIntoScenes(scenes, null, undefined)).not.toThrow()
    expect(syncVideosIntoScenes(scenes, null, undefined)).toBe(false)
  })

  it('T2V + I2V 동시에 동기화될 수 있다', () => {
    const scenes = [makeScene('scene_1')]
    const videoScenes = [makeT2V('vscene_1', { videoPath: '/path/t2v.mp4' })]
    const framePairs = [makeFramePair({
      videoPath: '/path/i2v.mp4',
      startSceneId: 'scene_1',
    })]

    const synced = syncVideosIntoScenes(scenes, videoScenes, framePairs)

    expect(synced).toBe(true)
    expect(scenes[0].videoT2VPath).toBe('/path/t2v.mp4')
    expect(scenes[0].videoI2VPath).toBe('/path/i2v.mp4')
  })

  it('여러 scene/vscene 매칭 — 각 scene 이 자신의 vscene 과 매칭', () => {
    const scenes = [
      makeScene('scene_1'),
      makeScene('scene_2'),
      makeScene('scene_3'),
    ]
    const videoScenes = [
      makeT2V('vscene_1', { videoPath: '/v1.mp4' }),
      makeT2V('vscene_3', { videoPath: '/v3.mp4' }),
      // vscene_2 없음
    ]

    const synced = syncVideosIntoScenes(scenes, videoScenes, [])

    expect(synced).toBe(true)
    expect(scenes[0].videoT2VPath).toBe('/v1.mp4')
    expect(scenes[1].videoT2VPath).toBeNull() // 매칭 없음
    expect(scenes[2].videoT2VPath).toBe('/v3.mp4')
  })
})
