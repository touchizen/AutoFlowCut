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

const mockExportPremiere = vi.fn()
vi.mock('../../src/exporters/premiere.js', () => ({
  exportPremiere: (...args) => mockExportPremiere(...args)
}))

const mockExportVrew = vi.fn()
vi.mock('../../src/exporters/vrew.js', () => ({
  exportVrew: (...args) => mockExportVrew(...args)
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
const staleScene = {
  id: 's-stale',
  image: null,
  imagePath: '/tmp/old.png',
  status: 'pending',
  duration: 3
}

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
  mockExportVrew.mockResolvedValue({ success: true, targetPath: '/tmp/p.vrew' })
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

  it('handleExportClick(format) — 포맷을 기억하고 localStorage 에 저장', () => {
    localStorage.removeItem('lastExportFormat')
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

    expect(result.current.exportFormat).toBe('capcut')

    act(() => {
      result.current.handleExportClick('premiere')
    })

    expect(result.current.exportFormat).toBe('premiere')
    expect(localStorage.getItem('lastExportFormat')).toBe('premiere')
    expect(result.current.showExportModal).toBe(true)
  })

  it('exportFormat — localStorage 가 깨진 값이면 capcut 으로 좁힌다', () => {
    localStorage.setItem('lastExportFormat', 'bad')
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
    expect(result.current.exportFormat).toBe('capcut')
  })

  it('handleExportClick(format) — 미인증이면 포맷 기억해도 모달 안 열림', () => {
    const onLoginRequired = vi.fn()
    const { result } = renderHook(() =>
      useExport({
        settings: baseSettings,
        scenes: baseScenes,
        openSettings: vi.fn(),
        isAuthenticated: false,
        subscription: { status: 'trial', canExport: true },
        refreshSubscription: vi.fn(),
        onLoginRequired,
        onPaywallRequired: vi.fn()
      })
    )

    act(() => {
      result.current.handleExportClick('premiere')
    })

    expect(onLoginRequired).toHaveBeenCalled()
    expect(result.current.showExportModal).toBe(false)
  })

  // 옛 동작: pending 이면 이미지가 있어도 모달을 안 열었다 — 그래서 519 씬 중 518 개가
  // 조용히 빠졌다. 이제는 열어서 사용자가 포함/배제를 고를 수 있어야 한다.
  it('pending 이어도 이미지가 있으면 export 모달을 연다 (사용자가 고른다)', () => {
    const { result } = renderHook(() =>
      useExport({
        settings: baseSettings,
        scenes: [staleScene],
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
    expect(mockToastWarning).not.toHaveBeenCalled()
  })

  it('이미지가 정말 없으면 종전대로 모달을 안 열고 경고한다', () => {
    const { result } = renderHook(() =>
      useExport({
        settings: baseSettings,
        scenes: [{ id: 's-empty', status: 'pending' }],
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

    expect(result.current.showExportModal).toBe(false)
    expect(mockToastWarning).toHaveBeenCalledWith('toast.noGeneratedImages')
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

// main 은 stale/손상 manifest 를 { error: kind } 로 알린다(throw 는 IPC 를 건너며 errorKind 가
// 소실된다 — Electron 이 message 만 직렬화한다). 그 객체를 그대로 흘려보내면 storyAudio 자리로
// 들어가 manifest 없는 채 export 가 진행된다. (문구 번역은 useExport.storyAudioStale.test.jsx —
// 이 파일의 t 목은 키를 그대로 돌려줘 번역을 관찰할 수 없다.)
describe('handleExportConfirm — story 오디오가 stale 이면 막는다', () => {
  it('{ error: kind } 를 storyAudio 로 흘려보내지 않고 export 를 중단한다', async () => {
    window.electronAPI = { storyLoadAudioPackage: vi.fn(async () => ({ error: 'story-audio-stale-manifest' })) }
    const { result } = renderHook(() =>
      useExport({
        settings: baseSettings,
        scenes: baseScenes,
        openSettings: vi.fn(),
        isAuthenticated: true,
        subscription: { status: 'trial', canExport: true },
        refreshSubscription: vi.fn(),
        onLoginRequired: vi.fn(),
        onPaywallRequired: vi.fn(),
        storyProjectPath: '/tmp/proj',
      })
    )

    await act(async () => {
      await result.current.handleExportConfirm(baseConfirmArgs)
    })

    expect(mockExportCapcut).not.toHaveBeenCalled()
    expect(mockToastError).toHaveBeenCalledTimes(1)
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

  it('pending 상태의 stale imagePath 는 confirm 경로에서도 export 하지 않는다', async () => {
    const refreshSubscription = vi.fn()
    const { result } = renderHook(() =>
      useExport({
        settings: baseSettings,
        scenes: [staleScene],
        openSettings: vi.fn(),
        isAuthenticated: true,
        subscription: { status: 'trial', canExport: true },
        refreshSubscription,
        onLoginRequired: vi.fn(),
        onPaywallRequired: vi.fn()
      })
    )

    let exportResult
    await act(async () => {
      exportResult = await result.current.handleExportConfirm(baseConfirmArgs)
    })

    expect(exportResult).toEqual({ success: false, error: 'toast.noGeneratedImages' })
    expect(mockExportCapcut).not.toHaveBeenCalled()
    expect(refreshSubscription).not.toHaveBeenCalled()
  })
})

describe('story 프로젝트 storyAudio 배선 (M2a-4 IP-A2)', () => {
  const storyHook = (extra = {}) => renderHook(() =>
    useExport({
      settings: baseSettings,
      scenes: baseScenes,
      openSettings: vi.fn(),
      isAuthenticated: true,
      subscription: { status: 'trial', canExport: true },
      refreshSubscription: vi.fn(),
      onLoginRequired: vi.fn(),
      onPaywallRequired: vi.fn(),
      ...extra,
    })
  )

  it('CapCut: storyProjectPath 있으면 storyLoadAudioPackage → options.storyAudio 전달', async () => {
    const pkg = { manifest: { version: 1, pushRevision: 3, segments: [] }, lastPushedRevision: 3 }
    window.electronAPI = { storyLoadAudioPackage: vi.fn().mockResolvedValue(pkg), openCapcut: vi.fn().mockResolvedValue() }
    const { result } = storyHook({ storyProjectPath: '/proj' })

    await act(async () => { await result.current.handleExportConfirm(baseConfirmArgs) })

    expect(window.electronAPI.storyLoadAudioPackage).toHaveBeenCalledTimes(1)
    expect(mockExportCapcut.mock.calls[0][1].storyAudio).toEqual(pkg)
  })

  it('CapCut: storyLoadAudioPackage 를 storyProjectPath 인자로 호출 (교차 프로젝트 방지)', async () => {
    const pkg = { manifest: { version: 1, pushRevision: 1, segments: [] }, lastPushedRevision: 1 }
    window.electronAPI = { storyLoadAudioPackage: vi.fn().mockResolvedValue(pkg), openCapcut: vi.fn().mockResolvedValue() }
    const { result } = storyHook({ storyProjectPath: '/proj' })

    await act(async () => { await result.current.handleExportConfirm(baseConfirmArgs) })

    expect(window.electronAPI.storyLoadAudioPackage).toHaveBeenCalledWith('/proj')
  })

  it('CapCut: 손상 manifest 로 storyLoadAudioPackage 가 reject 하면 export 차단(fail-fast)', async () => {
    window.electronAPI = { storyLoadAudioPackage: vi.fn().mockRejectedValue(new Error('manifest corrupt')), openCapcut: vi.fn() }
    const { result } = storyHook({ storyProjectPath: '/proj' })

    let res
    await act(async () => { res = await result.current.handleExportConfirm(baseConfirmArgs) })

    expect(mockExportCapcut).not.toHaveBeenCalled()
    expect(res.success).toBe(false)
    expect(mockToastError).toHaveBeenCalled()
  })

  it('CapCut: storyProjectPath 없으면 IPC 미호출 + storyAudio null', async () => {
    window.electronAPI = { storyLoadAudioPackage: vi.fn(), openCapcut: vi.fn().mockResolvedValue() }
    const { result } = storyHook() // storyProjectPath 없음

    await act(async () => { await result.current.handleExportConfirm(baseConfirmArgs) })

    expect(window.electronAPI.storyLoadAudioPackage).not.toHaveBeenCalled()
    expect(mockExportCapcut.mock.calls[0][1].storyAudio ?? null).toBeNull()
  })

  it('Premiere: storyProjectPath 있으면 options.storyAudio 전달', async () => {
    const pkg = { manifest: { version: 1, pushRevision: 2, segments: [] }, lastPushedRevision: 2 }
    mockExportPremiere.mockResolvedValue({ success: true, targetPath: '/tmp/p.prproj' })
    window.electronAPI = { storyLoadAudioPackage: vi.fn().mockResolvedValue(pkg), openPremiereProject: vi.fn().mockResolvedValue({ success: true }) }
    const { result } = storyHook({ storyProjectPath: '/proj' })

    await act(async () => { await result.current.handleExportPremiere(baseConfirmArgs) })

    expect(window.electronAPI.storyLoadAudioPackage).toHaveBeenCalledTimes(1)
    expect(mockExportPremiere.mock.calls[0][1].storyAudio).toEqual(pkg)
  })

  it('Vrew: 오디오 미배치 — storyProjectPath 있어도 storyAudio 미전달(IP-A3)', async () => {
    mockExportVrew.mockResolvedValue({ success: true, targetPath: '/tmp/p.vrew' })
    window.electronAPI = { storyLoadAudioPackage: vi.fn(), openVrewProject: vi.fn().mockResolvedValue({ success: true }) }
    const { result } = storyHook({ storyProjectPath: '/proj' })

    await act(async () => { await result.current.handleExportVrew(baseConfirmArgs) })

    expect(window.electronAPI.storyLoadAudioPackage).not.toHaveBeenCalled()
    expect(mockExportVrew.mock.calls[0][1].storyAudio ?? null).toBeNull()
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

describe('handleExportPremiere — 앱 실행 + Premiere 전용 toast', () => {
  beforeEach(() => {
    mockExportPremiere.mockResolvedValue({ success: true, targetPath: '/tmp/p.prproj' })
  })

  const premiereHook = () => renderHook(() =>
    useExport({
      settings: baseSettings,
      scenes: baseScenes,
      openSettings: vi.fn(),
      isAuthenticated: true,
      subscription: { status: 'active', canExport: true },
      refreshSubscription: vi.fn(),
      onLoginRequired: vi.fn(),
      onPaywallRequired: vi.fn()
    })
  )

  it('저장 후 openPremiereProject 호출 + Premiere toast (CapCut toast 아님)', async () => {
    window.electronAPI = { openPremiereProject: vi.fn().mockResolvedValue({ success: true }) }
    const { result } = premiereHook()

    await act(async () => { await result.current.handleExportPremiere(baseConfirmArgs) })

    expect(mockExportPremiere).toHaveBeenCalled()
    expect(window.electronAPI.openPremiereProject).toHaveBeenCalledWith({ targetPath: '/tmp/p.prproj' })
    expect(mockToastSuccess).toHaveBeenCalledWith('toast.premiereSaveComplete', expect.anything())
    expect(mockToastInfo).toHaveBeenCalledWith('toast.premiereLaunched', expect.anything())
    // CapCut 전용 문구는 쓰지 않는다 (회귀: "CapCut 프로젝트 저장 완료" toast 누수)
    expect(mockToastSuccess).not.toHaveBeenCalledWith('toast.exportSaveComplete', expect.anything())
  })

  it('Premiere 열기 실패 시 premiereLaunchFailed 경고', async () => {
    window.electronAPI = { openPremiereProject: vi.fn().mockResolvedValue({ success: false }) }
    const { result } = premiereHook()

    await act(async () => { await result.current.handleExportPremiere(baseConfirmArgs) })

    expect(mockToastWarning).toHaveBeenCalledWith('toast.premiereLaunchFailed', expect.anything())
  })
})

describe('handleExportVrew — 로컬 Vrew 저장', () => {
  it('exportVrew 호출 + 저장 후 .vrew 오픈, GCF refresh 없이 완료', async () => {
    const refreshSubscription = vi.fn()
    const onExportSuccess = vi.fn()
    mockExportVrew.mockResolvedValueOnce({
      success: true,
      targetPath: '/tmp/p.vrew',
      warnings: [{ code: 'unsupported-bgm' }],
    })
    window.electronAPI = { openVrewProject: vi.fn().mockResolvedValue({ success: true }) }
    const { result } = renderHook(() =>
      useExport({
        settings: baseSettings,
        scenes: baseScenes,
        openSettings: vi.fn(),
        isAuthenticated: true,
        subscription: { status: 'active', canExport: true },
        refreshSubscription,
        onLoginRequired: vi.fn(),
        onPaywallRequired: vi.fn(),
        onExportSuccess
      })
    )

    await act(async () => { await result.current.handleExportVrew(baseConfirmArgs) })

    expect(mockExportVrew).toHaveBeenCalledTimes(1)
    expect(window.electronAPI.openVrewProject).toHaveBeenCalledWith({ targetPath: '/tmp/p.vrew' })
    expect(mockToastSuccess).toHaveBeenCalledWith('toast.vrewSaveComplete', expect.anything())
    expect(mockToastWarning).toHaveBeenCalledWith('toast.vrewExportWarnings', expect.anything())
    expect(mockToastInfo).toHaveBeenCalledWith('toast.vrewLaunched', expect.anything())
    expect(refreshSubscription).not.toHaveBeenCalled()
    expect(onExportSuccess).toHaveBeenCalledTimes(1)
  })

  it('Vrew 열기 실패 시 vrewLaunchFailed 경고', async () => {
    window.electronAPI = { openVrewProject: vi.fn().mockResolvedValue({ success: false }) }
    const { result } = renderHook(() =>
      useExport({
        settings: baseSettings,
        scenes: baseScenes,
        openSettings: vi.fn(),
        isAuthenticated: true,
        subscription: { status: 'active', canExport: true },
        refreshSubscription: vi.fn(),
        onLoginRequired: vi.fn(),
        onPaywallRequired: vi.fn()
      })
    )

    await act(async () => { await result.current.handleExportVrew(baseConfirmArgs) })

    expect(mockToastWarning).toHaveBeenCalledWith('toast.vrewLaunchFailed', expect.anything())
  })
})
