import { describe, it, expect } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useScenes } from '../../src/hooks/useScenes.js'

const pushScene = (storyId, over = {}) => ({
  storyId, sceneNo: 1, prompt: 'IMG', videoT2VPrompt: 'VID',
  startTime: 0, endTime: 6, duration: 6, srtLineIds: [], subtitle: '자막', ...over,
})

describe('importStoryScenes', () => {
  it('신규 push: 씬이 그리드에 추가되고 매핑이 적용된다', () => {
    const { result } = renderHook(() => useScenes())
    let ret
    act(() => { ret = result.current.importStoryScenes({ scenes: [pushScene('u1')] }) })
    const s = result.current.scenes.find((x) => x.storyId === 'u1')
    expect(s).toMatchObject({ prompt: 'IMG', videoT2VPrompt: 'VID', duration: 6 })
    expect(s.id).toMatch(/^scene_/)
    expect(ret.nextScenes).toHaveLength(1)
  })

  it('재push: 프롬프트 변경 시 이미지 보존 + stalePrompt', () => {
    const { result } = renderHook(() => useScenes())
    act(() => { result.current.importStoryScenes({ scenes: [pushScene('u1')] }) })
    act(() => {
      // 이미지가 생성된 상태 시뮬레이션 (실제 씬 모델 필드: image/imagePath)
      result.current.setScenes(result.current.scenes.map((s) => ({ ...s, image: 'file://img.png' })))
    })
    act(() => { result.current.importStoryScenes({ scenes: [pushScene('u1', { prompt: 'IMG2' })] }) })
    const s = result.current.scenes.find((x) => x.storyId === 'u1')
    expect(s.prompt).toBe('IMG2')
    expect(s.image).toBe('file://img.png')
    expect(s.stalePrompt).toBe(true)
    expect(s.stalePromptAt).toBeTruthy()
  })

  it('재push: videoT2VPrompt 변경 + 기존 비디오 존재 시 staleVideo', () => {
    const { result } = renderHook(() => useScenes())
    act(() => { result.current.importStoryScenes({ scenes: [pushScene('u1')] }) })
    act(() => {
      // 비디오가 생성된 상태 시뮬레이션 (실제 씬 모델 필드: videoT2V/videoT2VPath)
      result.current.setScenes(result.current.scenes.map((s) => ({ ...s, videoT2V: 'file://vid.mp4' })))
    })
    act(() => { result.current.importStoryScenes({ scenes: [pushScene('u1', { videoT2VPrompt: 'VID2' })] }) })
    const s = result.current.scenes.find((x) => x.storyId === 'u1')
    expect(s.videoT2VPrompt).toBe('VID2')
    expect(s.videoT2V).toBe('file://vid.mp4')
    expect(s.staleVideo).toBe(true)
    expect(s.staleVideoAt).toBeTruthy()
  })

  it('non-story 씬은 보존된다', () => {
    const { result } = renderHook(() => useScenes())
    act(() => { result.current.setScenes([{ id: 'scene_1', prompt: '기존' }]) })
    act(() => { result.current.importStoryScenes({ scenes: [pushScene('u1')] }) })
    expect(result.current.scenes).toHaveLength(2)
    expect(result.current.scenes[0].prompt).toBe('기존')
  })

  it('srtTrack 포함 push: wholesale 교체 + non-story 씬 srtLineIds 비움', () => {
    const { result } = renderHook(() => useScenes())
    act(() => {
      result.current.setScenes([{ id: 'scene_1', prompt: '기존', srtLineIds: ['sub_1'] }])
      result.current.setSrtTrack([{ id: 'sub_1', text: '옛 자막', startTime: 0, endTime: 1 }])
    })
    const newTrack = [{ id: 'story_1', text: '새 자막', startTime: 0, endTime: 6 }]
    act(() => { result.current.importStoryScenes({ scenes: [pushScene('u1', { srtLineIds: ['story_1'] })], srtTrack: newTrack }) })
    expect(result.current.srtTrack).toEqual(newTrack)
    expect(result.current.scenes.find((s) => s.id === 'scene_1').srtLineIds).toEqual([])
  })

  it('씬 삭제 이력 후 importStoryScenes(갱신만, 신규 없음) → 이후 addScene이 삭제된 id를 재사용하지 않는다', () => {
    const { result } = renderHook(() => useScenes())
    // u1 신규 push → scene_1 생성
    act(() => { result.current.importStoryScenes({ scenes: [pushScene('u1')] }) })
    // addScene → scene_2 생성
    let addedId
    act(() => { addedId = result.current.addScene() })
    expect(addedId).toBe('scene_2')
    // scene_2 삭제 (삭제 이력 발생)
    act(() => { result.current.deleteScene(addedId) })
    // importStoryScenes 갱신만 (신규 story 씬 없음, 기존 u1 업데이트만)
    act(() => { result.current.importStoryScenes({ scenes: [pushScene('u1', { prompt: 'IMG-UPDATED' })] }) })
    // 카운터가 wholesale-replacement 경로로 reset 됐다면 다음 addScene 이 scene_2 를 재발급함 (버그)
    let newId
    act(() => { newId = result.current.addScene() })
    expect(newId).not.toBe('scene_2')
    expect(newId).toBe('scene_3')
  })
})
