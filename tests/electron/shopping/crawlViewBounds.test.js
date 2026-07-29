// @vitest-environment node
import { describe, expect, it } from 'vitest'

import { normalizeShoppingCrawlBounds } from '../../../electron/shopping/crawlViewBounds.js'

describe('normalizeShoppingCrawlBounds', () => {
  it('admits the exact 0×0 hidden sentinel for native-view teardown', () => {
    expect(normalizeShoppingCrawlBounds(
      { x: 0, y: 0, width: 0, height: 0 },
      { width: 1_200, height: 800 },
    )).toEqual({ x: 0, y: 0, width: 0, height: 0 })
  })

  it('admits the hidden sentinel while minimized content bounds are 0×0', () => {
    expect(normalizeShoppingCrawlBounds(
      { x: 0, y: 0, width: 0, height: 0 },
      { width: 0, height: 0 },
      1.25,
    )).toEqual({ x: 0, y: 0, width: 0, height: 0 })
  })

  it('rounds renderer bounds and clamps every edge to the window content area', () => {
    expect(normalizeShoppingCrawlBounds(
      { x: -10.4, y: 790.2, width: 2_000.4, height: 100.4 },
      { width: 1_200, height: 800 },
    )).toEqual({ x: 0, y: 790, width: 1_200, height: 10 })

    expect(normalizeShoppingCrawlBounds(
      { x: 1_199.4, y: -5.2, width: 20.9, height: 50.1 },
      { width: 1_200, height: 800 },
    )).toEqual({ x: 1_199, y: 0, width: 1, height: 50 })
  })

  it('multiplies renderer CSS pixels by zoomFactor before DIP clamping', () => {
    expect(normalizeShoppingCrawlBounds(
      { x: 12, y: 16, width: 200, height: 100 },
      { width: 1_200, height: 800 },
      1.25,
    )).toEqual({ x: 15, y: 20, width: 250, height: 125 })

    expect(normalizeShoppingCrawlBounds(
      { x: 12, y: 16, width: 200, height: 100 },
      { width: 1_200, height: 800 },
      1,
    )).toEqual({ x: 12, y: 16, width: 200, height: 100 })
  })

  it('rejects non-finite, non-positive, or unusable bounds', () => {
    const contentBounds = { width: 1_200, height: 800 }

    expect(normalizeShoppingCrawlBounds(null, contentBounds)).toBeNull()
    expect(normalizeShoppingCrawlBounds(
      { x: 0, y: 0, width: Number.NaN, height: 50 },
      contentBounds,
    )).toBeNull()
    expect(normalizeShoppingCrawlBounds(
      { x: 0, y: 0, width: 0, height: 50 },
      contentBounds,
    )).toBeNull()
    expect(normalizeShoppingCrawlBounds(
      { x: 0, y: 0, width: 50, height: 50 },
      { width: 0, height: 800 },
    )).toBeNull()
  })
})
