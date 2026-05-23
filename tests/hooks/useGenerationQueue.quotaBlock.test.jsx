/**
 * useGenerationQueue — quota-block + queue auto-subscribe 회귀 테스트
 *
 * 정책:
 *   1) quota 도달 시 queue 가 자체 subscribe 해서 pending 작업을 reject (caller 책임 X)
 *   2) blocked 상태에서 enqueue 는 즉시 reject — cascade 차단
 *   3) 사용자 모달 dismiss 후 정상 enqueue 재개
 *
 * 회귀 컨텍스트:
 *   기존엔 emitQuotaStop 의 firstTrigger 가드 때문에 caller A 가 clearQueue 없이 먼저
 *   emit → caller B 가 clearQueue 포함해서 emit 했는데 firstTrigger=false 라 큐가 안
 *   비워지는 회귀가 있었다. queue 가 직접 subscribe 하면 caller 책임 자체가 사라짐.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useGenerationQueue } from '../../src/hooks/useGenerationQueue'
import {
  emitQuotaStop,
  notifyQuotaModalDismissed,
  __resetQuotaStopForTests,
} from '../../src/utils/quotaStop'

beforeEach(() => {
  __resetQuotaStopForTests()
})

describe('useGenerationQueue — quota-block + auto-subscribe', () => {
  it('quota-blocked 상태에서 enqueue 시 즉시 reject', async () => {
    const { result } = renderHook(() => useGenerationQueue())

    // emit (caller 가 clearQueue 안 넘김 — 신구조에선 불필요)
    act(() => {
      emitQuotaStop({ stopRequestedRef: { current: false }, scope: 'Test' })
    })

    let rejected = null
    await act(async () => {
      try {
        await result.current.enqueue({
          type: 'image',
          label: 'test',
          execute: vi.fn().mockResolvedValue('should-not-run'),
        })
      } catch (e) {
        rejected = e
      }
    })

    expect(rejected).toBeInstanceOf(Error)
    expect(rejected.message).toMatch(/quota/i)
  })

  it('emit 호출자가 clearQueue 인자를 안 넘겨도 queue 가 자체 subscribe 로 비워짐 (회귀 가드)', async () => {
    const { result } = renderHook(() => useGenerationQueue())

    // 절대 끝나지 않는 작업으로 첫 자리 점유
    const blocker = new Promise(() => {})
    act(() => {
      result.current.enqueue({ type: 'image', label: 'running', execute: () => blocker })
    })

    // 두 번째 작업 enqueue — queue 에 대기
    let secondReject
    const secondPromise = new Promise((_res, rej) => { secondReject = rej })
    act(() => {
      result.current.enqueue({ type: 'image', label: 'pending', execute: vi.fn() }).catch(secondReject)
    })

    // quota stop — caller 가 clearQueue 인자 안 넘김. 그래도 queue 는 자체 subscribe 로 비워짐.
    act(() => {
      emitQuotaStop({ stopRequestedRef: { current: false }, scope: 'Test' })
    })

    const err = await secondPromise.catch((e) => e)
    expect(err).toBeInstanceOf(Error)
    expect(err.message).toMatch(/quota/i)
  })

  it('두 번째 caller (clearQueue 없이) 의 emit 도 queue 를 다시 비운다 (firstTrigger=false 회귀)', async () => {
    const { result } = renderHook(() => useGenerationQueue())

    // 첫 caller emit — queue 비움
    act(() => { emitQuotaStop({ stopRequestedRef: { current: false }, scope: 'A' }) })

    // 사용자 dismiss → 다시 enqueue 1개
    act(() => { notifyQuotaModalDismissed() })

    const blocker = new Promise(() => {})
    act(() => {
      result.current.enqueue({ type: 'image', label: 'running', execute: () => blocker })
    })
    let pendingReject
    const pendingPromise = new Promise((_r, rej) => { pendingReject = rej })
    act(() => {
      result.current.enqueue({ type: 'image', label: 'pending2', execute: vi.fn() }).catch(pendingReject)
    })

    // 두 번째 caller emit (firstTrigger=false 가 됨에도 listener 는 호출 → queue 비워짐)
    act(() => { emitQuotaStop({ stopRequestedRef: { current: false }, scope: 'B' }) })

    const err = await pendingPromise.catch((e) => e)
    expect(err).toBeInstanceOf(Error)
    expect(err.message).toMatch(/quota/i)
  })

  it('모달 dismiss 후엔 다시 enqueue 허용', async () => {
    const { result } = renderHook(() => useGenerationQueue())

    act(() => { emitQuotaStop({ stopRequestedRef: { current: false }, scope: 'Test' }) })

    await act(async () => {
      await expect(result.current.enqueue({
        type: 'image', label: 't1', execute: vi.fn(),
      })).rejects.toThrow(/quota/i)
    })

    act(() => { notifyQuotaModalDismissed() })

    const exec = vi.fn().mockResolvedValue('ok')
    let res
    await act(async () => {
      res = await result.current.enqueue({ type: 'image', label: 't2', execute: exec })
    })
    expect(exec).toHaveBeenCalledTimes(1)
    expect(res).toBe('ok')
  })
})
