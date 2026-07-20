import { describe, expect, it } from 'vitest'
import { baseImageReplacementPatch } from '../../src/utils/imagePatch.js'

describe('baseImageReplacementPatch', () => {
  it('이미지 교체 시 업스케일 마커를 기본으로 비운다', () => {
    expect(baseImageReplacementPatch()).toEqual({
      upscaledAt: null,
      upscaled_size: null,
    })
  })

  it('extra가 기본값을 포함해 마지막에 덮어쓴다', () => {
    expect(baseImageReplacementPatch({
      imagePath: '/scenes/scene_1.png',
      upscaledAt: 123,
    })).toEqual({
      upscaledAt: 123,
      upscaled_size: null,
      imagePath: '/scenes/scene_1.png',
    })
  })
})
