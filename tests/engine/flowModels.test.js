/**
 * flowModels.test.js — FLOW_MODELS 정적 목록 형태 검증.
 * FLOW_MODELS는 flat array — categorizeApiModels(FLOW_MODELS)로
 * { imageModels, videoModels }를 얻어야 한다.
 */
import { describe, it, expect } from 'vitest'
import { FLOW_MODELS, FLOW_STATIC_MODELS } from '../../src/engine/flowModels'

describe('FLOW_MODELS shape', () => {
  it('is a flat array (not an object with imageModels/videoModels)', () => {
    expect(Array.isArray(FLOW_MODELS)).toBe(true)
    expect(FLOW_MODELS.length).toBeGreaterThan(0)
  })

  it('all entries have a non-empty string id', () => {
    for (const m of FLOW_MODELS) {
      expect(typeof m.id).toBe('string')
      expect(m.id.length).toBeGreaterThan(0)
    }
  })

  it('all entries have a non-empty string label', () => {
    for (const m of FLOW_MODELS) {
      expect(typeof m.label).toBe('string')
      expect(m.label.length).toBeGreaterThan(0)
    }
  })

  it('all entries have a methods array', () => {
    for (const m of FLOW_MODELS) {
      expect(Array.isArray(m.methods)).toBe(true)
      expect(m.methods.length).toBeGreaterThan(0)
    }
  })

  it('all entries have a kind of image|video (명시적 분류 — /image/ 술어 대신)', () => {
    for (const m of FLOW_MODELS) {
      expect(['image', 'video']).toContain(m.kind)
    }
  })
})

describe('FLOW_STATIC_MODELS (kind 로 split — 정적 Flow 목록)', () => {
  it('imageModels 비어있지 않고 전부 kind=image', () => {
    const { imageModels } = FLOW_STATIC_MODELS
    expect(Array.isArray(imageModels)).toBe(true)
    expect(imageModels.length).toBeGreaterThan(0)
    for (const m of imageModels) expect(m.kind).toBe('image')
  })

  it('videoModels 비어있지 않고 전부 kind=video', () => {
    const { videoModels } = FLOW_STATIC_MODELS
    expect(Array.isArray(videoModels)).toBe(true)
    expect(videoModels.length).toBeGreaterThan(0)
    for (const m of videoModels) expect(m.kind).toBe('video')
  })

  it('이미지 id 는 Flow 패널 표시 이름 (applyAgentDefaults setModel 매칭용 — Nano Banana 포함)', () => {
    const ids = FLOW_STATIC_MODELS.imageModels.map(m => m.id)
    expect(ids).toContain('Nano Banana 2')
    expect(ids).toContain('Nano Banana Pro')
    // /image/ 같은 enum 술어에 안 의존 (표시 이름이라 'image' 가 없다)
    expect(ids.some(id => /image/i.test(id))).toBe(false)
  })

  it('비디오 id 는 내부 enum 유지 (i2v 주입/해상도 제약과 정합)', () => {
    const ids = FLOW_STATIC_MODELS.videoModels.map(m => m.id)
    for (const id of ids) {
      const isVeoEnum = /^veo_/.test(id)
      const hasMethod = FLOW_MODELS.find(r => r.id === id)?.methods?.includes('predictLongRunning')
      expect(isVeoEnum || hasMethod).toBe(true)
    }
  })

  it('모든 모델에 비어있지 않은 label', () => {
    const all = [...FLOW_STATIC_MODELS.imageModels, ...FLOW_STATIC_MODELS.videoModels]
    for (const m of all) {
      expect(typeof m.label).toBe('string')
      expect(m.label.length).toBeGreaterThan(0)
    }
  })
})
