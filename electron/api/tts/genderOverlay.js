import { voiceKey } from '../../../src/utils/voiceKey.js'

// 순수: 어댑터 voice 배열에 app-global 성별 캐시를 병합. 확정(adapter/seed)은 불변.
export function applyGenderOverlay(provider, voices, cache = {}) {
  return (voices || []).map((v) => {
    if (v.genderSource === 'adapter' || v.genderSource === 'seed') return v // 확정 불변
    const hit = cache[voiceKey(provider, v.id)]
    if (!hit || !hit.gender) return v
    return {
      ...v,
      gender: hit.gender,
      genderSource: hit.source, // 'manual' | 'f0'
      f0: hit.f0 ?? null,
      confidence: hit.confidence ?? null,
    }
  })
}
