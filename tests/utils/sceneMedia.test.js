/**
 * sceneMedia — 공용 export 미디어 결정 함수 단위 테스트
 *
 * 가장 중요한 회귀 가드: cross-session(이전 세션 영상 = path만 남음, base64 없음)
 * 케이스에서 SceneList(시각)와 useExport(실제) 가 같은 결정을 내려야 한다.
 *
 * 회귀 컨텍스트 (실제 사용자 시나리오):
 *   - 이전 세션: I2V 생성 → 종료 → project.json 에 videoI2VPath 만 남고 videoI2V(base64) 사라짐
 *   - 현재 세션 시작: I2V는 path 만, T2V 새로 생성 → videoT2V(base64) 메모리에 있음
 *   - 이전 코드:
 *       SceneList: videoI2V undefined → skip → videoT2V truthy → "T2V 선택됨" 표시
 *       useExport: videoI2VPath truthy → "I2V" 결정 → 실제 export 됨
 *   - 결과: 사용자 시각엔 T2V 가 선택된 듯 보였는데 실제론 I2V 가 export 됨
 *           (silent data corruption — 사용자가 알아채기 어려움)
 *
 * Fix: SceneList 와 useExport 가 모두 이 공용 함수 사용.
 *      base64 와 path 둘 다 체크.
 */

import { describe, it, expect } from 'vitest'
import {
  resolveExportVideos,
  hasExportableMedia,
  getExportFilePaths,
  videoClearPatch,
  buildVideoRestorePatch,
  assertVideoSource,
  getVideoDisabledField,
  buildFramePairVideoPatch,
  resolveI2vRestoreSceneId,
} from '../../src/utils/sceneMedia'

describe('hasExportableMedia', () => {
  // Contract: capcutCloud 가 image 를 메인 트랙으로 사용하므로 image 가 없는 씬은
  // exporter 가 silent drop 한다. → image (base64 또는 path) 가 있어야 exportable.

  it('null/undefined 씬은 false', () => {
    expect(hasExportableMedia(null)).toBe(false)
    expect(hasExportableMedia(undefined)).toBe(false)
  })

  it('빈 객체는 false', () => {
    expect(hasExportableMedia({})).toBe(false)
  })

  it('image base64 있으면 true', () => {
    expect(hasExportableMedia({ image: 'b64' })).toBe(true)
  })

  it('imagePath 있으면 true', () => {
    expect(hasExportableMedia({ imagePath: '/img.png' })).toBe(true)
  })

  it('🚨 영상만 있고 image 없으면 false (exporter 가 silent drop 하므로 — 회귀 가드)', () => {
    // 이전 잘못된 구현: image 없이도 true 반환 → exporter 가 조용히 씬 건너뜀
    // 새 contract: image 필수. 영상만 있는 씬은 명확히 "no images" 경고로 surface.
    expect(hasExportableMedia({ videoT2V: 'b64' })).toBe(false)
    expect(hasExportableMedia({ videoT2VPath: '/t.mp4' })).toBe(false)
    expect(hasExportableMedia({ videoI2V: 'b64' })).toBe(false)
    expect(hasExportableMedia({ videoI2VPath: '/i.mp4' })).toBe(false)
    // 영상 모두 갖춘 video-only 씬도 false
    expect(
      hasExportableMedia({
        videoT2VPath: '/t.mp4',
        videoI2VPath: '/i.mp4',
      })
    ).toBe(false)
  })

  it('image + 영상 같이 있으면 true (정상 케이스)', () => {
    expect(
      hasExportableMedia({ imagePath: '/img.png', videoT2VPath: '/t.mp4' })
    ).toBe(true)
    expect(
      hasExportableMedia({ image: 'b64', videoI2V: 'b64' })
    ).toBe(true)
  })

  it('cross-session: imagePath + videoI2VPath 만 있어도 exportable (실제 사용자 시나리오)', () => {
    // 사용자 project.json: image/videoI2V base64 사라지고 path 들만 남은 케이스
    const scene = {
      id: 'scene_2',
      imagePath: '/images/scene_2.png',
      videoI2VPath: '/videos/i2v_2.mp4',
    }
    expect(hasExportableMedia(scene)).toBe(true)
  })

  it('exportMedia 명시값은 무관 (image 유무가 기준)', () => {
    // exportMedia='t2v' 라도 image 없으면 false (exporter contract 위반)
    expect(
      hasExportableMedia({ exportMedia: 't2v', videoT2VPath: '/t.mp4' })
    ).toBe(false)
    // exportMedia='image' + image 있으면 true
    expect(
      hasExportableMedia({ exportMedia: 'image', imagePath: '/i.png' })
    ).toBe(true)
  })
})

