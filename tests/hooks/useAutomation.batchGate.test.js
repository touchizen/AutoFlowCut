import { describe, it, expect, vi } from 'vitest'
// Test the pure gate helper extracted from the hook: makeBatchConsumeGate.
import { makeBatchConsumeGate } from '../../src/hooks/batchConsumeGate'
import { batchStartGate } from '../../src/hooks/batchStartGate'

describe('makeBatchConsumeGate', () => {
  it('charges once per batch; later items are no-op (single consume call)', async () => {
    const consume = vi.fn().mockResolvedValue({ charged: true })
    const gate = makeBatchConsumeGate('bid-1', 'image', consume)
    expect(await gate.ensure()).toEqual({ ok: true })
    expect(await gate.ensure()).toEqual({ ok: true })
    expect(consume).toHaveBeenCalledTimes(1)
    expect(consume).toHaveBeenCalledWith({ batchId: 'bid-1', batchType: 'image' })
  })
  it('denied → ok:false and remembers denial (no second call)', async () => {
    const consume = vi.fn().mockResolvedValue({ denied: true })
    const gate = makeBatchConsumeGate('bid-2', 'image', consume)
    expect(await gate.ensure()).toEqual({ ok: false })
    expect(await gate.ensure()).toEqual({ ok: false })
    expect(consume).toHaveBeenCalledTimes(1)
  })

  // ─── Finding #6: onConsumed callback ──────────────────────────────────────
  it('#6: onConsumed is called exactly once when charged succeeds', async () => {
    const consume = vi.fn().mockResolvedValue({ charged: true })
    const onConsumed = vi.fn()
    const gate = makeBatchConsumeGate('bid-3', 'image', consume, onConsumed)
    await gate.ensure()
    await gate.ensure() // second call is no-op (cached)
    expect(onConsumed).toHaveBeenCalledTimes(1)
  })

  it('#6: onConsumed is NOT called when denied', async () => {
    const consume = vi.fn().mockResolvedValue({ denied: true })
    const onConsumed = vi.fn()
    const gate = makeBatchConsumeGate('bid-4', 'image', consume, onConsumed)
    await gate.ensure()
    expect(onConsumed).not.toHaveBeenCalled()
  })

  it('#6: onConsumed throwing does not break the gate result', async () => {
    const consume = vi.fn().mockResolvedValue({ charged: true })
    const onConsumed = vi.fn().mockImplementation(() => { throw new Error('refresh failed') })
    const gate = makeBatchConsumeGate('bid-5', 'image', consume, onConsumed)
    // should not throw even if onConsumed throws
    const result = await gate.ensure()
    expect(result).toEqual({ ok: true })
  })

  it('#6: onConsumed not provided → works normally (backward compat)', async () => {
    const consume = vi.fn().mockResolvedValue({ charged: true })
    const gate = makeBatchConsumeGate('bid-6', 'image', consume) // no onConsumed
    expect(await gate.ensure()).toEqual({ ok: true })
    expect(consume).toHaveBeenCalledTimes(1)
  })

  // ─── Finding #5: partial retry reusing batchId must not be paywalled ──────────
  // The hook computes isReusingBatch = !!((sceneIds || sceneIndices) && batchIdRef.current).
  describe('#5: isReusingBatch wiring (partial retry)', () => {
    it('partial retry (sceneIds) reusing prior batchId → proceed even when quota exhausted', () => {
      const sub = { batchRemaining: 0, batchUnlimited: false }
      const sceneIds = ['scene_1']; const sceneIndices = null
      const batchIdRef = { current: 'prior-batch' }
      const isReusingBatch = !!((sceneIds || sceneIndices) && batchIdRef.current)
      expect(batchStartGate({ subscriptionBatch: sub, isAuthenticated: true, subscriptionStatus: 'active', isReusingBatch }))
        .toEqual({ action: 'proceed' })
    })

    it('full start (no sceneIds/sceneIndices) → not reusing → paywall when exhausted', () => {
      const sub = { batchRemaining: 0, batchUnlimited: false }
      const sceneIds = null; const sceneIndices = null
      const batchIdRef = { current: 'prior-batch' }
      const isReusingBatch = !!((sceneIds || sceneIndices) && batchIdRef.current)
      expect(batchStartGate({ subscriptionBatch: sub, isAuthenticated: true, subscriptionStatus: 'active', isReusingBatch }))
        .toEqual({ action: 'paywall' })
    })

    it('partial retry after reload (no prior batchId) → not reusing → paywall', () => {
      const sub = { batchRemaining: 0, batchUnlimited: false }
      const sceneIds = ['scene_1']; const sceneIndices = null
      const batchIdRef = { current: null }
      const isReusingBatch = !!((sceneIds || sceneIndices) && batchIdRef.current)
      expect(batchStartGate({ subscriptionBatch: sub, isAuthenticated: true, subscriptionStatus: 'active', isReusingBatch }))
        .toEqual({ action: 'paywall' })
    })
  })
})
