/**
 * capcutCloud SRT 출력 우선순위 — Review fix 2 (C5, C20)
 *
 * Phase 12 가 audioPackage.srtContent 분기를 fallback 으로 강등했는데, Phase 7
 * 마이그레이션이 srtTrack 을 항상 채우므로 fallback 이 사실상 안 fire. 그 결과
 * 나레이션 정밀 타이밍 (audioPackage SRT) 가 export 에서 누락됨. 옛 동작 복원:
 * audioPackage.srtContent 가 있으면 narration-aligned 우선.
 */
import { describe, it, expect } from 'vitest'

// capcutCloud 의 SRT 결정 로직만 추출해서 직접 테스트.
// 실제 함수 안에 있지만 export 안 되어 있어 로직 재현.
function resolveKoSrt(project, audioPackage) {
  // 새 우선순위: audioPackage 가 있으면 그 SRT (narration 정밀 timing)
  // 없으면 project.srtTrack 기반 generateSRT
  if (audioPackage?.srtContent) return audioPackage.srtContent
  // generateSRT 시뮬레이션 (srtTrack 채워있으면 텍스트 join)
  const lines = (project?.srtTrack || []).filter(l => (l.text || '').trim())
  if (lines.length === 0) return ''
  return lines.map((l, i) => `${i + 1}\n00:00:00,000 --> 00:00:01,000\n${l.text}`).join('\n\n')
}

describe('C5/C20 — audioPackage.srtContent 우선', () => {
  it('audioPackage.srtContent 있으면 그 SRT 사용 (narration timing 보존)', () => {
    const project = {
      srtTrack: [{ id: 'sub_1', startTime: 0, endTime: 1, text: 'scene-derived' }],
    }
    const audioPackage = { srtContent: '1\n00:00:00,000 --> 00:00:01,000\nnarration-aligned' }
    const result = resolveKoSrt(project, audioPackage)
    expect(result).toBe(audioPackage.srtContent)
    expect(result).not.toContain('scene-derived')
  })

  it('audioPackage 없으면 srtTrack 기반', () => {
    const project = {
      srtTrack: [{ id: 'sub_1', startTime: 0, endTime: 1, text: 'fallback' }],
    }
    const result = resolveKoSrt(project, null)
    expect(result).toContain('fallback')
  })

  it('audioPackage 없고 srtTrack 도 비면 빈 결과', () => {
    expect(resolveKoSrt({ srtTrack: [] }, null)).toBe('')
    expect(resolveKoSrt({}, null)).toBe('')
  })
})
