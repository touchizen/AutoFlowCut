/**
 * saveCurrentProjectWithPayload — 명시 payload 저장 (stale closure 방지)
 *
 * 스펙 §4-④: 기존 saveCurrentProject() 는 render 시점 scenes/srtTrack 클로저를
 * 저장하므로, story push 직후 호출하면 이전 상태가 저장되고도 ack 가 나갈 수
 * 있다. saveCurrentProjectWithPayload({ scenes, srtTrack }) 는 인자로 받은
 * scenes/srtTrack 을 저장한다(클로저의 옛 값이 아니라). 나머지 필드는 기존
 * saveCurrentProject 와 동일하게 현재 값(closure) 을 사용한다.
 *
 * setup/mock 패턴은 tests/hooks/useProjectData.test.js 를 그대로 따른다.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useProjectData } from '../../src/hooks/useProjectData'
import { fileSystemAPI } from '../../src/hooks/useFileSystem'

vi.mock('../../src/hooks/useFileSystem', () => ({
  fileSystemAPI: {
    loadProjectData: vi.fn(),
    getResourcePath: vi.fn(),
    readResource: vi.fn(),
    readHistoryMetadata: vi.fn(),
    getHistory: vi.fn(),
    projectExists: vi.fn(),
    saveProjectData: vi.fn(),
  },
}))

vi.mock('../../src/services/mediaSync', () => ({
  syncVideosIntoScenes: vi.fn(),
}))

vi.mock('../../src/services/videoRecovery', () => ({
  recoverInFlightVideos: vi.fn(),
}))

describe('saveCurrentProjectWithPayload', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    localStorage.clear() // keep the mount auto-restore effect a no-op
    fileSystemAPI.projectExists.mockResolvedValue(true)
    fileSystemAPI.saveProjectData.mockResolvedValue({ success: true })
  })

  // closure 에 남아있는 "stale" scenes/srtTrack — 훅에 전달된 값이며, render 클로저에
  // 그대로 캡처된다. 테스트는 saveCurrentProjectWithPayload 가 이 값이 아니라 인자로
  // 준 값을 저장하는지 검증한다.
  const staleScenes = [{ id: 'stale_scene' }]
  const staleSrtTrack = [{ id: 'stale_srt' }]

  function setup(overrides = {}) {
    const { result } = renderHook(() =>
      useProjectData({
        settings: { projectName: 'p', saveMode: 'folder', aspectRatio: '16:9', defaultDuration: 3 },
        setSettings: vi.fn(),
        scenes: staleScenes, references: [], setScenes: vi.fn(), setReferences: vi.fn(),
        videoScenes: [], setVideoScenes: vi.fn(),
        framePairs: [], setFramePairs: vi.fn(),
        selectedStyleRefId: null, setSelectedStyleRefId: vi.fn(),
        srtTrack: staleSrtTrack, setSrtTrack: vi.fn(),
        openSettings: vi.fn(), onAudioSwitch: vi.fn(), genAPI: null,
        ...overrides,
      }),
    )
    return { result }
  }

  it('saves the given payload scenes/srtTrack — not the stale closure values', async () => {
    const { result } = setup()

    const freshScenes = [{ id: 'fresh_scene' }]
    const freshSrtTrack = [{ id: 'fresh_srt' }]

    let res
    await act(async () => {
      res = await result.current.saveCurrentProjectWithPayload({ scenes: freshScenes, srtTrack: freshSrtTrack })
    })

    expect(res).toEqual({ ok: true })
    expect(fileSystemAPI.saveProjectData).toHaveBeenCalledTimes(1)
    const [projectName, payload] = fileSystemAPI.saveProjectData.mock.calls[0]
    expect(projectName).toBe('p')
    expect(payload.scenes).toEqual(freshScenes)
    expect(payload.srtTrack).toEqual(freshSrtTrack)
    // stale closure 값이 섞여 들어가면 안 된다
    expect(payload.scenes).not.toEqual(staleScenes)
    expect(payload.srtTrack).not.toEqual(staleSrtTrack)
  })

  it('V2: references override를 저장 payload에 반영(stale closure references 아님)', async () => {
    const staleRefs = [{ id: 1, name: 'stale' }]
    const { result } = setup({ references: staleRefs })
    const freshRefs = [{ id: 1, name: 'stale' }, { id: 2, name: '민수', type: 'character' }]
    await act(async () => {
      await result.current.saveCurrentProjectWithPayload({ scenes: [{ id: 's' }], srtTrack: [], references: freshRefs })
    })
    const [, payload] = fileSystemAPI.saveProjectData.mock.calls[0]
    expect(payload.references.some((r) => r.name === '민수')).toBe(true)
  })

  it('V2: references 미지정이면 기존 closure references 사용(하위호환)', async () => {
    const closureRefs = [{ id: 9, name: 'closure' }]
    const { result } = setup({ references: closureRefs })
    await act(async () => {
      await result.current.saveCurrentProjectWithPayload({ scenes: [{ id: 's' }], srtTrack: [] })
    })
    const [, payload] = fileSystemAPI.saveProjectData.mock.calls[0]
    expect(payload.references).toEqual(closureRefs)
  })

  it('returns { ok: false } when the underlying save fails', async () => {
    fileSystemAPI.saveProjectData.mockResolvedValue({ success: false, error: 'disk full' })
    const { result } = setup()

    let res
    await act(async () => {
      res = await result.current.saveCurrentProjectWithPayload({ scenes: [{ id: 's' }], srtTrack: [] })
    })

    expect(res).toEqual({ ok: false })
  })

  it('does not mutate the existing saveCurrentProject() closure-based behavior', async () => {
    // 회귀 방지: saveCurrentProjectWithPayload 추가/리팩터가 기존 saveCurrentProject() 를
    // 건드리지 않았는지 — 여전히 closure 의 scenes/srtTrack(stale*) 를 저장해야 한다.
    const { result } = setup()

    await act(async () => {
      await result.current.saveCurrentProject()
    })

    const [, payload] = fileSystemAPI.saveProjectData.mock.calls[0]
    expect(payload.scenes).toEqual(staleScenes)
    expect(payload.srtTrack).toEqual(staleSrtTrack)
  })
})
