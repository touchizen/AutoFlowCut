import { act, renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { useScenes } from '../../src/hooks/useScenes'

vi.mock('../../src/hooks/useFileSystem', () => ({
  fileSystemAPI: { readFileByPath: vi.fn().mockResolvedValue({ success: false }) },
}))

describe('useScenes — SRT prompt bulk field patch', () => {
  it('fills each blank field independently and preserves populated/runtime fields', () => {
    const { result } = renderHook(() => useScenes())
    const image = 'data:image/png;base64,IMAGE'
    const videoT2V = 'data:video/mp4;base64,VIDEO'
    act(() => {
      result.current.setScenes([
        {
          id: 's1', prompt: 'keep-image', videoT2VPrompt: '', videoI2VPrompt: 'keep-i2v',
          image, imagePath: '/scene.png', videoT2V, videoT2VPath: '/scene.mp4',
          status: 'done', startTime: 10, endTime: 13, duration: 3,
        },
        {
          id: 's2', prompt: '   ', videoT2VPrompt: 'keep-video', videoI2VPrompt: 'keep-i2v-2',
          imagePath: '/second.png', status: 'error', startTime: 20, endTime: 24, duration: 4,
        },
      ])
    })

    let applied
    act(() => {
      applied = result.current.applySrtPromptChunk([
        { sceneNo: 1, imagePrompt: 'new-image-1', videoPrompt: 'new-video-1' },
        { sceneNo: 2, imagePrompt: 'new-image-2', videoPrompt: 'new-video-2' },
      ], {
        sceneNoToSceneId: new Map([[1, 's1'], [2, 's2']]),
        onlyEmpty: true,
      })
    })

    expect(applied).toEqual({ nextScenes: result.current.scenes })
    expect(result.current.scenes[0]).toMatchObject({
      prompt: 'keep-image',
      videoT2VPrompt: 'new-video-1',
      videoI2VPrompt: 'keep-i2v',
      image,
      imagePath: '/scene.png',
      videoT2V,
      videoT2VPath: '/scene.mp4',
      status: 'done',
      startTime: 10,
      endTime: 13,
      duration: 3,
      staleVideo: true,
      staleVideoAt: expect.any(String),
    })
    expect(result.current.scenes[0]).not.toHaveProperty('stalePrompt')
    expect(result.current.scenes[1]).toMatchObject({
      prompt: 'new-image-2',
      videoT2VPrompt: 'keep-video',
      videoI2VPrompt: 'keep-i2v-2',
      imagePath: '/second.png',
      status: 'error',
      startTime: 20,
      endTime: 24,
      duration: 4,
      stalePrompt: true,
      stalePromptAt: expect.any(String),
    })
    expect(result.current.scenes[1]).not.toHaveProperty('staleVideo')
  })

  it('overwrites both generated fields only when explicitly requested and marks media stale', () => {
    const { result } = renderHook(() => useScenes())
    act(() => {
      result.current.setScenes([{
        id: 's1',
        prompt: 'old-image',
        videoT2VPrompt: 'old-video',
        videoI2VPrompt: 'never-touch',
        image: 'image-data',
        videoT2VPath: '/video.mp4',
        status: 'done',
      }])
    })

    act(() => {
      result.current.applySrtPromptChunk([
        { sceneNo: 1, imagePrompt: 'new-image', videoPrompt: 'new-video' },
      ], {
        sceneNoToSceneId: new Map([[1, 's1']]),
        onlyEmpty: false,
      })
    })

    expect(result.current.scenes[0]).toMatchObject({
      prompt: 'new-image',
      videoT2VPrompt: 'new-video',
      videoI2VPrompt: 'never-touch',
      image: 'image-data',
      videoT2VPath: '/video.mp4',
      status: 'done',
      stalePrompt: true,
      staleVideo: true,
    })
  })
})
