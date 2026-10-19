import { describe, it, expect } from 'vitest'
import { flowDownloadResolution } from '../../src/config/genModels'

// Flow 다운로드 해상도는 생성 모델 한계와 무관하게 설정값을 검증만 한다(Codex R2 #2 · Fable #4) — 무엇을 줄지는 Flow 메뉴가 정한다.
describe('flowDownloadResolution', () => {
  it('passes 720p / 1080p / 4k through (case-insensitive)', () => {
    expect(flowDownloadResolution('720p')).toBe('720p')
    expect(flowDownloadResolution('1080p')).toBe('1080p')
    expect(flowDownloadResolution('4K')).toBe('4k')
  })
  it('falls back to 720p (the original, no upscale) for anything else', () => {
    expect(flowDownloadResolution(undefined)).toBe('720p')
    expect(flowDownloadResolution('360p')).toBe('720p')
    expect(flowDownloadResolution('8k')).toBe('720p')
  })
})
