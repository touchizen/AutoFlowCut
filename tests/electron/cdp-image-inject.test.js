// @vitest-environment node

/**
 * injectImageBatchBody — batchGenerateImages request-body injection
 *
 * This is the core of the aspect-ratio fix: the project ratio is enforced by
 * rewriting requests[].imageAspectRatio in the outgoing request body (CDP
 * Fetch interception), not by clicking Flow's UI. Same path also injects the
 * fixed seed and reference images.
 */

import { describe, it, expect } from 'vitest'
import { injectImageBatchBody } from '../../electron/cdp-image-inject.js'

const body = (n = 1) => ({ requests: Array.from({ length: n }, () => ({})) })

describe('injectImageBatchBody — aspect ratio', () => {
  it('injects IMAGE_ASPECT_RATIO_PORTRAIT into every request', () => {
    const b = body(3)
    const applied = injectImageBatchBody(b, { aspectRatio: 'IMAGE_ASPECT_RATIO_PORTRAIT' })

    expect(applied.aspectRatio).toBe(true)
    expect(b.requests.every((r) => r.imageAspectRatio === 'IMAGE_ASPECT_RATIO_PORTRAIT')).toBe(true)
  })

  it('injects IMAGE_ASPECT_RATIO_LANDSCAPE', () => {
    const b = body(1)
    injectImageBatchBody(b, { aspectRatio: 'IMAGE_ASPECT_RATIO_LANDSCAPE' })

    expect(b.requests[0].imageAspectRatio).toBe('IMAGE_ASPECT_RATIO_LANDSCAPE')
  })

  it('leaves imageAspectRatio untouched when none is given', () => {
    const b = body(1)
    const applied = injectImageBatchBody(b, {})

    expect(applied.aspectRatio).toBe(false)
    expect('imageAspectRatio' in b.requests[0]).toBe(false)
  })
})

describe('injectImageBatchBody — seed', () => {
  it('injects a fixed seed into every request', () => {
    const b = body(2)
    const applied = injectImageBatchBody(b, { seed: 12345 })

    expect(applied.seed).toBe(true)
    expect(b.requests.every((r) => r.seed === 12345)).toBe(true)
  })

  it('treats seed 0 as a real value', () => {
    const b = body(1)
    injectImageBatchBody(b, { seed: 0 })

    expect(b.requests[0].seed).toBe(0)
  })

  it('skips seed injection when null', () => {
    const b = body(1)
    const applied = injectImageBatchBody(b, { seed: null })

    expect(applied.seed).toBe(false)
    expect('seed' in b.requests[0]).toBe(false)
  })
})

describe('injectImageBatchBody — reference images', () => {
  it('appends reference images to imageInputs', () => {
    const b = body(1)
    const applied = injectImageBatchBody(b, {
      referenceImages: [{ mediaId: 'm1' }, { mediaId: 'm2' }],
    })

    expect(applied.references).toBe(true)
    expect(b.requests[0].imageInputs).toEqual([
      { imageInputType: 'IMAGE_INPUT_TYPE_REFERENCE', name: 'm1' },
      { imageInputType: 'IMAGE_INPUT_TYPE_REFERENCE', name: 'm2' },
    ])
  })

  it('skips reference injection for an empty list', () => {
    const b = body(1)
    expect(injectImageBatchBody(b, { referenceImages: [] }).references).toBe(false)
  })
})

describe('injectImageBatchBody — combined / edge cases', () => {
  it('applies seed + aspect ratio together', () => {
    const b = body(1)
    const applied = injectImageBatchBody(b, { seed: 7, aspectRatio: 'IMAGE_ASPECT_RATIO_PORTRAIT' })

    expect(applied).toEqual({ references: false, seed: true, aspectRatio: true })
    expect(b.requests[0]).toMatchObject({ seed: 7, imageAspectRatio: 'IMAGE_ASPECT_RATIO_PORTRAIT' })
  })

  it('returns all-false for a body with no requests array', () => {
    expect(injectImageBatchBody({}, { aspectRatio: 'IMAGE_ASPECT_RATIO_PORTRAIT' }))
      .toEqual({ references: false, seed: false, aspectRatio: false })
    expect(injectImageBatchBody(null, { seed: 1 }))
      .toEqual({ references: false, seed: false, aspectRatio: false })
  })
})
