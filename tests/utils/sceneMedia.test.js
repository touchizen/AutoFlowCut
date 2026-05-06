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
  resolveExportMediaChoice,
  hasExportableMedia,
  getExportFilePaths,
} from '../../src/utils/sceneMedia'

describe('resolveExportMediaChoice', () => {
  describe('명시적 exportMedia (사용자가 클릭으로 선택)', () => {
    it("exportMedia='i2v' 면 데이터 유무와 무관하게 'i2v'", () => {
      expect(resolveExportMediaChoice({ exportMedia: 'i2v' })).toBe('i2v')
      expect(
        resolveExportMediaChoice({ exportMedia: 'i2v', videoI2V: 'b64' })
      ).toBe('i2v')
      expect(
        resolveExportMediaChoice({ exportMedia: 'i2v', videoI2VPath: '/p' })
      ).toBe('i2v')
    })

    it("exportMedia='t2v' 면 't2v'", () => {
      expect(resolveExportMediaChoice({ exportMedia: 't2v' })).toBe('t2v')
    })

    it("exportMedia='image' 면 'image' (영상 데이터 있어도)", () => {
      expect(
        resolveExportMediaChoice({
          exportMedia: 'image',
          videoI2VPath: '/path',
          videoT2VPath: '/path',
        })
      ).toBe('image')
    })
  })

  describe('auto (exportMedia 미설정)', () => {
    it('아무 미디어도 없으면 image', () => {
      expect(resolveExportMediaChoice({})).toBe('image')
    })

    it('image 만 있으면 image (image 자체는 auto 분기에선 영향 없음 — fallback)', () => {
      expect(resolveExportMediaChoice({ image: 'b64' })).toBe('image')
      expect(resolveExportMediaChoice({ imagePath: '/img' })).toBe('image')
    })

    it('I2V base64 만 → i2v', () => {
      expect(resolveExportMediaChoice({ videoI2V: 'b64' })).toBe('i2v')
    })

    it('I2V path 만 → i2v (이전 세션에서 생성한 I2V)', () => {
      expect(resolveExportMediaChoice({ videoI2VPath: '/i2v.mp4' })).toBe('i2v')
    })

    it('T2V base64 만 → t2v', () => {
      expect(resolveExportMediaChoice({ videoT2V: 'b64' })).toBe('t2v')
    })

    it('T2V path 만 → t2v (이전 세션에서 생성한 T2V)', () => {
      expect(resolveExportMediaChoice({ videoT2VPath: '/t2v.mp4' })).toBe('t2v')
    })

    it('I2V + T2V 둘 다 있으면 I2V 우선', () => {
      expect(
        resolveExportMediaChoice({
          videoI2V: 'i2v_b64',
          videoT2V: 't2v_b64',
        })
      ).toBe('i2v')
      expect(
        resolveExportMediaChoice({
          videoI2VPath: '/i2v.mp4',
          videoT2VPath: '/t2v.mp4',
        })
      ).toBe('i2v')
    })
  })

  describe('🚨 회귀 가드 — cross-session 시각/실제 일치', () => {
    it('이전 세션 I2V (path만) + 이번 세션 T2V (base64) → i2v (이전 코드는 t2v 반환했음)', () => {
      // 사용자 실제 시나리오:
      // - 이전 세션 I2V 생성 → 저장 → base64 사라지고 path 만 남음
      // - 이번 세션 시작 → T2V 생성 → videoT2V(base64) 메모리에
      // - exportMedia 미설정 (auto)
      const scene = {
        id: 'scene_1',
        videoI2VPath: 'C:/project/videos/i2v_1.mp4',  // 이전 세션 I2V path 만
        videoI2V: undefined,                            // base64 없음
        videoT2VPath: 'C:/project/videos/t2v_1.mp4',  // 이번 세션 T2V path
        videoT2V: '(base64_placeholder)',               // 이번 세션 T2V base64
      }
      // 이전 SceneList 로직(base64만 체크)은 't2v' 반환 → 시각이 거짓말함
      // 새 공용 로직은 path 도 체크 → 'i2v' 반환 (실제 export 와 일치)
      expect(resolveExportMediaChoice(scene)).toBe('i2v')
    })

    it('이전 세션 I2V (path만) + 이번 세션 T2V 없음 → i2v (이전엔 image 반환했음)', () => {
      // 시나리오: 이전 세션 I2V만 생성, 이번 세션 아무 영상 안 만듦
      // SceneList 이전 로직: videoI2V undefined → videoT2V undefined → image 반환
      // 새 공용 로직: videoI2VPath truthy → i2v 반환 (실제 export 와 일치)
      const scene = {
        id: 'scene_2',
        videoI2VPath: 'C:/project/videos/i2v_2.mp4',
        videoI2V: undefined,
      }
      expect(resolveExportMediaChoice(scene)).toBe('i2v')
    })

    it('명시적 t2v 선택했는데 T2V 데이터가 정말 없으면 여전히 t2v (사용자 의도 존중)', () => {
      // 명시 선택은 데이터 유무와 무관하게 그 값 반환.
      // 호출 측(useExport)이 path/data 추출 시 적절히 처리.
      const scene = {
        exportMedia: 't2v',
        videoI2VPath: '/i.mp4',
        // videoT2V/videoT2VPath 모두 없음
      }
      expect(resolveExportMediaChoice(scene)).toBe('t2v')
    })
  })

  describe('방어적 동작', () => {
    it('scene 이 null 이면 image (crash 안 함)', () => {
      expect(resolveExportMediaChoice(null)).toBe('image')
    })

    it('scene 이 undefined 면 image', () => {
      expect(resolveExportMediaChoice(undefined)).toBe('image')
    })

    it('알 수 없는 exportMedia 값이면 auto 처럼 동작', () => {
      // 'foo' 같은 잘못된 값 → 명시 분기 통과 못 함 → auto fallback
      const scene = { exportMedia: 'foo', videoI2VPath: '/i.mp4' }
      expect(resolveExportMediaChoice(scene)).toBe('i2v')
    })

    it('exportMedia 가 빈 문자열이면 auto 처리', () => {
      const scene = { exportMedia: '', videoI2VPath: '/i.mp4' }
      expect(resolveExportMediaChoice(scene)).toBe('i2v')
    })
  })

  describe('우선순위 매트릭스', () => {
    // [exportMedia, hasI2VBase64, hasI2VPath, hasT2VBase64, hasT2VPath, expected]
    const scenarios = [
      // 명시 선택
      ['i2v', false, false, false, false, 'i2v'],
      ['t2v', false, false, false, false, 't2v'],
      ['image', true, true, true, true, 'image'],
      // auto, 단일 미디어
      [null, true, false, false, false, 'i2v'],   // I2V base64
      [null, false, true, false, false, 'i2v'],   // I2V path 만
      [null, false, false, true, false, 't2v'],   // T2V base64
      [null, false, false, false, true, 't2v'],   // T2V path 만
      [null, false, false, false, false, 'image'], // 아무것도 없음
      // auto, I2V + T2V 동시 (I2V 우선)
      [null, true, false, true, false, 'i2v'],
      [null, false, true, false, true, 'i2v'],
      [null, true, true, true, true, 'i2v'],
      // ⭐ 회귀 케이스: I2V path만 + T2V base64 → i2v
      [null, false, true, true, false, 'i2v'],
    ]

    scenarios.forEach(([exportMedia, i2vB, i2vP, t2vB, t2vP, expected]) => {
      const desc = `exportMedia=${exportMedia ?? 'auto'} I2V[b=${i2vB ? 'Y' : 'N'},p=${i2vP ? 'Y' : 'N'}] T2V[b=${t2vB ? 'Y' : 'N'},p=${t2vP ? 'Y' : 'N'}] → ${expected}`
      it(desc, () => {
        const scene = {
          exportMedia,
          videoI2V: i2vB ? 'b64' : undefined,
          videoI2VPath: i2vP ? '/i.mp4' : undefined,
          videoT2V: t2vB ? 'b64' : undefined,
          videoT2VPath: t2vP ? '/t.mp4' : undefined,
        }
        expect(resolveExportMediaChoice(scene)).toBe(expected)
      })
    })
  })
})

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
  // Contract: resolveExportMediaChoice 의 결과에 맞춰 실제 읽을 path 만 반환.
  // 선택 안 된 영상 path 는 권한 체크 대상에서 제외 (UX 회귀 방지).

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

  describe('🚨 회귀 가드 — 선택 안 된 영상 path 는 제외', () => {
    it("exportMedia='image' + 영상 path 들 있어도 imagePath 만 반환", () => {
      // 사용자가 image export 선택했는데 과거 영상 path 가 남아있어 권한 prompt 뜨던 회귀
      const scene = {
        exportMedia: 'image',
        imagePath: '/img.png',
        videoT2VPath: '/t.mp4',  // 선택 안 됨 — 제외
        videoI2VPath: '/i.mp4',  // 선택 안 됨 — 제외
      }
      expect(getExportFilePaths(scene)).toEqual(['/img.png'])
    })

    it("exportMedia='t2v' 면 imagePath + videoT2VPath, videoI2VPath 는 제외", () => {
      const scene = {
        exportMedia: 't2v',
        imagePath: '/img.png',
        videoT2VPath: '/t.mp4',
        videoI2VPath: '/i.mp4',  // 선택 안 됨 — 제외
      }
      const paths = getExportFilePaths(scene)
      expect(paths).toContain('/img.png')
      expect(paths).toContain('/t.mp4')
      expect(paths).not.toContain('/i.mp4')
      expect(paths.length).toBe(2)
    })

    it("exportMedia='i2v' 면 imagePath + videoI2VPath, videoT2VPath 는 제외", () => {
      const scene = {
        exportMedia: 'i2v',
        imagePath: '/img.png',
        videoT2VPath: '/t.mp4',  // 선택 안 됨 — 제외
        videoI2VPath: '/i.mp4',
      }
      const paths = getExportFilePaths(scene)
      expect(paths).toContain('/img.png')
      expect(paths).toContain('/i.mp4')
      expect(paths).not.toContain('/t.mp4')
      expect(paths.length).toBe(2)
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

    it('auto + image + 양쪽 영상 path → I2V 우선, T2V 제외', () => {
      const scene = {
        imagePath: '/i.png',
        videoT2VPath: '/t.mp4',  // auto 우선순위에서 밀림 — 제외
        videoI2VPath: '/v.mp4',
      }
      const paths = getExportFilePaths(scene)
      expect(paths).toContain('/i.png')
      expect(paths).toContain('/v.mp4')
      expect(paths).not.toContain('/t.mp4')
      expect(paths.length).toBe(2)
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
