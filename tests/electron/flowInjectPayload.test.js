import { describe, it, expect } from 'vitest'
import { buildFlowInjectPayload, flowInjectClearPayload } from '../../electron/flow-inject-payload.js'

describe('buildFlowInjectPayload', () => {
  it('top-level duration/videoModel 을 보존한다 (T2V OmniFlash 강제 누락 회귀)', () => {
    const p = buildFlowInjectPayload({ seed: 42, duration: 6, videoModel: 'Omni Flash' })
    expect(p.duration).toBe(6)
    expect(p.videoModel).toBe('Omni Flash')
    expect(p.seed).toBe(42)
  })

  it('누락 필드는 null 로 채운다', () => {
    const p = buildFlowInjectPayload({ seed: 1 })
    expect(p).toEqual({ seed: 1, aspectRatio: null, references: null, i2v: null, duration: null, videoModel: null, genTag: null })
  })

  it('인자 없이 호출해도 모든 필드 null', () => {
    expect(buildFlowInjectPayload()).toEqual({
      seed: null, aspectRatio: null, references: null, i2v: null, duration: null, videoModel: null, genTag: null,
    })
  })

  it('#R35: genTag 를 보존한다(seed 무관 correlation 태그)', () => {
    expect(buildFlowInjectPayload({ seed: 5, genTag: 'scene-async-1' }).genTag).toBe('scene-async-1')
  })
})

describe('flowInjectClearPayload', () => {
  it('arm 과 동일한 키 집합을 reset 한다 (set/clear 드리프트 가드)', () => {
    const armKeys = Object.keys(buildFlowInjectPayload({ seed: 1, duration: 8 })).sort()
    const clearKeys = Object.keys(flowInjectClearPayload()).sort()
    expect(clearKeys).toEqual(armKeys)
  })

  it('모든 필드가 null', () => {
    const p = flowInjectClearPayload()
    expect(Object.values(p).every((v) => v === null)).toBe(true)
  })
})
