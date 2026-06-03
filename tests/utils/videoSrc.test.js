/**
 * videoSrc — 공용 비디오 src/path 변환 유틸 테스트
 *
 * 회귀 방지: VideoDetailModal/SceneList/ResultsTable 에 흩어져 있던 동일 로직을
 * 한 함수로 통합한 뒤, 변환 규칙이 일관되게 유지되는지 검증.
 */

import { describe, it, expect } from 'vitest'
import { resolveVideoSrc, ensureBase64DataUrl } from '../../src/utils/videoSrc'

describe('resolveVideoSrc', () => {
  it('null/undefined/빈 인자 → null', () => {
    expect(resolveVideoSrc(null, null)).toBeNull()
    expect(resolveVideoSrc(undefined, undefined)).toBeNull()
    expect(resolveVideoSrc('', '')).toBeNull()
  })

  it('data URL 은 그대로 반환', () => {
    const dataUrl = 'data:video/mp4;base64,abc123'
    expect(resolveVideoSrc(dataUrl, null)).toBe(dataUrl)
  })

  it('raw base64 (data: prefix 없음) → mp4 data URL 로 감쌈', () => {
    expect(resolveVideoSrc('rawbase64', null)).toBe('data:video/mp4;base64,rawbase64')
  })

  it('POSIX 절대 경로 → file://', () => {
    expect(resolveVideoSrc(null, '/Users/u/v.mp4')).toBe('file:///Users/u/v.mp4')
  })

  it('Windows 절대 경로 → file:///C:/... (백슬래시 → 슬래시)', () => {
    expect(resolveVideoSrc(null, 'C:\\Users\\u\\v.mp4'))
      .toBe('file:///C:/Users/u/v.mp4')
  })

  it('base64 와 path 둘 다 있으면 base64 우선', () => {
    const result = resolveVideoSrc('data:video/mp4;base64,xxx', '/foo/bar.mp4')
    expect(result).toBe('data:video/mp4;base64,xxx')
  })

  it('base64 자리에 실수로 path 가 들어와도 file:// 변환으로 폴백', () => {
    // 호출부 실수 방어 — base64 자리에 path 들어와도 안 깨짐
    expect(resolveVideoSrc('/abs/path.mp4', null)).toBe('file:///abs/path.mp4')
    expect(resolveVideoSrc('C:\\path.mp4', null)).toBe('file:///C:/path.mp4')
  })

  it('http(s)/상대경로 path 는 그대로 (origin 유지)', () => {
    expect(resolveVideoSrc(null, 'https://example.com/v.mp4'))
      .toBe('https://example.com/v.mp4')
    expect(resolveVideoSrc(null, 'media/v.mp4'))
      .toBe('media/v.mp4')
  })

  // 캐시버스터 — 안정 파일명(t2v_N/i2v_N) 재생성 시 stale 회피. filePath 경로에만 ?v= 부착.
  it('filePath + version → ?v= 부착 (POSIX)', () => {
    expect(resolveVideoSrc(null, '/Users/u/v.mp4', { version: 1717000000000 }))
      .toBe('file:///Users/u/v.mp4?v=1717000000000')
  })

  it('filePath + version → ?v= 부착 (Windows)', () => {
    expect(resolveVideoSrc(null, 'C:\\u\\v.mp4', { version: 42 }))
      .toBe('file:///C:/u/v.mp4?v=42')
  })

  it('이미 query 가 있는 path 는 & 로 연결', () => {
    expect(resolveVideoSrc(null, 'https://e.com/v.mp4?x=1', { version: 7 }))
      .toBe('https://e.com/v.mp4?x=1&v=7')
  })

  it('base64/data URL 우선 경로는 version 무관 (캐시 무의미)', () => {
    expect(resolveVideoSrc('data:video/mp4;base64,xxx', '/foo.mp4', { version: 9 }))
      .toBe('data:video/mp4;base64,xxx')
    expect(resolveVideoSrc('rawbase64', null, { version: 9 }))
      .toBe('data:video/mp4;base64,rawbase64')
  })

  it('version 없음/null → 기존과 동일 (?v 미부착, 하위호환)', () => {
    expect(resolveVideoSrc(null, '/v.mp4')).toBe('file:///v.mp4')
    expect(resolveVideoSrc(null, '/v.mp4', {})).toBe('file:///v.mp4')
    expect(resolveVideoSrc(null, '/v.mp4', { version: null })).toBe('file:///v.mp4')
  })
})

describe('ensureBase64DataUrl', () => {
  it('null/undefined/빈 → null', () => {
    expect(ensureBase64DataUrl(null)).toBeNull()
    expect(ensureBase64DataUrl(undefined)).toBeNull()
    expect(ensureBase64DataUrl('')).toBeNull()
  })

  it('data URL 은 그대로 반환', () => {
    const dataUrl = 'data:image/png;base64,xxx'
    expect(ensureBase64DataUrl(dataUrl)).toBe(dataUrl)
  })

  it('raw base64 → 기본 video/mp4 prefix', () => {
    expect(ensureBase64DataUrl('rawbase64'))
      .toBe('data:video/mp4;base64,rawbase64')
  })

  it('mime 타입 커스터마이즈 가능', () => {
    expect(ensureBase64DataUrl('rawbase64', 'image/jpeg'))
      .toBe('data:image/jpeg;base64,rawbase64')
  })
})
