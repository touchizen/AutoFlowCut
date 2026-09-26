/**
 * useMcpServer — load_csv(update-scenes) 병합이 CSV 가 보내지 않은 씬 필드를 버리지 않는다.
 *
 * 실기(2026-09-26 M3 게이트): 병합이 matched 에서 이미지 포인터 몇 개(image·imagePath·status·mediaId·…)만 골라
 * 새 객체를 만들어, CSV 에 없는 필드가 전부 사라졌다 — 이미지 탭 모델명(model)·seed·생성 시각, 완성된 텍스트→영상의
 * 연결(videoT2VStatus·Path·MediaId·Model…)과 선택(videoT2VSelected), 스토리 연결(storyId). 영상 파일은 디스크에
 * 남는데 앱·내보내기에서 사라지고, 되찾으려면 다시 생성(과금)해야 했다. 기존 씬을 바탕에 깔고 CSV 가 보낸 필드만
 * 덮는다(스토리 push 의 importStoryScenes 와 같은 정책). 이미지 포인터·status 규칙(Issue #2)은 그대로.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useMcpServer } from '../../src/hooks/useMcpServer'
import { useVideoScenes } from '../../src/hooks/useVideoScenes'

function makeProps(overrides = {}) {
  return {
    settings: { mcpHttpEnabled: false, mcpHttpPort: 3210 },
    scenes: [], setScenes: vi.fn(), references: [], setReferences: vi.fn(),
    handleGenerateRef: vi.fn(), handleGenerateScene: vi.fn(), handleGenerateAllRefs: vi.fn(),
    handleStart: vi.fn(), handleStop: vi.fn(), handleProjectChange: vi.fn(), handleExportConfirm: vi.fn(),
    selectedStyleRefId: null, setSelectedStyleRefId: vi.fn(), refreshReviews: vi.fn(),
    audioReviews: [], importByPath: vi.fn(), audioPackage: null,
    automationState: { isRunning: false, isPaused: false, progress: { current: 0, total: 0 }, status: 'idle', statusMessage: '' },
    videoAutomation: {}, generatingRefs: [], isRunning: false,
    ...overrides,
  }
}

/** 이미지·영상 둘 다 생성이 끝난 씬 — 실기 m3-live-gate 의 scene_5 모양. */
const DONE_SCENE = {
  id: 'scene_5', _sceneNum: 3, prompt: 'A', subtitle: 'old', characters: '', status: 'done',
  imagePath: '/p/scenes/scene_5.jpg', mediaId: 'img-media', image_size: { width: 1376, height: 768 }, donePrompt: 'A',
  model: 'Nano Banana 2', seed: 795165954, generatedAt: 1790382396526, generatingEndedAt: 1790382396600,
  videoT2VPrompt: 'V', videoT2VSelected: true, videoT2VStatus: 'complete',
  videoT2VPath: '/p/videos/t2v_5.mp4', videoT2VMediaId: 'vid-media', videoT2VGenerationId: 'vid-media',
  videoT2VSaveId: 't2v_5', videoT2VModel: 'Omni Flash', videoT2VDuration: 4, videoT2VSeed: 130204,
  storyId: 'story-7',
}

describe('MCP load_csv — CSV 가 보내지 않은 씬 필드 보존', () => {
  let cb = null
  beforeEach(() => {
    window.electronAPI = { startMcpHttp: vi.fn(), stopMcpHttp: vi.fn(), onMcpUpdate: vi.fn((fn) => { cb = fn; return () => {} }) }
  })
  afterEach(() => { delete window.electronAPI; cb = null })

  function applyUpdate(prev, incomingScenes) {
    const setScenes = vi.fn()
    renderHook(() => useMcpServer(makeProps({ setScenes })))
    cb({ type: 'update-scenes', scenes: incomingScenes })
    return setScenes.mock.calls[0][0](prev)
  }

  it('프롬프트가 같으면 이미지 생성 메타(model·seed·생성 시각)·영상 결과·선택·storyId 가 그대로 — CSV 필드는 반영', () => {
    const [s] = applyUpdate([DONE_SCENE], [{ id: 'scene_5', _sceneNum: 3, prompt: 'A', subtitle: 'new', characters: 'king', videoT2VPrompt: 'V' }])
    expect(s.subtitle).toBe('new')
    expect(s.characters).toBe('king')
    expect(s.status).toBe('done')
    expect(s).toMatchObject({ model: 'Nano Banana 2', seed: 795165954, generatedAt: 1790382396526, generatingEndedAt: 1790382396600 })
    expect(s).toMatchObject({
      videoT2VSelected: true, videoT2VStatus: 'complete', videoT2VPath: '/p/videos/t2v_5.mp4',
      videoT2VMediaId: 'vid-media', videoT2VGenerationId: 'vid-media', videoT2VSaveId: 't2v_5',
      videoT2VModel: 'Omni Flash', videoT2VDuration: 4, videoT2VSeed: 130204,
    })
    expect(s.storyId).toBe('story-7')
  })

  it('CSV 행에 영상 프롬프트 열이 없어도 영상 프롬프트·결과가 남는다', () => {
    const [s] = applyUpdate([DONE_SCENE], [{ id: 'scene_5', _sceneNum: 3, prompt: 'A' }])
    expect(s.videoT2VPrompt).toBe('V')
    expect(s.videoT2VStatus).toBe('complete')
    expect(s.videoT2VPath).toBe('/p/videos/t2v_5.mp4')
  })

  it('프롬프트가 바뀌면 기존 규칙대로 pending — 남아 있는 옛 이미지의 메타는 보존', () => {
    const [s] = applyUpdate([DONE_SCENE], [{ id: 'scene_5', _sceneNum: 3, prompt: 'A-refined' }])
    expect(s.prompt).toBe('A-refined')
    expect(s.status).toBe('pending')
    expect(s.imagePath).toBe('/p/scenes/scene_5.jpg')
    expect(s.model).toBe('Nano Banana 2')
  })

  it('CSV 가 이미지 포인터를 실어 와도 기존 이미지가 이긴다(병합 규칙 유지)', () => {
    const [s] = applyUpdate([DONE_SCENE], [{ id: 'scene_5', _sceneNum: 3, prompt: 'A', imagePath: '/elsewhere.jpg', mediaId: 'other' }])
    expect(s.imagePath).toBe('/p/scenes/scene_5.jpg')
    expect(s.mediaId).toBe('img-media')
  })

  it('통합: 병합 뒤에도 영상 탭(useVideoScenes)에 완료된 영상이 선택된 채로 보인다', () => {
    const merged = applyUpdate([DONE_SCENE], [{ id: 'scene_5', _sceneNum: 3, prompt: 'A', subtitle: 'new' }])
    const { result } = renderHook(() => useVideoScenes(merged, null))
    expect(result.current.videoScenes).toHaveLength(1)
    expect(result.current.videoScenes[0]).toMatchObject({
      id: 'vscene_5', status: 'complete', videoPath: '/p/videos/t2v_5.mp4', mediaId: 'vid-media', model: 'Omni Flash', selected: true,
    })
  })
})
