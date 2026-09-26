import { describe, expect, it } from 'vitest'

import { ASS_PATH_TOKEN, FONTS_DIR_TOKEN } from '../../../electron/render/filtergraphTokens.js'

describe('filtergraph placeholder contract', () => {
  it('exports the producer/consumer tokens from one module', () => {
    expect(ASS_PATH_TOKEN).toBe('__ASS_PATH__')
    expect(FONTS_DIR_TOKEN).toBe('__FONTS_DIR__')
  })
})
