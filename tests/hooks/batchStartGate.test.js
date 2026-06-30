import { describe, it, expect } from 'vitest'
import { batchStartGate } from '../../src/hooks/batchStartGate'

describe('batchStartGate', () => {
  // ─── existing cases ───────────────────────────────────────────
  it('subscriptionBatch null → proceed (ungated mode)', () => {
    expect(batchStartGate({ subscriptionBatch: null, isAuthenticated: false })).toEqual({ action: 'proceed' })
  })

  it('logged-out user with quota → login', () => {
    expect(batchStartGate({ subscriptionBatch: { batchRemaining: 5 }, isAuthenticated: false })).toEqual({ action: 'login' })
  })

  it('logged-in, exhausted quota → paywall', () => {
    expect(batchStartGate({ subscriptionBatch: { batchRemaining: 0, batchUnlimited: false }, isAuthenticated: true })).toEqual({ action: 'paywall' })
  })

  it('logged-in, has quota → proceed', () => {
    expect(batchStartGate({ subscriptionBatch: { batchRemaining: 3 }, isAuthenticated: true })).toEqual({ action: 'proceed' })
  })

  it('unlimited overrides zero remaining → proceed', () => {
    expect(batchStartGate({ subscriptionBatch: { batchUnlimited: true, batchRemaining: 0 }, isAuthenticated: true })).toEqual({ action: 'proceed' })
  })

  // ─── Finding #5/#8: authenticated + loading/error subscription must block ──
  it('#5: authed + subscriptionStatus loading → loading (not paywall, not proceed)', () => {
    // simulate: initializeUser failed / doc not yet created → calculateTrialStatus(null) returned
    // full free quota, but server would reject consume. Gate must block.
    const sub = { batchRemaining: 10, batchUnlimited: false } // looks like quota exists
    expect(batchStartGate({ subscriptionBatch: sub, isAuthenticated: true, subscriptionStatus: 'loading' }))
      .toEqual({ action: 'loading' })
  })

  it('#5: authed + subscriptionStatus error → loading (block, no paywall)', () => {
    const sub = { batchRemaining: 10, batchUnlimited: false }
    expect(batchStartGate({ subscriptionBatch: sub, isAuthenticated: true, subscriptionStatus: 'error' }))
      .toEqual({ action: 'loading' })
  })

  it('#8: loading takes precedence over quota exhaustion check', () => {
    // even if batchRemaining is 0, loading status should return loading not paywall
    const sub = { batchRemaining: 0, batchUnlimited: false }
    expect(batchStartGate({ subscriptionBatch: sub, isAuthenticated: true, subscriptionStatus: 'loading' }))
      .toEqual({ action: 'loading' })
  })

  it('#8: subscriptionStatus undefined → backward compat, proceeds normally', () => {
    const sub = { batchRemaining: 5, batchUnlimited: false }
    // undefined subscriptionStatus should not block (existing behavior)
    expect(batchStartGate({ subscriptionBatch: sub, isAuthenticated: true, subscriptionStatus: undefined }))
      .toEqual({ action: 'proceed' })
  })

  it('#5: subscriptionStatus null = not loading/error → normal flow', () => {
    const sub = { batchRemaining: 0, batchUnlimited: false }
    // null status → paywall (not loading)
    expect(batchStartGate({ subscriptionBatch: sub, isAuthenticated: true, subscriptionStatus: null }))
      .toEqual({ action: 'paywall' })
  })

  it('#8: loading action when subscriptionBatch is null → ungated (null takes precedence)', () => {
    // null subscriptionBatch always proceeds regardless of status
    expect(batchStartGate({ subscriptionBatch: null, isAuthenticated: true, subscriptionStatus: 'loading' }))
      .toEqual({ action: 'proceed' })
  })

  it('#8: login takes precedence over loading status', () => {
    // unauthenticated user → login, not loading
    const sub = { batchRemaining: 5 }
    expect(batchStartGate({ subscriptionBatch: sub, isAuthenticated: false, subscriptionStatus: 'loading' }))
      .toEqual({ action: 'login' })
  })

  it('unlimited subscription with confirmed status → proceed', () => {
    const sub = { batchUnlimited: true, batchRemaining: 0 }
    expect(batchStartGate({ subscriptionBatch: sub, isAuthenticated: true, subscriptionStatus: 'active' }))
      .toEqual({ action: 'proceed' })
  })

  // ─── Finding #5: retry reusing an already-charged batchId must not be paywalled ──
  // A partial retry (save-failure redownload) reuses the in-memory batchId → server consume is an
  // idempotent no-op (already charged). Blocking it with paywall after quota hit 0 would strand the
  // user on an already-paid batch. A full regeneration mints a fresh batchId (isReusingBatch false)
  // → paywall still applies normally.
  it('#5: isReusingBatch + exhausted quota → proceed (idempotent no-op, not paywall)', () => {
    const sub = { batchRemaining: 0, batchUnlimited: false }
    expect(batchStartGate({ subscriptionBatch: sub, isAuthenticated: true, subscriptionStatus: 'active', isReusingBatch: true }))
      .toEqual({ action: 'proceed' })
  })

  it('#5: fresh batch (isReusingBatch false) + exhausted quota → paywall (regen needs a credit)', () => {
    const sub = { batchRemaining: 0, batchUnlimited: false }
    expect(batchStartGate({ subscriptionBatch: sub, isAuthenticated: true, subscriptionStatus: 'active', isReusingBatch: false }))
      .toEqual({ action: 'paywall' })
  })

  it('#5: isReusingBatch does not override login (logged-out still → login)', () => {
    const sub = { batchRemaining: 0 }
    expect(batchStartGate({ subscriptionBatch: sub, isAuthenticated: false, isReusingBatch: true }))
      .toEqual({ action: 'login' })
  })

  it('#5: isReusingBatch does not override loading (transient doc state still → loading)', () => {
    const sub = { batchRemaining: 0, batchUnlimited: false }
    expect(batchStartGate({ subscriptionBatch: sub, isAuthenticated: true, subscriptionStatus: 'loading', isReusingBatch: true }))
      .toEqual({ action: 'loading' })
  })
})
