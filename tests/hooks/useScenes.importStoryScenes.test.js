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
      // 이미지가 생성된 상태 시뮬레이션
      result.current.setScenes(result.current.scenes.map((s) => ({ ...s, imageUrl: 'file://img.png' })))
    })
    act(() => { result.current.importStoryScenes({ scenes: [pushScene('u1', { prompt: 'IMG2' })] }) })
    const s = result.current.scenes.find((x) => x.storyId === 'u1')
    expect(s.prompt).toBe('IMG2')
    expect(s.imageUrl).toBe('file://img.png')
    expect(s.stalePrompt).toBe(true)
    expect(s.stalePromptAt).toBeTruthy()
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
})
