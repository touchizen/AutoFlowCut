import { describe, expect, it } from 'vitest'
import {
  baseImageReplacementPatch,
  computeUpscaylTargets,
} from '../../src/utils/imagePatch.js'

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

describe('computeUpscaylTargets', () => {
  const scene = (id, extra = {}) => ({
    id,
    status: 'done',
    imagePath: `/scenes/${id}.png`,
    ...extra,
  })

  it('완료+파일경로+미업스케일 씬만 대상으로 고르고 스킵 사유를 센다', () => {
    const result = computeUpscaylTargets([
      scene('eligible'),
      scene('already', { upscaledAt: 123 }),
      scene('base64-only', { imagePath: null, image: 'BASE64' }),
      scene('pending', { status: 'pending' }),
    ])

    expect(result.targets.map(({ id }) => id)).toEqual(['eligible'])
    expect(result).toMatchObject({
      alreadyUpscaled: 1,
      skippedNoFile: 1,
      skipped: 3,
    })
  })

  it('targetSceneIds가 있으면 해당 씬들 안에서 같은 필터와 카운트를 적용한다', () => {
    const result = computeUpscaylTargets([
      scene('one'),
      scene('two', { upscaledAt: 123 }),
      scene('three', { imagePath: null, image: 'BASE64' }),
    ], ['two', 'three'])

    expect(result.targets).toEqual([])
    expect(result).toMatchObject({
      alreadyUpscaled: 1,
      skippedNoFile: 1,
      skipped: 2,
    })
  })
})