describe('getExportFilePaths', () => {
  // Contract(B1): imagePath + 존재하는 영상 path 모두 반환(있는 영상 다 export 하므로).
  // data:base64 URL 은 디스크 read 불필요 → 제외.

  it('null/undefined 씬은 빈 배열', () => {
    expect(getExportFilePaths(null)).toEqual([])
    expect(getExportFilePaths(undefined)).toEqual([])
  })

  it('빈 객체는 빈 배열', () => {
    expect(getExportFilePaths({})).toEqual([])
  })

  it('imagePath 만 있으면 [imagePath] (auto → image fallback)', () => {
    expect(getExportFilePaths({ imagePath: '/img.png' })).toEqual(['/img.png'])
  })

  describe('B1 — exportMedia 무시, 있는 영상 path 다 포함', () => {
    it("exportMedia='image' 여도 image + 영상 path 다 (영상도 export 하므로 권한 필요)", () => {
      const scene = {
        exportMedia: 'image',
        imagePath: '/img.png',
        videoT2VPath: '/t.mp4',
        videoI2VPath: '/i.mp4',
      }
      const paths = getExportFilePaths(scene)
      expect(paths).toEqual(expect.arrayContaining(['/img.png', '/i.mp4', '/t.mp4']))
      expect(paths.length).toBe(3)
    })

    it("exportMedia='t2v' 여도 videoI2VPath 도 포함 (핀이 export 를 거르지 않음)", () => {
      const scene = {
        exportMedia: 't2v',
        imagePath: '/img.png',
        videoT2VPath: '/t.mp4',
        videoI2VPath: '/i.mp4',
      }
      const paths = getExportFilePaths(scene)
      expect(paths).toEqual(expect.arrayContaining(['/img.png', '/t.mp4', '/i.mp4']))
      expect(paths.length).toBe(3)
    })
  })

  describe('auto choice (exportMedia 미설정)', () => {
    it('auto + image 만 → [imagePath]', () => {
      expect(
        getExportFilePaths({ imagePath: '/i.png' })
      ).toEqual(['/i.png'])
    })

    it('auto + image + I2V path → I2V 우선이라 [imagePath, videoI2VPath]', () => {
      const scene = {
        imagePath: '/i.png',
        videoI2VPath: '/v.mp4',
      }
      const paths = getExportFilePaths(scene)
      expect(paths).toContain('/i.png')
      expect(paths).toContain('/v.mp4')
      expect(paths.length).toBe(2)
    })

    it('auto + image + T2V path 만 → [imagePath, videoT2VPath]', () => {
      const scene = {
        imagePath: '/i.png',
        videoT2VPath: '/t.mp4',
      }
      const paths = getExportFilePaths(scene)
      expect(paths).toContain('/i.png')
      expect(paths).toContain('/t.mp4')
      expect(paths.length).toBe(2)
    })

    it('auto + image + 양쪽 영상 path → 하이브리드: 이미지+i2v+t2v 모두 (2트랙 export)', () => {
      const scene = {
        imagePath: '/i.png',
        videoT2VPath: '/t.mp4',  // 하이브리드: auto + 둘 다면 둘 다 포함(2트랙)
        videoI2VPath: '/v.mp4',
      }
      const paths = getExportFilePaths(scene)
      expect(paths).toContain('/i.png')
      expect(paths).toContain('/v.mp4')
      expect(paths).toContain('/t.mp4')
      expect(paths.length).toBe(3)
    })
  })

  describe('data URL 처리', () => {
    it('data:base64 URL 은 권한 불필요 — 제외', () => {
      const scene = {
        exportMedia: 't2v',
        imagePath: 'data:image/png;base64,iVBORw0...',
        videoT2VPath: 'data:video/mp4;base64,AAAA...',
      }
      expect(getExportFilePaths(scene)).toEqual([])
    })

    it('파일 path + data URL 혼합이면 파일 path 만', () => {
      const scene = {
        exportMedia: 't2v',
        imagePath: 'data:image/png;base64,xxx',  // base64 — 제외
        videoT2VPath: '/real/t.mp4',              // 실제 파일 — 포함
      }
      expect(getExportFilePaths(scene)).toEqual(['/real/t.mp4'])
    })
  })

  it('base64 필드(image, videoT2V, videoI2V)는 무시 — 권한 불필요', () => {
    const scene = {
      image: 'b64',
      videoT2V: 'b64',
      videoI2V: 'b64',
    }
    expect(getExportFilePaths(scene)).toEqual([])
  })
})

