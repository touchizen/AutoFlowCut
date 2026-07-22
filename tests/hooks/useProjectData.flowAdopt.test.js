/**
 * Flow 프로젝트 수동 채택(adopt).
 *
 * 배경: 새 로컬 프로젝트는 저장된 flowProjectId 가 없어 mode-entry Case B 가
 * newFlowProject() 로 Flow 프로젝트를 만든다. 이게 실패하면(간헐 — Flow 홈의 광고/오버레이,
 * 20s 타임아웃 등) flowProjectReady=false 로 고착되고 회복 경로가 없어 생성이 전부 막힌다.
 * 사용자가 Flow 웹에서 직접 새 프로젝트를 만들어도 앱이 채택하지 않아 풀리지 않았다.
 *
 * 해결: Case B 실패 시 그 시점의 Flow id 를 preId 로 기록해 두고(arm), 이후 현재 Flow id 가
 * preId 와 "달라지면" = 사용자가 새 프로젝트로 들어간 것이므로 그 id 를 채택한다.
 * 이 preId 비교는 newFlowProject 가 새 프로젝트를 판정할 때 쓰는 기법과 동일하며,
 * "Flow 뷰가 이전 프로젝트에 그대로 머물러 있는" 경우를 구조적으로 배제한다.
 *
 * 안전장치(Codex 설계리뷰):
 *  - 채택 전 openFlowProject 로 confirmed(정상 composer) 확인 — URL 에 id 가 있어도 에러 화면일 수 있다.
 *  - project.json 저장이 성공한 뒤에만 ready=true — 저장 실패 시 다음 실행에서 또 새 프로젝트를 만든다.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useProjectData } from '../../src/hooks/useProjectData'

vi.mock('../../src/hooks/useFileSystem', () => ({
  fileSystemAPI: {
    loadProjectData: vi.fn(),
    getResourcePath: vi.fn(),
    readResource: vi.fn(),
    readHistoryMetadata: vi.fn(),
    getHistory: vi.fn(),
    projectExists: vi.fn(),
    saveProjectData: vi.fn(),
    ensurePermission: vi.fn(),
    mergeProjectData: vi.fn(),
  },
}))
vi.mock('../../src/services/mediaSync', () => ({ syncVideosIntoScenes: vi.fn() }))
vi.mock('../../src/services/videoRecovery', () => ({ recoverInFlightVideos: vi.fn() }))

import { fileSystemAPI } from '../../src/hooks/useFileSystem'

function setupHook({ mode = 'api', projectName = 'p1' } = {}) {
  const { result, rerender } = renderHook(
    ({ mode, projectName }) =>
      useProjectData({
        settings: { projectName, saveMode: 'folder', aspectRatio: '16:9' },
        setSettings: vi.fn(),
        scenes: [], references: [], setScenes: vi.fn(), setReferences: vi.fn(),
        videoScenes: [], setVideoScenes: vi.fn(),
        framePairs: [], setFramePairs: vi.fn(),
        selectedStyleRefId: null, setSelectedStyleRefId: vi.fn(),
        openSettings: vi.fn(), onAudioSwitch: vi.fn(), genAPI: null,
        mode,
      }),
    { initialProps: { mode, projectName } },
  )
  return { result, rerender }
}

const urlOf = (id) => `https://labs.google/fx/tools/flow/project/${id}`

describe('Flow 프로젝트 채택 (Case B 실패 회복)', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    localStorage.clear()
    fileSystemAPI.saveProjectData.mockResolvedValue({ success: true })
    fileSystemAPI.readResource.mockResolvedValue({ success: false })
    fileSystemAPI.readHistoryMetadata.mockResolvedValue({ success: false })
    fileSystemAPI.getHistory.mockResolvedValue({ success: false, histories: [] })
    fileSystemAPI.ensurePermission.mockResolvedValue({ success: true })
    fileSystemAPI.mergeProjectData.mockResolvedValue({ success: true })
    if (typeof window !== 'undefined') delete window.electronAPI
  })

  // Case B 실패 → armed. 그 후 사용자가 Flow 에서 새 프로젝트로 들어가면(id != preId) 채택된다.
  it('사용자가 Flow 에서 새 프로젝트로 들어가면(preId와 다름) 채택해 ready 를 푼다', async () => {
    const newFlowProject = vi.fn().mockResolvedValue({ success: false, error: 'timeout waiting for a NEW project URL' })
    const flowExtractProjectId = vi.fn()
      .mockResolvedValueOnce({ success: true, projectId: 'old-id' }) // Case B 실패 시점 preId
      .mockResolvedValue({ success: true, projectId: 'new-id' })     // 사용자가 만든 새 프로젝트
    const openFlowProject = vi.fn().mockResolvedValue({ success: true, already: true, url: urlOf('new-id') })
    window.electronAPI = { newFlowProject, flowExtractProjectId, openFlowProject }

    const { result, rerender } = setupHook({ mode: 'api' })
    await act(async () => { rerender({ mode: 'flow', projectName: 'p1' }) })
    expect(result.current.flowProjectReady).toBe(false) // Case B 실패로 차단됨

    let adopted
    await act(async () => { adopted = await result.current.tryAdoptFlowProject() })

    expect(adopted?.ok).toBe(true)
    expect(result.current.flowProjectId).toBe('new-id')
    expect(result.current.flowProjectReady).toBe(true)
    expect(fileSystemAPI.mergeProjectData).toHaveBeenCalledWith('p1', { flowProjectId: 'new-id' })
  })

  // Flow 뷰가 이전 프로젝트에 그대로 머물러 있으면 채택하지 않는다(오염 방지의 핵심).
  it('현재 id 가 preId 와 같으면 채택하지 않는다', async () => {
    const newFlowProject = vi.fn().mockResolvedValue({ success: false })
    const flowExtractProjectId = vi.fn().mockResolvedValue({ success: true, projectId: 'old-id' })
    const openFlowProject = vi.fn()
    window.electronAPI = { newFlowProject, flowExtractProjectId, openFlowProject }

    const { result, rerender } = setupHook({ mode: 'api' })
    await act(async () => { rerender({ mode: 'flow', projectName: 'p1' }) })

    let adopted
    await act(async () => { adopted = await result.current.tryAdoptFlowProject() })

    expect(adopted?.ok).toBe(false)
    expect(result.current.flowProjectReady).toBe(false)
    expect(openFlowProject).not.toHaveBeenCalled()
    expect(fileSystemAPI.mergeProjectData).not.toHaveBeenCalled()
  })

  // URL 에 id 가 있어도 에러 화면일 수 있다 — confirmed 가 아니면 채택하지 않는다.
  it('composer 확인(openFlowProject)이 confirmed 가 아니면 채택하지 않는다', async () => {
    const newFlowProject = vi.fn().mockResolvedValue({ success: false })
    const flowExtractProjectId = vi.fn()
      .mockResolvedValueOnce({ success: true, projectId: 'old-id' })
      .mockResolvedValue({ success: true, projectId: 'new-id' })
    const openFlowProject = vi.fn().mockResolvedValue({ success: false, errorPage: true, url: urlOf('new-id') })
    window.electronAPI = { newFlowProject, flowExtractProjectId, openFlowProject }

    const { result, rerender } = setupHook({ mode: 'api' })
    await act(async () => { rerender({ mode: 'flow', projectName: 'p1' }) })

    let adopted
    await act(async () => { adopted = await result.current.tryAdoptFlowProject() })

    expect(adopted?.ok).toBe(false)
    expect(result.current.flowProjectReady).toBe(false)
    expect(fileSystemAPI.mergeProjectData).not.toHaveBeenCalled()
  })

  // flowProjectReady=false 는 "생성 진행 중"에도 참이다. Case B 가 실제로 실패해 arm 되기 전에는
  // 채택하면 안 된다 — 아직 preId 도 없어 Flow 에 떠 있는 아무 프로젝트나 잡을 수 있다.
  it('Case B 가 실패해 arm 되기 전에는 채택하지 않는다(진행 중 오채택 방지)', async () => {
    // newFlowProject 를 영원히 pending 으로 두어 "생성 진행 중" 상태를 만든다.
    const newFlowProject = vi.fn(() => new Promise(() => {}))
    const flowExtractProjectId = vi.fn().mockResolvedValue({ success: true, projectId: 'someone-elses-id' })
    const openFlowProject = vi.fn()
    window.electronAPI = { newFlowProject, flowExtractProjectId, openFlowProject }

    const { result, rerender } = setupHook({ mode: 'api' })
    await act(async () => { rerender({ mode: 'flow', projectName: 'p1' }) })

    let adopted
    await act(async () => { adopted = await result.current.tryAdoptFlowProject() })

    expect(adopted).toMatchObject({ ok: false, reason: 'not-armed' })
    expect(openFlowProject).not.toHaveBeenCalled()
    expect(fileSystemAPI.mergeProjectData).not.toHaveBeenCalled()
    expect(result.current.flowProjectId).toBeNull()
  })

  // baseline 관측 자체가 실패했는데(Flow view 미준비 등) 이를 null 로 뭉개면, 이후 Flow 가 이전
  // 프로젝트로 복원됐을 때 "id !== null" 이라 그 옛 프로젝트를 채택해 새 로컬 프로젝트를 오염시킨다.
  it('baseline 관측에 실패했으면 첫 시도는 baseline 만 잡고, 이전 프로젝트를 채택하지 않는다', async () => {
    const newFlowProject = vi.fn().mockResolvedValue({ success: false })
    const flowExtractProjectId = vi.fn()
      .mockResolvedValueOnce({ success: false, error: 'Flow view not ready' }) // Case B 실패 시점: 관측 실패
      .mockResolvedValue({ success: true, projectId: 'previous-id' })          // 이후 이전 프로젝트로 복원됨
    const openFlowProject = vi.fn()
    window.electronAPI = { newFlowProject, flowExtractProjectId, openFlowProject }

    const { result, rerender } = setupHook({ mode: 'api' })
    await act(async () => { rerender({ mode: 'flow', projectName: 'p1' }) })

    let first, second
    await act(async () => { first = await result.current.tryAdoptFlowProject() })
    await act(async () => { second = await result.current.tryAdoptFlowProject() })

    expect(first).toMatchObject({ ok: false, reason: 'baseline-set' })
    expect(second).toMatchObject({ ok: false, reason: 'unchanged' }) // 이전 프로젝트는 채택 안 됨
    expect(openFlowProject).not.toHaveBeenCalled()
    expect(fileSystemAPI.mergeProjectData).not.toHaveBeenCalled()
    expect(result.current.flowProjectReady).toBe(false)
  })

  // 저장이 실패했는데 ready 를 열면, 다음 실행에서 저장 id 가 없어 또 새 프로젝트를 만든다(fail-open 금지).
  it('project.json 저장이 실패하면 ready 를 열지 않는다', async () => {
    const newFlowProject = vi.fn().mockResolvedValue({ success: false })
    const flowExtractProjectId = vi.fn()
      .mockResolvedValueOnce({ success: true, projectId: 'old-id' })
      .mockResolvedValue({ success: true, projectId: 'new-id' })
    const openFlowProject = vi.fn().mockResolvedValue({ success: true, already: true, url: urlOf('new-id') })
    window.electronAPI = { newFlowProject, flowExtractProjectId, openFlowProject }
    fileSystemAPI.mergeProjectData.mockResolvedValue({ success: false, error: 'disk' })

    const { result, rerender } = setupHook({ mode: 'api' })
    await act(async () => { rerender({ mode: 'flow', projectName: 'p1' }) })

    let adopted
    await act(async () => { adopted = await result.current.tryAdoptFlowProject() })

    expect(adopted?.ok).toBe(false)
    expect(result.current.flowProjectReady).toBe(false)
  })
})
