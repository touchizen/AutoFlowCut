/**
 * resetGeneratingItem — 로드/복원 시 중단된 'generating' 상태 정규화.
 * 회귀 가드: scene.videoT2VStatus/videoI2VStatus 가 generating 으로 남으면 재로드 후
 * 타임라인이 멀쩡한 기존 비디오를 영구히 빈칸+shimmer 로 숨긴다(데이터는 있는데 복귀 안 됨).
 */
import { describe, it, expect } from 'vitest'
import { resetGeneratingItem } from '../../src/hooks/useProjectData'

describe('resetGeneratingItem', () => {
  it('status=generating → pending + generatingStartedAt 비움', () => {
    expect(resetGeneratingItem({ status: 'generating', generatingStartedAt: 123 }))
      .toEqual({ status: 'pending', generatingStartedAt: undefined })
  })

  it('videoT2VStatus=generating → pending, videoT2VPath 데이터는 보존(복귀)', () => {
    const out = resetGeneratingItem({ videoT2VStatus: 'generating', videoT2VPath: '/t.mp4', videoT2VGeneratingStartedAt: 5 })
    expect(out.videoT2VStatus).toBe('pending')
    expect(out.videoT2VGeneratingStartedAt).toBe(undefined)
    expect(out.videoT2VPath).toBe('/t.mp4')
  })

  it('videoI2VStatus=generating → pending, videoI2VPath 보존(복귀)', () => {
    const out = resetGeneratingItem({ videoI2VStatus: 'generating', videoI2VPath: '/i.mp4' })
    expect(out.videoI2VStatus).toBe('pending')
    expect(out.videoI2VPath).toBe('/i.mp4')
  })

  it('세 status 동시 generating 도 모두 정규화', () => {
    const out = resetGeneratingItem({ status: 'generating', videoT2VStatus: 'generating', videoI2VStatus: 'generating' })
    expect(out.status).toBe('pending')
    expect(out.videoT2VStatus).toBe('pending')
    expect(out.videoI2VStatus).toBe('pending')
  })

  it('generating 아니면 동일 참조 반환(불필요한 복제 없음)', () => {
    const item = { status: 'done', videoT2VStatus: 'complete', videoI2VPath: '/i.mp4' }
    expect(resetGeneratingItem(item)).toBe(item)
  })

  it('null/undefined 안전', () => {
    expect(resetGeneratingItem(null)).toBe(null)
    expect(resetGeneratingItem(undefined)).toBe(undefined)
  })
})