describe('resolveExportVideos (B1: exportMedia 무시 — 있는 영상 다 export)', () => {
  const i2v = { videoI2VPath: '/i.mp4', videoI2VDuration: 2 }
  const t2v = { videoT2VPath: '/t.mp4', videoT2VDuration: 4 }

  it('i2v·t2v 둘 다 → 둘 다 반환 (i2v 먼저)', () => {
    const out = resolveExportVideos({ ...i2v, ...t2v })
    expect(out.map(v => v.source)).toEqual(['i2v', 't2v'])
    expect(out[0].path).toBe('/i.mp4')
    expect(out[0].duration).toBe(2)
    expect(out[1].path).toBe('/t.mp4')
    expect(out[1].duration).toBe(4)
  })
  it('하나만 → 그 하나', () => {
    expect(resolveExportVideos({ ...t2v }).map(v => v.source)).toEqual(['t2v'])
  })
  it("exportMedia='i2v' 여도 둘 다 (핀은 export 안 거름 — 큐레이션은 CapCut)", () => {
    expect(resolveExportVideos({ ...i2v, ...t2v, exportMedia: 'i2v' }).map(v => v.source)).toEqual(['i2v', 't2v'])
  })
  it("exportMedia='t2v' 여도 둘 다", () => {
    expect(resolveExportVideos({ ...i2v, ...t2v, exportMedia: 't2v' }).map(v => v.source)).toEqual(['i2v', 't2v'])
  })
  it("exportMedia='image' 여도 영상 다 (영상 큐레이션은 CapCut 에서)", () => {
    expect(resolveExportVideos({ ...i2v, ...t2v, exportMedia: 'image' }).map(v => v.source)).toEqual(['i2v', 't2v'])
  })
  it('비디오 없으면 빈 배열', () => {
    expect(resolveExportVideos({ imagePath: '/x.png' })).toEqual([])
  })
  it('base64만 있어도(path 없음) 인식', () => {
    const out = resolveExportVideos({ videoT2V: 'BASE64DATA' })
    expect(out.map(v => v.source)).toEqual(['t2v'])
    expect(out[0].data).toBe('BASE64DATA')
  })

  it('videoI2VDisabled=true → i2v 제외(t2v만)', () => {
    expect(resolveExportVideos({ ...i2v, ...t2v, videoI2VDisabled: true }).map(v => v.source)).toEqual(['t2v'])
  })
  it('videoT2VDisabled=true → t2v 제외(i2v만)', () => {
    expect(resolveExportVideos({ ...i2v, ...t2v, videoT2VDisabled: true }).map(v => v.source)).toEqual(['i2v'])
  })
  it('둘 다 disabled → 빈 배열(이미지만 export)', () => {
    expect(resolveExportVideos({ ...i2v, ...t2v, videoI2VDisabled: true, videoT2VDisabled: true })).toEqual([])
  })
  it('disabled=null/false 는 켜짐(falsy)', () => {
    expect(resolveExportVideos({ ...i2v, videoI2VDisabled: null }).map(v => v.source)).toEqual(['i2v'])
    expect(resolveExportVideos({ ...i2v, videoI2VDisabled: false }).map(v => v.source)).toEqual(['i2v'])
  })

  it('source별 generating 상태는 stale video path 를 export 하지 않음', () => {
    const out = resolveExportVideos({
      ...i2v,
      ...t2v,
      videoI2VStatus: 'generating',
      videoT2VStatus: 'complete',
    })

    expect(out.map(v => v.source)).toEqual(['t2v'])
  })

  it('t2v generating 상태도 stale path 를 제외하고 i2v 는 유지', () => {
    const out = resolveExportVideos({
      ...i2v,
      ...t2v,
      videoI2VStatus: 'complete',
      videoT2VStatus: 'generating',
    })

    expect(out.map(v => v.source)).toEqual(['i2v'])
  })
})

