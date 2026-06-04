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
