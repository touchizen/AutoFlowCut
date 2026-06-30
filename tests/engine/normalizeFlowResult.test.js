/**
 * TDD: Write failing tests first for normalizeFlowResult.js (Task 2 — M4)
 *
 * Tests assert:
 *   - normalizeFlowImageResult: image data-URL → `image` field, mediaId, model passthrough
 *   - normalizeFlowVideoStatus: status → videoUrl, mediaId, model, status
 *   - normalizeFlowVideoResult: base64 download → video field (video-patch shape)
 *   - Missing / failed inputs → safe nulls, no throw
 */

import { describe, it, expect } from 'vitest'
import {
  normalizeFlowImageResult,
  normalizeFlowVideoStatus,
  normalizeFlowVideoResult,
} from '../../src/engine/normalizeFlowResult.js'

// ── normalizeFlowImageResult ──────────────────────────────────────────────────

describe('normalizeFlowImageResult', () => {
  const DATA_URL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='
  const MODEL = 'flow-imagen-v3'

  it('maps images[0].base64 to image field (the canonical scene.image key)', () => {
    const collectResult = { success: true, images: [{ base64: DATA_URL, mediaId: 'mid-001' }] }
    const result = normalizeFlowImageResult(collectResult, { model: MODEL })
    expect(result.image).toBe(DATA_URL)
  })

  it('maps images[0].mediaId to mediaId field', () => {
    const collectResult = { success: true, images: [{ base64: DATA_URL, mediaId: 'mid-001' }] }
    const result = normalizeFlowImageResult(collectResult, { model: MODEL })
    expect(result.mediaId).toBe('mid-001')
  })

  it('passes model through unchanged', () => {
    const collectResult = { success: true, images: [{ base64: DATA_URL, mediaId: 'mid-001' }] }
    const result = normalizeFlowImageResult(collectResult, { model: MODEL })
    expect(result.model).toBe(MODEL)
  })

  it('returns safe shape when success=false', () => {
    const collectResult = { success: false, images: [] }
    const result = normalizeFlowImageResult(collectResult, { model: MODEL })
    expect(result.image).toBeNull()
    expect(result.mediaId).toBeNull()
    expect(result.model).toBe(MODEL)
  })

  it('returns safe shape when images array is empty', () => {
    const collectResult = { success: true, images: [] }
    const result = normalizeFlowImageResult(collectResult, { model: MODEL })
    expect(result.image).toBeNull()
    expect(result.mediaId).toBeNull()
  })

  it('returns safe shape when collectResult is null — does not throw', () => {
    expect(() => normalizeFlowImageResult(null, { model: MODEL })).not.toThrow()
    const result = normalizeFlowImageResult(null, { model: MODEL })
    expect(result.image).toBeNull()
    expect(result.mediaId).toBeNull()
    expect(result.model).toBe(MODEL)
  })

  it('returns safe shape when collectResult is missing images key', () => {
    expect(() => normalizeFlowImageResult({ success: true }, { model: MODEL })).not.toThrow()
    const result = normalizeFlowImageResult({ success: true }, { model: MODEL })
    expect(result.image).toBeNull()
    expect(result.mediaId).toBeNull()
  })

  it('uses model from opts even when model is undefined (passes undefined through)', () => {
    const collectResult = { success: true, images: [{ base64: DATA_URL, mediaId: 'mid-002' }] }
    const result = normalizeFlowImageResult(collectResult, {})
    expect(result.model).toBeUndefined()
  })
})

// ── normalizeFlowVideoStatus ──────────────────────────────────────────────────

