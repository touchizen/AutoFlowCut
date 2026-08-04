import { describe, expect, it } from 'vitest'
import { isAbortedResult } from '../../src/utils/isAbortedResult.js'

describe('isAbortedResult', () => {
  it.each([
    [{ aborted: true }, true],
    [{ success: true, aborted: true }, true],
    [{ success: false, errorKind: 'aborted' }, false],
    [{ success: false, error: 'Operation aborted' }, false],
    [{ aborted: false }, false],
    [null, false],
    [undefined, false],
    ['aborted', false],
  ])('aborted:true만 authoritative다: %j → %s', (value, expected) => {
    expect(isAbortedResult(value)).toBe(expected)
  })
})