describe('videoClearPatch (재생성/clear 시 영상 필드 초기화 — disabled reset 포함)', () => {
  it("'i2v' → i2v 필드 전부 null + videoI2VDisabled:null", () => {
    expect(videoClearPatch('i2v')).toEqual({
      videoI2V: null, videoI2VPath: null, videoI2VDuration: null, videoI2VDisabled: null,
    })
  })
  it("'t2v' → t2v 필드 전부 null + videoT2VDisabled:null", () => {
    expect(videoClearPatch('t2v')).toEqual({
      videoT2V: null, videoT2VPath: null, videoT2VDuration: null, videoT2VDisabled: null,
    })
  })
})

describe('buildVideoRestorePatch (history 복원 → source-specific scene patch)', () => {
  const meta = { video: 'B64', videoPath: '/v.mp4', seed: 7, generatedAt: 123, model: 'veo', mediaId: 'm1' }

  it("'t2v' → 비디오 메타를 videoT2V* 네임스페이스로 매핑(이미지 메타 오염 방지)", () => {
    const out = buildVideoRestorePatch('t2v', meta)
    expect(out.videoT2V).toBe('B64')
    expect(out.videoT2VPath).toBe('/v.mp4')
    expect(out.videoT2VDisabled).toBe(null)
    expect(out.videoT2VSeed).toBe(7)
    expect(out.videoT2VGeneratedAt).toBe(123)
    expect(out.videoT2VModel).toBe('veo')
    expect(out.videoT2VMediaId).toBe('m1')
    // raw 이미지 메타 키는 절대 포함 안 함
    expect(out).not.toHaveProperty('seed')
    expect(out).not.toHaveProperty('generatedAt')
    expect(out).not.toHaveProperty('model')
    expect(out).not.toHaveProperty('mediaId')
  })

  it("'i2v' → 최소 cache-buster(videoI2VGeneratedAt)만 + disabled 리셋, raw 메타 없음", () => {
    const out = buildVideoRestorePatch('i2v', meta)
    expect(out.videoI2V).toBe('B64')
    expect(out.videoI2VPath).toBe('/v.mp4')
    expect(out.videoI2VDisabled).toBe(null)
    expect(out.videoI2VGeneratedAt).toBe(123)
    expect(out).not.toHaveProperty('seed')
    expect(out).not.toHaveProperty('generatedAt')
  })

  it('video 없으면(path만 복원) videoXXX 데이터 키 생략', () => {
    const out = buildVideoRestorePatch('t2v', { videoPath: '/v.mp4' })
    expect(out).not.toHaveProperty('videoT2V')
    expect(out.videoT2VPath).toBe('/v.mp4')
    expect(out.videoT2VDisabled).toBe(null)
  })

  it("'i2v' 같은 path 덮어쓰기(base64 없이 path+generatedAt만)도 cache-buster 포함", () => {
    // fp_ / i2v_ 복원은 보통 같은 i2v_N.mp4 를 덮어써 path 가 불변 — generatedAt 이
    // videoI2VGeneratedAt 로 들어가야 timeline/monitor 가 stale preview 를 안 본다.
    const out = buildVideoRestorePatch('i2v', { videoPath: '/v/i2v_3.mp4', generatedAt: 999 })
    expect(out.videoI2VPath).toBe('/v/i2v_3.mp4')
    expect(out.videoI2VGeneratedAt).toBe(999)
    expect(out).not.toHaveProperty('videoI2V')
  })
})

