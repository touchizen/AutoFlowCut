/**
 * AuthContext 단위 테스트
 *
 * onSnapshot 제거 후 getDoc 기반 구조에서 발생할 수 있는 케이스 검증:
 *  1) 사용자 전환 시점에 이전 사용자의 canExport 가 새 사용자에게 새지 않는가 (loading lock)
 *  2) A→B 전환 중 A 의 늦은 응답이 B 의 fresh state 를 덮어쓰지 않는가 (race guard)
 *  3) refreshSubscription 이 정상적으로 await 가능한 async 인가
 *  4) calculateTrialStatus(null) 함정 회피
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'

// ── Firebase 모듈 모킹 ──
const mockOnAuthChange = vi.fn()
const mockSignInWithGoogle = vi.fn()
const mockSignOut = vi.fn()
const mockInitializeUser = vi.fn()
const mockGetAppDoc = vi.fn()

vi.mock('../../src/firebase', () => ({
  signInWithGoogle: (...args) => mockSignInWithGoogle(...args),
  signOut: (...args) => mockSignOut(...args),
  onAuthChange: (...args) => mockOnAuthChange(...args),
  initializeUser: (...args) => mockInitializeUser(...args)
}))

vi.mock('../../src/firebase/firestore', async () => {
  const actual = await vi.importActual('../../src/firebase/firestore')
  return {
    ...actual,
    getAppDoc: (...args) => mockGetAppDoc(...args)
  }
})

import { AuthProvider, useAuth } from '../../src/contexts/AuthContext'

// 외부 제어 가능한 Promise — once-queue 의존성을 피하기 위해
function deferred() {
  let resolve, reject
  const promise = new Promise((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

// onAuthChange 콜백 캡처 헬퍼
let capturedAuthCallback = null
function setupAuthCallback() {
  capturedAuthCallback = null
  mockOnAuthChange.mockImplementation((cb) => {
    capturedAuthCallback = cb
    cb(null) // 초기엔 미인증
    return () => {}
  })
}

function fireAuthChange(user) {
  if (!capturedAuthCallback) throw new Error('onAuthChange callback not captured')
  act(() => {
    capturedAuthCallback(user)
  })
}

const wrapper = ({ children }) => <AuthProvider>{children}</AuthProvider>

beforeEach(() => {
  // 핵심: mockReset 으로 implementation + once-queue 모두 비움.
  // (vi.clearAllMocks 는 history 만 비우고 implementation 은 유지하므로 테스트 간 누수 발생)
  mockOnAuthChange.mockReset()
  mockGetAppDoc.mockReset()
  mockSignInWithGoogle.mockReset()
  mockSignOut.mockReset()
  mockInitializeUser.mockReset()
  setupAuthCallback()
})

describe('AuthContext — 초기 상태', () => {
  it('비로그인 상태에서 subscription.canExport 는 false', () => {
    const { result } = renderHook(() => useAuth(), { wrapper })

    expect(result.current.isAuthenticated).toBe(false)
    expect(result.current.subscription.canExport).toBe(false)
    expect(result.current.subscription.status).toBe('none')
  })
})

describe('AuthContext — 사용자 전환 시 loading lock (P2-3)', () => {
  it('새 사용자 진입 즉시 subscription 이 loading 상태가 되어 canExport=false 를 보장', async () => {
    const dA = deferred()
    mockGetAppDoc.mockImplementation(() => dA.promise)

    const { result } = renderHook(() => useAuth(), { wrapper })

    fireAuthChange({ uid: 'user-A', email: 'a@test.com' })

    // fetch 미완료 윈도우 — loading 상태 + canExport: false
    await waitFor(() => {
      expect(result.current.subscription.status).toBe('loading')
    })
    expect(result.current.subscription.canExport).toBe(false)
    expect(result.current.isAuthenticated).toBe(true)

    // fetch 완료 후엔 정상 trial 상태로 복귀
    await act(async () => {
      dA.resolve(null) // 신규 유저 → calculateTrialStatus(null) → trial 5/7
      await dA.promise
    })

    await waitFor(() => {
      expect(result.current.subscription.status).toBe('trial')
    })
    expect(result.current.subscription.canExport).toBe(true)
  })

  it('A(active) → B(아직 응답 없음) 전환 중 A 의 canExport=true 가 B 에게 새지 않는다', async () => {
    const dA = deferred()
    const dB = deferred()
    mockGetAppDoc.mockImplementation((uid) => {
      if (uid === 'user-A') return dA.promise
      if (uid === 'user-B') return dB.promise
      return Promise.resolve(null)
    })

    const { result } = renderHook(() => useAuth(), { wrapper })

    fireAuthChange({ uid: 'user-A', email: 'a@test.com' })

    await act(async () => {
      dA.resolve({ subscriptionStatus: 'active', subscriptionPlan: 'monthly' })
      await dA.promise
    })

    await waitFor(() => {
      expect(result.current.subscription.status).toBe('active')
    })
    expect(result.current.subscription.canExport).toBe(true)

    // B 로 전환 — dB 는 미해결로 둬서 loading 상태가 stable 하게 유지되도록 한다
    fireAuthChange({ uid: 'user-B', email: 'b@test.com' })

    await waitFor(() => {
      expect(result.current.subscription.status).toBe('loading')
    })
    // 핵심 검증 — A 의 canExport: true 가 B 에게 새지 않아야 함
    expect(result.current.subscription.canExport).toBe(false)
  })
})

describe('AuthContext — race condition (stale fetch 응답 폐기)', () => {
  // 회귀 방지 — 지적된 케이스: A 의 fetch 가 in-flight 인 상태에서 sign-out 발생 →
  // 그 사이에 A 응답이 도착하면 user=null 이지만 subscription 이 active 로 덮어쓰여 canExport=true 가 된다.
  // (token 이 fetchUserData 시작 시점에만 증가하면, sign-out 콜백 내에서 token 이 안 올라가
  //  stale 응답이 token 검사를 그대로 통과한다)
  it('A 의 fetch 진행 중 sign-out 시 A 의 늦은 active 응답이 무시된다', async () => {
    const dA = deferred()
    mockGetAppDoc.mockImplementation(() => dA.promise)

    const { result } = renderHook(() => useAuth(), { wrapper })

    fireAuthChange({ uid: 'user-A', email: 'a@test.com' })
    await waitFor(() => {
      expect(result.current.subscription.status).toBe('loading')
    })

    // sign-out — A 응답 도착 전
    fireAuthChange(null)
    await waitFor(() => {
      expect(result.current.subscription.status).toBe('none')
    })

    // A 응답이 뒤늦게 active 로 도착 — 무시되어야 한다 (sign-out 후이므로)
    await act(async () => {
      dA.resolve({ subscriptionStatus: 'active', subscriptionPlan: 'monthly' })
      await new Promise(r => setTimeout(r, 30))
    })

    // 절대로 active 로 변하면 안 됨 (canExport=true 누수 차단)
    expect(result.current.subscription.status).toBe('none')
    expect(result.current.subscription.canExport).toBe(false)
    expect(result.current.isAuthenticated).toBe(false)
  })

  // 회귀 방지 — A→B 전환에서 token 이 fetchUserData() 진입 시점에만 올라가면,
  // setUser(B) 직후 / B effect 가 실행되기 전 microtask 윈도우에 A 응답이 도착하면
  // 토큰이 아직 A 의 token 과 같아서 통과되어 active 로 덮인다.
  it('A→B 전환 직후 effect 가 동작하기 전이라도 A 의 늦은 응답이 새 사용자 상태를 덮지 않는다', async () => {
    const dA = deferred()
    const dB = deferred()
    mockGetAppDoc.mockImplementation((uid) => {
      if (uid === 'user-A') return dA.promise
      if (uid === 'user-B') return dB.promise
      return Promise.resolve(null)
    })

    const { result } = renderHook(() => useAuth(), { wrapper })

    fireAuthChange({ uid: 'user-A', email: 'a@test.com' })
    await waitFor(() => {
      expect(result.current.subscription.status).toBe('loading')
    })

    // B 로 전환
    fireAuthChange({ uid: 'user-B', email: 'b@test.com' })

    // A 응답이 B 의 fetch 가 완료되기 전에 도착 → 무시되어야 한다
    await act(async () => {
      dA.resolve({ subscriptionStatus: 'active', subscriptionPlan: 'yearly' })
      await new Promise(r => setTimeout(r, 30))
    })

    // 여전히 loading (B 의 응답 대기 중)
    expect(result.current.subscription.status).toBe('loading')
    expect(result.current.subscription.canExport).toBe(false)
    // user 는 B
    expect(result.current.user?.uid).toBe('user-B')

    // B 응답 도착 후 정상 반영
    await act(async () => {
      dB.resolve({
        subscriptionStatus: 'expired',
        bonusRemaining: 0,
        monthlyUsed: 5,
        quotaPeriodStart: new Date()
      })
      await dB.promise
    })

    await waitFor(() => {
      expect(result.current.subscription.status).toBe('expired')
    })
  })

  it('A 의 늦은 응답이 B 의 fresh state 를 덮어쓰지 않는다', async () => {
    const dA = deferred()
    const dB = deferred()
    mockGetAppDoc.mockImplementation((uid) => {
      if (uid === 'user-A') return dA.promise
      if (uid === 'user-B') return dB.promise
      return Promise.resolve(null)
    })

    const { result } = renderHook(() => useAuth(), { wrapper })

    // A 로그인 — fetch 시작 (dA 보류)
    fireAuthChange({ uid: 'user-A', email: 'a@test.com' })
    await waitFor(() => {
      expect(result.current.subscription.status).toBe('loading')
    })

    // A → B 즉시 전환
    fireAuthChange({ uid: 'user-B', email: 'b@test.com' })

    // B 응답 먼저 도착 → expired (B-3 quota 모델: 보너스/월 모두 소진)
    await act(async () => {
      dB.resolve({
        subscriptionStatus: 'expired',
        bonusRemaining: 0,
        monthlyUsed: 5,
        quotaPeriodStart: new Date()
      })
      await dB.promise
    })

    await waitFor(() => {
      expect(result.current.subscription.status).toBe('expired')
    })
    expect(result.current.subscription.canExport).toBe(false)

    // A 응답이 뒤늦게 active 로 도착 — 무시되어야 한다 (stale token)
    await act(async () => {
      dA.resolve({ subscriptionStatus: 'active', subscriptionPlan: 'yearly' })
      await dA.promise
      // 마이크로태스크 flush
      await new Promise(r => setTimeout(r, 20))
    })

    // B 의 expired 가 유지되어야 한다
    expect(result.current.subscription.status).toBe('expired')
    expect(result.current.subscription.canExport).toBe(false)
  })
})

describe('AuthContext — refreshSubscription', () => {
  it('await 가능한 async 함수이며, 호출 후 subscription 이 최신 데이터로 갱신된다', async () => {
    // B-3 quota 모델: bonusRemaining + monthlyRemaining = effectiveRemaining (legacy: exportsRemaining)
    let callCount = 0
    const periodStart = new Date()
    mockGetAppDoc.mockImplementation(async () => {
      callCount += 1
      if (callCount === 1) {
        // 보너스 5 + 월 5 = 10
        return {
          subscriptionStatus: 'trial',
          bonusRemaining: 5,
          monthlyUsed: 0,
          quotaPeriodStart: periodStart
        }
      }
      // 보너스 1 + 월 5 = 6 (보너스 4 소진 후)
      return {
        subscriptionStatus: 'trial',
        bonusRemaining: 1,
        monthlyUsed: 0,
        quotaPeriodStart: periodStart
      }
    })

    const { result } = renderHook(() => useAuth(), { wrapper })

    fireAuthChange({ uid: 'user-A', email: 'a@test.com' })
    await waitFor(() => {
      expect(result.current.subscription.status).toBe('trial')
    })
    expect(result.current.subscription.exportsRemaining).toBe(10) // 5 + 5

    // 새 데이터 반영
    await act(async () => {
      await result.current.refreshSubscription()
    })

    expect(result.current.subscription.exportsRemaining).toBe(6) // 1 + 5
  })

  it('미인증 상태에서 호출되어도 throw 하지 않고 no-op', async () => {
    const { result } = renderHook(() => useAuth(), { wrapper })

    await act(async () => {
      await expect(result.current.refreshSubscription()).resolves.not.toThrow?.()
    })

    expect(mockGetAppDoc).not.toHaveBeenCalled()
  })
})

describe('AuthContext — 로그아웃 시 상태 정리', () => {
  it('user=null 신호 시 subscription 이 SUBSCRIPTION_NONE 으로 리셋된다', async () => {
    mockGetAppDoc.mockImplementation(async () => ({
      subscriptionStatus: 'active',
      subscriptionPlan: 'monthly'
    }))

    const { result } = renderHook(() => useAuth(), { wrapper })

    fireAuthChange({ uid: 'user-A', email: 'a@test.com' })
    await waitFor(() => {
      expect(result.current.subscription.status).toBe('active')
    })

    fireAuthChange(null)
    await waitFor(() => {
      expect(result.current.subscription.status).toBe('none')
    })
    expect(result.current.subscription.canExport).toBe(false)
    expect(result.current.isAuthenticated).toBe(false)
  })
})

describe('AuthContext — calculateTrialStatus(null) 함정 회피 (추가 이슈 a)', () => {
  it('loading 윈도우에서 trial(canExport:true)이 노출되지 않는다', async () => {
    // getAppDoc 영원히 pending — loading 윈도우 유지
    mockGetAppDoc.mockImplementation(() => new Promise(() => {}))

    const { result } = renderHook(() => useAuth(), { wrapper })

    fireAuthChange({ uid: 'first-time-user', email: 'new@test.com' })

    await waitFor(() => {
      expect(result.current.subscription.status).toBe('loading')
    })

    expect(result.current.subscription.status).not.toBe('trial')
    expect(result.current.subscription.canExport).toBe(false)
  })
})

describe('AuthContext — getAppDoc source 의도 (cache fallback 차단)', () => {
  // 회귀 방지: refresh 는 export 직후 GCF 가 갱신한 quota 를 정확히 받아야 하므로
  // cache fallback 가능성이 있는 default 가 아니라 server 강제 조회를 써야 한다.
  it('초기 mount fetch 는 source 를 명시하지 않거나 default 로 호출한다', async () => {
    mockGetAppDoc.mockResolvedValue({ subscriptionStatus: 'trial', bonusRemaining: 5, monthlyUsed: 0 })

    const { result } = renderHook(() => useAuth(), { wrapper })
    fireAuthChange({ uid: 'user-A', email: 'a@test.com' })

    await waitFor(() => {
      expect(result.current.subscription.status).toBe('trial')
    })

    expect(mockGetAppDoc).toHaveBeenCalledTimes(1)
    const [, opts] = mockGetAppDoc.mock.calls[0]
    // 'server' 가 아니어야 한다 (default 또는 미지정)
    expect(opts?.source).not.toBe('server')
  })

  it('refreshSubscription 은 source: "server" 로 호출한다', async () => {
    mockGetAppDoc.mockResolvedValue({ subscriptionStatus: 'trial', bonusRemaining: 5, monthlyUsed: 0 })

    const { result } = renderHook(() => useAuth(), { wrapper })
    fireAuthChange({ uid: 'user-A', email: 'a@test.com' })
    await waitFor(() => {
      expect(result.current.subscription.status).toBe('trial')
    })
    mockGetAppDoc.mockClear()

    await act(async () => {
      await result.current.refreshSubscription()
    })

    expect(mockGetAppDoc).toHaveBeenCalledTimes(1)
    const [, opts] = mockGetAppDoc.mock.calls[0]
    expect(opts?.source).toBe('server')
  })

  it('refreshSubscription 은 fetch 결과 데이터를 반환한다 (호출자가 inline 으로 사용 가능)', async () => {
    mockGetAppDoc
      .mockResolvedValueOnce({ subscriptionStatus: 'trial', bonusRemaining: 5, monthlyUsed: 0 })
      .mockResolvedValueOnce({ subscriptionStatus: 'active', subscriptionPlan: 'yearly' })

    const { result } = renderHook(() => useAuth(), { wrapper })
    fireAuthChange({ uid: 'user-A', email: 'a@test.com' })
    await waitFor(() => {
      expect(result.current.subscription.status).toBe('trial')
    })

    let fresh
    await act(async () => {
      fresh = await result.current.refreshSubscription()
    })

    expect(fresh?.subscriptionStatus).toBe('active')
    expect(fresh?.subscriptionPlan).toBe('yearly')
  })
})

describe('AuthContext — fetch 실패 시 terminal 상태 (loading 영구 고정 방지)', () => {
  // 회귀 방지: getAppDoc 이 throw 해도 catch 가 setError 만 하고 subscription 을
  // 갱신하지 않으면 SUBSCRIPTION_LOADING 에 영구 고정 → useExport 가 silent return 해서
  // 사용자가 dead-end 상태에 갇힌다. terminal SUBSCRIPTION_ERROR 로 전환되어야 한다.
  it('초기 fetch 실패 시 status 가 "error" 로 전환되어 stuck loading 이 발생하지 않는다', async () => {
    mockGetAppDoc.mockRejectedValue(new Error('Firestore unavailable'))

    const { result } = renderHook(() => useAuth(), { wrapper })
    fireAuthChange({ uid: 'user-A', email: 'a@test.com' })

    await waitFor(() => {
      expect(result.current.subscription.status).toBe('error')
    })

    // canExport: false 로 export 차단은 유지
    expect(result.current.subscription.canExport).toBe(false)
    // error message 도 노출되어야 retry UI / 디버깅 가능
    expect(result.current.error).toBeTruthy()
  })

  it('refreshSubscription 실패 시에도 terminal "error" 로 전환된다', async () => {
    // 첫 mount fetch 는 성공, 그 다음 refresh 만 실패하는 시나리오
    mockGetAppDoc
      .mockResolvedValueOnce({ subscriptionStatus: 'trial', bonusRemaining: 5, monthlyUsed: 0 })
      .mockRejectedValueOnce(new Error('network blip'))

    const { result } = renderHook(() => useAuth(), { wrapper })
    fireAuthChange({ uid: 'user-A', email: 'a@test.com' })
    await waitFor(() => {
      expect(result.current.subscription.status).toBe('trial')
    })

    // refresh 실패 — refreshSubscription 자체가 throw 하므로 caller 가 catch 책임
    await act(async () => {
      try {
        await result.current.refreshSubscription()
      } catch { /* expected */ }
    })

    expect(result.current.subscription.status).toBe('error')
    expect(result.current.subscription.canExport).toBe(false)
  })

  it('error 상태에서 refresh 가 성공하면 정상 상태로 회복된다', async () => {
    mockGetAppDoc
      .mockRejectedValueOnce(new Error('temporarily down'))
      .mockResolvedValueOnce({ subscriptionStatus: 'trial', bonusRemaining: 5, monthlyUsed: 0 })

    const { result } = renderHook(() => useAuth(), { wrapper })
    fireAuthChange({ uid: 'user-A', email: 'a@test.com' })
    await waitFor(() => {
      expect(result.current.subscription.status).toBe('error')
    })

    await act(async () => {
      await result.current.refreshSubscription()
    })

    expect(result.current.subscription.status).toBe('trial')
    expect(result.current.subscription.canExport).toBe(true)
    // 성공 후 error 도 자동 클리어 (이전 작업에서 추가)
    expect(result.current.error).toBe(null)
  })
})

