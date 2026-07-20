import { describe, expect, it } from 'vitest'
import { computeKenBurns } from '../../electron/render/kenBurns.js'
import {
  aspectRatioToRenderFormat,
  kenBurnsPreviewStyle,
  normalizePreviewImageSrc,
  toKenBurnsRatios,
} from '../../src/utils/kenBurnsPreview.js'

function parseTransform(transform) {
  const match = transform.match(
    /^translate\(([-+\d.eE]+)%, ([-+\d.eE]+)%\) scale\(([-+\d.eE]+)\)$/,
  )
  expect(match).not.toBeNull()
  return {
    txPct: Number(match[1]),
    tyPct: Number(match[2]),
    z: Number(match[3]),
  }
}

describe('kenBurnsPreviewStyle', () => {
  const zoomIn = {
    startScale: 1,
    endScale: 1.3,
    startAnchor: { x: 0, y: 0 },
    endAnchor: { x: 1, y: 1 },
  }

  it.each([
    [0, 'translate(0%, 0%) scale(1)'],
    [0.5, 'translate(-7.499999999999996%, -7.499999999999996%) scale(1.15)'],
    [1, 'translate(-30.000000000000004%, -30.000000000000004%) scale(1.3)'],
  ])('zoom-in p=%s의 정확한 transform을 만든다', (p, transform) => {
    expect(kenBurnsPreviewStyle(zoomIn, p)).toEqual({
      transform,
      transformOrigin: '0 0',
    })
  })

  const zoomOut = {
    startScale: 1.3,
    endScale: 1,
    startAnchor: { x: 1, y: 1 },
    endAnchor: { x: 1, y: 1 },
  }

  it.each([
    [0, 'translate(-30.000000000000004%, -30.000000000000004%) scale(1.3)'],
    [0.5, 'translate(-14.999999999999991%, -14.999999999999991%) scale(1.15)'],
    [1, 'translate(0%, 0%) scale(1)'],
  ])('zoom-out p=%s의 정확한 transform을 만든다', (p, transform) => {
    expect(kenBurnsPreviewStyle(zoomOut, p)).toEqual({
      transform,
      transformOrigin: '0 0',
    })
  })

  it.each([
    [{ x: 0, y: 0 }, 'translate(0%, 0%) scale(1.25)'],
    [{ x: 1, y: 1 }, 'translate(-25%, -25%) scale(1.25)'],
    [{ x: 0.5, y: 0.5 }, 'translate(-12.5%, -12.5%) scale(1.25)'],
    // 비대칭 anchor — tx는 ax, ty는 ay에서 나와야 함 (뮤테이션 M5: ty가 ax를 쓰면 죽는 케이스)
    [{ x: 1, y: 0 }, 'translate(-25%, 0%) scale(1.25)'],
    [{ x: 0, y: 1 }, 'translate(0%, -25%) scale(1.25)'],
  ])('anchor %j에서 정확한 이동량을 만든다', (anchor, transform) => {
    const kb = {
      startScale: 1.25,
      endScale: 1.25,
      startAnchor: anchor,
      endAnchor: anchor,
    }

    expect(kenBurnsPreviewStyle(kb, 0.5).transform).toBe(transform)
  })

  it('scale 1 identity에서 -0 없이 정적 transform을 만든다', () => {
    const kb = {
      startScale: 1,
      endScale: 1,
      startAnchor: { x: 1, y: 1 },
      endAnchor: { x: 1, y: 1 },
    }

    expect(kenBurnsPreviewStyle(kb, 0.5)).toEqual({
      transform: 'translate(0%, 0%) scale(1)',
      transformOrigin: '0 0',
    })
  })

  it('진행률을 [0, 1]로 방어적으로 clamp한다', () => {
    expect(kenBurnsPreviewStyle(zoomIn, -1)).toEqual(kenBurnsPreviewStyle(zoomIn, 0))
    expect(kenBurnsPreviewStyle(zoomIn, 2)).toEqual(kenBurnsPreviewStyle(zoomIn, 1))
  })

  it('computeKenBurns 결과의 중간 scale이 export linearExpression의 산술 중점과 같다', () => {
    const kb = computeKenBurns({ id: 'scene-3' }, 2, {
      mode: 'pattern',
      scaleMin: 1,
      scaleMax: 1.3,
    })
    const { z } = parseTransform(kenBurnsPreviewStyle(kb, 0.5).transform)
    const exportMidpoint = kb.startScale + (kb.endScale - kb.startScale) * 0.5

    expect(z).toBe(exportMidpoint)
  })

  it.each([
    [1, 0],
    [1.15, 0.5],
    [1.3, 1],
    [2, 0.25],
  ])('z=%s, ax=%s에서 export crop과 CSS 합성이 같은 구간을 매핑한다', (z, ax) => {
    const kb = {
      startScale: z,
      endScale: z,
      startAnchor: { x: ax, y: 0 },
      endAnchor: { x: ax, y: 0 },
    }
    const { txPct } = parseTransform(kenBurnsPreviewStyle(kb, 0.5).transform)
    const txNorm = txPct / 100
    const cropLeft = (1 - 1 / z) * ax

    expect(-txNorm / z).toBeCloseTo(cropLeft, 12)
    expect(z * cropLeft + txNorm).toBeCloseTo(0, 12)
    expect(z * (cropLeft + 1 / z) + txNorm).toBeCloseTo(1, 12)
  })
})

describe('toKenBurnsRatios', () => {
  it('percent 설정을 export ratio로 변환한다', () => {
    expect(toKenBurnsRatios({
      kenBurnsMode: 'pattern',
      kenBurnsScaleMin: 100,
      kenBurnsScaleMax: 130,
    })).toEqual({
      mode: 'pattern',
      scaleMin: 1,
      scaleMax: 1.3,
    })
  })

  it.each([NaN, undefined, 0])(
    '값이 %s이면 inline export 식과 같은 fallback을 쓴다',
    (value) => {
      expect(toKenBurnsRatios({
        kenBurnsMode: 'random',
        kenBurnsScaleMin: value,
        kenBurnsScaleMax: value,
      })).toEqual({
        mode: 'random',
        scaleMin: 1,
        scaleMax: 1.15,
      })
    },
  )
})

describe('aspectRatioToRenderFormat', () => {
  it.each([
    ['9:16', 'portrait'],
    ['16:9', 'landscape'],
    ['1:1', 'landscape'],
  ])('%s를 export format %s로 매핑한다', (aspectRatio, format) => {
    expect(aspectRatioToRenderFormat(aspectRatio)).toBe(format)
  })
})

describe('normalizePreviewImageSrc', () => {
  it('raw PNG base64를 PNG data URL로 정규화한다', () => {
    const raw = `iVBORw0KGgo${'A'.repeat(80)}`
    expect(normalizePreviewImageSrc(raw)).toBe(`data:image/png;base64,${raw}`)
  })

  it('raw JPEG base64를 JPEG data URL로 정규화한다', () => {
    const raw = `/9j/${'A'.repeat(80)}`
    expect(normalizePreviewImageSrc(raw)).toBe(`data:image/jpeg;base64,${raw}`)
  })

  it.each([
    'data:image/png;base64,AAAA',
    'file:///tmp/image.png',
    'https://example.com/image.png',
    'blob:preview-image',
  ])('이미 사용 가능한 src %s는 그대로 둔다', (src) => {
    expect(normalizePreviewImageSrc(src)).toBe(src)
  })
})
