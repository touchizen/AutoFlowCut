import { describe, expect, it, vi } from 'vitest'
import * as generationEngine from '../../src/engine/useGenerationEngine.js'

function member(label) {
  return {
    label,
    generateImage: vi.fn(async () => label),
    submitGeneration: vi.fn(async () => label),
    checkGeneration: vi.fn(async () => label),
    collectGeneration: vi.fn(async () => label),
    clearGenerations: vi.fn(async () => label),
    generateVideoT2V: vi.fn(async () => label),
    generateVideoI2V: vi.fn(async () => label),
    checkVideoStatus: vi.fn(async () => label),
    downloadVideo: vi.fn(async () => label),
    setStopRequested: vi.fn(async () => label),
  }
}

function expectRouter() {
  expect(typeof generationEngine.createStageRoutedEngine).toBe('function')
  return typeof generationEngine.createStageRoutedEngine === 'function'
}

describe('stage-routed generation engine', () => {
  it('routes every stage to Flow on the flow route', async () => {
    if (!expectRouter()) return
    const api = member('api')
    const flow = member('flow')

    const routed = generationEngine.createStageRoutedEngine(
      { mode: 'flow', sessionTarget: 'flow' },
      { api, flow },
    )
    await expect(routed.submitGeneration('a scene prompt', [])).resolves.toBe('flow')
    await expect(routed.generateVideoT2V('a motion prompt')).resolves.toBe('flow')
    expect(flow.submitGeneration).toHaveBeenCalledOnce()
    expect(flow.generateVideoT2V).toHaveBeenCalledOnce()
    expect(api.submitGeneration).not.toHaveBeenCalled()
    expect(api.generateVideoT2V).not.toHaveBeenCalled()
  })

  it('routes every stage to the API member on the api route', async () => {
    if (!expectRouter()) return
    const api = member('api')
    const flow = member('flow')
    const routed = generationEngine.createStageRoutedEngine(
      { mode: 'api', sessionTarget: 'flow' },
      { api, flow },
    )
    await expect(routed.generateImage('image prompt', [])).resolves.toBe('api')
    await expect(routed.generateVideoI2V('motion prompt')).resolves.toBe('api')
    expect(flow.generateImage).not.toHaveBeenCalled()
    expect(flow.generateVideoI2V).not.toHaveBeenCalled()
  })

  it('falls back to the API member for an unparseable route', async () => {
    if (!expectRouter()) return
    const api = member('api')
    const flow = member('flow')
    const routed = generationEngine.createStageRoutedEngine(
      { mode: 'flow', sessionTarget: 'not-registered' },
      { api, flow },
    )
    await expect(routed.generateImage('image prompt', [])).resolves.toBe('api')
    expect(flow.generateImage).not.toHaveBeenCalled()
  })

  it('keeps stop routing aligned with the image stage owner', async () => {
    if (!expectRouter()) return
    const api = member('api')
    const flow = member('flow')
    const routed = generationEngine.createStageRoutedEngine(
      { mode: 'flow', sessionTarget: 'flow' },
      { api, flow },
    )
    await expect(routed.setStopRequested(true)).resolves.toBe('flow')
    expect(flow.setStopRequested).toHaveBeenCalledWith(true)
    expect(api.setStopRequested).not.toHaveBeenCalled()
  })
})
