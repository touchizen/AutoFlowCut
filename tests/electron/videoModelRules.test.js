import { describe, it, expect } from 'vitest'
import { isOmniFlashModel } from '../../electron/video-model-rules.js'
import { isOmniFlashModel as rendererIsOmniFlash } from '../../src/utils/videoModels.js'

describe('video-model-rules isOmniFlashModel (electron 공유 규칙)', () => {
  it('표시이름/내부 abra_* 감지, Veo/빈값은 false', () => {
    expect(isOmniFlashModel('Omni Flash')).toBe(true)
    expect(isOmniFlashModel('omniflash')).toBe(true)
    expect(isOmniFlashModel('gemini-omni-flash')).toBe(true)
    expect(isOmniFlashModel('abra_t2v_8s')).toBe(true)
    expect(isOmniFlashModel('abra_i2v_8s')).toBe(true)
    expect(isOmniFlashModel('Veo 3.1 - Fast')).toBe(false)
    expect(isOmniFlashModel('veo_3_1_t2v')).toBe(false)
    expect(isOmniFlashModel('')).toBe(false)
    expect(isOmniFlashModel(null)).toBe(false)
    expect(isOmniFlashModel(undefined)).toBe(false)
  })

  it('renderer(src/utils/videoModels)와 동일 판정 — 두 복사본 드리프트 방지 parity', () => {
    const fixtures = [
      'Omni Flash', 'omniflash', 'gemini-omni-flash', 'abra_t2v_8s', 'abra_i2v_8s',
      'Veo 3.1 - Fast', 'veo_3_1_t2v', 'veo-3.1-fast-generate-preview', '', null, undefined,
    ]
    for (const f of fixtures) {
      expect(isOmniFlashModel(f)).toBe(rendererIsOmniFlash(f))
    }
  })
})
