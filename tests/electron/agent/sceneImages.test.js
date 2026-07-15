// @vitest-environment node
import { describe, it, expect, vi } from 'vitest'
import {
  SCENE_IMAGE_EXTS,
  findSceneImageCandidate,
  resizeSpec,
} from '../../../electron/agent/sceneImages.js'

// M3 I3 (D11): 이미지 후보 탐색과 리사이즈 결정은 순수 함수. nativeImage(main-only)는 주입한다.
// 후보 리스트는 이미지 5확장자만 — fs:read-resource의 7확장자(mp4/webm 포함)를 재사용하지 않는다.

describe('SCENE_IMAGE_EXTS', () => {
  it('D11 순서의 이미지 5확장자만', () => {
    expect(SCENE_IMAGE_EXTS).toEqual(['png', 'jpg', 'jpeg', 'webp', 'gif'])
  })
})

describe('findSceneImageCandidate', () => {
  it('resolved rendererSceneId의 .png만 존재 → 그 경로. scene_1.* probe 0회 (slice 28)', async () => {
    const exists = vi.fn(async (p) => p.endsWith('scene_17.png'))
    const got = await findSceneImageCandidate({ sceneDir: '/proj/scenes', rendererSceneId: 'scene_17', exists })
    expect(got).toBe('/proj/scenes/scene_17.png')
    // 오직 scene_17.* 만 probe한다 — ordinal로 scene_1.* 를 조립하지 않는다.
    for (const call of exists.mock.calls) {
      expect(call[0]).toContain('scene_17.')
      expect(call[0]).not.toContain('scene_1.')
    }
  })

  it('확장자 우선순위 png>jpg>jpeg>webp>gif — png 먼저 매치되면 뒤는 probe 안 함', async () => {
    const exists = vi.fn(async () => true) // 전부 존재해도
    const got = await findSceneImageCandidate({ sceneDir: '/d', rendererSceneId: 's', exists })
    expect(got).toBe('/d/s.png')
    expect(exists).toHaveBeenCalledTimes(1) // 첫 매치에서 멈춘다
  })

  it('jpeg만 존재 → jpeg 경로', async () => {
    const exists = vi.fn(async (p) => p.endsWith('.jpeg'))
    expect(await findSceneImageCandidate({ sceneDir: '/d', rendererSceneId: 's', exists }))
      .toBe('/d/s.jpeg')
  })

  it('후보 전부 없음 → null (slice 29)', async () => {
    const exists = vi.fn(async () => false)
    expect(await findSceneImageCandidate({ sceneDir: '/d', rendererSceneId: 's', exists })).toBeNull()
    expect(exists).toHaveBeenCalledTimes(5) // 5확장자 전부 시도
  })
})

describe('resizeSpec — 긴 변이 maxEdge를 넘으면 aspect 보존 축소 (slice 31)', () => {
  it('9:16 세로(720×1280), maxEdge 768 → {height:768}', () => {
    expect(resizeSpec(720, 1280, 768)).toEqual({ height: 768 })
  })

  it('16:9 가로(1280×720), maxEdge 768 → {width:768}', () => {
    expect(resizeSpec(1280, 720, 768)).toEqual({ width: 768 })
  })

  it('정사각 초과(1000×1000) → {width:768}', () => {
    expect(resizeSpec(1000, 1000, 768)).toEqual({ width: 768 })
  })

  it('이미 maxEdge 이내(400×600) → null (리사이즈 안 함)', () => {
    expect(resizeSpec(400, 600, 768)).toBeNull()
  })

  it('경계값(768×768) → null', () => {
    expect(resizeSpec(768, 768, 768)).toBeNull()
  })
})
