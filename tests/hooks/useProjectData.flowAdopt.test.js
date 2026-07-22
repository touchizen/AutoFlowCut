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
import { useProjectData, BIND_WATCHDOG_MS } from '../../src/hooks/useProjectData'

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
    // 실제 계약: project.json 이 없어도 success:true + data:null (isNew) 을 돌려준다.
    fileSystemAPI.loadProjectData.mockResolvedValue({ success: true, data: null })
    if (typeof window !== 'undefined') delete window.electronAPI
  })

  // Case B 실패 → armed. 그 후 id 가 baseline 과 달라지면 채택 후보지만, **자동 채택은 하지 않는다**.
  // id 변화는 "이동이 일어났다"만 증명할 뿐 누가 왜 이동시켰는지(provenance)를 증명하지 않는다 —
  // 사용자가 예전 작업물을 열어봤거나 Flow 가 자율 이동한 경우 남의 프로젝트에 씬이 섞인다.
  it('id 가 baseline 과 달라져도 확인 없이는 채택하지 않는다(항상 확인)', async () => {
    const newFlowProject = vi.fn().mockResolvedValue({ success: false, error: 'timeout waiting for a NEW project URL' })
    const flowExtractProjectId = vi.fn()
      .mockResolvedValueOnce({ success: true, projectId: 'old-id' })
      .mockResolvedValue({ success: true, projectId: 'new-id' })
    const openFlowProject = vi.fn().mockResolvedValue({ success: true, already: true, url: urlOf('new-id') })
    window.electronAPI = { newFlowProject, flowExtractProjectId, openFlowProject }

    const { result, rerender } = setupHook({ mode: 'api' })
    await act(async () => { rerender({ mode: 'flow', projectName: 'p1' }) })

    let res
    await act(async () => { res = await result.current.tryAdoptFlowProject() })

    expect(res).toMatchObject({ ok: false, reason: 'needs-confirm', projectId: 'new-id' })
    expect(openFlowProject).not.toHaveBeenCalled()
    expect(fileSystemAPI.mergeProjectData).not.toHaveBeenCalled()
    expect(result.current.flowProjectReady).toBe(false)
  })

  // 사용자가 확인하면 그때 채택된다(baseline 이 non-null 이어도 동일).
  it('사용자가 확인하면 채택해 ready 를 푼다', async () => {
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
    await act(async () => { adopted = await result.current.tryAdoptFlowProject({ confirmed: true }) })

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
    await act(async () => { adopted = await result.current.tryAdoptFlowProject({ confirmed: true }) })

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

    // 생성이 진행 중이면 재바인딩 요청조차 하지 않는다(두 소유자 금지) — 채택은 당연히 안 된다.
    expect(adopted).toMatchObject({ ok: false, reason: 'bind-in-flight' })
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

  // baseline 이 null(Flow 가 home) 이면, 지금 보이는 프로젝트가 "사용자가 방금 만든 것"인지
  // "이전 프로젝트가 복원된 것"인지 구분할 수 없다 → 자동 채택하지 않고 사용자 확인을 요구한다.
  it('baseline 이 null(home)이면 자동 채택하지 않고 needs-confirm 을 돌려준다', async () => {
    const newFlowProject = vi.fn().mockResolvedValue({ success: false })
    const flowExtractProjectId = vi.fn()
      .mockResolvedValueOnce({ success: true, projectId: null })  // Case B 실패 시점: home
      .mockResolvedValue({ success: true, projectId: 'some-id' })
    const openFlowProject = vi.fn().mockResolvedValue({ success: true, already: true, url: urlOf('some-id') })
    window.electronAPI = { newFlowProject, flowExtractProjectId, openFlowProject }

    const { result, rerender } = setupHook({ mode: 'api' })
    await act(async () => { rerender({ mode: 'flow', projectName: 'p1' }) })

    let res
    await act(async () => { res = await result.current.tryAdoptFlowProject() })

    expect(res).toMatchObject({ ok: false, reason: 'needs-confirm', projectId: 'some-id' })
    expect(fileSystemAPI.mergeProjectData).not.toHaveBeenCalled()
    expect(result.current.flowProjectReady).toBe(false)

    // 사용자가 확인하면 그때 채택된다.
    await act(async () => { res = await result.current.tryAdoptFlowProject({ confirmed: true }) })
    expect(res).toMatchObject({ ok: true, projectId: 'some-id' })
    expect(result.current.flowProjectReady).toBe(true)
  })

  // 다른 로컬 프로젝트에서 arm 된 채택이 살아남아 현재 프로젝트에 발화하면 안 된다.
  it('arm 이 다른 로컬 프로젝트/세션의 것이면 채택하지 않는다(stale-arm)', async () => {
    const newFlowProject = vi.fn().mockResolvedValue({ success: false })
    const flowExtractProjectId = vi.fn()
      .mockResolvedValueOnce({ success: true, projectId: 'old-id' })
      .mockResolvedValue({ success: true, projectId: 'new-id' })
    const openFlowProject = vi.fn()
    window.electronAPI = { newFlowProject, flowExtractProjectId, openFlowProject }

    const { result, rerender } = setupHook({ mode: 'api' })
    await act(async () => { rerender({ mode: 'flow', projectName: 'p1' }) })
    // 로컬 프로젝트가 바뀐 상황을 흉내 — arm 은 p1 것이라 p2 에서는 발화하면 안 된다.
    await act(async () => { rerender({ mode: 'flow', projectName: 'p2' }) })

    let res
    await act(async () => { res = await result.current.tryAdoptFlowProject() })

    // 어떤 경로로 거절되든(stale-arm / 재arm 후 unchanged) 지켜야 할 성질은 하나다:
    // 이전 로컬 프로젝트(p1)의 project.json 에 절대 쓰지 않는다.
    expect(res?.ok).toBe(false)
    expect(fileSystemAPI.mergeProjectData).not.toHaveBeenCalledWith('p1', expect.anything())
  })

  // 자동 생성(Case B)이 "성공"해도 project.json 저장이 실패하면, ready 를 여는 순간 다음 실행에서
  // 저장된 id 가 없어 또 새 Flow 프로젝트를 만든다(빈 프로젝트 양산). 채택 경로와 같은 규칙 —
  // 저장이 확인된 뒤에만 ready 를 연다.
  it('Case B 성공이라도 project.json 저장이 실패하면 ready 를 열지 않는다', async () => {
    const newFlowProject = vi.fn().mockResolvedValue({ success: true, projectId: 'created-id' })
    const flowExtractProjectId = vi.fn().mockResolvedValue({ success: true, projectId: 'created-id' })
    const openFlowProject = vi.fn()
    window.electronAPI = { newFlowProject, flowExtractProjectId, openFlowProject }
    fileSystemAPI.mergeProjectData.mockResolvedValue({ success: false, error: 'disk' })

    const { result, rerender } = setupHook({ mode: 'api' })
    await act(async () => { rerender({ mode: 'flow', projectName: 'p1' }) })

    expect(fileSystemAPI.mergeProjectData).toHaveBeenCalledWith('p1', { flowProjectId: 'created-id' })
    expect(result.current.flowProjectReady).toBe(false)
    // 저장되지 않은 id 를 state 에 바인딩하면 mode-entry 가 Case A 로 재오픈해 ready 를 열어버린다
    // (같은 fail-open 이 뒷문으로 재현된다).
    expect(result.current.flowProjectId).toBeNull()
  })

  // 저장만 실패한 상태에는 회복 경로가 있어야 한다 — Flow 프로젝트는 이미 만들어졌으므로
  // 새로 만들 필요 없이 저장만 재시도하면 된다(App 의 5초 폴링이 이 함수를 계속 부른다).
  it('Case B 저장 실패 후, 폴링 재시도에서 저장이 성공하면 open 확인을 거쳐 ready 를 연다', async () => {
    const newFlowProject = vi.fn().mockResolvedValue({ success: true, projectId: 'created-id' })
    const flowExtractProjectId = vi.fn().mockResolvedValue({ success: true, projectId: 'created-id' })
    // 저장은 "디스크에 매핑이 있다"는 증명일 뿐 Flow 뷰가 그 프로젝트를 보고 있다는 증명이 아니다 —
    // ready 는 openFlowProject 확인을 거쳐야 열린다.
    const openFlowProject = vi.fn().mockResolvedValue({ success: true, already: true, url: urlOf('created-id') })
    window.electronAPI = { newFlowProject, flowExtractProjectId, openFlowProject }
    fileSystemAPI.mergeProjectData.mockResolvedValueOnce({ success: false, error: 'disk' })
    fileSystemAPI.mergeProjectData.mockResolvedValue({ success: true })
    // 실제 계약: project.json 이 없어도 success:true + data:null (isNew) 을 돌려준다.
    fileSystemAPI.loadProjectData.mockResolvedValue({ success: true, data: null })

    const { result, rerender } = setupHook({ mode: 'api' })
    await act(async () => { rerender({ mode: 'flow', projectName: 'p1' }) })
    expect(result.current.flowProjectReady).toBe(false)

    let res
    await act(async () => { res = await result.current.tryAdoptFlowProject() })

    expect(res).toMatchObject({ ok: true, projectId: 'created-id' })
    expect(result.current.flowProjectId).toBe('created-id')
    expect(result.current.flowProjectReady).toBe(true)
    expect(openFlowProject).toHaveBeenCalledWith({ flowProjectId: 'created-id' })
    // 이미 만들어진 프로젝트를 저장만 재시도한 것 — 새 Flow 프로젝트를 또 만들면 안 된다.
    expect(newFlowProject).toHaveBeenCalledTimes(1)
    // 재시도가 실제로 "저장"이었는지 핀 — 저장을 건너뛰고 ready 만 열면 같은 fail-open 이다.
    expect(fileSystemAPI.mergeProjectData).toHaveBeenCalledTimes(2)
    expect(fileSystemAPI.mergeProjectData).toHaveBeenNthCalledWith(2, 'p1', { flowProjectId: 'created-id' })
  })

  // 저장 대기는 그 로컬 프로젝트의 것이다. api 로 잠깐 나갔다 돌아왔다고 버리면, 이미 만들어진
  // Flow 프로젝트를 잃고 Case B 가 두 번째 프로젝트를 만든다(빈 프로젝트 양산).
  it('Case B 저장 실패 후 api 로 나갔다 돌아와도, 새로 만들지 않고 저장만 재시도한다', async () => {
    const newFlowProject = vi.fn().mockResolvedValue({ success: true, projectId: 'created-id' })
    const flowExtractProjectId = vi.fn().mockResolvedValue({ success: true, projectId: 'created-id' })
    const openFlowProject = vi.fn().mockResolvedValue({ success: true, already: true, url: urlOf('created-id') })
    window.electronAPI = { newFlowProject, flowExtractProjectId, openFlowProject }
    fileSystemAPI.mergeProjectData.mockResolvedValueOnce({ success: false, error: 'disk' })
    fileSystemAPI.mergeProjectData.mockResolvedValue({ success: true })
    // 실제 계약: project.json 이 없어도 success:true + data:null (isNew) 을 돌려준다.
    fileSystemAPI.loadProjectData.mockResolvedValue({ success: true, data: null })

    const { result, rerender } = setupHook({ mode: 'api' })
    await act(async () => { rerender({ mode: 'flow', projectName: 'p1' }) })
    expect(result.current.flowProjectReady).toBe(false)

    await act(async () => { rerender({ mode: 'api', projectName: 'p1' }) })
    await act(async () => { rerender({ mode: 'flow', projectName: 'p1' }) })

    expect(newFlowProject).toHaveBeenCalledTimes(1)
    expect(result.current.flowProjectId).toBe('created-id')
    expect(result.current.flowProjectReady).toBe(true)
  })

  // 저장 대기가 다른 로컬 프로젝트에서 발화하면 그 프로젝트의 project.json 에 남의 Flow id 를 쓴다.
  it('저장 대기는 다른 로컬 프로젝트에서 발화하지 않는다', async () => {
    // 두 로컬 프로젝트가 서로 다른 Flow 프로젝트를 만든다 — id 가 같으면 오염을 관측할 수 없다.
    const newFlowProject = vi.fn()
      .mockResolvedValueOnce({ success: true, projectId: 'p1-flow-id' })
      .mockResolvedValue({ success: true, projectId: 'p2-flow-id' })
    const flowExtractProjectId = vi.fn().mockResolvedValue({ success: true, projectId: 'p2-flow-id' })
    window.electronAPI = { newFlowProject, flowExtractProjectId, openFlowProject: vi.fn() }
    fileSystemAPI.mergeProjectData.mockResolvedValue({ success: false, error: 'disk' })

    const { result, rerender } = setupHook({ mode: 'api' })
    await act(async () => { rerender({ mode: 'flow', projectName: 'p1' }) })
    // 로컬 프로젝트가 p2 로 바뀐 상황
    await act(async () => { rerender({ mode: 'flow', projectName: 'p2' }) })
    fileSystemAPI.mergeProjectData.mockResolvedValue({ success: true })
    // 실제 계약: project.json 이 없어도 success:true + data:null (isNew) 을 돌려준다.
    fileSystemAPI.loadProjectData.mockResolvedValue({ success: true, data: null })

    await act(async () => { await result.current.tryAdoptFlowProject() })

    expect(fileSystemAPI.mergeProjectData).not.toHaveBeenCalledWith('p2', { flowProjectId: 'p1-flow-id' })
  })

  // p2 의 저장 실패가 p1 의 회복 정보를 덮으면, p1 으로 돌아왔을 때 이미 만들어진 Flow 프로젝트를
  // 잃고 세 번째 프로젝트를 만든다. 저장 대기는 프로젝트마다 따로 남아야 한다.
  it('두 로컬 프로젝트가 각각 저장 실패해도 서로의 회복 정보를 지우지 않는다', async () => {
    const newFlowProject = vi.fn()
      .mockResolvedValueOnce({ success: true, projectId: 'p1-flow-id' })
      .mockResolvedValueOnce({ success: true, projectId: 'p2-flow-id' })
      .mockResolvedValue({ success: true, projectId: 'unexpected-third' })
    const flowExtractProjectId = vi.fn().mockResolvedValue({ success: true, projectId: 'p1-flow-id' })
    const openFlowProject = vi.fn().mockResolvedValue({ success: true, already: true, url: urlOf('p1-flow-id') })
    window.electronAPI = { newFlowProject, flowExtractProjectId, openFlowProject }
    fileSystemAPI.mergeProjectData.mockResolvedValue({ success: false, error: 'disk' })

    const { result, rerender } = setupHook({ mode: 'api' })
    await act(async () => { rerender({ mode: 'flow', projectName: 'p1' }) })  // p1: 저장 실패로 대기
    await act(async () => { rerender({ mode: 'flow', projectName: 'p2' }) })  // p2: 저장 실패로 대기

    // 디스크가 회복되고 p1 으로 돌아온다.
    fileSystemAPI.mergeProjectData.mockResolvedValue({ success: true })
    // 실제 계약: project.json 이 없어도 success:true + data:null (isNew) 을 돌려준다.
    fileSystemAPI.loadProjectData.mockResolvedValue({ success: true, data: null })
    await act(async () => { rerender({ mode: 'flow', projectName: 'p1' }) })

    expect(fileSystemAPI.mergeProjectData).toHaveBeenLastCalledWith('p1', { flowProjectId: 'p1-flow-id' })
    expect(result.current.flowProjectId).toBe('p1-flow-id')
    expect(newFlowProject).toHaveBeenCalledTimes(2)  // 세 번째 프로젝트를 만들면 안 된다
  })

  // state 에는 id 가 없는데 디스크에는 있는 상태가 실재한다 — 저장은 성공했지만 그 사이 모드
  // 이탈/전환으로 state 반영을 건너뛴 경우(회복 항목은 저장 성공 시점에 이미 지워진다).
  // 그때 새로 만들면 방금 저장한 프로젝트를 버리고 빈 프로젝트를 하나 더 만든다.
  it('Case B 는 만들기 전에 디스크의 flowProjectId 를 확인한다', async () => {
    const newFlowProject = vi.fn().mockResolvedValue({ success: true, projectId: 'unwanted-new' })
    const flowExtractProjectId = vi.fn().mockResolvedValue({ success: true, projectId: 'disk-id' })
    const openFlowProject = vi.fn().mockResolvedValue({ success: true, already: true, url: urlOf('disk-id') })
    window.electronAPI = { newFlowProject, flowExtractProjectId, openFlowProject }
    // 디스크에는 매핑이 있는데 state(flowProjectId)는 null 인 상태로 flow 에 진입한다.
    fileSystemAPI.loadProjectData.mockResolvedValue({ success: true, data: { flowProjectId: 'disk-id' } })

    const { result, rerender } = setupHook({ mode: 'api' })
    await act(async () => { rerender({ mode: 'flow', projectName: 'p1' }) })

    expect(newFlowProject).not.toHaveBeenCalled()
    expect(result.current.flowProjectId).toBe('disk-id')
    expect(result.current.flowProjectReady).toBe(true)
  })

  // flow:new-project 는 URL 의 UUID 가 바뀐 것만 확인한다 — 그 페이지가 정상 composer 인지는
  // 모른다(에러/랜딩 화면도 새 URL 을 받는다). 생성만으로 ready 를 열면 확인되지 않은 프로젝트로
  // 생성이 나간다. ready 는 open 확인(applyOpenResult)에서만 열려야 한다.
  it('생성에 성공해도 open 확인 전에는 ready 를 열지 않는다', async () => {
    const newFlowProject = vi.fn().mockResolvedValue({ success: true, projectId: 'created-id' })
    const flowExtractProjectId = vi.fn().mockResolvedValue({ success: true, projectId: 'created-id' })
    // 만들어진 URL 이 사실 에러 페이지였다.
    const openFlowProject = vi.fn().mockResolvedValue({ success: false, errorPage: true, url: urlOf('created-id') })
    window.electronAPI = { newFlowProject, flowExtractProjectId, openFlowProject }

    const { result, rerender } = setupHook({ mode: 'api' })
    await act(async () => { rerender({ mode: 'flow', projectName: 'p1' }) })

    expect(openFlowProject).toHaveBeenCalledWith({ flowProjectId: 'created-id' })
    expect(result.current.flowProjectReady).toBe(false)
  })

  // 생성은 성공했는데 그 사이 모드가 바뀌면, 만들어진 Flow 프로젝트는 이미 존재한다. 그걸 버리면
  // 다시 들어올 때 또 만들어 빈 프로젝트가 쌓인다 — 취소 여부와 무관하게 붙잡아 둬야 한다.
  it('생성 응답이 도착하기 전에 모드가 바뀌어도 만들어진 프로젝트를 잃지 않는다', async () => {
    let resolveNew
    const newFlowProject = vi.fn(() => new Promise((r) => { resolveNew = r }))
    const flowExtractProjectId = vi.fn().mockResolvedValue({ success: true, projectId: 'created-id' })
    const openFlowProject = vi.fn().mockResolvedValue({ success: true, already: true, url: urlOf('created-id') })
    window.electronAPI = { newFlowProject, flowExtractProjectId, openFlowProject }
    fileSystemAPI.mergeProjectData.mockResolvedValue({ success: false, error: 'disk' })

    const { result, rerender } = setupHook({ mode: 'api' })
    await act(async () => { rerender({ mode: 'flow', projectName: 'p1' }) })
    // 생성 응답 전에 api 로 빠진다(effect cleanup → cancelled).
    await act(async () => { rerender({ mode: 'api', projectName: 'p1' }) })
    await act(async () => { resolveNew({ success: true, projectId: 'created-id' }); await Promise.resolve() })

    // 다시 flow 로 — 이미 만들어진 프로젝트를 쓰고, 새로 만들면 안 된다.
    fileSystemAPI.mergeProjectData.mockResolvedValue({ success: true })
    await act(async () => { rerender({ mode: 'flow', projectName: 'p1' }) })

    expect(newFlowProject).toHaveBeenCalledTimes(1)
    expect(result.current.flowProjectId).toBe('created-id')
  })

  // 취소된 이전 bind 가 뒤늦게 끝나면서 in-flight 플래그를 끄면, 아직 IPC 가 진행 중인 최신
  // bind 위에 폴링이 재바인딩을 걸어 openFlowProject/newFlowProject 가 겹친다(두 소유자).
  it('취소된 이전 bind 가 끝나도 진행 중인 최신 bind 의 in-flight 를 풀지 않는다', async () => {
    const resolvers = []
    const newFlowProject = vi.fn(() => new Promise((r) => resolvers.push(r)))
    const flowExtractProjectId = vi.fn().mockResolvedValue({ success: true, projectId: 'x' })
    window.electronAPI = { newFlowProject, flowExtractProjectId, openFlowProject: vi.fn() }

    const { result, rerender } = setupHook({ mode: 'api' })
    await act(async () => { rerender({ mode: 'flow', projectName: 'p1' }) })   // bind A 시작(대기)
    await act(async () => { rerender({ mode: 'api', projectName: 'p1' }) })    // A 취소
    await act(async () => { rerender({ mode: 'flow', projectName: 'p1' }) })   // bind B 시작(대기)
    expect(resolvers).toHaveLength(2)

    // 취소된 A 가 뒤늦게 끝난다. B 는 아직 진행 중이다.
    await act(async () => { resolvers[0]({ success: false, error: 'late' }); await Promise.resolve() })

    let res
    await act(async () => { res = await result.current.tryAdoptFlowProject() })

    expect(res).toMatchObject({ ok: false, reason: 'bind-in-flight' })
    expect(newFlowProject).toHaveBeenCalledTimes(2)  // 세 번째 생성이 시작되면 안 된다
  })

  // IPC 가 영영 끝나지 않으면(끊긴 네트워크 폴더, 멈춘 loadURL) in-flight 잠금이 폴링의 재시도까지
  // 막아 영구 차단이 된다. 영구 차단보다는 중복 시도 위험을 택한다.
  it('bind 가 끝나지 않으면 워치독이 in-flight 를 풀어 재시도를 허용한다', async () => {
    vi.useFakeTimers()
    try {
      const newFlowProject = vi.fn(() => new Promise(() => {}))  // 영영 끝나지 않는다
      const flowExtractProjectId = vi.fn().mockResolvedValue({ success: true, projectId: 'x' })
      window.electronAPI = { newFlowProject, flowExtractProjectId, openFlowProject: vi.fn() }

      const { result, rerender } = setupHook({ mode: 'api' })
      await act(async () => { rerender({ mode: 'flow', projectName: 'p1' }) })

      let before
      await act(async () => { before = await result.current.tryAdoptFlowProject() })
      expect(before).toMatchObject({ reason: 'bind-in-flight' })

      await act(async () => { await vi.advanceTimersByTimeAsync(BIND_WATCHDOG_MS + 1000) })

      let after
      await act(async () => { after = await result.current.tryAdoptFlowProject() })
      expect(after).toMatchObject({ reason: 'rebind-requested' })
    } finally {
      vi.useRealTimers()
    }
  })

  // project.json 을 못 읽은 것과 "매핑이 없다"는 다르다. 읽기 실패를 매핑 없음으로 뭉개면
  // 멀쩡한 매핑 위에 새 Flow 프로젝트를 만들어 덮어쓴다(원래 프로젝트의 작업물과 분리된다).
  it('project.json 읽기가 실패하면 새로 만들지 않고, 다음 폴링에서 회복한다', async () => {
    const newFlowProject = vi.fn().mockResolvedValue({ success: true, projectId: 'unwanted-new' })
    const flowExtractProjectId = vi.fn().mockResolvedValue({ success: true, projectId: 'disk-id' })
    const openFlowProject = vi.fn().mockResolvedValue({ success: true, already: true, url: urlOf('disk-id') })
    window.electronAPI = { newFlowProject, flowExtractProjectId, openFlowProject }
    fileSystemAPI.loadProjectData.mockResolvedValue({ success: false, error: 'EIO' })

    const { result, rerender } = setupHook({ mode: 'api' })
    await act(async () => { rerender({ mode: 'flow', projectName: 'p1' }) })

    expect(newFlowProject).not.toHaveBeenCalled()
    expect(result.current.flowProjectReady).toBe(false)

    // 디스크가 회복되면 폴링이 재바인딩을 요청해 원래 매핑을 되찾는다.
    fileSystemAPI.loadProjectData.mockResolvedValue({ success: true, data: { flowProjectId: 'disk-id' } })
    await act(async () => { await result.current.tryAdoptFlowProject() })

    expect(result.current.flowProjectId).toBe('disk-id')
    expect(newFlowProject).not.toHaveBeenCalled()
  })

  // Case A 의 open 이 일시적으로 실패하면 ready 만 닫히고 effect deps 는 그대로다 — 폴링이
  // 재오픈을 맡지 않으면 모드/프로젝트를 손으로 바꾸기 전까지 생성이 계속 막힌다.
  it('저장된 프로젝트의 open 이 일시 실패해도 폴링 재시도로 ready 가 열린다', async () => {
    const newFlowProject = vi.fn()
    const flowExtractProjectId = vi.fn().mockResolvedValue({ success: true, projectId: 'saved-id' })
    const openFlowProject = vi.fn()
      .mockResolvedValueOnce({ success: false })  // 일시 실패(에러 페이지 아님)
      .mockResolvedValue({ success: true, already: true, url: urlOf('saved-id') })
    window.electronAPI = { newFlowProject, flowExtractProjectId, openFlowProject }
    fileSystemAPI.loadProjectData.mockResolvedValue({ success: true, data: { flowProjectId: 'saved-id' } })
    localStorage.setItem('autoflowcut_settings', JSON.stringify({ projectName: 'p1', saveMode: 'folder' }))

    const { result, rerender } = setupHook({ mode: 'flow' })
    await act(async () => { rerender({ mode: 'flow', projectName: 'p1' }) })
    expect(result.current.flowProjectReady).toBe(false)

    await act(async () => { await result.current.tryAdoptFlowProject() })

    expect(result.current.flowProjectReady).toBe(true)
    expect(newFlowProject).not.toHaveBeenCalled()
  })

  // arm 토큰의 epoch 를 await **뒤에** 읽으면, 그 사이 시작된 프로젝트 전환의 epoch 가 붙어
  // 이전 프로젝트의 arm 이 "현재 세션의 것"으로 되살아난다. epoch 는 effect 시작 시점 값이어야 한다.
  it('생성 응답이 늦게 도착해도, 그 사이 시작된 전환의 epoch 로 arm 이 되살아나지 않는다', async () => {
    let resolveNew
    const newFlowProject = vi.fn(() => new Promise((r) => { resolveNew = r }))
    const flowExtractProjectId = vi.fn().mockResolvedValue({ success: true, projectId: 'other-id' })
    const openFlowProject = vi.fn()
    window.electronAPI = { newFlowProject, flowExtractProjectId, openFlowProject }
    fileSystemAPI.projectExists.mockResolvedValue(false)

    const { result, rerender } = setupHook({ mode: 'api' })
    await act(async () => { rerender({ mode: 'flow', projectName: 'p1' }) })

    // 생성 응답을 기다리는 동안 프로젝트 전환이 시작된다(= load epoch 증가).
    await act(async () => { await result.current.handleProjectChange('p9') })
    // 그 뒤에야 생성 실패 응답이 도착해 arm 을 세운다.
    await act(async () => { resolveNew({ success: false, error: 'timeout' }); await Promise.resolve() })

    let res
    await act(async () => { res = await result.current.tryAdoptFlowProject() })

    // arm 자체가 서지 않아야 한다(그래서 채택이 아니라 재바인딩으로 간다). arm 이 서면 그 뒤의
    // 판정은 baseline 이 우연히 무엇이었는지에 좌우된다 — 그 우연에 기대지 않게 여기서 끊는다.
    expect(res).toMatchObject({ ok: false, reason: 'rebind-requested' })
    expect(openFlowProject).not.toHaveBeenCalled()
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
    await act(async () => { adopted = await result.current.tryAdoptFlowProject({ confirmed: true }) })

    expect(adopted?.ok).toBe(false)
    expect(result.current.flowProjectReady).toBe(false)
  })
})