describe('resolveI2vRestoreSceneId (i2v history 복원 → 적용 대상 scene/fp 해석)', () => {
  it('owning framePair 있으면 그 ownerSceneId 사용 (video.fpId 직접)', () => {
    const fps = [{ id: 'fp_7', ownerSceneId: 'scene_5' }]
    expect(resolveI2vRestoreSceneId({ id: 'i2v_7', fpId: 'fp_7', sceneId: 'scene_5' }, fps))
      .toEqual({ fpId: 'fp_7', sceneId: 'scene_5' })
  })

  it('video.fpId 없으면 id 에서 fp_ 파싱', () => {
    const fps = [{ id: 'fp_3', ownerSceneId: 'scene_3' }]
    expect(resolveI2vRestoreSceneId({ id: 'i2v_3', sceneId: 'scene_3' }, fps))
      .toEqual({ fpId: 'fp_3', sceneId: 'scene_3' })
  })

  it('owning framePair 없으면 payload.sceneId 로 폴백 (no-op 방지, P2-1)', () => {
    // 폴백 i2v_9 → fp_9 가 존재하지 않아도, payload 의 sceneId 로 scene 갱신은 되게.
    expect(resolveI2vRestoreSceneId({ id: 'i2v_9', sceneId: 'scene_9' }, []))
      .toEqual({ fpId: 'fp_9', sceneId: 'scene_9' })
  })

  it('framePair 도 sceneId 도 없으면 sceneId=null (스킵)', () => {
    expect(resolveI2vRestoreSceneId({ id: 'i2v_2' }, []))
      .toEqual({ fpId: 'fp_2', sceneId: null })
  })

  it('video 없으면 안전하게 null', () => {
    expect(resolveI2vRestoreSceneId(null, [])).toEqual({ fpId: null, sceneId: null })
  })
})

describe('source 헬퍼 — assert/getVideoDisabledField/buildFramePairVideoPatch (typo 방어)', () => {
  it('assertVideoSource: i2v/t2v 통과, 그 외(typo/undefined) throw', () => {
    expect(assertVideoSource('i2v')).toBe('i2v')
    expect(assertVideoSource('t2v')).toBe('t2v')
    expect(() => assertVideoSource('i2V')).toThrow()
    expect(() => assertVideoSource(undefined)).toThrow()
  })
  it('getVideoDisabledField: source 별 올바른 disabled 필드', () => {
    expect(getVideoDisabledField('i2v')).toBe('videoI2VDisabled')
    expect(getVideoDisabledField('t2v')).toBe('videoT2VDisabled')
    expect(() => getVideoDisabledField('x')).toThrow()
  })
  it('videoClearPatch/buildVideoRestorePatch: unknown source → throw (silent fallback 제거)', () => {
    expect(() => videoClearPatch('x')).toThrow()
    expect(() => buildVideoRestorePatch('x', {})).toThrow()
  })
  it('buildFramePairVideoPatch: video/base64/videoPath + present-key 메타', () => {
    expect(buildFramePairVideoPatch({ video: 'B', videoPath: '/p', seed: 1, generatedAt: 2 }))
      .toEqual({ video: 'B', base64: 'B', videoPath: '/p', seed: 1, generatedAt: 2 })
    const out = buildFramePairVideoPatch({ videoPath: '/p' })
    expect(out).not.toHaveProperty('seed')
    expect(out.videoPath).toBe('/p')
  })
  it('buildFramePairVideoPatch: media key 없으면(meta-only) video/base64/videoPath 미포함(영상 wipe 방지)', () => {
    const out = buildFramePairVideoPatch({ generatedAt: 9 })
    expect(out).toEqual({ generatedAt: 9 })
    expect(out).not.toHaveProperty('video')
    expect(out).not.toHaveProperty('base64')
    expect(out).not.toHaveProperty('videoPath')
  })
})
