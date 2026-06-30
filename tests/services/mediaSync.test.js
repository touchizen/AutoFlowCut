/**
 * syncVideosIntoScenes — I2V 결과물 동기화 정책 단위 테스트
 *
 * Step 3 이후 T2V 는 scenes 가 single source of truth (useVideoScenes 가 직접
 * scene.videoT2V* 를 갱신). 이 모듈은 I2V (framePair → scene.videoI2V*)
 * 결과물 동기화만 담당한다. T2V 관련 테스트는 제거됨.
 *
 * 회귀 방지 — 이전 정책 ("scene path 가 비어있을 때만 채움")은
 *   recovery / regen 으로 source path 가 바뀌어도 scene 에 옛 path 가 남아 있으면
 *   동기화가 skip 되어 SceneList/export 가 옛 비디오를 사용하는 버그를 만들었다.
 * 새 정책: source 가 권위. source path 가 다르면 overwrite.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { syncVideosIntoScenes } from '../../src/services/mediaSync'

beforeEach(() => {
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

function makeFramePair(overrides = {}) {
  return {
    status: 'complete',
    videoPath: '/path/new-i2v.mp4',
    duration: 8,
    ownerSceneId: 'scene_1',
    startSceneId: 'scene_1',
    ...overrides,
  }
}

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

  it('framePair.generatedAt 을 scene.videoI2VGeneratedAt 로 동기화 (캐시버스터 — 로드/복구 경로)', () => {
    const scenes = [makeScene('scene_1')]
    const framePairs = [makeFramePair({ videoPath: '/path/i2v.mp4', generatedAt: 12345 })]

    const synced = syncVideosIntoScenes(scenes, [], framePairs)

    expect(synced).toBe(true)
    expect(scenes[0].videoI2VGeneratedAt).toBe(12345)
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

  it('ownerSceneId 가 없으면 (gallery-rooted 행) scene 동기화 안 함', () => {
    const scenes = [makeScene('scene_1', { videoI2VPath: '/path/old.mp4' })]
    const framePairs = [makeFramePair({
      videoPath: '/path/new.mp4',
      ownerSceneId: null,
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

  it('ownerSceneId 가 없으면 동기화 안 함', () => {
    const scenes = [makeScene('scene_1')]
    const framePairs = [makeFramePair({ ownerSceneId: null, startSceneId: null })]

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
  it('scenes 가 비어 있으면 false 반환 (I2V 처리 대상 없음)', () => {
    expect(syncVideosIntoScenes([], [], [])).toBe(false)
  })

  it('scenes 가 null 이어도 throw 없이 false', () => {
    expect(syncVideosIntoScenes(null, [], [])).toBe(false)
  })

  it('videoScenes / framePairs 가 null/undefined 이어도 정상 진행', () => {
    const scenes = [makeScene('scene_1')]
    expect(() => syncVideosIntoScenes(scenes, null, undefined)).not.toThrow()
    expect(syncVideosIntoScenes(scenes, null, undefined)).toBe(false)
  })

  it('videoScenes 인자는 무시됨 (T2V 는 scenes 가 source of truth, Step 3+)', () => {
    const scenes = [makeScene('scene_1', { videoT2VPath: null })]
    const videoScenes = [{
      id: 'vscene_1', prompt: 'video prompt', status: 'complete',
      videoPath: '/x.mp4', duration: 5,
    }]
    const synced = syncVideosIntoScenes(scenes, videoScenes, [])
    expect(synced).toBe(false) // T2V sync 안 함
    expect(scenes[0].videoT2VPath).toBeNull() // 변경 없음
  })
})
