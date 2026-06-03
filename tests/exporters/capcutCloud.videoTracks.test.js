/**
 * capcutCloud — 하이브리드 2 비디오 트랙 (i2v 앞 / t2v 뒤).
 * prepareCloudRequest 가 scene.videos(0~2개)를 trackIndex 가진 videoOverlays 로 변환하는지.
 * (image_size 를 미리 줘서 new Image() 비동기 로딩 경로를 우회)
 */
import { describe, it, expect } from 'vitest'
import { prepareCloudRequest } from '../../src/exporters/capcutCloud'

const sceneBase = { id: 'scene_1', image_path: '/i.png', image_size: { width: 1024, height: 1024 }, image_duration: 10 }

describe('capcutCloud — 하이브리드 비디오 트랙', () => {
  it('i2v·t2v 둘 다 → videoOverlays 2개 + trackIndex(i2v=1 앞, t2v=0 뒤) + 각자 back-align', async () => {
    const project = {
      name: 'p',
      scenes: [{
        ...sceneBase,
        videos: [
          { source: 'i2v', path: '/v/i2v_1.mp4', duration: 2 },
          { source: 't2v', path: '/v/t2v_1.mp4', duration: 4 },
        ],
      }],
    }
    const { cloudRequest } = await prepareCloudRequest(project)
    const overlays = cloudRequest.videoOverlays
    expect(overlays).toHaveLength(2)

    const i2v = overlays.find(o => o.filename.includes('i2v'))
    const t2v = overlays.find(o => o.filename.includes('t2v'))
    expect(i2v.trackIndex).toBe(1)  // 앞(위)
    expect(t2v.trackIndex).toBe(0)  // 뒤(아래)
    // 10s 씬 back-align: i2v 2s → start 8000, t2v 4s → start 6000
    expect(i2v.startMs).toBe(8000)
    expect(t2v.startMs).toBe(6000)
  })

  it('단일 비디오면 overlay 1개', async () => {
    const project = { scenes: [{ ...sceneBase, videos: [{ source: 't2v', path: '/t.mp4', duration: 4 }] }] }
    const { cloudRequest } = await prepareCloudRequest(project)
    expect(cloudRequest.videoOverlays).toHaveLength(1)
    expect(cloudRequest.videoOverlays[0].trackIndex).toBe(0)
  })

  it('비디오 없으면 videoOverlays null', async () => {
    const project = { scenes: [{ ...sceneBase, videos: [] }] }
    const { cloudRequest } = await prepareCloudRequest(project)
    expect(cloudRequest.videoOverlays).toBeNull()
  })
})