describe('AuthContext — window focus listener (외부 결제/환불 복귀 시 자동 refresh)', () => {
  // 회귀 컨텍스트: PaywallModal이 window.open(checkout URL, '_blank') 후 onClose() —
  // 사용자가 브라우저 결제하고 앱 복귀해도 앱은 fetch 안 하던 회귀 (체험판 뱃지 stuck).
  // 5초 이상 unfocused 후 복귀 시 refreshSubscription 자동 호출.

  it('인증 안 된 상태에선 focus 발생해도 fetch 호출 안 됨', () => {
    renderHook(() => useAuth(), { wrapper })
    // user 없는 상태
    act(() => { window.dispatchEvent(new Event('blur')) })
    act(() => { window.dispatchEvent(new Event('focus')) })
    // getAppDoc은 mount 시점 한 번도 호출 안 됨 (인증 안 됐으니)
    expect(mockGetAppDoc).not.toHaveBeenCalled()
  })

  it('5초 이상 unfocused 후 focus 복귀 시 refreshSubscription 자동 호출 (server source)', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    mockGetAppDoc.mockResolvedValue({ exportsUsedThisMonth: 0, lemonSqueezyCustomerId: 'cus-1' })

    renderHook(() => useAuth(), { wrapper })
    fireAuthChange({ uid: 'user-A', email: 'a@test.com' })

    // mount 시 1회 fetch
    await waitFor(() => expect(mockGetAppDoc).toHaveBeenCalledTimes(1))
    expect(mockGetAppDoc.mock.calls[0][1]).toEqual({ source: 'default' })

    // 결제 외부 브라우저로 갔다 옴 — blur → 6초 경과 → focus
    act(() => { window.dispatchEvent(new Event('blur')) })
    vi.advanceTimersByTime(6000)
    act(() => { window.dispatchEvent(new Event('focus')) })

    // server source로 refetch
    await waitFor(() => expect(mockGetAppDoc).toHaveBeenCalledTimes(2))
    expect(mockGetAppDoc.mock.calls[1][1]).toEqual({ source: 'server' })

    vi.useRealTimers()
  })

  it('5초 미만 unfocused (alt-tab 등) 후 focus는 무시 — fetch 호출 안 됨', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    mockGetAppDoc.mockResolvedValue({ exportsUsedThisMonth: 0 })

    renderHook(() => useAuth(), { wrapper })
    fireAuthChange({ uid: 'user-A', email: 'a@test.com' })

    await waitFor(() => expect(mockGetAppDoc).toHaveBeenCalledTimes(1))

    // blur → 2초 경과 → focus (alt-tab 시나리오)
    act(() => { window.dispatchEvent(new Event('blur')) })
    vi.advanceTimersByTime(2000)
    act(() => { window.dispatchEvent(new Event('focus')) })

    // refetch 안 일어남
    expect(mockGetAppDoc).toHaveBeenCalledTimes(1)

    vi.useRealTimers()
  })

  it('logout 시 리스너 정리 — 다시 focus 발생해도 fetch 호출 안 됨', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    mockGetAppDoc.mockResolvedValue({ exportsUsedThisMonth: 0 })

    renderHook(() => useAuth(), { wrapper })
    fireAuthChange({ uid: 'user-A', email: 'a@test.com' })
    await waitFor(() => expect(mockGetAppDoc).toHaveBeenCalledTimes(1))

    // logout
    fireAuthChange(null)

    // blur → 10초 → focus — 이제 리스너 해제됐어야
    act(() => { window.dispatchEvent(new Event('blur')) })
    vi.advanceTimersByTime(10000)
    act(() => { window.dispatchEvent(new Event('focus')) })

    expect(mockGetAppDoc).toHaveBeenCalledTimes(1)  // logout 후 추가 호출 없음

    vi.useRealTimers()
  })
})
