import { describe, expect, it } from 'vitest'
import { resolveExportVideos } from '../../src/utils/sceneMedia.js'
import {
  agentVideoScenePatch,
  resolveAgentVideoScenes,
} from '../../src/agent/videoAdmission.js'

describe('renderer agent video admission identity', () => {
  it('Tool Core가 resolve한 rendererSceneId를 조립/replace 없이 pipeline item에 보존한다', () => {
    const scenes = [
      {
        id: 'opaque/renderer-A',
        prompt: 'image prompt A',
        videoT2VPrompt: 'animate A',
        videoT2VStatus: 'pending',
        duration: 6,
      },
      { id: 'opaque:renderer-B', videoT2VPrompt: 'animate B', duration: 4 },
    ]

    expect(resolveAgentVideoScenes([
      { ordinal: 2, rendererSceneId: 'opaque:renderer-B' },
      { ordinal: 1, rendererSceneId: 'opaque/renderer-A' },
    ], scenes)).toEqual([
      expect.objectContaining({
        id: 'opaque:renderer-B', rendererSceneId: 'opaque:renderer-B', ordinal: 2,
        prompt: 'animate B', targetDuration: 4,
      }),
      expect.objectContaining({
        id: 'opaque/renderer-A', rendererSceneId: 'opaque/renderer-A', ordinal: 1,
        prompt: 'animate A', status: 'pending', targetDuration: 6,
      }),
    ])
  })

  it('resolve 뒤 삭제된 scene은 지어내지 않아 admission의 no-items로 닫을 수 있다', () => {
    expect(resolveAgentVideoScenes([
      { ordinal: 7, rendererSceneId: 'deleted-renderer-id' },
    ], [{ id: 'still-here', videoT2VPrompt: 'x' }])).toEqual([])
  })

  it('agent 완료 patch는 rendererSceneId scene의 videoT2VPath를 채우고 export t2v source가 읽는다', () => {
    const scene = { id: 'opaque-id', imagePath: '/scene.png' }
    const patch = agentVideoScenePatch('complete', {
      base64: 'VIDEO-BASE64',
      videoPath: '/project/scenes/opaque-id.t2v.mp4',
      duration: 6,
      generatedAt: 123,
    })
    const updated = { ...scene, ...patch }

    expect(patch).toMatchObject({
      videoT2VStatus: 'complete',
      videoT2V: 'VIDEO-BASE64',
      videoT2VPath: '/project/scenes/opaque-id.t2v.mp4',
      videoT2VDisabled: null,
      videoT2VDuration: 6,
      videoT2VGeneratedAt: 123,
    })
    expect(resolveExportVideos(updated)).toEqual([{
      source: 't2v',
      path: '/project/scenes/opaque-id.t2v.mp4',
      data: 'VIDEO-BASE64',
      duration: 6,
    }])
  })
})
