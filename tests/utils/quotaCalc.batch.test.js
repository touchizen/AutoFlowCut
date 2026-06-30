import { describe, it, expect } from 'vitest'
import { computeBatchQuotaState, BATCH_BONUS_GRANT, BATCH_MONTHLY_QUOTA } from '../../src/utils/quotaCalc'

const NOW = new Date(Date.UTC(2026, 5, 15))

describe('computeBatchQuotaState', () => {
  it('new/absent fields → full batch allowance', () => {
    expect(computeBatchQuotaState(undefined, NOW).effectiveRemaining).toBe(BATCH_BONUS_GRANT + BATCH_MONTHLY_QUOTA)
    expect(computeBatchQuotaState({}, NOW).effectiveRemaining).toBe(10)
  })
  it('reads batch fields independent of export fields', () => {
    const s = computeBatchQuotaState({ bonusRemaining: 0, monthlyUsed: 5, batchBonusRemaining: 2, batchMonthlyUsed: 0, batchQuotaPeriodStart: new Date(Date.UTC(2026,5,1)) }, NOW)
    expect(s.effectiveRemaining).toBe(2 + BATCH_MONTHLY_QUOTA)
  })
  it('active subscription → unlimited', () => {
    const s = computeBatchQuotaState({ subscriptionStatus: 'active' }, NOW)
    expect(s.isActive).toBe(true)
    expect(s.effectiveRemaining).toBe(Infinity)
  })
  it('cancelled-grace → unlimited', () => {
    const s = computeBatchQuotaState({ subscriptionStatus: 'cancelled', subscriptionEndDate: new Date(Date.UTC(2026,6,1)) }, NOW)
    expect(s.isActive).toBe(true)
  })
})
