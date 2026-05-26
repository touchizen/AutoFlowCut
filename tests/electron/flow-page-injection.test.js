// @vitest-environment node

//
// Regression test — monkey-patch injectImageBatchBody body shape.
//
// electron/flow-page-injection.js exports a tagged template string that is
// run inside the Flow page via executeJavaScript(). The inline
// injectImageBatchBody inside that string is what actually shapes outgoing
// batchGenerateImages request bodies for end users.
//
// Bug fixed (2026-05-26): the inline function set req.referenceImages = [...],
// which Google's protobuf rejects with HTTP 400 INVALID_ARGUMENT plus
// "Unknown name 'referenceImages' at 'requests[0]': Cannot find field."
//
// Fix: push reference media IDs into imageInputs[] with
// { imageInputType: 'IMAGE_INPUT_TYPE_REFERENCE', name: <mediaId> }.
//
// This test extracts the inline function from the page-script string and
// asserts the produced body shape directly, so a regression in the inline
// function (which lives inside a template-literal string and is not normally
// importable) is caught at unit-test time.
//

import { describe, it, expect } from 'vitest'
import { FLOW_PAGE_INJECTION } from '../../electron/flow-page-injection.js'

// Extract the inline injectImageBatchBody source from the page-script string
// and rebuild it as a real function we can call from Node.
function extractMonkeyPatchInjector() {
  // Match: function injectImageBatchBody(body, inject) { … }
  const match = FLOW_PAGE_INJECTION.match(
    /function\s+injectImageBatchBody\s*\(\s*body\s*,\s*inject\s*\)\s*\{[\s\S]*?\n  \}/
  )
  if (!match) throw new Error('injectImageBatchBody not found in FLOW_PAGE_INJECTION')
  // Wrap as expression so `new Function()` can return it.
  // eslint-disable-next-line no-new-func
  return new Function(`${match[0]}; return injectImageBatchBody;`)()
}

const monkeyInject = extractMonkeyPatchInjector()

const body = (n = 1) => ({ requests: Array.from({ length: n }, () => ({})) })

describe('monkey-patch injectImageBatchBody — reference images', () => {
  it('pushes references into imageInputs[] with IMAGE_INPUT_TYPE_REFERENCE', () => {
    const b = body(1)
    const modified = monkeyInject(b, {
      seed: null,
      aspectRatio: null,
      references: [{ mediaId: 'm1' }, { mediaId: 'm2' }],
    })

    expect(modified).toBe(true)
    expect(b.requests[0].imageInputs).toEqual([
      { imageInputType: 'IMAGE_INPUT_TYPE_REFERENCE', name: 'm1' },
      { imageInputType: 'IMAGE_INPUT_TYPE_REFERENCE', name: 'm2' },
    ])
  })

  it('never emits the legacy "referenceImages" field that Google rejects', () => {
    const b = body(2)
    monkeyInject(b, {
      seed: null,
      aspectRatio: null,
      references: [{ mediaId: 'm1' }],
    })

    for (const req of b.requests) {
      expect('referenceImages' in req).toBe(false)
    }
  })

  it('preserves existing imageInputs[] entries and appends references', () => {
    const b = { requests: [{ imageInputs: [{ imageInputType: 'IMAGE_INPUT_TYPE_OTHER', name: 'existing' }] }] }
    monkeyInject(b, {
      seed: null,
      aspectRatio: null,
      references: [{ mediaId: 'm1' }],
    })

    expect(b.requests[0].imageInputs).toEqual([
      { imageInputType: 'IMAGE_INPUT_TYPE_OTHER', name: 'existing' },
      { imageInputType: 'IMAGE_INPUT_TYPE_REFERENCE', name: 'm1' },
    ])
  })

  it('skips reference injection when list is empty / null', () => {
    const b1 = body(1)
    const b2 = body(1)
    monkeyInject(b1, { seed: null, aspectRatio: null, references: [] })
    monkeyInject(b2, { seed: null, aspectRatio: null, references: null })

    expect('imageInputs' in b1.requests[0]).toBe(false)
    expect('imageInputs' in b2.requests[0]).toBe(false)
  })
})

describe('monkey-patch injectImageBatchBody — combined seed + aspectRatio + references', () => {
  it('produces the full expected request[0] shape when all three are injected', () => {
    const b = body(1)
    monkeyInject(b, {
      seed: 42,
      aspectRatio: 'IMAGE_ASPECT_RATIO_LANDSCAPE',
      references: [{ mediaId: 'm1' }],
    })

    expect(b.requests[0]).toEqual({
      seed: 42,
      imageAspectRatio: 'IMAGE_ASPECT_RATIO_LANDSCAPE',
      imageInputs: [{ imageInputType: 'IMAGE_INPUT_TYPE_REFERENCE', name: 'm1' }],
    })
  })

  it('applies seed + aspectRatio to every request in a batch', () => {
    const b = body(3)
    monkeyInject(b, {
      seed: 7,
      aspectRatio: 'IMAGE_ASPECT_RATIO_PORTRAIT',
      references: null,
    })

    for (const req of b.requests) {
      expect(req).toEqual({
        seed: 7,
        imageAspectRatio: 'IMAGE_ASPECT_RATIO_PORTRAIT',
      })
    }
  })
})

describe('monkey-patch injectImageBatchBody — seed / aspectRatio (unchanged)', () => {
  it('injects seed=0 as a real value', () => {
    const b = body(1)
    monkeyInject(b, { seed: 0, aspectRatio: null, references: null })
    expect(b.requests[0].seed).toBe(0)
  })

  it('injects IMAGE_ASPECT_RATIO_PORTRAIT into every request', () => {
    const b = body(3)
    monkeyInject(b, { seed: null, aspectRatio: 'IMAGE_ASPECT_RATIO_PORTRAIT', references: null })
    expect(b.requests.every((r) => r.imageAspectRatio === 'IMAGE_ASPECT_RATIO_PORTRAIT')).toBe(true)
  })

  it('returns false for a body with no requests array', () => {
    expect(monkeyInject({}, { seed: 1, aspectRatio: null, references: null })).toBe(false)
  })
})
