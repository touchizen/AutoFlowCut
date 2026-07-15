// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createToolCore } from '../../../electron/agent/toolCore.js'

// M3 I7 (D12, slice 37 는 [P]): get_scene_video_frames 는 ordinal 을 resolve 하고, 그 씬의
// videoI2VPath/videoT2VPath 를 renderer video.frames 로 넘겨 프레임 이미지 블록을 받는다.

const TOKEN = 'tok-1'

let storyCommands, toolBridge, core
beforeEach(() => {
  storyCommands = {
    hasProject: () => true,
    projectToken: TOKEN,
    projectPath: '/proj',
    getState: vi.fn(async () => ({ sceneMode: 'audio-first', fixedScenes: null })),
  }
  toolBridge = {
    invoke: vi.fn(async (name, args) => {
      if (name === 'scene.snapshot') {
        return { sceneMode: 'audio-first', scenes: [
          { id: 'scene_17', storyId: 'a', videoI2VPath: '/proj/scenes/scene_17.i2v.mp4' },
          { id: 'scene_3', storyId: 'b', videoT2VPath: '/proj/scenes/scene_3.t2v.mp4' },
          { id: 'scene_9', storyId: 'c' }, // 영상 없음
        ] }
      }
      if (name === 'video.frames') {
        return { rendererSceneId: args.rendererSceneId, frames: [
          { timeMs: 3000, data: 'F1', mimeType: 'image/jpeg' },
          { timeMs: 6000, data: 'F2', mimeType: 'image/jpeg' },
        ] }
      }
      throw new Error(`unexpected ${name}`)
    }),
  }
  core = createToolCore({ toolBridge, projectToken: TOKEN })
  core.use(storyCommands)
})

describe('get_scene_video_frames', () => {
  it('i2v 경로 씬 → video.frames 호출, 프레임 이미지 블록', async () => {
    const r = await core.call('get_scene_video_frames', { sceneNumbers: [1] }, {})
    expect(r.status).toBe('done')
    expect(r.frames).toEqual([{ ordinal: 1, rendererSceneId: 'scene_17', source: 'i2v', status: 'ok', count: 2 }])
    expect(r.content).toEqual([
      { type: 'image', data: 'F1', mimeType: 'image/jpeg' },
      { type: 'image', data: 'F2', mimeType: 'image/jpeg' },
    ])
    expect(toolBridge.invoke).toHaveBeenCalledWith('video.frames',
      expect.objectContaining({ rendererSceneId: 'scene_17', videoPath: '/proj/scenes/scene_17.i2v.mp4' }))
  })

  it('t2v만 있는 씬 → source t2v', async () => {
    const r = await core.call('get_scene_video_frames', { sceneNumbers: [2] }, {})
    expect(r.frames[0]).toMatchObject({ ordinal: 2, rendererSceneId: 'scene_3', source: 't2v', status: 'ok' })
  })

  it('영상 경로 없는 씬 → video-not-found, video.frames 미호출', async () => {
    const r = await core.call('get_scene_video_frames', { sceneNumbers: [3] }, {})
    expect(r.frames).toEqual([{ ordinal: 3, rendererSceneId: 'scene_9', status: 'video-not-found' }])
    expect(r.content).toEqual([])
    expect(toolBridge.invoke).not.toHaveBeenCalledWith('video.frames', expect.anything())
  })

  it('범위 밖 ordinal → per-scene scene-not-found', async () => {
    const r = await core.call('get_scene_video_frames', { sceneNumbers: [1, 9] }, {})
    expect(r.frames).toContainEqual({ ordinal: 9, status: 'scene-not-found' })
  })

  it('mode 불일치 → fixed-scenes-stale', async () => {
    storyCommands.getState = vi.fn(async () => ({ sceneMode: 'image-first', fixedScenes: [
      { ordinal: 1, rendererSceneId: 'scene_17', storyId: 'a' },
    ] }))
    const r = await core.call('get_scene_video_frames', { sceneNumbers: [1] }, {})
    expect(r).toMatchObject({ status: 'rejected', reason: 'fixed-scenes-stale' })
  })

  it('프로젝트 미오픈 → no-project', async () => {
    storyCommands.hasProject = () => false
    const r = await core.call('get_scene_video_frames', { sceneNumbers: [1] }, {})
    expect(r).toEqual({ status: 'rejected', reason: 'no-project' })
  })
})
