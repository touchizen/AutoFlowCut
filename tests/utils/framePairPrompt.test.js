/**
 * getFramePairEffectivePrompt — promptSource 별 effective prompt 단위 테스트.
 *
 * 회귀 가드: ResultsTable 표시와 generation path 가 모두 이 함수를 통과해야 silently
 * mismatch 가 안 난다 (UI 는 옛 값, generation 은 새 값을 쓰는 등).
 */
import { describe, it, expect } from 'vitest'
import { getFramePairEffectivePrompt } from '../../src/utils/framePairPrompt'

const VIDEO_SCENES = [
  { id: 'vscene_1', prompt: 'owner video prompt' },
  { id: 'vscene_2', prompt: 'another video prompt' },
]

const SCENES = [
  // SCENES 는 useVideoScenes 의 source. videoT2VPrompt 가 truthy 면 VIDEO_SCENES 에 derive 됨.
  // 페어링: scene_N.videoT2VPrompt === vscene_N.prompt (정상 상태).
  { id: 'scene_1', prompt: 'CURRENT scene 1 image prompt', videoT2VPrompt: 'owner video prompt' },
  { id: 'scene_2', prompt: 'CURRENT scene 2 image prompt', videoT2VPrompt: 'another video prompt' },
]

describe('getFramePairEffectivePrompt', () => {
  it('image 모드 (scene-bound) → owner scene.prompt 가 진실 (pair.prompt 무시)', () => {
    // 회귀: pair.prompt 는 행 생성 시 스냅샷이라 stale 가능. scene.prompt 가 진실.
    const pair = { prompt: 'STALE-SNAPSHOT', videoPrompt: 'VID', customPrompt: 'CUS', ownerSceneId: 'scene_1' }
    expect(getFramePairEffectivePrompt(pair, 'image', VIDEO_SCENES, SCENES)).toBe('CURRENT scene 1 image prompt')
  })

  it('image 모드 (gallery-rooted, ownerSceneId=null) → pair.prompt 폴백', () => {
    const pair = { prompt: 'GALLERY-IMG', ownerSceneId: null }
    expect(getFramePairEffectivePrompt(pair, 'image', VIDEO_SCENES, SCENES)).toBe('GALLERY-IMG')
  })

  it('image 모드 (scenes 없을 때 / scene 못 찾음) → pair.prompt 폴백', () => {
    const pair = { prompt: 'PAIR-FALLBACK', ownerSceneId: 'scene_999' }
    expect(getFramePairEffectivePrompt(pair, 'image', VIDEO_SCENES, SCENES)).toBe('PAIR-FALLBACK')
    expect(getFramePairEffectivePrompt(pair, 'image', VIDEO_SCENES)).toBe('PAIR-FALLBACK')
  })

  it('image 모드 + 빈 prompt → 빈 문자열', () => {
    const pair = { prompt: '', ownerSceneId: 'scene_1' }
    // scene.prompt 가 있으면 scene 진실 ↓
    expect(getFramePairEffectivePrompt(pair, 'image', VIDEO_SCENES, SCENES)).toBe('CURRENT scene 1 image prompt')
    // scene.prompt 도 비면 빈 문자열
    const emptyScenes = [{ id: 'scene_1', prompt: '' }]
    expect(getFramePairEffectivePrompt(pair, 'image', VIDEO_SCENES, emptyScenes)).toBe('')
  })

  it('video 모드 (scene-bound) → owner T2V prompt 가 진실 (pair.videoPrompt 무시)', () => {
    // 회귀: pair.videoPrompt 는 legacy. T2V 탭에서 video prompt 바꾸면 F→V 도 자동 sync.
    const pair = { prompt: 'IMG', videoPrompt: 'LEGACY-OVERRIDE', ownerSceneId: 'scene_1' }
    expect(getFramePairEffectivePrompt(pair, 'video', VIDEO_SCENES, SCENES)).toBe('owner video prompt')
  })

  it('video 모드 + owner scene 없음 → pair.videoPrompt 폴백 (legacy 호환)', () => {
    const pair = { prompt: 'IMG', videoPrompt: 'LEGACY-PAIR', ownerSceneId: 'scene_999' }
    expect(getFramePairEffectivePrompt(pair, 'video', VIDEO_SCENES, SCENES)).toBe('LEGACY-PAIR')
  })

  it('video 모드: scene.videoT2VPrompt="" (빈 문자열) → authoritative, legacy pair.videoPrompt 부활 X', () => {
    // 회귀: useVideoScenes 의 derived videoScenes 는 truthy filter 라 빈 문자열이면 vscene 이
    // 사라져버려, matchedV 기반 lookup 만 쓰면 pair.videoPrompt 가 부활. scene 자체에서 직접
    // lookup 하면 빈 문자열도 authoritative 로 인식.
    const pair = { prompt: 'IMG', videoPrompt: 'LEGACY-OVERRIDE', ownerSceneId: 'scene_1' }
    const scenesWithEmptyT2V = [{ id: 'scene_1', prompt: 'image prompt', videoT2VPrompt: '' }]
    // videoScenes 는 truthy filter 후 빈 배열 — 실제 useVideoScenes 동작 시뮬레이션
    const derivedVideoScenes = []
    expect(getFramePairEffectivePrompt(pair, 'video', derivedVideoScenes, scenesWithEmptyT2V)).toBe('')
  })

  it('video 모드: scene 에 videoT2VPrompt 필드 자체 없음 → pair.videoPrompt 폴백 (legacy/image-only scene)', () => {
    // 이미지만 생성된 scene (videoT2VPrompt 필드 미정의) — 사용자 데이터 보존 위해 pair fallback.
    const pair = { prompt: 'IMG', videoPrompt: 'LEGACY-PAIR', ownerSceneId: 'scene_1' }
    const scenesWithoutT2V = [{ id: 'scene_1', prompt: 'image prompt' }]
    expect(getFramePairEffectivePrompt(pair, 'video', [], scenesWithoutT2V)).toBe('LEGACY-PAIR')
  })

  it('video 모드 + scene 에 videoT2VPrompt 필드 없음 + pair.videoPrompt 비면 owner scene.prompt → pair.prompt fallback', () => {
    // 새 모델: scene.videoT2VPrompt 가 '필드 자체로 정의됨' 이면 authoritative (빈 문자열도).
    // 따라서 image fallback 발동 조건은 scene 에 필드 자체가 없는 케이스 (legacy / image-only scene).
    const pair = { prompt: 'STALE', videoPrompt: '', ownerSceneId: 'scene_1' }
    const scenesNoT2V = [{ id: 'scene_1', prompt: 'CURRENT scene 1 image prompt' }]  // videoT2VPrompt 미정의
    expect(getFramePairEffectivePrompt(pair, 'video', [], scenesNoT2V)).toBe('CURRENT scene 1 image prompt')
  })

  it('video 모드 + ownerSceneId 없음(gallery-rooted)도 안전하게 처리', () => {
    const pair = { prompt: 'IMG', videoPrompt: '', ownerSceneId: null }
    expect(getFramePairEffectivePrompt(pair, 'video', VIDEO_SCENES, SCENES)).toBe('IMG')
  })

  it('none 모드 → pair.customPrompt', () => {
    const pair = { prompt: 'IMG', videoPrompt: 'VID', customPrompt: 'CUSTOM', ownerSceneId: 'scene_1' }
    expect(getFramePairEffectivePrompt(pair, 'none', VIDEO_SCENES, SCENES)).toBe('CUSTOM')
  })

  it('none 모드 + customPrompt 없음 → 빈 문자열 (image 로 fallback 안 함)', () => {
    const pair = { prompt: 'IMG', customPrompt: '', ownerSceneId: 'scene_1' }
    expect(getFramePairEffectivePrompt(pair, 'none', VIDEO_SCENES, SCENES)).toBe('')
  })

  it('null/undefined pair 안전 처리', () => {
    expect(getFramePairEffectivePrompt(null, 'image', VIDEO_SCENES, SCENES)).toBe('')
    expect(getFramePairEffectivePrompt(undefined, 'video', VIDEO_SCENES, SCENES)).toBe('')
  })

  it('videoScenes/scenes 미전달 (default) 시도 crash 없음', () => {
    const pair = { prompt: 'IMG', ownerSceneId: 'scene_1' }
    expect(getFramePairEffectivePrompt(pair, 'image')).toBe('IMG')
    expect(getFramePairEffectivePrompt(pair, 'video')).toBe('IMG')
    expect(getFramePairEffectivePrompt(pair, 'none')).toBe('')
  })
})
