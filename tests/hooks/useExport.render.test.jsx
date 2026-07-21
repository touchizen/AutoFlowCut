/**
 * useExport.handleExportRender — Premiere 미러: story 프로젝트면 loadStoryAudio 를 호출해
 * 오디오를 exporter 에 넘겨야 한다. Vrew 식(오디오 미로드) 미러였다면 story 프로젝트가 무음 MP4 로
 * 렌더된다. loadStoryAudio 호출을 지우는 뮤테이션이 이 테스트로 죽는다(스펙 §7 회귀 계약).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'

vi.mock('../../src/exporters/render.js', () => ({
  exportRenderVideo: vi.fn(async () => ({ ok: true, outPath: '/o.mp4' })),
  makeRenderJobId: () => 'job_render_1',
}))
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
import { exportRenderVideo } from '../../src/exporters/render.js'

const settings = { projectName: 'P', aspectRatio: '9:16', defaultDuration: 3 }
const scenes = [{ id: 'scene_1', prompt: 'p', imagePath: '/tmp/a.png', status: 'done' }]
const renderArgs = { scaleMode: 'fit', kenBurns: false, kenBurnsMode: 'random', kenBurnsCycle: 5, kenBurnsScaleMin: 100, kenBurnsScaleMax: 130, subtitleOption: 'none', subtitleFontSize: 8, renderMode: 'final', renderBurnSubtitle: true }

const renderExport = () => renderHook(() => useExport({
  settings, scenes,
  openSettings: vi.fn(),
  isAuthenticated: true,
  subscription: { status: 'trial', canExport: true },
  refreshSubscription: vi.fn(),
  onLoginRequired: vi.fn(),
  onPaywallRequired: vi.fn(),
  storyProjectPath: '/tmp/proj',
}))

describe('useExport.handleExportRender', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('loads story audio and passes it to the exporter (not a silent Vrew-style mirror)', async () => {
    const manifest = { manifest: { pushRevision: 1, segments: [] }, lastPushedRevision: 1 }
    window.electronAPI = {
      storyLoadAudioPackage: vi.fn(async () => manifest),
      renderMp4: vi.fn(async () => ({ ok: true, outPath: '/o.mp4' })),
      onRenderProgress: vi.fn(() => () => {}),
    }
    const { result } = renderExport()
    await act(async () => { await result.current.handleExportRender(renderArgs) })

    expect(window.electronAPI.storyLoadAudioPackage).toHaveBeenCalled() // loadStoryAudio 발화
    expect(exportRenderVideo).toHaveBeenCalledTimes(1)
    const opts = exportRenderVideo.mock.calls[0][1]
    expect(opts.storyAudio).toEqual(manifest)                            // 로드된 오디오가 exporter 로 흐름
    expect(opts.renderMode).toBe('final')
    expect(opts.renderBurnSubtitle).toBe(true)
  })

  it('subscribes to render progress and unsubscribes on completion', async () => {
    const unsub = vi.fn()
    window.electronAPI = {
      storyLoadAudioPackage: vi.fn(async () => null),
      renderMp4: vi.fn(async () => ({ ok: true, outPath: '/o.mp4' })),
      onRenderProgress: vi.fn(() => unsub),
    }
    const { result } = renderExport()
    await act(async () => { await result.current.handleExportRender(renderArgs) })
    expect(window.electronAPI.onRenderProgress).toHaveBeenCalled()
    expect(unsub).toHaveBeenCalled()
  })

  it('does not pass a browser confirmation callback to the self-render exporter', async () => {
    window.confirm = vi.fn(() => false)
    window.electronAPI = {
      storyLoadAudioPackage: vi.fn(async () => null),
      renderMp4: vi.fn(async () => ({ ok: true, outPath: '/o.mp4' })),
      onRenderProgress: vi.fn(() => () => {}),
    }
    const { result } = renderExport()
    await act(async () => { await result.current.handleExportRender(renderArgs) })

    expect(exportRenderVideo.mock.calls[0][2]).not.toHaveProperty('confirmOverlays')
    expect(window.confirm).not.toHaveBeenCalled()
  })
})
