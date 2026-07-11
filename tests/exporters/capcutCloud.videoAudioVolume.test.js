/**
 * capcutCloud — Veo 영상 오디오 볼륨 옵션 (V5 통합)
 *
 * GCF 응답(draftInfo) → 앱이 영상 세그먼트 volume 패치 → writeCapcutProject 로 전달.
 * GCF 는 수정하지 않는다 (segment.volume 을 안 쓰므로 앱이 받은 draft 를 고쳐야 한다).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const callExportFunction = vi.fn()
vi.mock('../../src/exporters/callExportFunction', () => ({
  callExportFunction: (...args) => callExportFunction(...args),
}))

const { exportCapcutPackageCloud } = await import('../../src/exporters/capcutCloud')

/** GCF 가 돌려주는 draft 모양: 이미지 material(photo) + Veo 영상 material(video) */
function gcfDraft(videoFilename) {
  return {
    materials: {
      videos: [
        { id: 'mat_img_1', type: 'photo', material_name: 'image_scene_1.png' },
        { id: 'mat_vid_1', type: 'video', material_name: videoFilename },
      ],
    },
    tracks: [
      { type: 'video', segments: [{ id: 'seg_img_1', material_id: 'mat_img_1', volume: 1.0 }] },
      { type: 'video', segments: [{ id: 'seg_vid_1', material_id: 'mat_vid_1', volume: 1.0 }] },
    ],
  }
}

const project = {
  name: 'p',
  format: 'portrait',
  scenes: [{
    id: 'scene_1',
    image_path: '/img/scene_1.png',
    image_size: { width: 1024, height: 1024 },
    image_duration: 6,
    videos: [{ source: 't2v', path: '/v/t2v_1.mp4', duration: 4 }],
  }],
}

/** writeCapcutProject 가 받은 draftInfo 에서 영상 세그먼트를 꺼낸다 */
function writtenVideoSegment() {
  const arg = window.electronAPI.writeCapcutProject.mock.calls[0][0]
  const draft = JSON.parse(arg.draftInfo)
  return draft.tracks.flatMap(t => t.segments).find(s => s.id === 'seg_vid_1')
}

function writtenImageSegment() {
  const arg = window.electronAPI.writeCapcutProject.mock.calls[0][0]
  const draft = JSON.parse(arg.draftInfo)
  return draft.tracks.flatMap(t => t.segments).find(s => s.id === 'seg_img_1')
}

beforeEach(() => {
  vi.clearAllMocks()
  window.electronAPI = {
    getVolumePath: vi.fn().mockResolvedValue({ volumePath: '' }),
    writeCapcutProject: vi.fn().mockResolvedValue({ success: true, targetPath: '/out' }),
  }
  callExportFunction.mockImplementation(async (_fn, requestData) => ({
    draftInfo: gcfDraft(requestData.videoOverlays[0].filename),
    draftMetaInfo: { draft_materials: [{ value: [] }] },
  }))
})

describe('capcutCloud — videoAudioVolume 옵션', () => {
  it('videoAudioVolume: 0 → 영상 세그먼트만 음소거되어 디스크에 쓰인다', async () => {
    await exportCapcutPackageCloud(project, { capcutProjectNumber: '/out', videoAudioVolume: 0 })

    expect(writtenVideoSegment().volume).toBe(0)
    expect(writtenImageSegment().volume).toBe(1.0)  // 이미지는 불변
  })

  it('videoAudioVolume: 0.15 → 앰비언스 볼륨으로 쓰인다', async () => {
    await exportCapcutPackageCloud(project, { capcutProjectNumber: '/out', videoAudioVolume: 0.15 })

    expect(writtenVideoSegment().volume).toBe(0.15)
  })

  it('옵션 미지정 → GCF 기본 동작 유지 (volume 1.0 그대로)', async () => {
    await exportCapcutPackageCloud(project, { capcutProjectNumber: '/out' })

    expect(writtenVideoSegment().volume).toBe(1.0)
  })
})
