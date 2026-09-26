/**
 * applyVideoAudioVolume — GCF 가 만든 CapCut draft 에서 Veo 영상 세그먼트 볼륨만 앱에서 패치.
 *
 * 배경: Veo 는 오디오를 끌 수 없고(Gemini API 가 generate_audio=false 거부), GCF 는
 * 영상 오버레이 세그먼트에 volume 을 쓰지 않아 템플릿 기본 1.0 이 그대로 나간다
 * (whisk2capcut index.suffixed.js:1193-1208). GCF 는 수정 금지 → 앱이 받은 draft 를 패치한다.
 *
 * 주의: CapCut draft 포맷은 정지 이미지도 materials.videos 에 담는다(type:'photo').
 * 그래서 videoOverlays 의 filename 집합에 속한 material 만 대상이다.
 */
import { describe, it, expect } from 'vitest'
import { applyVideoAudioVolume } from '../../src/exporters/videoAudioVolume'

/** GCF 응답을 닮은 draft: 이미지 1(photo) + 영상 1(video) */
function makeDraft() {
  return {
    materials: {
      videos: [
        { id: 'mat_img_1', type: 'photo', material_name: 'image_scene_1.png' },
        { id: 'mat_vid_1', type: 'video', material_name: 'video_scene_1_t2v.mp4' },
      ],
    },
    tracks: [
      {
        type: 'video',
        segments: [{ id: 'seg_img_1', material_id: 'mat_img_1', volume: 1.0 }],
      },
      {
        type: 'video',
        segments: [{ id: 'seg_vid_1', material_id: 'mat_vid_1', volume: 1.0 }],
      },
    ],
  }
}

const VIDEO_FILENAMES = ['video_scene_1_t2v.mp4']

const segById = (draft, id) =>
  draft.tracks.flatMap(t => t.segments).find(s => s.id === id)

describe('applyVideoAudioVolume', () => {
  // V1 — 영상 세그먼트만 대상. 이미지 세그먼트는 불변.
  it('영상 오버레이 material 을 참조하는 세그먼트에만 volume 을 주입한다', () => {
    const out = applyVideoAudioVolume(makeDraft(), { videoFilenames: VIDEO_FILENAMES, volume: 0 })

    expect(segById(out, 'seg_vid_1').volume).toBe(0)
    // 이미지는 건드리지 않는다 (photo material)
    expect(segById(out, 'seg_img_1').volume).toBe(1.0)
  })

  // V2 — 값이 그대로 반영. null/undefined 면 draft 불변(GCF 기본 유지).
  it('volume 0.15 면 0.15 가 붙는다', () => {
    const out = applyVideoAudioVolume(makeDraft(), { videoFilenames: VIDEO_FILENAMES, volume: 0.15 })
    expect(segById(out, 'seg_vid_1').volume).toBe(0.15)
  })

  it('volume 이 null/undefined 면 draft 를 그대로 돌려준다 (구버전 설정 = GCF 기본 동작)', () => {
    const draft = makeDraft()
    const before = JSON.stringify(draft)

    expect(JSON.stringify(applyVideoAudioVolume(draft, { videoFilenames: VIDEO_FILENAMES, volume: null }))).toBe(before)
    expect(JSON.stringify(applyVideoAudioVolume(draft, { videoFilenames: VIDEO_FILENAMES }))).toBe(before)
  })

  // V3 — 영상 없는 프로젝트(이미지만)는 불변 + 예외 없음.
  it('videoFilenames 가 비면 draft 불변', () => {
    const draft = makeDraft()
    const before = JSON.stringify(draft)
    expect(JSON.stringify(applyVideoAudioVolume(draft, { videoFilenames: [], volume: 0 }))).toBe(before)
    expect(JSON.stringify(applyVideoAudioVolume(draft, { videoFilenames: null, volume: 0 }))).toBe(before)
  })

  // V4 — 응답이 JSON 문자열로 올 수 있다(capcutCloud.js:85 가 그 경우를 다룬다).
  it('draft 가 JSON 문자열이어도 패치하고 문자열로 돌려준다', () => {
    const out = applyVideoAudioVolume(JSON.stringify(makeDraft()), { videoFilenames: VIDEO_FILENAMES, volume: 0 })

    expect(typeof out).toBe('string')
    expect(segById(JSON.parse(out), 'seg_vid_1').volume).toBe(0)
  })

  it('파싱 불가 문자열이면 원본을 그대로 돌려준다 (export 를 깨뜨리지 않는다)', () => {
    const broken = '{not json'
    expect(applyVideoAudioVolume(broken, { videoFilenames: VIDEO_FILENAMES, volume: 0 })).toBe(broken)
  })

  // V6 — 방어: 예상 밖 draft 모양에도 throw 하지 않는다.
  it('materials/tracks 가 없어도 throw 하지 않는다', () => {
    expect(() => applyVideoAudioVolume({}, { videoFilenames: VIDEO_FILENAMES, volume: 0 })).not.toThrow()
    expect(() => applyVideoAudioVolume(null, { videoFilenames: VIDEO_FILENAMES, volume: 0 })).not.toThrow()
  })
})

// 리뷰 R1(참고): CapCut 은 음소거를 풀 때 last_nonzero_volume 으로 돌아간다(템플릿 기본 1.0). 0.15 로 낮춘 클립을 CapCut 에서
//   껐다 켜면 100% 로 튀지 않게, 0 보다 큰 값은 last_nonzero_volume 도 같이 맞춘다. 음소거(0)는 되돌릴 값을 남긴다.
describe('applyVideoAudioVolume — last_nonzero_volume', () => {
  const withLast = () => {
    const d = makeDraft()
    for (const s of d.tracks.flatMap(t => t.segments)) s.last_nonzero_volume = 1.0
    return d
  }

  it('0.15 → volume 과 last_nonzero_volume 둘 다 0.15', () => {
    const out = applyVideoAudioVolume(withLast(), { videoFilenames: VIDEO_FILENAMES, volume: 0.15 })
    expect(segById(out, 'seg_vid_1')).toMatchObject({ volume: 0.15, last_nonzero_volume: 0.15 })
    expect(segById(out, 'seg_img_1')).toMatchObject({ volume: 1.0, last_nonzero_volume: 1.0 })
  })

  it('0(음소거) → last_nonzero_volume 은 그대로(풀면 원래 볼륨)', () => {
    const out = applyVideoAudioVolume(withLast(), { videoFilenames: VIDEO_FILENAMES, volume: 0 })
    expect(segById(out, 'seg_vid_1')).toMatchObject({ volume: 0, last_nonzero_volume: 1.0 })
  })
})