describe('normalizeFlowVideoStatus', () => {
  const MODEL = 'flow-veo-3'

  it('maps status.videoUrl to videoUrl field', () => {
    const status = { generationId: 'gen-1', status: 'complete', videoUrl: 'https://cdn.flow.ai/vid.mp4', mediaId: 'vid-mid-1' }
    const result = normalizeFlowVideoStatus(status, { model: MODEL })
    expect(result.videoUrl).toBe('https://cdn.flow.ai/vid.mp4')
  })

  it('maps status.mediaId to mediaId field', () => {
    const status = { generationId: 'gen-1', status: 'complete', videoUrl: 'https://cdn.flow.ai/vid.mp4', mediaId: 'vid-mid-1' }
    const result = normalizeFlowVideoStatus(status, { model: MODEL })
    expect(result.mediaId).toBe('vid-mid-1')
  })

  it('maps status.status to status field', () => {
    const status = { generationId: 'gen-1', status: 'complete', videoUrl: 'https://cdn.flow.ai/vid.mp4', mediaId: 'vid-mid-1' }
    const result = normalizeFlowVideoStatus(status, { model: MODEL })
    expect(result.status).toBe('complete')
  })

  it('passes model through unchanged', () => {
    const status = { generationId: 'gen-1', status: 'complete', videoUrl: 'https://cdn.flow.ai/vid.mp4', mediaId: 'vid-mid-1' }
    const result = normalizeFlowVideoStatus(status, { model: MODEL })
    expect(result.model).toBe(MODEL)
  })

  it('handles pending status (no videoUrl yet) safely', () => {
    const status = { generationId: 'gen-1', status: 'pending', videoUrl: null, mediaId: null }
    const result = normalizeFlowVideoStatus(status, { model: MODEL })
    expect(result.status).toBe('pending')
    expect(result.videoUrl).toBeNull()
    expect(result.mediaId).toBeNull()
    expect(result.model).toBe(MODEL)
  })

  it('handles failed status safely', () => {
    const status = { generationId: 'gen-1', status: 'failed', videoUrl: null, mediaId: null, error: 'quota exceeded' }
    const result = normalizeFlowVideoStatus(status, { model: MODEL })
    expect(result.status).toBe('failed')
    expect(result.videoUrl).toBeNull()
    expect(result.mediaId).toBeNull()
  })

  it('returns safe shape when status is null — does not throw', () => {
    expect(() => normalizeFlowVideoStatus(null, { model: MODEL })).not.toThrow()
    const result = normalizeFlowVideoStatus(null, { model: MODEL })
    expect(result.videoUrl).toBeNull()
    expect(result.mediaId).toBeNull()
    expect(result.status).toBeNull()
    expect(result.model).toBe(MODEL)
  })

  it('returns safe shape when status object is missing fields', () => {
    expect(() => normalizeFlowVideoStatus({}, { model: MODEL })).not.toThrow()
    const result = normalizeFlowVideoStatus({}, { model: MODEL })
    expect(result.videoUrl).toBeUndefined()
    expect(result.model).toBe(MODEL)
  })
})

// ── normalizeFlowVideoResult ──────────────────────────────────────────────────

describe('normalizeFlowVideoResult', () => {
  const MODEL = 'flow-veo-3'
  const BASE64 = 'data:video/mp4;base64,AAAAIGZ0eXBpc29t'

  it('maps base64 to video field (canonical patch shape for videoScenes[].video)', () => {
    const downloadResult = { success: true, base64: BASE64 }
    const result = normalizeFlowVideoResult(downloadResult, { model: MODEL })
    expect(result.video).toBe(BASE64)
  })

  it('passes model through unchanged', () => {
    const downloadResult = { success: true, base64: BASE64 }
    const result = normalizeFlowVideoResult(downloadResult, { model: MODEL })
    expect(result.model).toBe(MODEL)
  })

  it('returns null video when success=false', () => {
    const downloadResult = { success: false }
    const result = normalizeFlowVideoResult(downloadResult, { model: MODEL })
    expect(result.video).toBeNull()
    expect(result.model).toBe(MODEL)
  })

  it('returns null video when base64 is missing', () => {
    const downloadResult = { success: true }
    const result = normalizeFlowVideoResult(downloadResult, { model: MODEL })
    expect(result.video).toBeNull()
  })

  it('returns safe shape when downloadResult is null — does not throw', () => {
    expect(() => normalizeFlowVideoResult(null, { model: MODEL })).not.toThrow()
    const result = normalizeFlowVideoResult(null, { model: MODEL })
    expect(result.video).toBeNull()
    expect(result.model).toBe(MODEL)
  })
})
