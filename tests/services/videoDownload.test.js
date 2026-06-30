/**
 * videoDownload.test.js — cloud 비디오 다운로드 공통 헬퍼 단위 테스트.
 */
import { describe, it, expect, vi } from 'vitest'
import { downloadVideoBase64 } from '../../src/services/videoDownload'

describe('downloadVideoBase64', () => {
  it('videoUrl 없으면 실패', async () => {
    expect(await downloadVideoBase64(vi.fn(), '')).toEqual({ success: false, error: 'No video URL' })
  })

  it('downloadVideo 가 함수가 아니면 실패', async () => {
    expect(await downloadVideoBase64(null, 'https://v/a')).toEqual({ success: false, error: 'downloadVideo unavailable' })
  })

  it('downloadVideo(videoUri) 로 위임하고 결과 반환', async () => {
    const dv = vi.fn().mockResolvedValue({ success: true, base64: 'VID', mimeType: 'video/mp4' })
    const r = await downloadVideoBase64(dv, 'https://v/a', '1080p')
    expect(dv).toHaveBeenCalledWith('https://v/a', '1080p') // #R13-6: resolution threaded through
    expect(r).toEqual({ success: true, base64: 'VID', mimeType: 'video/mp4' })
  })

  it('downloadVideo throw 시 안전하게 실패 반환', async () => {
    const dv = vi.fn().mockRejectedValue(new Error('net'))
    expect(await downloadVideoBase64(dv, 'https://v/a')).toEqual({ success: false, error: 'net' })
  })
})
