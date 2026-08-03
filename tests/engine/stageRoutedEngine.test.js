import { describe, expect, it, vi } from 'vitest'
import * as generationEngine from '../../src/engine/useGenerationEngine.js'

function member(label) {
  return {
    label,
    cancelsActiveOnStop: label === 'chatgpt',
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
  it('routes text-only image generation to ChatGPT with flow+flow as the untouched positive control', async () => {
    if (!expectRouter()) return
    const api = member('api')
    const flow = member('flow')
    const chatgpt = member('chatgpt')

    const routed = generationEngine.createStageRoutedEngine(
      { mode: 'flow', sessionTarget: 'chatgpt' },
      { api, flow, chatgpt },
    )
    await expect(routed.submitGeneration('measured text prompt', [], { batchCount: 1 }))
      .resolves.toBe('chatgpt')
    expect(chatgpt.submitGeneration).toHaveBeenCalledOnce()
    expect(flow.submitGeneration).not.toHaveBeenCalled()

    const control = generationEngine.createStageRoutedEngine(
      { mode: 'flow', sessionTarget: 'flow' },
      { api, flow, chatgpt },
    )
    await expect(control.submitGeneration('same prompt', [], { batchCount: 1 })).resolves.toBe('flow')
    expect(flow.submitGeneration).toHaveBeenCalledOnce()
  })

  it('routes video on flow+chatgpt to the API provider, never ChatGPT', async () => {
    if (!expectRouter()) return
    const api = member('api')
    const flow = member('flow')
    const chatgpt = member('chatgpt')
    const routed = generationEngine.createStageRoutedEngine(
      { mode: 'flow', sessionTarget: 'chatgpt' },
      { api, flow, chatgpt },
    )

    await expect(routed.generateVideoT2V('video prompt')).resolves.toBe('api')
    await expect(routed.generateVideoI2V('motion prompt')).resolves.toBe('api')
    expect(api.generateVideoT2V).toHaveBeenCalledOnce()
    expect(api.generateVideoI2V).toHaveBeenCalledOnce()
    expect(chatgpt.generateVideoT2V).not.toHaveBeenCalled()
    expect(chatgpt.generateVideoI2V).not.toHaveBeenCalled()

    await expect(routed.generateImage('image positive control', [])).resolves.toBe('chatgpt')
    expect(chatgpt.generateImage).toHaveBeenCalledOnce()
  })

  it('routes active-image cancellation to ChatGPT while flow+flow remains on the Flow no-op port', async () => {
    if (!expectRouter()) return
    const api = member('api')
    const flow = member('flow')
    const chatgpt = member('chatgpt')
    const routed = generationEngine.createStageRoutedEngine(
      { mode: 'flow', sessionTarget: 'chatgpt' },
      { api, flow, chatgpt },
    )

    await expect(routed.setStopRequested(true)).resolves.toBe('chatgpt')
    expect(chatgpt.setStopRequested).toHaveBeenCalledWith(true)
    expect(api.setStopRequested).not.toHaveBeenCalled()
    expect(flow.setStopRequested).not.toHaveBeenCalled()
    expect(routed.cancelsActiveOnStop).toBe(true)

    const control = generationEngine.createStageRoutedEngine(
      { mode: 'flow', sessionTarget: 'flow' },
      { api, flow, chatgpt },
    )
    await expect(control.setStopRequested(true)).resolves.toBe('flow')
    expect(flow.setStopRequested).toHaveBeenCalledWith(true)
    expect(control.cancelsActiveOnStop).toBe(false)
  })
})
