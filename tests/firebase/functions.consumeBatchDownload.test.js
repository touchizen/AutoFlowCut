import { describe, it, expect, vi, beforeEach } from 'vitest'

const httpsCallable = vi.fn()
vi.mock('firebase/functions', () => ({ httpsCallable: (...a) => httpsCallable(...a) }))
vi.mock('../../src/firebase/config', () => ({ functions: {}, APP_ID: 'autoflowcut' }))

import { consumeBatchDownload } from '../../src/firebase/functions'

beforeEach(() => httpsCallable.mockReset())

describe('consumeBatchDownload wrapper', () => {
  it('passes appId/batchId/batchType and returns callable data', async () => {
    const fn = vi.fn().mockResolvedValue({ data: { charged: true, unlimited: false, remaining: 9 } })
    httpsCallable.mockReturnValue(fn)
    const r = await consumeBatchDownload({ batchId: 'b1', batchType: 'image' })
    expect(fn).toHaveBeenCalledWith({ appId: 'autoflowcut', batchId: 'b1', batchType: 'image' })
    expect(r).toEqual({ charged: true, unlimited: false, remaining: 9 })
  })

  it('fails CLOSED on error (returns denied, never throws, no optimistic free)', async () => {
    httpsCallable.mockReturnValue(vi.fn().mockRejectedValue(new Error('network')))
    const r = await consumeBatchDownload({ batchId: 'b1', batchType: 'image' })
    expect(r.denied).toBe(true)
    expect(r.charged).toBeFalsy()
  })
})
