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

describe('getFramePairEffectivePrompt', () => {
  it('image 모드 → pair.prompt', () => {
    const pair = { prompt: 'IMG', videoPrompt: 'VID', customPrompt: 'CUS', ownerSceneId: 'scene_1' }
    expect(getFramePairEffectivePrompt(pair, 'image', VIDEO_SCENES)).toBe('IMG')
  })

  it('image 모드 + 빈 prompt → 빈 문자열 (undefined 아님)', () => {
    const pair = { prompt: '', ownerSceneId: 'scene_1' }
    expect(getFramePairEffectivePrompt(pair, 'image', VIDEO_SCENES)).toBe('')
  })

  it('video 모드 → pair.videoPrompt 우선', () => {
    const pair = { prompt: 'IMG', videoPrompt: 'VID-EXPLICIT', ownerSceneId: 'scene_1' }
    expect(getFramePairEffectivePrompt(pair, 'video', VIDEO_SCENES)).toBe('VID-EXPLICIT')
  })

  it('video 모드 + videoPrompt 비면 owner 씬의 T2V prompt 로 fallback', () => {
    const pair = { prompt: 'IMG', videoPrompt: '', ownerSceneId: 'scene_1' }
    expect(getFramePairEffectivePrompt(pair, 'video', VIDEO_SCENES)).toBe('owner video prompt')
  })

  it('video 모드 + videoPrompt/owner 둘 다 비면 image prompt 로 fallback', () => {
    const pair = { prompt: 'IMG', videoPrompt: '', ownerSceneId: 'scene_999' }
    expect(getFramePairEffectivePrompt(pair, 'video', VIDEO_SCENES)).toBe('IMG')
  })

  it('video 모드 + ownerSceneId 없음(gallery-rooted)도 안전하게 처리', () => {
    const pair = { prompt: 'IMG', videoPrompt: '', ownerSceneId: null }
    expect(getFramePairEffectivePrompt(pair, 'video', VIDEO_SCENES)).toBe('IMG')
  })

  it('none 모드 → pair.customPrompt', () => {
    const pair = { prompt: 'IMG', videoPrompt: 'VID', customPrompt: 'CUSTOM', ownerSceneId: 'scene_1' }
    expect(getFramePairEffectivePrompt(pair, 'none', VIDEO_SCENES)).toBe('CUSTOM')
  })

  it('none 모드 + customPrompt 없음 → 빈 문자열 (image 로 fallback 안 함)', () => {
    // none 모드는 의도적으로 "다른 모든 프롬프트 무시" 의미이므로 fallback 금지.
    const pair = { prompt: 'IMG', customPrompt: '', ownerSceneId: 'scene_1' }
    expect(getFramePairEffectivePrompt(pair, 'none', VIDEO_SCENES)).toBe('')
  })

  it('null/undefined pair 안전 처리', () => {
    expect(getFramePairEffectivePrompt(null, 'image', VIDEO_SCENES)).toBe('')
    expect(getFramePairEffectivePrompt(undefined, 'video', VIDEO_SCENES)).toBe('')
  })

  it('videoScenes 미전달 (default) 시 video 모드 fallback 은 image 로', () => {
    const pair = { prompt: 'IMG', videoPrompt: '', ownerSceneId: 'scene_1' }
    expect(getFramePairEffectivePrompt(pair, 'video')).toBe('IMG')
  })
})
