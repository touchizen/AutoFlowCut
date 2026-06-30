import { describe, it, expect } from 'vitest'
import { createEngineApi } from '../../src/engine/engineApi'
import { assertEngineContract, ENGINE_METHODS } from './engineContract'

// useGenAPI 반환 surface를 모사한 fake (안정 fn 참조).
function makeFakeGenAPI(accessToken = 'byok') {
  const fns = {}
  for (const name of ENGINE_METHODS) fns[name] = () => name
  return { accessToken, projectId: null, ...fns }
}

describe('engineApi (identity wrapper over useGenAPI)', () => {
  it('satisfies the engine contract', () => {
    assertEngineContract(createEngineApi(makeFakeGenAPI()))
  })

  it('delegates non-wrapped methods to the underlying genAPI by reference (identity)', () => {
    // M4 T7: generateImage, submitGeneration, uploadReference are wrappers (not identity refs).
    // All other methods remain identity delegations.
    const WRAPPED = new Set(['generateImage', 'submitGeneration', 'uploadReference'])
    const genAPI = makeFakeGenAPI()
    const engine = createEngineApi(genAPI)
    for (const name of ENGINE_METHODS) {
      if (WRAPPED.has(name)) continue
      expect(engine[name], `engine.${name} should be the same ref as genAPI.${name}`).toBe(genAPI[name])
    }
  })

  it('passes through value fields (accessToken, projectId)', () => {
    const engine = createEngineApi(makeFakeGenAPI('byok'))
    expect(engine.accessToken).toBe('byok')
    expect(engine.projectId).toBe(null)
  })
})
