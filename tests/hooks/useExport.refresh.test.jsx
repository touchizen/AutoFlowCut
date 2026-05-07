/**
 * useExport — Export 성공 후 subscription 재조회 + loading 윈도우 paywall 차단
 *
 * P2-1: V2 GCF 가 서버측 quota 를 갱신해도 클라이언트 subscription 캐시는 별개.
 *   handleExportConfirm 성공 직후 refreshSubscription 이 호출되어야 다음 export 가드가 정확해진다.
 * P2-3 후속: subscription.status === 'loading' 일 때 paywall 띄우면 사용자가 오해한다.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'

// ── 외부 모듈 모킹 ──
const mockExportCapcut = vi.fn()
vi.mock('../../src/exporters/capcut.js', () => ({
  exportCapcut: (...args) => mockExportCapcut(...args)
}))

const mockToastWarning = vi.fn()
const mockToastSuccess = vi.fn()
const mockToastInfo = vi.fn()
const mockToastError = vi.fn()
vi.mock('../../src/components/Toast', () => ({
  toast: {
    warning: (...a) => mockToastWarning(...a),
    success: (...a) => mockToastSuccess(...a),
    info: (...a) => mockToastInfo(...a),
    error: (...a) => mockToastError(...a)
  }
}))

vi.mock('../../src/hooks/useI18n', () => ({
  default: () => ({ t: (key) => key, lang: 'en', setLang: vi.fn() }),
  useI18n: () => ({ t: (key) => key, lang: 'en', setLang: vi.fn() })
}))

vi.mock('../../src/hooks/useFileSystem', () => ({
  fileSystemAPI: {
    ensurePermission: vi.fn().mockResolvedValue({ hasPermission: true })
  },
  default: () => ({})
}))

import { useExport } from '../../src/hooks/useExport'

const baseSettings = { projectName: 'TestProject', aspectRatio: '16:9', defaultDuration: 3 }
const baseScenes = [
  { id: 's1', image: 'data:image/png;base64,xxx', imagePath: null, duration: 3 }
]

const baseConfirmArgs = {
  capcutProjectNumber: 1,
  scaleMode: 'cover',
  kenBurns: false,
  kenBurnsMode: null,
  kenBurnsCycle: null,
  kenBurnsScaleMin: null,
  kenBurnsScaleMax: null,
  subtitleOption: 'none',
  subtitleFontSize: 36
}

beforeEach(() => {
  vi.clearAllMocks()
  mockExportCapcut.mockResolvedValue({ success: true, targetPath: '/tmp/out' })
  // window.electronAPI.openCapcut 우회 — 단위 테스트에서는 호출 안 함
  if (typeof window !== 'undefined') {
    delete window.electronAPI
  }
})

describe('handleExportClick — loading 윈도우 paywall 차단 (P2-3 후속)', () => {
  it('subscription.status === "loading" 이면 paywall 띄우지 않고 무음 차단', () => {
    const onPaywallRequired = vi.fn()
    const onLoginRequired = vi.fn()
    const { result } = renderHook(() =>
      useExport({
        settings: baseSettings,
        scenes: baseScenes,
        openSettings: vi.fn(),
        isAuthenticated: true,
        subscription: { status: 'loading', canExport: false },
        refreshSubscription: vi.fn(),
        onLoginRequired,
        onPaywallRequired
      })
    )

    act(() => {
      result.current.handleExportClick()
    })

    expect(onPaywallRequired).not.toHaveBeenCalled()
    expect(onLoginRequired).not.toHaveBeenCalled()
    expect(result.current.showExportModal).toBe(false)
  })

  it('canExport=false 이지만 status !== "loading" 이면 paywall(trial_expired) 띄움', () => {
    const onPaywallRequired = vi.fn()
    const { result } = renderHook(() =>
      useExport({
        settings: baseSettings,
        scenes: baseScenes,
        openSettings: vi.fn(),
        isAuthenticated: true,
        subscription: { status: 'expired', canExport: false },
        refreshSubscription: vi.fn(),
        onLoginRequired: vi.fn(),
        onPaywallRequired
      })
    )

    act(() => {
      result.current.handleExportClick()
    })

    expect(onPaywallRequired).toHaveBeenCalledWith('trial_expired')
  })

  it('canExport=true 이면 export 모달 오픈', () => {
    const { result } = renderHook(() =>
      useExport({
        settings: baseSettings,
        scenes: baseScenes,
        openSettings: vi.fn(),
        isAuthenticated: true,
        subscription: { status: 'trial', canExport: true },
        refreshSubscription: vi.fn(),
        onLoginRequired: vi.fn(),
        onPaywallRequired: vi.fn()
      })
    )

    act(() => {
      result.current.handleExportClick()
    })

    expect(result.current.showExportModal).toBe(true)
  })

  it('미인증 시 onLoginRequired 만 호출', () => {
    const onLoginRequired = vi.fn()
    const onPaywallRequired = vi.fn()
    const { result } = renderHook(() =>
      useExport({
        settings: baseSettings,
        scenes: baseScenes,
        openSettings: vi.fn(),
        isAuthenticated: false,
        subscription: null,
        refreshSubscription: vi.fn(),
        onLoginRequired,
        onPaywallRequired
      })
    )

    act(() => {
      result.current.handleExportClick()
    })

    expect(onLoginRequired).toHaveBeenCalled()
    expect(onPaywallRequired).not.toHaveBeenCalled()
    expect(result.current.showExportModal).toBe(false)
  })
})

describe('handleExportConfirm — 성공 후 refreshSubscription 호출 (P2-1)', () => {
  it('export 성공 시 refreshSubscription 이 호출된다', async () => {
    const refreshSubscription = vi.fn().mockResolvedValue(undefined)
    const { result } = renderHook(() =>
      useExport({
        settings: baseSettings,
        scenes: baseScenes,
        openSettings: vi.fn(),
        isAuthenticated: true,
        subscription: { status: 'trial', canExport: true },
        refreshSubscription,
        onLoginRequired: vi.fn(),
        onPaywallRequired: vi.fn()
      })
    )

    await act(async () => {
      await result.current.handleExportConfirm(baseConfirmArgs)
    })

    expect(mockExportCapcut).toHaveBeenCalledTimes(1)
    expect(refreshSubscription).toHaveBeenCalledTimes(1)
  })

  it('refreshSubscription 호출 순서는 exportCapcut 성공 이후', async () => {
    const callOrder = []
    mockExportCapcut.mockImplementation(async () => {
      callOrder.push('exportCapcut')
      return { success: true, targetPath: '/tmp/out' }
    })
    const refreshSubscription = vi.fn().mockImplementation(async () => {
      callOrder.push('refreshSubscription')
    })

    const { result } = renderHook(() =>
      useExport({
        settings: baseSettings,
        scenes: baseScenes,
        openSettings: vi.fn(),
        isAuthenticated: true,
        subscription: { status: 'trial', canExport: true },
        refreshSubscription,
        onLoginRequired: vi.fn(),
        onPaywallRequired: vi.fn()
      })
    )

    await act(async () => {
      await result.current.handleExportConfirm(baseConfirmArgs)
    })

    expect(callOrder).toEqual(['exportCapcut', 'refreshSubscription'])
  })

  it('exportCapcut 실패 시 refreshSubscription 은 호출되지 않음', async () => {
    mockExportCapcut.mockResolvedValue({ success: false, error: 'quota exceeded' })
    const refreshSubscription = vi.fn()

    const { result } = renderHook(() =>
      useExport({
        settings: baseSettings,
        scenes: baseScenes,
        openSettings: vi.fn(),
        isAuthenticated: true,
        subscription: { status: 'trial', canExport: true },
        refreshSubscription,
        onLoginRequired: vi.fn(),
        onPaywallRequired: vi.fn()
      })
    )

    await act(async () => {
      await result.current.handleExportConfirm(baseConfirmArgs)
    })

    expect(refreshSubscription).not.toHaveBeenCalled()
    expect(mockToastError).toHaveBeenCalled()
  })

  it('refreshSubscription 자체가 실패해도 export 결과 자체는 성공으로 유지된다', async () => {
    const refreshSubscription = vi.fn().mockRejectedValue(new Error('Firestore offline'))
    const { result } = renderHook(() =>
      useExport({
        settings: baseSettings,
        scenes: baseScenes,
        openSettings: vi.fn(),
        isAuthenticated: true,
        subscription: { status: 'trial', canExport: true },
        refreshSubscription,
        onLoginRequired: vi.fn(),
        onPaywallRequired: vi.fn()
      })
    )

    await act(async () => {
      await result.current.handleExportConfirm(baseConfirmArgs)
    })

    // export 자체는 성공 토스트가 떠야 한다
    expect(mockToastSuccess).toHaveBeenCalled()
    // export 실패 토스트는 뜨지 않아야 한다
    expect(mockToastError).not.toHaveBeenCalled()
  })

  it('refreshSubscription 미주입 시 — 테스트 등 — crash 하지 않고 정상 종료', async () => {
    const { result } = renderHook(() =>
      useExport({
        settings: baseSettings,
        scenes: baseScenes,
        openSettings: vi.fn(),
        isAuthenticated: true,
        subscription: { status: 'trial', canExport: true },
        // refreshSubscription 누락
        onLoginRequired: vi.fn(),
        onPaywallRequired: vi.fn()
      })
    )

    await expect(
      act(async () => {
        await result.current.handleExportConfirm(baseConfirmArgs)
      })
    ).resolves.not.toThrow()

    expect(mockExportCapcut).toHaveBeenCalled()
    expect(mockToastSuccess).toHaveBeenCalled()
  })
})

describe('handleExportClick — terminal error 상태 처리 (구독 정보 로드 실패)', () => {
  // 회귀 방지: subscription.status === 'error' 이면 paywall 이 아니라
  // 에러 토스트 + refreshSubscription 재시도로 처리되어야 한다.
  it('subscription.status === "error" 일 때 paywall 대신 toast.error + refresh 트리거', () => {
    const onPaywallRequired = vi.fn()
    const onLoginRequired = vi.fn()
    const refreshSubscription = vi.fn()
    const { result } = renderHook(() =>
      useExport({
        settings: baseSettings,
        scenes: baseScenes,
        openSettings: vi.fn(),
        isAuthenticated: true,
        subscription: { status: 'error', canExport: false, isExpired: true },
        refreshSubscription,
        onLoginRequired,
        onPaywallRequired
      })
    )

    act(() => {
      result.current.handleExportClick()
    })

    expect(mockToastError).toHaveBeenCalledTimes(1)
    expect(refreshSubscription).toHaveBeenCalledTimes(1)
    expect(onPaywallRequired).not.toHaveBeenCalled()
    expect(onLoginRequired).not.toHaveBeenCalled()
    expect(result.current.showExportModal).toBe(false)
  })

  it('refreshSubscription 미주입 시에도 error 분기에서 crash 하지 않는다', () => {
    const { result } = renderHook(() =>
      useExport({
        settings: baseSettings,
        scenes: baseScenes,
        openSettings: vi.fn(),
        isAuthenticated: true,
        subscription: { status: 'error', canExport: false, isExpired: true },
        // refreshSubscription 누락
        onLoginRequired: vi.fn(),
        onPaywallRequired: vi.fn()
      })
    )

    expect(() => {
      act(() => {
        result.current.handleExportClick()
      })
    }).not.toThrow()

    expect(mockToastError).toHaveBeenCalled()
  })

  // 회귀 방지: 재시도 promise 가 reject 되어도 unhandled rejection 으로 떨어지지 않아야 한다.
  // refreshSubscription 은 fetchUserData throw 를 그대로 전파하므로 fire-and-forget 위험.
  it('refreshSubscription 재시도가 reject 되어도 unhandled rejection 이 발생하지 않는다', async () => {
    const refreshSubscription = vi.fn().mockRejectedValue(new Error('still down'))
    const unhandled = vi.fn()
    if (typeof process !== 'undefined') {
      process.on('unhandledRejection', unhandled)
    }

    const { result } = renderHook(() =>
      useExport({
        settings: baseSettings,
        scenes: baseScenes,
        openSettings: vi.fn(),
        isAuthenticated: true,
        subscription: { status: 'error', canExport: false, isExpired: true },
        refreshSubscription,
        onLoginRequired: vi.fn(),
        onPaywallRequired: vi.fn()
      })
    )

    act(() => {
      result.current.handleExportClick()
    })

    // microtask flush 로 reject 된 promise 가 처리되도록 한다
    await new Promise(r => setTimeout(r, 30))

    expect(refreshSubscription).toHaveBeenCalledTimes(1)
    expect(unhandled).not.toHaveBeenCalled()

    if (typeof process !== 'undefined') {
      process.off('unhandledRejection', unhandled)
    }
  })
})
