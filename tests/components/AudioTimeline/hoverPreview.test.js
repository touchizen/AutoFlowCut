import { describe, it, expect } from 'vitest'
import { resolveHoverPreviewSrc, findLiveClip } from '../../../src/components/AudioTimeline/hoverPreview'

describe('resolveHoverPreviewSrc', () => {
  it('null hover → undefined', () => {
    expect(resolveHoverPreviewSrc(null)).toBeUndefined()
  })

  it('이미지 클립 → 씬 이미지 src', () => {
    const hover = {
      scene: { id: 'scene_1', imagePath: '/imgs/a.png', generatedAt: 123 },
      clip: { role: 'image' },
    }
    const src = resolveHoverPreviewSrc(hover)
    expect(src).toContain('a.png')
  })

  it('T2V 비디오 클립 → 추출된 포스터(posterDataUrl) 사용, 이미지 아님', () => {
    const hover = {
      scene: { id: 'scene_2', imagePath: '/imgs/b.png' },
      clip: { role: 'video-t2v', posterDataUrl: 'data:image/png;base64,POSTER' },
    }
    expect(resolveHoverPreviewSrc(hover)).toBe('data:image/png;base64,POSTER')
  })

  it('I2V 비디오 클립 → 추출된 포스터 사용', () => {
    const hover = {
      scene: { id: 'scene_3', imagePath: '/imgs/c.png' },
      clip: { role: 'video-i2v', posterDataUrl: 'data:image/png;base64,IPOSTER' },
    }
    expect(resolveHoverPreviewSrc(hover)).toBe('data:image/png;base64,IPOSTER')
  })

  it('비디오 클립인데 포스터 아직 미로드 → 씬 이미지로 폴백하지 않고 undefined', () => {
    const hover = {
      scene: { id: 'scene_4', imagePath: '/imgs/d.png' },
      clip: { role: 'video-t2v', posterDataUrl: null },
    }
    expect(resolveHoverPreviewSrc(hover)).toBeUndefined()
  })

  it('clip 없음(구 경로) → 씬 이미지로 폴백', () => {
    const hover = {
      scene: { id: 'scene_5', imagePath: '/imgs/e.png' },
    }
    expect(resolveHoverPreviewSrc(hover)).toContain('e.png')
  })

  it('이미지 없는 씬 → undefined', () => {
    const hover = { scene: { id: 'scene_6' }, clip: { role: 'image' } }
    expect(resolveHoverPreviewSrc(hover)).toBeUndefined()
  })
})

describe('findLiveClip', () => {
  const data = {
    tracks: [
      { id: 'image', clips: [{ id: 'img-s1', role: 'image' }] },
      { id: 'video-t2v', clips: [{ id: 'vid-t2v-s1', role: 'video-t2v', posterDataUrl: 'data:fresh' }] },
    ],
  }

  it('id 로 현재 data 의 live clip 을 찾는다 (poster 갱신본)', () => {
    expect(findLiveClip(data, 'vid-t2v-s1')).toEqual({ id: 'vid-t2v-s1', role: 'video-t2v', posterDataUrl: 'data:fresh' })
  })

  it('없는 id → null', () => {
    expect(findLiveClip(data, 'nope')).toBeNull()
  })

  it('data/id 없으면 null (크래시 없음)', () => {
    expect(findLiveClip(null, 'x')).toBeNull()
    expect(findLiveClip(data, null)).toBeNull()
  })

  it('hover 중 poster 가 뒤늦게 로드돼도 live clip 재조회로 최신 poster 사용 (P2-b)', () => {
    // hover 시점엔 poster 없던 stale clip 을 들고 있어도, data 에서 재조회하면 최신본.
    const staleHover = { scene: { id: 's1' }, clip: { id: 'vid-t2v-s1', role: 'video-t2v', posterDataUrl: null } }
    const live = findLiveClip(data, staleHover.clip.id)
    expect(resolveHoverPreviewSrc({ ...staleHover, clip: live })).toBe('data:fresh')
  })
})
