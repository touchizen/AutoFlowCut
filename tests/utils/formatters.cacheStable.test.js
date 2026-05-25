/**
 * resolveImageSrc — review T1 fix
 *
 * ?t=Date.now() 캐시 버스터가 매 render 새 URL 만들어 브라우저 캐시 무력화 +
 * 이미지 재디코딩 폭주. stable version (item.generatedAt 등) 사용.
 */
import { describe, it, expect } from 'vitest'
import { resolveImageSrc } from '../../src/utils/formatters'

describe('T1 — resolveImageSrc returns stable URL across calls', () => {
  it('same item → identical URL (no Date.now churn)', () => {
    const item = { imagePath: '/abs/path/scene_1.png' }
    const u1 = resolveImageSrc(item)
    const u2 = resolveImageSrc(item)
    expect(u1).toBe(u2)
  })

  it('uses item.generatedAt as version query when present', () => {
    const item = { imagePath: '/abs/path/scene_1.png', generatedAt: 1735000000000 }
    const url = resolveImageSrc(item)
    expect(url).toContain('?v=1735000000000')
  })

  it('different generatedAt → different URL (cache bust on regenerate)', () => {
    const a = { imagePath: '/abs/path/scene_1.png', generatedAt: 1735000000000 }
    const b = { imagePath: '/abs/path/scene_1.png', generatedAt: 1735000099999 }
    expect(resolveImageSrc(a)).not.toBe(resolveImageSrc(b))
  })

  it('no version field → no query string (stable, accept stale)', () => {
    const item = { imagePath: '/abs/path/scene_1.png' }
    const url = resolveImageSrc(item)
    expect(url).not.toContain('?t=')
    expect(url).not.toContain('?v=')
    expect(url).toBe('file:///abs/path/scene_1.png')
  })

  it('Windows 경로도 동일 패턴', () => {
    const item = { imagePath: 'C:\\foo\\bar.png', generatedAt: 1234 }
    const url = resolveImageSrc(item)
    expect(url).toBe('file:///C:/foo/bar.png?v=1234')
  })

  it('base64 fallback unchanged (filePath 없을 때)', () => {
    const item = { image: 'data:image/png;base64,XXX' }
    expect(resolveImageSrc(item)).toBe('data:image/png;base64,XXX')
  })
})
