import { describe, it, expect } from 'vitest'
import { VIDEO_MODELS } from '../../src/config/genModels.js'
import { FLOW_MODELS } from '../../src/engine/flowModels.js'

// FLOW_MODELS(표시이름 카탈로그)와 VIDEO_MODELS(API 카탈로그)는 같은 Veo 패밀리 해상도 제약을
// 공유해야 한다 — coerceResolution 이 두 카탈로그를 모두 참조하므로, 한쪽만 바뀌면 같은 패밀리가
// 모드에 따라 다르게 강등된다. 공유 상수로 dedup 했고 이 테스트가 드리프트를 고정한다.
describe('Veo family allowedResolutions parity (FLOW_MODELS ↔ VIDEO_MODELS)', () => {
  const families = [
    { flow: 'Veo 3.1 - Lite', api: 'veo-3.1-lite-generate-preview' },
    { flow: 'Veo 3.1 - Fast', api: 'veo-3.1-fast-generate-preview' },
    { flow: 'Veo 3.1 - Quality', api: 'veo-3.1-generate-preview' },
  ]
  for (const fam of families) {
    it(`${fam.flow} 와 ${fam.api} 의 allowedResolutions 가 동일`, () => {
      const flow = FLOW_MODELS.find((m) => m.id === fam.flow)
      const api = VIDEO_MODELS.find((m) => m.id === fam.api)
      expect(flow).toBeTruthy()
      expect(api).toBeTruthy()
      expect(flow.allowedResolutions).toEqual(api.allowedResolutions)
    })
  }
})
