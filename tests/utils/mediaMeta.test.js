/**
 * mediaMeta — 순수 유틸 함수 단위 테스트
 *
 * 검증:
 *   - parseModelLabel: 다양한 모델 식별자 패턴 정확히 분리
 *   - estimateBase64FileSize: byte → human readable 변환
 *   - fetchLatestHistoryMeta: history JSON 에서 seed/timestamp/model 백필
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// fileSystemAPI 모킹 — fetchLatestHistoryMeta 가 사용 (metadata-only IPC)
const mockGetHistory = vi.fn()
const mockReadHistoryMetadata = vi.fn()

vi.mock('../../src/hooks/useFileSystem', () => ({
  fileSystemAPI: {
    getHistory: (...args) => mockGetHistory(...args),
    readHistoryMetadata: (...args) => mockReadHistoryMetadata(...args)
  }
}))

import {
  parseModelLabel,
  estimateBase64FileSize,
  fetchLatestHistoryMeta
} from '../../src/utils/mediaMeta'

describe('parseModelLabel', () => {
  it('null/undefined/빈 문자열 → null', () => {
    expect(parseModelLabel(null)).toBeNull()
    expect(parseModelLabel(undefined)).toBeNull()
    expect(parseModelLabel('')).toBeNull()
    expect(parseModelLabel('   ')).toBeNull()
    expect(parseModelLabel(123)).toBeNull()
    expect(parseModelLabel({})).toBeNull()
  })

  it('"flow" → name:"flow", version:null (Whisk 이미지 엔진)', () => {
    expect(parseModelLabel('flow')).toEqual({ name: 'flow', version: null })
  })

  it('veo_3_1_t2v_* 형식 → name + version 분리', () => {
    expect(parseModelLabel('veo_3_1_t2v_fast_ultra_relaxed'))
      .toEqual({ name: 'veo / t2v fast ultra relaxed', version: '3.1' })

    expect(parseModelLabel('veo-3-1-i2v'))
      .toEqual({ name: 'veo / i2v', version: '3.1' })

    expect(parseModelLabel('veo_2'))
      .toEqual({ name: 'veo', version: '2' })
  })

  it('kling-v1.6-pro 형식 → name + version 분리', () => {
    expect(parseModelLabel('kling-v1.6-pro'))
      .toEqual({ name: 'kling pro', version: '1.6' })

    expect(parseModelLabel('kling_v1.5'))
      .toEqual({ name: 'kling', version: '1.5' })
  })

  it('generic name-v1.0 형식 → name + version 분리', () => {
    expect(parseModelLabel('sora-v2.0'))
      .toEqual({ name: 'sora', version: '2.0' })

    expect(parseModelLabel('runway_v3'))
      .toEqual({ name: 'runway', version: '3' })
  })

  it('패턴 매칭 실패 시 (끝에 숫자 없음) 원본 그대로 name + version null', () => {
    // generic 패턴은 끝에 숫자 시퀀스 요구 — 'unknown-model-name' 은 'name' 이 숫자 아니라 매칭 실패.
    expect(parseModelLabel('unknown-model-name'))
      .toEqual({ name: 'unknown-model-name', version: null })

    expect(parseModelLabel('mystery'))
      .toEqual({ name: 'mystery', version: null })

    expect(parseModelLabel('weird name with spaces'))
      .toEqual({ name: 'weird name with spaces', version: null })
  })
})

describe('estimateBase64FileSize', () => {
  it('null/undefined → null', () => {
    expect(estimateBase64FileSize(null)).toBeNull()
    expect(estimateBase64FileSize(undefined)).toBeNull()
    expect(estimateBase64FileSize('')).toBeNull()
    expect(estimateBase64FileSize(0)).toBeNull()
  })

  it('1KB 미만 → "N B"', () => {
    // 100 chars → ~75 bytes
    expect(estimateBase64FileSize('a'.repeat(100))).toMatch(/^\d+ B$/)
  })

  it('1KB ~ 1MB → "N KB"', () => {
    // 10KB 정도
    const result = estimateBase64FileSize('a'.repeat(10240))
    expect(result).toMatch(/^\d+ KB$/)
  })

  it('1MB 이상 → "N.N MB"', () => {
    // ~2MB
    const result = estimateBase64FileSize('a'.repeat(3 * 1024 * 1024))
    expect(result).toMatch(/^\d+\.\d MB$/)
  })

  it('data URL prefix 자동 제거', () => {
    const withPrefix = 'data:image/png;base64,' + 'a'.repeat(10240)
    const withoutPrefix = 'a'.repeat(10240)
    expect(estimateBase64FileSize(withPrefix)).toBe(estimateBase64FileSize(withoutPrefix))
  })
})

describe('fetchLatestHistoryMeta', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('인자 누락 시 빈 객체 반환', async () => {
    expect(await fetchLatestHistoryMeta(null, 'scenes', 'scene_1')).toEqual({})
    expect(await fetchLatestHistoryMeta('proj', null, 'scene_1')).toEqual({})
    expect(await fetchLatestHistoryMeta('proj', 'scenes', null)).toEqual({})
  })

  it('getHistory 실패 시 빈 객체', async () => {
    mockGetHistory.mockResolvedValue({ success: false })
    expect(await fetchLatestHistoryMeta('proj', 'scenes', 'scene_1')).toEqual({})
  })

  it('history 비어있으면 빈 객체', async () => {
    mockGetHistory.mockResolvedValue({ success: true, histories: [] })
    expect(await fetchLatestHistoryMeta('proj', 'scenes', 'scene_1')).toEqual({})
  })

  it('첫 metadata 의 seed/timestamp/model 반환', async () => {
    mockGetHistory.mockResolvedValue({
      success: true,
      histories: [{ filename: 'scene_1_20260101_flow.png' }]
    })
    mockReadHistoryMetadata.mockResolvedValue({
      success: true,
      metadata: { seed: 12345, timestamp: 1700000000000, model: 'flow', prompt: 'foo' }
    })
    const result = await fetchLatestHistoryMeta('proj', 'scenes', 'scene_1')
    expect(result).toEqual({
      seed: 12345,
      generatedAt: 1700000000000,
      model: 'flow'
    })
  })

  it('metadata 일부 필드 누락 시 null 로 채움', async () => {
    mockGetHistory.mockResolvedValue({
      success: true,
      histories: [{ filename: 'scene_1.png' }]
    })
    mockReadHistoryMetadata.mockResolvedValue({
      success: true,
      metadata: { timestamp: 1700000000000 }  // seed/model 없음
    })
    const result = await fetchLatestHistoryMeta('proj', 'scenes', 'scene_1')
    expect(result.seed).toBeNull()
    expect(result.generatedAt).toBe(1700000000000)
    expect(result.model).toBeNull()
  })

  it('첫 entry 에 메타가 없으면 다음 entry 시도', async () => {
    mockGetHistory.mockResolvedValue({
      success: true,
      histories: [
        { filename: 'a.png' },
        { filename: 'b.png' }
      ]
    })
    mockReadHistoryMetadata
      .mockResolvedValueOnce({ success: true, metadata: null })  // 첫번째: 메타 없음
      .mockResolvedValueOnce({  // 두번째: 메타 있음
        success: true,
        metadata: { seed: 999, timestamp: 1234567890 }
      })

    const result = await fetchLatestHistoryMeta('proj', 'scenes', 'x')
    expect(result.seed).toBe(999)
  })

  it('readHistoryFile throw 시 빈 객체로 안전 폴백 (앱 안 깨짐)', async () => {
    mockGetHistory.mockResolvedValue({
      success: true,
      histories: [{ filename: 'a.png' }]
    })
    mockReadHistoryMetadata.mockRejectedValue(new Error('disk error'))

    const result = await fetchLatestHistoryMeta('proj', 'scenes', 'x')
    expect(result).toEqual({})
  })
})
