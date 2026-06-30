import { describe, it, expect } from 'vitest'
import { VIDEO_DOWNLOAD_TIMEOUT_MS, IMAGE_UPSCALE_TIMEOUT_MS } from '../../electron/flow-download-config.js'

// Flow DOM 다운로드는 1080p/4K 선택 시 업스케일까지 끝나야 파일이 temp 에 나타난다.
// 동영상 4K 업스케일은 2분으로 부족(라이브 timeout 회귀) → 5분. 이미지는 2분 유지.
describe('flow download/upscale timeouts', () => {
  it('동영상 다운로드는 5분(300000ms)', () => {
    expect(VIDEO_DOWNLOAD_TIMEOUT_MS).toBe(300000)
  })
  it('이미지 업스케일은 2분(120000ms)', () => {
    expect(IMAGE_UPSCALE_TIMEOUT_MS).toBe(120000)
  })
  it('동영상 타임아웃이 이미지보다 길다', () => {
    expect(VIDEO_DOWNLOAD_TIMEOUT_MS).toBeGreaterThan(IMAGE_UPSCALE_TIMEOUT_MS)
  })
})
