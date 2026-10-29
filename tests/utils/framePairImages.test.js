/**
 * framePairImages.test.js — F2V 프레임 id → inline base64/dataUrl 해석 단위 테스트.
 *
 * 회귀 가드: cloud(Veo) 모드에서 디스크 업로드(gallery::) 프레임이 _startImage 로
 * 해석되는지 — Flow mediaId 가 아니라 로컬 dataUrl 로. (이게 비면 실행 시 "No start image".)
 */
import { describe, it, expect, vi } from 'vitest'
import { frameImageFor, resolveFrameImageBase64, stripOmniEndFrame, flowEndFrameDisabled } from '../../src/utils/framePairImages'

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

  // Codex 2차 H1: 씬의 imagePath 가 교체 이미지(다른 파일)를 가리키는데 scenes/<id> 엔 옛 이미지가 남아 있으면 옛 이미지로 과금된다 — 정확한 경로를 먼저 읽는다.
  it('imagePath 를 주면 그 파일을 scenes/<id> 보다 먼저 읽는다', async () => {
    const fs = mkFs({
      readFileByPath: vi.fn(async (p) => (p === '/w/proj/replaced.png' ? { success: true, data: 'data:image/png;base64,NEW' } : { success: false })),
      readImage: vi.fn(async () => ({ success: true, data: 'data:image/png;base64,OLD' })),
    })
    expect(await resolveFrameImageBase64('s1', null, 'proj', { fs, imagePath: '/w/proj/replaced.png' })).toBe('data:image/png;base64,NEW')
    expect(fs.readImage).not.toHaveBeenCalled()
  })

  // Codex 3차 H1: 교체 이미지(다른 파일)를 못 읽으면 scenes/<id> 의 옛 이미지로 넘어가지 않는다(옛 이미지로 과금) — null. 경로가 바로 scenes/<id>.<ext> 면 같은 파일이라 폴백한다(폴더 이동 등).
  it('imagePath 를 못 읽으면: 다른 파일이면 null(옛 이미지로 넘어가지 않는다) · scenes/<id> 자체면 리소스 폴백', async () => {
    const fs = mkFs({ readFileByPath: vi.fn(async () => ({ success: false })), readImage: vi.fn(async () => ({ success: true, data: 'data:image/png;base64,OLD' })) })
    expect(await resolveFrameImageBase64('s1', null, 'proj', { fs, imagePath: '/w/proj/replaced.png' })).toBeNull()
    expect(fs.readImage).not.toHaveBeenCalled()
    expect(await resolveFrameImageBase64('s1', null, 'proj', { fs, imagePath: '/old/place/proj/scenes/s1.jpg' })).toBe('data:image/png;base64,OLD')
  })

  // Fable 최종 리뷰 2: 썸네일(resolveImageSrc)은 imagePath 를 메모리 image 보다 먼저 보여 준다 — update-scene {imagePath} 로 바꾼 뒤 메모리에 옛 dataUrl 이 남아
  //   있으면 화면은 새 이미지인데 옛 바이트로 과금됐다. 읽히는 imagePath 가 메모리보다 먼저다. 못 읽으면 메모리(전과 같다).
  it('읽히는 imagePath 가 메모리 inline 보다 먼저 · 못 읽으면 inline', async () => {
    const fs = mkFs({ readFileByPath: vi.fn(async (p) => (p === '/w/proj/replaced.png' ? { success: true, data: 'data:image/png;base64,NEW' } : { success: false })) })
    expect(await resolveFrameImageBase64('s1', 'data:image/png;base64,OLD_MEM', 'proj', { fs, imagePath: '/w/proj/replaced.png' })).toBe('data:image/png;base64,NEW')
    expect(await resolveFrameImageBase64('s1', 'data:image/png;base64,OLD_MEM', 'proj', { fs, imagePath: '/w/proj/missing.png' })).toBe('data:image/png;base64,OLD_MEM')
    expect(fs.readImage).not.toHaveBeenCalled()
  })

  // Codex 3차 M2: 씬 id 가 없으면(끝 프레임을 뺀 행) 경로가 남아 있어도 읽지 않는다
  it('sceneId 가 없으면 imagePath 도 읽지 않는다', async () => {
    const fs = mkFs({ readFileByPath: vi.fn(async () => ({ success: true, data: 'data:image/png;base64,END' })) })
    expect(await resolveFrameImageBase64('', null, 'proj', { fs, imagePath: '/w/proj/scenes/s2.jpg' })).toBeNull()
    expect(fs.readFileByPath).not.toHaveBeenCalled()
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
    const out = stripOmniEndFrame({ ...pair, _endImagePath: '/w/p/scenes/s2.jpg' }, true)
    expect(out.endSceneId).toBe('')
    expect(out._endMediaId).toBeNull()
    expect(out._endImage).toBeNull()
    expect(out._endImagePath).toBeNull()   // Codex 3차 M2: 경로도 지운다(남으면 숨긴 끝 프레임을 읽어 요청 전체가 거부된다)
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

// 2026-10-30 I2V: 새 Flow 는 시작 프레임만(끝 칸 첨부 미검증) — Flow 모드면 모델과 무관하게 끝 프레임을 끄고 제출에서 뺀다. API(cloud) 모드는 그대로.
describe('flowEndFrameDisabled(appMode, model)', () => {
  it.each([['Omni Flash'], ['Veo 3.1 - Fast'], ['Veo 3.1 - Quality'], [undefined]])('Flow 모드 + %s → true', (model) => {
    expect(flowEndFrameDisabled('flow', model)).toBe(true)
  })
  it.each([['veo-3.1-generate-preview'], ['Omni Flash']])('API 모드 + %s → false (cloud Veo 는 끝 프레임 지원)', (model) => {
    expect(flowEndFrameDisabled('api', model)).toBe(false)
  })
})
