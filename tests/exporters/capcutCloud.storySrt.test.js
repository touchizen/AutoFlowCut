/**
 * M2a-4 Codex finding 2 — story 프로젝트면 CapCut sidecar SRT 도 legacy audioPackage 를 무시.
 * exportCapcutPackageCloud 의 sidecar SRT 선택(:107)이 storyAudio 존재 시 audioPackage.srtContent
 * 를 쓰면 옛 import MP3 의 SRT 가 자막으로 새므로, 그 판단을 순수 헬퍼로 뽑아 검증한다.
 */
import { describe, it, expect } from 'vitest'
import { shouldUsePackageSrt } from '../../src/exporters/capcutCloud'

describe('shouldUsePackageSrt — story 배타', () => {
  it('storyAudio 있으면 audioPackage.srtContent 가 있어도 package SRT 를 쓰지 않는다', () => {
    expect(shouldUsePackageSrt({ audioPackage: { srtContent: 'old' }, storyAudio: { manifest: {} } })).toBe(false)
  })

  it('storyAudio 없고 srtContent 있으면 package SRT 우선(기존 동작)', () => {
    expect(shouldUsePackageSrt({ audioPackage: { srtContent: 'narration-aligned' } })).toBe(true)
  })

  it('srtContent 없으면 false', () => {
    expect(shouldUsePackageSrt({ audioPackage: {} })).toBe(false)
    expect(shouldUsePackageSrt({})).toBe(false)
  })
})
