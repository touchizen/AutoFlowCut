/**
 * calculateTrialStatus.test.js — UI 호환 어댑터 검증
 *
 * `firestore.js` 의 `calculateTrialStatus` 는 quotaCalc.js 의 순수 로직을
 * 기존 UI 가 기대하는 shape ({ canExport, isExpired, exportsRemaining,
 * daysRemaining, status, ... }) 으로 변환한다.
 *
 * pure 로직 자체는 `tests/utils/quotaCalc.test.js` 가 검증.
 * 이 파일은 어댑터의 매핑이 맞는지 + legacy 필드 호환을 본다.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { calculateTrialStatus } from '../../src/firebase/firestore'

describe('calculateTrialStatus (UI 어댑터)', () => {
  let originalDateNow

  beforeEach(() => {
    // 시간을 2026-05-15 로 고정 (월 경계 케이스 안정화)
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-05-15T12:00:00.000Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('신규/없음', () => {
    it('null appData → 무료 사용자, 10회 가능', () => {
      const result = calculateTrialStatus(null)
      expect(result.canExport).toBe(true)
      expect(result.isExpired).toBe(false)
      expect(result.status).toBe('trial')
      expect(result.effectiveRemaining).toBe(10)
      // legacy compat
      expect(result.exportsRemaining).toBe(10)
    })

    it('undefined appData 도 안전', () => {
      const result = calculateTrialStatus(undefined)
      expect(result.canExport).toBe(true)
    })
  })

  describe('활성 구독자', () => {
    it('subscriptionStatus=active → unlimited (Infinity 반환)', () => {
      const result = calculateTrialStatus({
        subscriptionStatus: 'active',
        subscriptionPlan: 'monthly',
      })
      expect(result.isActive).toBe(true)
      expect(result.canExport).toBe(true)
      expect(result.isExpired).toBe(false)
      expect(result.status).toBe('active')
      // legacy compat
      expect(result.exportsRemaining).toBe(Infinity)
      expect(result.daysRemaining).toBe(Infinity)
      expect(result.plan).toBe('monthly')
    })

    it('plan 미설정 → 기본 monthly', () => {
      const result = calculateTrialStatus({ subscriptionStatus: 'active' })
      expect(result.plan).toBe('monthly')
    })
  })

  describe('무료 사용자 - trial', () => {
    it('보너스 5 / 월 0 → 10 가능', () => {
      const result = calculateTrialStatus({
        subscriptionStatus: 'trial',
        bonusRemaining: 5,
        monthlyUsed: 0,
        quotaPeriodStart: { toDate: () => new Date('2026-05-01T00:00:00Z') },
      })
      expect(result.canExport).toBe(true)
      expect(result.isExpired).toBe(false)
      expect(result.status).toBe('trial')
      expect(result.effectiveRemaining).toBe(10)
      // legacy compat
      expect(result.exportsRemaining).toBe(10)
      expect(result.daysRemaining).toBe(1)  // expired 아닐 때 약한 신호
      // 신규 필드
      expect(result.bonusRemaining).toBe(5)
      expect(result.monthlyUsed).toBe(0)
      expect(result.monthlyQuota).toBe(5)
      expect(result.monthlyRemaining).toBe(5)
    })

    it('보너스 0 / 월 5 → 만료', () => {
      const result = calculateTrialStatus({
        subscriptionStatus: 'trial',
        bonusRemaining: 0,
        monthlyUsed: 5,
        quotaPeriodStart: { toDate: () => new Date('2026-05-01T00:00:00Z') },
      })
      expect(result.canExport).toBe(false)
      expect(result.isExpired).toBe(true)
      expect(result.status).toBe('expired')
      expect(result.effectiveRemaining).toBe(0)
      // legacy compat
      expect(result.exportsRemaining).toBe(0)
      expect(result.daysRemaining).toBe(0)  // expired 시 0
    })
  })

  describe('🚨 핵심 시나리오 — 월 경계', () => {
    it('지난 달 quota 다 썼지만 새 달 진입 → 5회 가능 (만료 아님)', () => {
      const result = calculateTrialStatus({
        subscriptionStatus: 'trial',
        bonusRemaining: 0,
        monthlyUsed: 5,
        quotaPeriodStart: { toDate: () => new Date('2026-04-01T00:00:00Z') },  // 4월
        // 현재 시간 2026-05-15 → 새 월 진입
      })
      expect(result.canExport).toBe(true)
      expect(result.isExpired).toBe(false)
      expect(result.effectiveRemaining).toBe(5)
    })
  })

  describe('🚨 lazy migration (기존 사용자)', () => {
    it('B-3 필드 없는 기존 trial 사용자 → 기본값 적용 (회복)', () => {
      const result = calculateTrialStatus({
        subscriptionStatus: 'trial',
        exportCount: 3,
        trialStartDate: { toDate: () => new Date('2026-04-15T00:00:00Z') },
        // bonusRemaining, monthlyUsed, quotaPeriodStart 없음
      })
      expect(result.canExport).toBe(true)
      expect(result.bonusRemaining).toBe(5)  // 기본값으로 회복
      expect(result.monthlyUsed).toBe(0)
      expect(result.effectiveRemaining).toBe(10)
    })
  })

  describe('legacy 필드 호환 (기존 UI 가 의존)', () => {
    it('exportsRemaining 는 effectiveRemaining 와 같음 (총합)', () => {
      const result = calculateTrialStatus({
        subscriptionStatus: 'trial',
        bonusRemaining: 2,
        monthlyUsed: 1,
        quotaPeriodStart: { toDate: () => new Date('2026-05-01T00:00:00Z') },
      })
      expect(result.exportsRemaining).toBe(result.effectiveRemaining)
      expect(result.exportsRemaining).toBe(6)  // 2 + (5-1)
    })

    it('canExport === !isExpired (export 가능 여부는 만료 아닐 때만)', () => {
      // 신규 — 만료 아님, 사용 가능
      const ok = calculateTrialStatus(null)
      expect(ok.canExport).toBe(!ok.isExpired)
      expect(ok.canExport).toBe(true)

      // 만료
      const expired = calculateTrialStatus({
        subscriptionStatus: 'trial',
        bonusRemaining: 0,
        monthlyUsed: 5,
        quotaPeriodStart: { toDate: () => new Date('2026-05-01T00:00:00Z') },
      })
      expect(expired.canExport).toBe(false)
      expect(expired.isExpired).toBe(true)

      // 활성 구독자 — 만료 없이 사용 가능
      const active = calculateTrialStatus({ subscriptionStatus: 'active' })
      expect(active.canExport).toBe(true)
      expect(active.isExpired).toBe(false)
    })

    it("isActive 의미: '유료 구독 중' — trial 사용자는 false (canExport 와 다를 수 있음)", () => {
      // 신규 사용자 — canExport=true 지만 isActive=false (유료 아님)
      const newbie = calculateTrialStatus(null)
      expect(newbie.canExport).toBe(true)
      expect(newbie.isActive).toBe(false)  // 유료 아님

      // 활성 구독자 — 둘 다 true
      const active = calculateTrialStatus({ subscriptionStatus: 'active' })
      expect(active.canExport).toBe(true)
      expect(active.isActive).toBe(true)
    })
  })
})
