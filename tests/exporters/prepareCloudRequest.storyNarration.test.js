/**
 * M2a-4a — prepareCloudRequest 의 story_narration 분기.
 *
 * audio 스텝이 써둔 manifest(세그먼트별 오디오 메타)를 export 가 읽어
 * `story_narration` 전용 audioTrack 으로 변환한다.
 *   - timecodeMs = seg.startMs, durationMs = seg.durationMs, trackIndex(기본 0), vol 은 GCF 서 1.0
 *   - narration 세그먼트만 (sfx 는 M2b, 여기선 제외)
 *   - audioFiles + pathMap 에 세그먼트 파일 등록
 * 정합 검사: manifest.pushRevision === lastPushedRevision 일 때만 사용.
 *   불일치/미ack(null) 이면 export 차단(throw) — 세 exporter 공유라 자동 차단.
 * 배타: options.storyAudio 가 있으면 기존 audioPackage 는 무시.
 * (image_size 를 미리 줘서 new Image() 비동기 경로 우회)
 */
import { describe, it, expect } from 'vitest'
import { prepareCloudRequest } from '../../src/exporters/prepareCloudRequest'

const sceneBase = { id: 's001', image_path: '/i.png', image_size: { width: 1024, height: 1024 }, image_duration: 3 }

function manifest(pushRevision, segments) {
  return { version: 1, pushRevision, segments }
}

const narrSeg = (id, startMs, durationMs, extra = {}) => ({
  id, type: 'narration', speaker: 'narrator', trackIndex: 0,
  audioPath: `/proj/story/audio/segments/${id}.mp3`, startMs, durationMs, ...extra,
})

