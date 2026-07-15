// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { stripSceneForAgent, sceneSnapshot } from '../../src/agent/sceneBridge.js'

// M3 I5: renderer scene.snapshot 핸들러. main 의 get_scene_images 가 ordinal 을 resolve 할 수 있게
// 라이브 scenes 배열(바이트 제거)과 sceneMode 를 준다. 순서 보존.

describe('stripSceneForAgent', () => {
  it('image/videoT2V/videoI2V 바이트만 제거하고 경로/식별자는 유지한다', () => {
    const scene = {
      id: 'scene_7', storyId: 's', prompt: 'p',
      image: 'BIGBYTES', videoT2V: 'V', videoI2V: 'W',
      videoT2VPath: '/a/t2v.mp4', videoI2VPath: '/a/i2v.mp4',
    }
    expect(stripSceneForAgent(scene)).toEqual({
      id: 'scene_7', storyId: 's', prompt: 'p',
      videoT2VPath: '/a/t2v.mp4', videoI2VPath: '/a/i2v.mp4',
    })
  })
})

describe('sceneSnapshot', () => {
  it('scenes 를 바이트 제거해 순서대로, sceneMode 를 함께 준다', () => {
    const scenes = [
      { id: 'scene_7', storyId: 'a', image: 'X' },
      { id: 'scene_3', storyId: 'b', image: 'Y' },
    ]
    expect(sceneSnapshot({ scenes, sceneMode: 'image-first' })).toEqual({
      sceneMode: 'image-first',
      scenes: [{ id: 'scene_7', storyId: 'a' }, { id: 'scene_3', storyId: 'b' }],
    })
  })

  it('sceneMode 없으면 audio-first 로 본다', () => {
    expect(sceneSnapshot({ scenes: [] })).toEqual({ sceneMode: 'audio-first', scenes: [] })
  })

  it('scenes 없으면 빈 배열', () => {
    expect(sceneSnapshot({ sceneMode: 'audio-first' })).toEqual({ sceneMode: 'audio-first', scenes: [] })
  })
})
