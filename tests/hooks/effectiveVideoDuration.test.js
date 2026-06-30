import { describe, it, expect } from 'vitest'
import { effectiveVideoDuration } from '../../src/hooks/useVideoAutomation'

// 1080p/4k → 8 고정과 referenceImages → 8 고정은 공식 Veo API(api 모드) 제약이다.
// Flow 모드는 Flow 백엔드가 길이를 처리하므로(OmniFlash 는 Flow 전용 + {4,6,8,10}, Flow Veo 도 씬
// 길이 반영) 해상도/refs 와 무관하게 항상 모델 그리드로 스냅한다. t2v·i2v 둘 다 동일.
// (라이브 회귀: Flow OmniFlash 1080p t2v 에서 씬 3초가 8초로 나옴 — 길이 최적화 미적용.)
describe('effectiveVideoDuration — api/flow 모드 분리', () => {
  describe('api 모드 (공식 Veo 제약 적용)', () => {
    it('1080p/4k 는 씬 길이 짧아도 8 고정', () => {
      expect(effectiveVideoDuration({ targetDuration: 3 }, 't2v', 8, '1080p', 'veo-3.1-fast-generate-preview', 'api')).toBe(8)
      expect(effectiveVideoDuration({ targetDuration: 4 }, 'i2v', 8, '4k', 'veo-3.1-generate-preview', 'api')).toBe(8)
    })
    it('t2v + referenceImages 는 8 고정', () => {
      expect(effectiveVideoDuration({ targetDuration: 3, referenceImages: [{ name: 'h' }] }, 't2v', 8, '720p', 'veo-3.1-fast-generate-preview', 'api')).toBe(8)
    })
    it('720p 는 씬 길이 {4,6,8} 스냅', () => {
      expect(effectiveVideoDuration({ targetDuration: 5 }, 't2v', 8, '720p', 'veo-3.1-fast-generate-preview', 'api')).toBe(6)
    })
  })

  describe('flow 모드 (API 제약 미적용, 항상 모델 그리드 스냅)', () => {
    it('OmniFlash 1080p t2v 는 씬 길이를 {4,6,8,10} 으로 스냅', () => {
      expect(effectiveVideoDuration({ targetDuration: 3 }, 't2v', 8, '1080p', 'Omni Flash', 'flow')).toBe(4)
      expect(effectiveVideoDuration({ targetDuration: 7 }, 't2v', 8, '1080p', 'Omni Flash', 'flow')).toBe(8)
      expect(effectiveVideoDuration({ targetDuration: 9 }, 't2v', 8, '1080p', 'Omni Flash', 'flow')).toBe(10)
    })
    it('OmniFlash 1080p i2v 도 동일하게 스냅', () => {
      expect(effectiveVideoDuration({ targetDuration: 3 }, 'i2v', 8, '1080p', 'Omni Flash', 'flow')).toBe(4)
    })
    it('Flow Veo 1080p 도 8 고정 없이 {4,6,8} 스냅', () => {
      expect(effectiveVideoDuration({ targetDuration: 3 }, 't2v', 8, '1080p', 'Veo 3.1 - Fast', 'flow')).toBe(4)
    })
    it('referenceImages 가 있어도 Flow 모드는 스냅(refs→8 미적용)', () => {
      expect(effectiveVideoDuration({ targetDuration: 3, referenceImages: [{ name: 'h' }] }, 't2v', 8, '1080p', 'Omni Flash', 'flow')).toBe(4)
    })
  })
})
