import { describe, it, expect } from 'vitest'
import { newBatchId, isValidBatchId } from '../../src/utils/batchId'

describe('batchId util', () => {
  it('newBatchId returns a valid UUID v4 each call (rotates)', () => {
    const a = newBatchId(), b = newBatchId()
    expect(isValidBatchId(a)).toBe(true)
    expect(a).not.toBe(b)
  })
  it('isValidBatchId rejects malformed', () => {
    expect(isValidBatchId('nope')).toBe(false)
    expect(isValidBatchId('')).toBe(false)
    expect(isValidBatchId(null)).toBe(false)
  })
})
