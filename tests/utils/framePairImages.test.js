/**
 * framePairImages.test.js — F2V 프레임 id → inline base64/dataUrl 해석 단위 테스트.
 *
 * 회귀 가드: cloud(Veo) 모드에서 디스크 업로드(gallery::) 프레임이 _startImage 로
 * 해석되는지 — Flow mediaId 가 아니라 로컬 dataUrl 로. (이게 비면 실행 시 "No start image".)
 */
import { describe, it, expect } from 'vitest'
import { frameImageFor } from '../../src/utils/framePairImages'

const scenes = [
  { id: 's1', image: 'data:image/png;base64,SCENE1' },
  { id: 's2', image: null, imagePath: '/disk/s2.png' }, // folder 모드: 메모리 image 는 null
]
const galleryItems = [
  { mediaId: 'local-1', url: 'data:image/png;base64,GAL1', dataUrl: 'data:image/png;base64,GAL1', local: true },
]

describe('frameImageFor', () => {
  it('갤러리(디스크 업로드) → dataUrl 반환 (Flow mediaId 아님)', () => {
    expect(frameImageFor('gallery::local-1', { scenes, galleryItems })).toBe('data:image/png;base64,GAL1')
  })

  it('갤러리 item 을 mediaId 또는 id 로 매칭', () => {
    const items = [{ id: 'g9', url: 'data:image/png;base64,X' }]
    expect(frameImageFor('gallery::g9', { galleryItems: items })).toBe('data:image/png;base64,X')
  })

  it('씬(메모리 이미지) → scene.image', () => {
    expect(frameImageFor('s1', { scenes })).toBe('data:image/png;base64,SCENE1')
  })

  it('folder 모드 씬(image null) → null (useVideoAutomation 이 readImage 로 폴백)', () => {
    expect(frameImageFor('s2', { scenes })).toBeNull()
  })

  it('알 수 없는 id / 누락 입력 → null', () => {
    expect(frameImageFor('gallery::nope', { galleryItems })).toBeNull()
    expect(frameImageFor('sX', { scenes })).toBeNull()
    expect(frameImageFor('', {})).toBeNull()
    expect(frameImageFor(null, {})).toBeNull()
    expect(frameImageFor(undefined, {})).toBeNull()
  })

  it('커스텀 galleryPrefix 지원', () => {
    const items = [{ mediaId: 'a', url: 'U' }]
    expect(frameImageFor('g//a', { galleryItems: items, galleryPrefix: 'g//' })).toBe('U')
  })
})
