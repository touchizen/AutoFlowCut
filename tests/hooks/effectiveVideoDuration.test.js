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
    it('Flow Veo 는 8 고정 — 새 Flow(flow.google.com) 의 Veo 패널엔 길이 선택이 없다(2026-09-25 실측, Veo 3.1 - Fast)', () => {
      expect(effectiveVideoDuration({ targetDuration: 3 }, 't2v', 8, '720p', 'Veo 3.1 - Fast', 'flow')).toBe(8)
      expect(effectiveVideoDuration({ targetDuration: 6 }, 't2v', 8, '720p', 'Veo 3.1 - Fast', 'flow')).toBe(8)
      expect(effectiveVideoDuration({ targetDuration: 3 }, 't2v', 8, '720p', 'veo-3.1-fast-generate-preview', 'flow')).toBe(8)
      // Omni Flash 는 그대로 스냅
      expect(effectiveVideoDuration({ targetDuration: 6 }, 't2v', 8, '720p', 'Omni Flash', 'flow')).toBe(6)
    })
    // M2-LIVE N9(A9/B9): Flow Veo 8초 스냅은 t2v 이고 **Veo … Fast**(관측된 유일한 패널 — 길이 그룹 없음)일 때만. i2v(Flow 는 지금 미지원이지만 옛 i2v 경로·저장 메타의 계약)와
    //   Lite/Quality(패널 모양 미관측 — 길이 그룹이 있으면 드라이버가 4·6초를 누르고, 없으면 드라이버 가드가 클릭 전에 거부한다)는 그리드 스냅 그대로.
    it('Flow Veo Fast i2v 는 8 고정이 아니라 그리드 스냅 (M2-LIVE N9)', () => {
      expect(effectiveVideoDuration({ targetDuration: 3 }, 'i2v', 8, '720p', 'Veo 3.1 - Fast', 'flow')).toBe(4)
      expect(effectiveVideoDuration({ targetDuration: 6 }, 'i2v', 8, '720p', 'veo-3.1-fast-generate-preview', 'flow')).toBe(6)
    })
    it('Flow Veo Lite/Quality t2v 는 그리드 스냅 — Fast 만 8 고정 (M2-LIVE N9)', () => {
      expect(effectiveVideoDuration({ targetDuration: 3 }, 't2v', 8, '720p', 'Veo 3.1 - Lite', 'flow')).toBe(4)
      expect(effectiveVideoDuration({ targetDuration: 6 }, 't2v', 8, '720p', 'Veo 3.1 - Quality', 'flow')).toBe(6)
      expect(effectiveVideoDuration({ targetDuration: 3 }, 't2v', 8, '720p', 'veo-3.1-generate-preview', 'flow')).toBe(4)
      expect(effectiveVideoDuration({ targetDuration: 3 }, 't2v', 8, '720p', 'Veo 3.1 - Fast', 'flow')).toBe(8)
    })
    it('referenceImages 가 있어도 Flow 모드는 스냅(refs→8 미적용)', () => {
      expect(effectiveVideoDuration({ targetDuration: 3, referenceImages: [{ name: 'h' }] }, 't2v', 8, '1080p', 'Omni Flash', 'flow')).toBe(4)
    })
  })
})
