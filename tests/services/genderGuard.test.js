import { describe, it, expect } from 'vitest'
import { shouldSkipStaleF0Gender } from '../../src/services/genderGuard'

// Codex 최종 리뷰 Finding 2: 미리듣기 F0 추정이 in-flight인 상태에서 사용자가 수동으로 성별을
// 지정한 뒤, 뒤늦게 도착한 stale F0 결과가 수동 지정을 덮어쓰던 race의 가드.
describe('shouldSkipStaleF0Gender', () => {
  it('source가 manual이면 항상 skip하지 않는다', () => {
    expect(shouldSkipStaleF0Gender({
      source: 'manual',
      voiceKey: 'elevenlabs:v1',
      manualGenderKeys: new Set(),
      existingGenderSource: null,
    })).toBe(false)
  })

  it('source가 f0이고 manualGenderKeys에 해당 key가 있으면 skip한다 (동기 가드)', () => {
    const manualGenderKeys = new Set(['elevenlabs:v1'])
    expect(shouldSkipStaleF0Gender({
      source: 'f0',
      voiceKey: 'elevenlabs:v1',
      manualGenderKeys,
      existingGenderSource: null, // ttsVoices state가 아직 반영 전이라도(lag) 동기 ref로 걸러짐
    })).toBe(true)
  })

  it('source가 f0이고 기존 genderSource가 manual이면 skip한다 (기존 방어선 유지)', () => {
    expect(shouldSkipStaleF0Gender({
      source: 'f0',
      voiceKey: 'elevenlabs:v1',
      manualGenderKeys: new Set(),
      existingGenderSource: 'manual',
    })).toBe(true)
  })

  it('source가 f0이고 manual 흔적이 전혀 없으면 skip하지 않는다', () => {
    expect(shouldSkipStaleF0Gender({
      source: 'f0',
      voiceKey: 'elevenlabs:v1',
      manualGenderKeys: new Set(),
      existingGenderSource: null,
    })).toBe(false)
  })

  it('다른 voiceKey의 manual 지정은 영향을 주지 않는다', () => {
    const manualGenderKeys = new Set(['elevenlabs:other'])
    expect(shouldSkipStaleF0Gender({
      source: 'f0',
      voiceKey: 'elevenlabs:v1',
      manualGenderKeys,
      existingGenderSource: null,
    })).toBe(false)
  })
})
