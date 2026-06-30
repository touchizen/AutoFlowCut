import { describe, it, expect, vi, afterEach } from 'vitest'
import { buildI2VScenePatch } from '../../src/utils/i2vScenePatch'

describe('buildI2VScenePatch — I2V owner-scene 동기화 패치', () => {
  afterEach(() => { vi.useRealTimers() })

  it('generating: status + videoI2VGeneratingStartedAt(now) 세팅, EndedAt=null', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-06-27T00:00:00Z'))
    const now = Date.now()
    const patch = buildI2VScenePatch('generating', {})
    expect(patch.videoI2VStatus).toBe('generating')
    expect(patch.videoI2VGeneratingStartedAt).toBe(now)
    expect(patch.videoI2VGeneratingEndedAt).toBe(null)
  })

  it('complete: status + videoI2VGeneratingEndedAt(now) 세팅 (타이머 정지)', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-06-27T00:01:00Z'))
    const now = Date.now()
    const patch = buildI2VScenePatch('complete', { base64: 'AAA', videoPath: '/v.mp4' })
    expect(patch.videoI2VStatus).toBe('complete')
    expect(patch.videoI2VGeneratingEndedAt).toBe(now)
    // 완료 결과도 함께 매핑
    expect(patch.videoI2V).toBe('AAA')
    expect(patch.videoI2VPath).toBe('/v.mp4')
    expect(patch.videoI2VDisabled).toBe(null)
  })

  it('error: status + videoI2VGeneratingEndedAt(now) 세팅 (타이머 정지)', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-06-27T00:02:00Z'))
    const now = Date.now()
    const patch = buildI2VScenePatch('error', {})
    expect(patch.videoI2VStatus).toBe('error')
    expect(patch.videoI2VGeneratingEndedAt).toBe(now)
    // error 는 generating 결과 필드를 건드리지 않음
    expect('videoI2V' in patch).toBe(false)
  })

  it('complete + duration/generatedAt: videoI2VDuration/videoI2VGeneratedAt 매핑', () => {
    const patch = buildI2VScenePatch('complete', { base64: 'B', duration: 6, generatedAt: 123 })
    expect(patch.videoI2VDuration).toBe(6)
    expect(patch.videoI2VGeneratedAt).toBe(123)
  })

  it('complete without base64: 비디오 결과 필드 미세팅 (status/EndedAt만)', () => {
    const patch = buildI2VScenePatch('complete', {})
    expect(patch.videoI2VStatus).toBe('complete')
    expect('videoI2V' in patch).toBe(false)
    expect(typeof patch.videoI2VGeneratingEndedAt).toBe('number')
  })
})
