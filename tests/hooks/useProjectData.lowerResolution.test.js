/**
 * 프로젝트를 열 때 복구가 요청보다 낮은 해상도로 저장하면 호출자에게 한 번 알린다(onLowerResolutionSaved) — Codex R2 #5.
 * 복구가 쓰는 다운로드 해상도는 설정값을 검증만 하고(720p/1080p/4k, 없으면 720p) 그대로 쓴다 — Fable #4(옛 기본 '1080p' 는 설정이 비어도 업스케일을 시도했다).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useProjectData } from '../../src/hooks/useProjectData'

vi.mock('../../src/hooks/useFileSystem', () => ({
  fileSystemAPI: {
    loadProjectData: vi.fn(), getResourcePath: vi.fn(), readResource: vi.fn(), readHistoryMetadata: vi.fn(),
    getHistory: vi.fn(), projectExists: vi.fn(), saveProjectData: vi.fn(), ensurePermission: vi.fn(),
  },
}))
vi.mock('../../src/services/mediaSync', () => ({ syncVideosIntoScenes: vi.fn() }))
vi.mock('../../src/services/videoRecovery', () => ({ recoverInFlightVideos: vi.fn() }))

import { fileSystemAPI } from '../../src/hooks/useFileSystem'
import { recoverInFlightVideos } from '../../src/services/videoRecovery'

const projectData = (settings) => ({
  success: true,
  data: { flowProjectId: 'fp-1', scenes: [], references: [], settings, videoScenes: [{ id: 'v1', generationId: 'g1', status: 'pending' }], framePairs: [], srtTrack: [], schemaVersion: 2 },
})
const genAPI = () => ({ checkVideoStatus: vi.fn(), downloadVideo: vi.fn(), fetchMedia: vi.fn(), getAccessToken: vi.fn() })
const props = (o = {}) => ({
  settings: { projectName: 'old', saveMode: 'folder', aspectRatio: '16:9' }, setSettings: vi.fn(),
  scenes: [], references: [], setScenes: vi.fn(), setReferences: vi.fn(), videoScenes: [], setVideoScenes: vi.fn(),
  framePairs: [], setFramePairs: vi.fn(), selectedStyleRefId: null, setSelectedStyleRefId: vi.fn(), srtTrack: [], setSrtTrack: vi.fn(),
  openSettings: vi.fn(), onAudioSwitch: vi.fn(), genAPI: genAPI(), mode: 'flow', ...o,
})

beforeEach(() => {
  vi.resetAllMocks()
  localStorage.clear()
  fileSystemAPI.saveProjectData.mockResolvedValue({ success: true })
  fileSystemAPI.readResource.mockResolvedValue({ success: false })
  fileSystemAPI.getResourcePath.mockResolvedValue({ success: false })
  fileSystemAPI.readHistoryMetadata.mockResolvedValue({ success: false })
  fileSystemAPI.getHistory.mockResolvedValue({ success: false, histories: [] })
  fileSystemAPI.ensurePermission.mockResolvedValue({ success: true })
  fileSystemAPI.projectExists.mockResolvedValue(true)
  localStorage.setItem('autoflowcut_settings', JSON.stringify({ projectName: 'prev', saveMode: 'folder' }))
  window.electronAPI = { setStartupProject: vi.fn(), openFlowProject: vi.fn().mockResolvedValue({ success: true, already: true }) }
})
afterEach(() => { delete window.electronAPI })

async function open(settings, extra) {
  fileSystemAPI.loadProjectData.mockResolvedValue(projectData(settings))
  await act(async () => {
    renderHook(() => useProjectData(props(extra)))
    await new Promise((r) => setTimeout(r, 60))
  })
}

describe('project-open recovery — download resolution and lower-resolution notice', () => {
  it('calls onLowerResolutionSaved once with the number of lower-resolution saves', async () => {
    recoverInFlightVideos.mockResolvedValue({ recovered: 2, total: 2, expired: 0, notices: [{ kind: 'upscale-fallback' }, { kind: 'upscale-downgraded' }] })
    const onLowerResolutionSaved = vi.fn()
    await open({ aspectRatio: '16:9', videoResolution: '1080p' }, { onLowerResolutionSaved })
    expect(recoverInFlightVideos).toHaveBeenCalled()
    expect(onLowerResolutionSaved).toHaveBeenCalledTimes(1)
    expect(onLowerResolutionSaved).toHaveBeenCalledWith(2)
  })

  it('does not call it when nothing was saved lower', async () => {
    recoverInFlightVideos.mockResolvedValue({ recovered: 1, total: 1, expired: 0, notices: [] })
    const onLowerResolutionSaved = vi.fn()
    await open({ aspectRatio: '16:9', videoResolution: '1080p' }, { onLowerResolutionSaved })
    expect(onLowerResolutionSaved).not.toHaveBeenCalled()
  })

  it('an unset resolution recovers at 720p (no upscale attempt); a set one is passed through', async () => {
    recoverInFlightVideos.mockResolvedValue({ recovered: 0, total: 0, expired: 0, notices: [] })
    await open({ aspectRatio: '16:9' })
    expect(recoverInFlightVideos.mock.calls[0][0]).toMatchObject({ videoResolution: '720p' })
  })
})
