/**
 * quotaCalc.test.js — 클라이언트 quota 계산 (GCF mirror) 단위 테스트
 *
 * 목적: GCF 의 computeQuotaState 와 동일 결정을 내리는지 검증.
 * 두 곳이 어긋나면 "시각엔 사용 가능한데 export 시 거부" 같은 UX 버그 발생.
 *
 * 실제 차단은 GCF, 이 모듈은 UI 표시용 — 이 테스트가 회귀 가드.
 */

import { describe, it, expect } from 'vitest'
import {
  MONTHLY_QUOTA,
  BONUS_GRANT,
  utcMonthStart,
  sameUtcMonth,
  computeQuotaState,
} from '../../src/utils/quotaCalc'

const ts = (date) => ({ toDate: () => date })

describe('quotaCalc — GCF mirror', () => {
  describe('상수값 (GCF 와 동일해야)', () => {
    it('MONTHLY_QUOTA = 5', () => {
      expect(MONTHLY_QUOTA).toBe(5)
    })

    it('BONUS_GRANT = 5', () => {
      expect(BONUS_GRANT).toBe(5)
    })
  })

  describe('utcMonthStart', () => {
    it('월 중간 → 1일 00:00 UTC', () => {
      const d = new Date('2026-05-15T08:23:45.678Z')
      expect(utcMonthStart(d).toISOString()).toBe('2026-05-01T00:00:00.000Z')
    })

    it('말일 23:59 → 그 달 1일', () => {
      const d = new Date('2026-05-31T23:59:59.999Z')
      expect(utcMonthStart(d).toISOString()).toBe('2026-05-01T00:00:00.000Z')
    })
  })

  describe('sameUtcMonth', () => {
    it('같은 월 → true', () => {
      expect(sameUtcMonth(
        new Date('2026-05-01T00:00:00Z'),
        new Date('2026-05-31T23:59:59Z')
      )).toBe(true)
    })

    it('다른 월 → false', () => {
      expect(sameUtcMonth(
        new Date('2026-05-31T23:59:59Z'),
        new Date('2026-06-01T00:00:00Z')
      )).toBe(false)
    })

    it('null 안전', () => {
      expect(sameUtcMonth(null, new Date())).toBe(false)
      expect(sameUtcMonth(undefined, undefined)).toBe(false)
    })
  })

  describe('computeQuotaState', () => {
    const now = new Date('2026-05-15T12:00:00.000Z')

    it('신규 사용자 (null) → 보너스 5 + 월 5 = 10', () => {
      const state = computeQuotaState(null, now)
      expect(state.bonusRemaining).toBe(5)
      expect(state.monthlyRemaining).toBe(5)
      expect(state.effectiveRemaining).toBe(10)
      expect(state.isExpired).toBe(false)
      expect(state.subscriptionStatus).toBe('trial')
    })

    it('활성 구독자 → 무제한', () => {
      const state = computeQuotaState({ subscriptionStatus: 'active' }, now)
      expect(state.isActive).toBe(true)
      expect(state.effectiveRemaining).toBe(Infinity)
    })

    it('보너스 3 / 월 2 → 6 가능', () => {
      const state = computeQuotaState({
        subscriptionStatus: 'trial',
        bonusRemaining: 3,
        monthlyUsed: 2,
        quotaPeriodStart: ts(new Date('2026-05-01T00:00:00Z')),
      }, now)
      expect(state.effectiveRemaining).toBe(6)
    })

    it('보너스 0 / 월 5 → 0 (만료)', () => {
      const state = computeQuotaState({
        subscriptionStatus: 'trial',
        bonusRemaining: 0,
        monthlyUsed: 5,
        quotaPeriodStart: ts(new Date('2026-05-01T00:00:00Z')),
      }, now)
      expect(state.isExpired).toBe(true)
      expect(state.subscriptionStatus).toBe('expired')
    })

    describe('🚨 월 자동 리셋 (carrier 보너스 보존)', () => {
      it('지난 달 quotaPeriodStart → monthlyUsed 0 으로 메모리 리셋', () => {
        const state = computeQuotaState({
          subscriptionStatus: 'trial',
          bonusRemaining: 3,
          monthlyUsed: 5,  // 지난 달 다 썼음
          quotaPeriodStart: ts(new Date('2026-04-01T00:00:00Z')),
        }, now)
        expect(state.monthlyUsed).toBe(0)
        expect(state.bonusRemaining).toBe(3)  // 보너스는 carrier
        expect(state.effectiveRemaining).toBe(8)
      })

      it('보너스 0 + 새 월 → 5 가능 (월 quota 만)', () => {
        const state = computeQuotaState({
          subscriptionStatus: 'trial',
          bonusRemaining: 0,
          monthlyUsed: 5,
          quotaPeriodStart: ts(new Date('2026-04-01T00:00:00Z')),
        }, now)
        expect(state.effectiveRemaining).toBe(5)
        expect(state.isExpired).toBe(false)
      })
    })

    describe('🚨 5/31 가입 페어니스', () => {
      it('5/31 가입 직후: 10회 가능', () => {
        const signup = new Date('2026-05-31T23:00:00.000Z')
        const justAfter = new Date('2026-05-31T23:01:00.000Z')
        const state = computeQuotaState({
          subscriptionStatus: 'trial',
          bonusRemaining: 5,
          monthlyUsed: 0,
          quotaPeriodStart: ts(utcMonthStart(signup)),
        }, justAfter)
        expect(state.effectiveRemaining).toBe(10)
      })

      it('5/31 가입 후 6/1 자정 직후: 보너스 carrier — 여전히 10회', () => {
        const state = computeQuotaState({
          subscriptionStatus: 'trial',
          bonusRemaining: 5,
          monthlyUsed: 0,
          quotaPeriodStart: ts(new Date('2026-05-01T00:00:00Z')),
        }, new Date('2026-06-01T00:00:01.000Z'))
        expect(state.effectiveRemaining).toBe(10)
      })
    })

    describe('lazy migration (기존 사용자)', () => {
      it('B-3 필드 없음 + 기존 trial 데이터 → 기본값 적용 (회복)', () => {
        const state = computeQuotaState({
          subscriptionStatus: 'trial',
          exportCount: 3,
          trialStartDate: ts(new Date('2026-04-15T00:00:00Z')),
          // bonusRemaining, monthlyUsed, quotaPeriodStart 없음
        }, now)
        expect(state.bonusRemaining).toBe(5)
        expect(state.monthlyUsed).toBe(0)
        expect(state.effectiveRemaining).toBe(10)
      })
    })

    it('Date 객체로 quotaPeriodStart 전달도 안전 (Timestamp 가 아니어도)', () => {
      const state = computeQuotaState({
        subscriptionStatus: 'trial',
        bonusRemaining: 5,
        monthlyUsed: 0,
        quotaPeriodStart: new Date('2026-05-01T00:00:00Z'),  // raw Date
      }, now)
      expect(state.effectiveRemaining).toBe(10)
    })
  })
})
