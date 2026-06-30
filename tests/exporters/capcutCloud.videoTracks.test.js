/**
 * capcutCloud — 하이브리드 2 비디오 트랙 (i2v 앞 / t2v 뒤).
 * prepareCloudRequest 가 scene.videos(0~2개)를 trackIndex 가진 videoOverlays 로 변환하는지.
 * (image_size 를 미리 줘서 new Image() 비동기 로딩 경로를 우회)
 */
import { describe, it, expect } from 'vitest'
import { prepareCloudRequest } from '../../src/exporters/prepareCloudRequest'

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

describe('prepareCloudRequest — 원시 base64 미디어 파일명', () => {
  // data: prefix 없는 원시 base64 비디오/오디오는 isFilePath=false 라 path.split 폴백으로
  // 전체 페이로드가 파일명이 되던 버그 → type 기반 안전한 이름으로.
  it('원시 base64 mp4 비디오 → 파일명이 페이로드가 아니라 video_<id>_<src>.mp4', async () => {
    const rawMp4 = 'AAAAGGZ0eXBpc29tAAACAGlzb21pc28y' + 'A'.repeat(200)
    const project = { scenes: [{ ...sceneBase, videos: [{ source: 't2v', path: rawMp4, duration: 4 }] }] }
    const { cloudRequest } = await prepareCloudRequest(project)
    expect(cloudRequest.videoOverlays[0].filename).toBe('video_scene_1_t2v.mp4')
  })

  it('원시 base64 mp3 SFX → sfx_<id>.mp3', async () => {
    const rawMp3 = 'SUQzBAAAAAAA' + 'A'.repeat(200)
    const project = { scenes: [{ ...sceneBase, sfx_path: rawMp3, sfx_duration: 2 }] }
    const { cloudRequest } = await prepareCloudRequest(project)
    expect(cloudRequest.sfxItems[0].filename).toBe('sfx_scene_1.mp3')
  })
})
