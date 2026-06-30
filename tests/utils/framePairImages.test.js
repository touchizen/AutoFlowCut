/**
 * framePairImages.test.js — F2V 프레임 id → inline base64/dataUrl 해석 단위 테스트.
 *
 * 회귀 가드: cloud(Veo) 모드에서 디스크 업로드(gallery::) 프레임이 _startImage 로
 * 해석되는지 — Flow mediaId 가 아니라 로컬 dataUrl 로. (이게 비면 실행 시 "No start image".)
 */
import { describe, it, expect, vi } from 'vitest'
import { frameImageFor, resolveFrameImageBase64, stripOmniEndFrame } from '../../src/utils/framePairImages'

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

describe('resolveFrameImageBase64 (디스크 폴백 — 재오픈 영속성)', () => {
  const mkFs = (over = {}) => ({
    readResource: vi.fn(async () => ({ success: false })),
    readImage: vi.fn(async () => ({ success: false })),
    ...over,
  })

  it('inlineImage 있으면 디스크 접근 없이 그대로 반환', async () => {
    const fs = mkFs()
    expect(await resolveFrameImageBase64('gallery::x', 'data:img;base64,INLINE', 'p', { fs })).toBe('data:img;base64,INLINE')
    expect(fs.readResource).not.toHaveBeenCalled()
    expect(fs.readImage).not.toHaveBeenCalled()
  })

  it('gallery:: → frames/ 리소스에서 읽기 (재오픈 시 메모리 없어도 동작)', async () => {
    const fs = mkFs({ readResource: vi.fn(async () => ({ success: true, data: 'DISK_FRAME' })) })
    const r = await resolveFrameImageBase64('gallery::local-1', null, 'proj', { fs })
    expect(r).toBe('DISK_FRAME')
    expect(fs.readResource).toHaveBeenCalledWith('proj', 'frames', 'local-1')
  })

  it('씬 id → scenes/ readImage 폴백', async () => {
    const fs = mkFs({ readImage: vi.fn(async () => ({ success: true, data: 'DISK_SCENE' })) })
    const r = await resolveFrameImageBase64('s1', null, 'proj', { fs })
    expect(r).toBe('DISK_SCENE')
    expect(fs.readImage).toHaveBeenCalledWith('proj', 's1')
  })

  it('projectName 없으면 null', async () => {
    const fs = mkFs()
    expect(await resolveFrameImageBase64('gallery::x', null, '', { fs })).toBeNull()
  })

  it('디스크 미존재 → null', async () => {
    const fs = mkFs()
    expect(await resolveFrameImageBase64('gallery::x', null, 'p', { fs })).toBeNull()
    expect(await resolveFrameImageBase64('s1', null, 'p', { fs })).toBeNull()
  })
})

describe('stripOmniEndFrame (OmniFlash 종료 프레임 strip)', () => {
  it('OmniFlash 면 endSceneId/_endMediaId/_endImage 를 모두 비운다', () => {
    const pair = {
      id: 'fp_1', startSceneId: 's1', _startMediaId: 'mStart', _startImage: 'data:img;base64,S',
      endSceneId: 's2', _endMediaId: 'mEnd', _endImage: 'data:img;base64,E', prompt: 'p',
    }
    const out = stripOmniEndFrame(pair, true)
    expect(out.endSceneId).toBe('')
    expect(out._endMediaId).toBeNull()
    expect(out._endImage).toBeNull()
    // 시작 프레임/프롬프트는 보존
    expect(out.startSceneId).toBe('s1')
    expect(out._startMediaId).toBe('mStart')
    expect(out._startImage).toBe('data:img;base64,S')
    expect(out.prompt).toBe('p')
    // 원본 불변
    expect(pair.endSceneId).toBe('s2')
  })

  it('OmniFlash 아니면 원본 그대로 (끝 프레임 유지)', () => {
    const pair = { id: 'fp_1', endSceneId: 's2', _endMediaId: 'mEnd', _endImage: 'data:img;base64,E' }
    expect(stripOmniEndFrame(pair, false)).toBe(pair)
  })

  it('null pair 안전', () => {
    expect(stripOmniEndFrame(null, true)).toBeNull()
  })
})
