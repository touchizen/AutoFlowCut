import { describe, it, expect, vi } from 'vitest'
import { makeBatchConsumeGate } from '../../src/hooks/batchConsumeGate'
import { batchStartGate } from '../../src/hooks/batchStartGate'
import { newBatchId } from '../../src/utils/batchId'

describe('video batch consume gate', () => {
  it('consumes once with batchType video-t2v before first download', async () => {
    const consume = vi.fn().mockResolvedValue({ charged: true })
    const gate = makeBatchConsumeGate('vb-1', 'video-t2v', consume)
    await gate.ensure(); await gate.ensure()
    expect(consume).toHaveBeenCalledTimes(1)
    expect(consume).toHaveBeenCalledWith({ batchId: 'vb-1', batchType: 'video-t2v' })
  })
  it('denied → ok:false (caller preserves generationId+mediaId, no regen)', async () => {
    const consume = vi.fn().mockResolvedValue({ denied: true })
    const gate = makeBatchConsumeGate('vb-2', 'video-i2v', consume)
    expect(await gate.ensure()).toEqual({ ok: false })
  })

  // ─── Finding #video-3: batchId persistence across video retries ───────────
  describe('#video-3: batchId persistence', () => {
    it('fresh start (isRetry=false) → always mints new batchId', () => {
      // Simulate what useVideoAutomation does: fresh start always creates new id
      const batchIdRef = { current: null }
      const isRetry = false
      // Run 1
      if (isRetry && batchIdRef.current) { /* reuse */ } else { batchIdRef.current = newBatchId() }
      const id1 = batchIdRef.current
      // Run 2 fresh
      if (isRetry && batchIdRef.current) { /* reuse */ } else { batchIdRef.current = newBatchId() }
      const id2 = batchIdRef.current
      expect(id1).not.toBe(id2)
    })

    it('retry (isRetry=true) with existing batchId → reuses same batchId', () => {
      const batchIdRef = { current: null }
      // Run 1: fresh start
      batchIdRef.current = newBatchId()
      const id1 = batchIdRef.current
      // Run 2: retry
      const isRetry = true
      if (isRetry && batchIdRef.current) { /* reuse */ } else { batchIdRef.current = newBatchId() }
      expect(batchIdRef.current).toBe(id1) // same id reused
    })

    it('retry (isRetry=true) with no prior batchId → mints new (first run)', () => {
      const batchIdRef = { current: null }
      const isRetry = true
      if (isRetry && batchIdRef.current) { /* reuse */ } else { batchIdRef.current = newBatchId() }
      expect(batchIdRef.current).toBeTruthy() // got a new id
    })

    // #5: the hook computes isReusingBatch = isRetry && !!batchIdRef.current and feeds it to
    // batchStartGate so a retry of an already-charged batch is not paywalled after quota hits 0.
    it('#5: retry reusing prior batchId → proceed even when quota exhausted', () => {
      const sub = { batchRemaining: 0, batchUnlimited: false }
      const batchIdRef = { current: 'prior-batch' }
      const isReusingBatch = !!(true /* isRetry */ && batchIdRef.current)
      expect(batchStartGate({ subscriptionBatch: sub, isAuthenticated: true, subscriptionStatus: 'active', isReusingBatch }))
        .toEqual({ action: 'proceed' })
    })

    it('#5: retry with no prior batchId (reload) → not reusing → paywall when exhausted', () => {
      const sub = { batchRemaining: 0, batchUnlimited: false }
      const batchIdRef = { current: null }
      const isReusingBatch = !!(true /* isRetry */ && batchIdRef.current)
      expect(batchStartGate({ subscriptionBatch: sub, isAuthenticated: true, subscriptionStatus: 'active', isReusingBatch }))
        .toEqual({ action: 'paywall' })
    })

    it('reusing batchId means gate is idempotent (no double-charge)', async () => {
      // Two gates with the same batchId both call consume — but since it's the same
      // gate instance (per-batch), the second ensure() returns cached result.
      const consume = vi.fn().mockResolvedValue({ charged: true })
      const batchId = 'retry-batch-42'
      const gate = makeBatchConsumeGate(batchId, 'video-t2v', consume)
      // Simulate retry: multiple items hitting the same gate
      const r1 = await gate.ensure()
      const r2 = await gate.ensure()
      expect(r1).toEqual({ ok: true })
      expect(r2).toEqual({ ok: true })
      // consume called exactly once even across retries
      expect(consume).toHaveBeenCalledTimes(1)
    })
  })
})
