/**
 * generationStatus — done 판정 공통 helper 단위 테스트.
 *
 * 핵심 회귀 (P2/P3 review v2/v3):
 *   status='pending'/'generating'/'error'면 image/path/mediaId가 있어도 done 아님.
 *   force 재생성 중 progress가 100% stuck되는 회귀를 양쪽(MCP, UI panel)에서 같은 정책으로 차단.
 */

import { describe, it, expect } from 'vitest'
import {
  isSceneGenerationDone,
  isReferenceUploadedDone,
  isReferenceImageDone,
} from '../../src/services/generationStatus'

describe('isSceneGenerationDone', () => {
  it('image 있고 status 없음 → done (legacy 호환)', () => {
    expect(isSceneGenerationDone({ image: 'data:...' })).toBe(true)
    expect(isSceneGenerationDone({ imagePath: '/x.png' })).toBe(true)
  })

  it("status === 'done' + image → done", () => {
    expect(isSceneGenerationDone({ status: 'done', image: 'd' })).toBe(true)
  })

  it("status === 'pending' + image 있어도 done 아님 (force 재생성 중)", () => {
    expect(isSceneGenerationDone({ status: 'pending', image: 'd' })).toBe(false)
    expect(isSceneGenerationDone({ status: 'pending', imagePath: '/x.png' })).toBe(false)
  })

  it("status === 'generating' → done 아님", () => {
    expect(isSceneGenerationDone({ status: 'generating', image: 'd' })).toBe(false)
  })

  it("status === 'error' + image → done 아님", () => {
    expect(isSceneGenerationDone({ status: 'error', image: 'd' })).toBe(false)
  })

  it('image 자체가 없으면 done 아님', () => {
    expect(isSceneGenerationDone({ status: 'done' })).toBe(false)
    expect(isSceneGenerationDone({})).toBe(false)
  })

  it('null/undefined 안전', () => {
    expect(isSceneGenerationDone(null)).toBe(false)
    expect(isSceneGenerationDone(undefined)).toBe(false)
  })
})

describe('isReferenceUploadedDone (MCP domain — mediaId 기준)', () => {
  it('mediaId 있고 status 없음 → done', () => {
    expect(isReferenceUploadedDone({ mediaId: 'm-1' })).toBe(true)
  })

  it("status === 'pending' + mediaId 있어도 done 아님 (force 재생성 중)", () => {
    expect(isReferenceUploadedDone({ status: 'pending', mediaId: 'm-1' })).toBe(false)
  })

  it("type === 'style'은 항상 done 아님 (batch 대상 아님)", () => {
    expect(isReferenceUploadedDone({ type: 'style', mediaId: 'm-1' })).toBe(false)
  })

  it('mediaId 자체가 없으면 done 아님', () => {
    expect(isReferenceUploadedDone({ type: 'character', data: 'base64' })).toBe(false)
  })

  it("status === 'generating'/'error' → done 아님", () => {
    expect(isReferenceUploadedDone({ status: 'generating', mediaId: 'm-1' })).toBe(false)
    expect(isReferenceUploadedDone({ status: 'error', mediaId: 'm-1' })).toBe(false)
  })
})

describe('isReferenceImageDone (UI panel domain — data/filePath 기준)', () => {
  it('data 있고 status 없음 → done', () => {
    expect(isReferenceImageDone({ data: 'base64...' })).toBe(true)
  })

  it('filePath 있음 → done', () => {
    expect(isReferenceImageDone({ filePath: '/x.png' })).toBe(true)
  })

  it("status === 'pending' + data 있어도 done 아님", () => {
    expect(isReferenceImageDone({ status: 'pending', data: 'd', filePath: '/x.png' })).toBe(false)
  })

  it("status === 'generating'/'error' → done 아님", () => {
    expect(isReferenceImageDone({ status: 'generating', data: 'd' })).toBe(false)
    expect(isReferenceImageDone({ status: 'error', data: 'd' })).toBe(false)
  })

  it('data/filePath 모두 없으면 done 아님', () => {
    expect(isReferenceImageDone({ status: 'done' })).toBe(false)
  })

  it('null/undefined 안전', () => {
    expect(isReferenceImageDone(null)).toBe(false)
  })
})

describe('MCP vs UI 정책 일관성', () => {
  // 핵심 회귀: force 재생성 중 ref(status=pending, mediaId, data, filePath 모두 있음)는
  // MCP와 UI 양쪽 helper 모두 false 반환해야 progress가 일관되게 "재생성 중"으로 보임.
  it('force 재생성 중 ref는 MCP/UI 둘 다 done 아님', () => {
    const ref = {
      type: 'character',
      status: 'pending',
      mediaId: 'm-stale',
      data: 'base64-stale',
      filePath: '/stale.png',
    }
    expect(isReferenceUploadedDone(ref)).toBe(false)
    expect(isReferenceImageDone(ref)).toBe(false)
  })

  it('재생성 완료 후 ref는 양쪽 모두 done', () => {
    const ref = {
      type: 'character',
      status: 'done',
      mediaId: 'm-new',
      data: 'base64-new',
      filePath: '/new.png',
    }
    expect(isReferenceUploadedDone(ref)).toBe(true)
    expect(isReferenceImageDone(ref)).toBe(true)
  })
})
