// @vitest-environment node

/**
 * aspectRatioTabSuffix — project ratio → Flow Radix Tabs trigger id suffix
 *
 * The integration (actually clicking the tab) lives in `configureFlowMode`
 * (ipc/shared.js) and is covered by shared.configureFlowMode.test.js — the
 * tab must be clicked while the settings menu is still open.
 */

import { describe, it, expect } from 'vitest'
import { aspectRatioTabSuffix } from '../../electron/flow-aspect-ratio-ui.js'

describe('aspectRatioTabSuffix', () => {
  it('maps 16:9 to the LANDSCAPE trigger suffix', () => {
    expect(aspectRatioTabSuffix('16:9')).toBe('-trigger-LANDSCAPE')
  })

  it('maps 9:16 to the PORTRAIT trigger suffix', () => {
    expect(aspectRatioTabSuffix('9:16')).toBe('-trigger-PORTRAIT')
  })

  it('returns null for unsupported / missing ratios', () => {
    expect(aspectRatioTabSuffix('4:3')).toBeNull()
    expect(aspectRatioTabSuffix('3:4')).toBeNull()
    expect(aspectRatioTabSuffix('1:1')).toBeNull()
    expect(aspectRatioTabSuffix(undefined)).toBeNull()
    expect(aspectRatioTabSuffix(null)).toBeNull()
    expect(aspectRatioTabSuffix('')).toBeNull()
  })

  it('returns a suffix that exact-matches only its own tab (guards the 3:4 mis-click)', () => {
    // '-trigger-PORTRAIT' must NOT be a prefix of another trigger id, otherwise
    // an endsWith / [id$=] match for 9:16 could land on 3:4 (-trigger-PORTRAIT_3_4).
    const portrait = aspectRatioTabSuffix('9:16')
    const landscape = aspectRatioTabSuffix('16:9')
    expect('radix-:r46:-trigger-PORTRAIT_3_4'.endsWith(portrait)).toBe(false)
    expect('radix-:r46:-trigger-PORTRAIT'.endsWith(portrait)).toBe(true)
    expect('radix-:r46:-trigger-LANDSCAPE_4_3'.endsWith(landscape)).toBe(false)
    expect('radix-:r46:-trigger-LANDSCAPE'.endsWith(landscape)).toBe(true)
  })
})