describe('prepareCloudRequest — story_narration 분기', () => {
  it('정합 OK 면 narration 세그먼트 → story_narration audioTrack (timecodeMs=startMs, durationMs, trackIndex)', async () => {
    const project = { name: 'p', scenes: [sceneBase] }
    const storyAudio = {
      manifest: manifest(7, [
        narrSeg('s001-1', 0, 2380),
        narrSeg('s001-2', 2380, 1620),
      ]),
      lastPushedRevision: 7,
    }
    const { cloudRequest } = await prepareCloudRequest(project, { storyAudio })
    const tracks = cloudRequest.audioTracks
    expect(tracks).toHaveLength(2)
    expect(tracks.every(t => t.type === 'story_narration')).toBe(true)

    const t1 = tracks.find(t => t.filename === 's001-1.mp3')
    expect(t1.timecodeMs).toBe(0)
    expect(t1.durationMs).toBe(2380)
    expect(t1.trackIndex).toBe(0)

    const t2 = tracks.find(t => t.filename === 's001-2.mp3')
    expect(t2.timecodeMs).toBe(2380)
    expect(t2.durationMs).toBe(1620)
  })

  it('세그먼트 오디오 파일이 audioFiles + pathMap 에 절대경로로 등록', async () => {
    const project = { name: 'p', scenes: [sceneBase] }
    const storyAudio = { manifest: manifest(3, [narrSeg('s001-1', 0, 1000)]), lastPushedRevision: 3 }
    const { audioFiles, pathMap } = await prepareCloudRequest(project, { storyAudio })
    const af = audioFiles.find(a => a.filename === 's001-1.mp3')
    expect(af).toBeTruthy()
    expect(af.type).toBe('narration')
    expect(af.path).toBe('/proj/story/audio/segments/s001-1.mp3')
    expect(pathMap['s001-1.mp3']).toBe('/proj/story/audio/segments/s001-1.mp3')
  })

  it('narration 은 story_narration, sfx 는 sfx_timed 로 분리 배치(M2b)', async () => {
    const project = { name: 'p', scenes: [sceneBase] }
    const storyAudio = {
      manifest: manifest(2, [
        narrSeg('s001-1', 0, 1000),
        { id: 's001-sfx', type: 'sfx', speaker: null, audioPath: '/proj/story/audio/segments/s001-sfx.mp3', startMs: 500, durationMs: 300 },
      ]),
      lastPushedRevision: 2,
    }
    const { cloudRequest } = await prepareCloudRequest(project, { storyAudio })
    const narr = cloudRequest.audioTracks.filter((t) => t.type === 'story_narration')
    expect(narr).toHaveLength(1)
    expect(narr[0].filename).toBe('s001-1.mp3')
    const sfx = cloudRequest.audioTracks.filter((t) => t.type === 'sfx_timed')
    expect(sfx).toHaveLength(1)
    expect(sfx[0].filename).toBe('s001-sfx.mp3')
  })

  it('trackIndex 없는 세그먼트는 0 으로 폴백', async () => {
    const project = { name: 'p', scenes: [sceneBase] }
    const seg = narrSeg('s001-1', 0, 1000)
    delete seg.trackIndex
    const storyAudio = { manifest: manifest(1, [seg]), lastPushedRevision: 1 }
    const { cloudRequest } = await prepareCloudRequest(project, { storyAudio })
    expect(cloudRequest.audioTracks[0].trackIndex).toBe(0)
  })

  it('manifest 의 화자별 trackIndex(0,1,2,1)를 story_narration audioTracks 에 보존한다', async () => {
    const project = { name: 'p', scenes: [sceneBase] }
    const storyAudio = {
      manifest: manifest(9, [
        narrSeg('s001-1', 0, 1000, { speaker: 'narrator', trackIndex: 0 }),
        narrSeg('s001-2', 1000, 1000, { speaker: 'mina', trackIndex: 1 }),
        narrSeg('s001-3', 2000, 1000, { speaker: 'jun', trackIndex: 2 }),
        narrSeg('s001-4', 3000, 1000, { speaker: 'mina', trackIndex: 1 }),
      ]),
      lastPushedRevision: 9,
    }
    const { cloudRequest } = await prepareCloudRequest(project, { storyAudio })
    expect(cloudRequest.audioTracks.map((t) => t.trackIndex)).toEqual([0, 1, 2, 1])
  })

  it('정합 불일치(pushRevision !== lastPushedRevision) 면 export 차단(throw)', async () => {
    const project = { name: 'p', scenes: [sceneBase] }
    const storyAudio = { manifest: manifest(5, [narrSeg('s001-1', 0, 1000)]), lastPushedRevision: 4 }
    await expect(prepareCloudRequest(project, { storyAudio })).rejects.toThrow(/sync|정합|pushRevision/i)
  })

  it('pushRevision null(미ack) 이면 export 차단(throw)', async () => {
    const project = { name: 'p', scenes: [sceneBase] }
    const storyAudio = { manifest: manifest(null, [narrSeg('s001-1', 0, 1000)]), lastPushedRevision: 3 }
    await expect(prepareCloudRequest(project, { storyAudio })).rejects.toThrow(/sync|정합|pushRevision/i)
  })

  it('배타: storyAudio 가 있으면 기존 audioPackage 는 무시', async () => {
    const project = { name: 'p', scenes: [sceneBase] }
    const audioPackage = { media: { video: { filename: 'full.mp3', path: '/full.mp3', durationMs: 5000 } } }
    const storyAudio = { manifest: manifest(1, [narrSeg('s001-1', 0, 1000)]), lastPushedRevision: 1 }
    const { cloudRequest } = await prepareCloudRequest(project, { storyAudio, audioPackage })
    // audioPackage.media.video(narration full mp3)가 아니라 story_narration 만 나와야
    expect(cloudRequest.audioTracks.every(t => t.type === 'story_narration')).toBe(true)
    expect(cloudRequest.audioTracks.find(t => t.filename === 'full.mp3')).toBeUndefined()
  })

  it('M2b: manifest sfx 세그먼트 → sfx_timed audioTrack (timecodeMs/durationMs/category) + audioFiles/pathMap', async () => {
    const project = { name: 'p', scenes: [sceneBase] }
    const storyAudio = {
      manifest: manifest(4, [
        narrSeg('s001-1', 0, 2000),
        { id: 's001-2', type: 'sfx', speaker: null, audioPath: '/proj/story/audio/segments/s001-2.mp3', startMs: 2000, durationMs: 800 },
      ]),
      lastPushedRevision: 4,
    }
    const { cloudRequest, audioFiles, pathMap } = await prepareCloudRequest(project, { storyAudio })
    const tracks = cloudRequest.audioTracks
    // narration + sfx 각 1
    expect(tracks.find((t) => t.type === 'story_narration' && t.filename === 's001-1.mp3')).toBeTruthy()
    const sfx = tracks.find((t) => t.type === 'sfx_timed')
    expect(sfx).toBeTruthy()
    expect(sfx.filename).toBe('s001-2.mp3')
    expect(sfx.timecodeMs).toBe(2000)
    expect(sfx.durationMs).toBe(800)
    expect(sfx.category).toBe('story')
    // 파일 등록
    expect(audioFiles.find((a) => a.type === 'sfx' && a.filename === 's001-2.mp3')).toBeTruthy()
    expect(pathMap['s001-2.mp3']).toBe('/proj/story/audio/segments/s001-2.mp3')
  })

  it('배타: storyAudio 있으면 srtEntries/audioDurationSec 도 audioPackage 를 무시', async () => {
    const project = {
      name: 'p', scenes: [sceneBase],
      srtTrack: [{ id: 'sub_1', startTime: 0, endTime: 1, text: 'story-srt' }],
    }
    const audioPackage = {
      srtEntries: [{ index: 1, start: 0, end: 1, text: 'old-package-srt' }],
      media: { video: { durationMs: 9000 } },
    }
    const storyAudio = { manifest: manifest(1, [narrSeg('s001-1', 0, 1000)]), lastPushedRevision: 1 }
    const { cloudRequest } = await prepareCloudRequest(project, { storyAudio, audioPackage })
    // srtEntries 는 project.srtTrack(story) 기반 — 옛 package SRT 가 새면 안 됨
    expect(JSON.stringify(cloudRequest.srtEntries || [])).not.toContain('old-package-srt')
    // audioDurationSec 는 개별 클립이라 null (옛 full mp3 duration 아님)
    expect(cloudRequest.audioDurationSec).toBeNull()
  })

  it('회귀: storyAudio 없으면 기존 audioPackage 동작 유지', async () => {
    const project = { name: 'p', scenes: [sceneBase] }
    const audioPackage = {
      voices: [{ character: 'A', files: [{ filename: 'v1.mp3', path: '/v1.mp3', timecodeMs: 100, durationMs: 500, seq: 1 }] }],
    }
    const { cloudRequest } = await prepareCloudRequest(project, { audioPackage })
    const voice = cloudRequest.audioTracks.find(t => t.type === 'voice')
    expect(voice).toBeTruthy()
    expect(cloudRequest.audioTracks.some(t => t.type === 'story_narration')).toBe(false)
  })
})
