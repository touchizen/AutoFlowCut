// M1-10 (D8-2): flow.google.com 에서 업스케일은 미지원(flow:upscale-image → flow-feature-unsupported). tryUpscaleImage 가
//   그 실패를 "원본 사용"으로 삼키면 사용자가 2k 를 켜 둔 채 조용히 원본을 받는다 — 그 kind 만은 throw 로 올린다.
//   그 외 실패(서버 오류 등)는 기존대로 원본 폴백(null).
import { describe, it, expect, vi } from 'vitest'
import { tryUpscaleImage } from '../../src/utils/imageProcessing'

describe('tryUpscaleImage — flow-feature-unsupported 백스톱', () => {
  it('upscaleImage 가 errorKind:flow-feature-unsupported 면 flow-upscale-unsupported 로 throw (삼키지 않는다)', async () => {
    const genAPI = { upscaleImage: vi.fn().mockResolvedValue({ success: false, errorKind: 'flow-feature-unsupported', error: 'flow-feature-unsupported:upscale-image' }) }
    let err
    try { await tryUpscaleImage(genAPI, 'm1', '2k', '[T]') } catch (e) { err = e }
    expect(err).toBeInstanceOf(Error)
    expect(err.errorKind).toBe('flow-upscale-unsupported')
    expect(err.message).toBe('flow-upscale-unsupported')
    expect(err.errorParams).toEqual({})
  })

  it('그 외 실패는 기존대로 원본(null)', async () => {
    const genAPI = { upscaleImage: vi.fn().mockResolvedValue({ success: false, error: 'server exploded' }) }
    await expect(tryUpscaleImage(genAPI, 'm1', '2k', '[T]')).resolves.toBeNull()
    const throwing = { upscaleImage: vi.fn().mockRejectedValue(new Error('boom')) }
    await expect(tryUpscaleImage(throwing, 'm1', '2k', '[T]')).resolves.toBeNull()
  })

  it('off / mediaId 없음 → 호출 없이 null', async () => {
    const genAPI = { upscaleImage: vi.fn() }
    await expect(tryUpscaleImage(genAPI, 'm1', 'off')).resolves.toBeNull()
    await expect(tryUpscaleImage(genAPI, null, '2k')).resolves.toBeNull()
    expect(genAPI.upscaleImage).not.toHaveBeenCalled()
  })
})
