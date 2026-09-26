/**
 * useExport — 내보내기 창에서 고른 "영상 클립 오디오" 볼륨이 CapCut exporter 까지 간다.
 *
 * 2026-09-26: 모달(ExportModal)은 onExport 페이로드에 videoAudioVolume 을 싣고 exporter(capcutCloud)는
 * options.videoAudioVolume 으로 draft 를 패치하는데, 그 사이의 handleExportConfirm 이 exportCapcut 에
 * 옵션을 **이름을 골라** 넘기면서 이 값을 빠뜨렸다 — 두 쪽 테스트는 각자 초록인데 기능은 처음부터 한 번도
 * 동작하지 않았다. 여기서 실제 훅으로 그 고리를 묶는다.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'

const mockExportCapcut = vi.fn(async () => ({ success: true }))
vi.mock('../../src/exporters/capcut.js', () => ({ exportCapcut: (...a) => mockExportCapcut(...a) }))
vi.mock('../../src/exporters/premiere.js', () => ({ exportPremiere: vi.fn(async () => ({ success: true })) }))
vi.mock('../../src/exporters/vrew.js', () => ({ exportVrew: vi.fn(async () => ({ success: true })) }))
vi.mock('../../src/components/Toast', () => ({
  toast: { warning: vi.fn(), success: vi.fn(), info: vi.fn(), error: vi.fn() },
}))
vi.mock('../../src/hooks/useFileSystem', () => ({
  fileSystemAPI: { ensurePermission: vi.fn().mockResolvedValue({ hasPermission: true }) },
  default: () => ({}),
}))
vi.mock('../../src/hooks/useI18n', () => ({
  default: () => ({ t: (k) => k, lang: 'ko', setLang: vi.fn() }),
  useI18n: () => ({ t: (k) => k, lang: 'ko', setLang: vi.fn() }),
}))

import { useExport } from '../../src/hooks/useExport'

const settings = { projectName: 'P', aspectRatio: '9:16', defaultDuration: 3 }
const scenes = [{ id: 'scene_1', prompt: 'p', imagePath: '/tmp/a.png', status: 'done' }]
const confirmArgs = { capcutProjectNumber: 1, scaleMode: 'fit', kenBurns: false, subtitleOption: 'none' }

const renderExport = () => renderHook(() => useExport({
  settings, scenes,
  openSettings: vi.fn(),
  isAuthenticated: true,
  subscription: { status: 'trial', canExport: true },
  refreshSubscription: vi.fn(),
  onLoginRequired: vi.fn(),
  onPaywallRequired: vi.fn(),
  storyProjectPath: null,
}))

describe('useExport — 영상 클립 오디오 볼륨이 CapCut exporter 로 전달된다', () => {
  beforeEach(() => { vi.clearAllMocks(); window.electronAPI = {} })

  it.each([0, 0.15, 1])('창에서 고른 %s 가 exportCapcut 옵션에 그대로 실린다', async (v) => {
    const { result } = renderExport()
    await act(async () => { await result.current.handleExportConfirm({ ...confirmArgs, videoAudioVolume: v }) })
    expect(mockExportCapcut).toHaveBeenCalledTimes(1)
    expect(mockExportCapcut.mock.calls[0][1].videoAudioVolume).toBe(v)
  })

  it('값이 없으면(예전 호출자) 싣지 않는다 — exporter 가 draft 를 건드리지 않아 기존 동작', async () => {
    const { result } = renderExport()
    await act(async () => { await result.current.handleExportConfirm(confirmArgs) })
    expect(mockExportCapcut.mock.calls[0][1].videoAudioVolume).toBeUndefined()
  })
})
