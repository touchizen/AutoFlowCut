import { describe, expect, it, vi } from 'vitest'
import { createChatgptEngine } from '../../src/engine/engineChatgpt.js'

function engineHarness(deps = {}) {
  const events = []
  const electronAPI = {
    chatgptSubmitGeneration: vi.fn(async (request) => {
      events.push(`submit:${request.prompt}`)
      return { success: true, generationId: 'engine-chatgpt-positive' }
    }),
    chatgptCancelGenerations: vi.fn(async () => {
      events.push('cancel')
      return { success: true }
    }),
  }
  return { engine: createChatgptEngine({ electronAPI, ...deps }), electronAPI, events }
}

describe('ChatGPT renderer engine measured request contract', () => {
  it('fails closed on malformed references after submitting an actual empty array', async () => {
    const h = engineHarness()
    await expect(h.engine.submitGeneration(
      'empty-array positive control',
      [],
      { batchCount: 1 },
    )).resolves.toMatchObject({ success: true })
    expect(h.events).toEqual(['submit:empty-array positive control'])

    const refused = await h.engine.submitGeneration(
      'malformed object must not submit',
      { data: 'non-default-reference-object' },
      { batchCount: 1 },
    )

    expect(refused).toMatchObject({
      success: false,
      errorKind: 'chatgpt-reference-images-unmeasured',
    })
    expect(h.events).toEqual(['submit:empty-array positive control'])
  })

  it('refuses explicit batch and seed opt-ins that the spike never measured', async () => {
    const h = engineHarness()
    await expect(h.engine.submitGeneration(
      'measured options positive control',
      [],
      { batchCount: 1 },
    )).resolves.toMatchObject({ success: true })

    const cases = [
      [{ batchCount: 4 }, 'chatgpt-batch-count-unmeasured'],
      [{ batchCount: 1, seed: 314159 }, 'chatgpt-seed-unmeasured'],
    ]
    for (const [options, errorKind] of cases) {
      await expect(h.engine.submitGeneration('unsupported option', [], options))
        .resolves.toMatchObject({ success: false, errorKind })
    }
    expect(h.events).toEqual(['submit:measured options positive control'])
  })

  it('submits the app-default settings shape by omitting aspect-ratio/provider/model plumbing', async () => {
    const notices = []
    const h = engineHarness({ onAspectRatioIgnored: () => notices.push('aspect-ratio-ignored') })

    // Positive control — no aspectRatio in options → no notice, submission goes through.
    await expect(h.engine.submitGeneration('no-aspect positive control', [], { batchCount: 1 }))
      .resolves.toMatchObject({ success: true })
    expect(notices).toEqual([])

    // The exact option object every real caller (useAutomation/useSceneGeneration/
    // useReferenceGeneration) sends with the useAppSettings defaults.
    const submitted = await h.engine.submitGeneration('settings-shaped submission', [], {
      batchCount: 1,
      seed: null,
      aspectRatio: '16:9',
      model: 'gemini-nonstandard-model',
      provider: 'google',
      references: [{ id: 'ref-non-default', name: 'unused-here' }],
    })

    expect(submitted).toMatchObject({ success: true, generationId: 'engine-chatgpt-positive' })
    expect(h.events).toEqual([
      'submit:no-aspect positive control',
      'submit:settings-shaped submission',
    ])
    const request = h.electronAPI.chatgptSubmitGeneration.mock.calls[1][0]
    expect('aspectRatio' in request).toBe(false)
    expect('provider' in request).toBe(false)
    expect('model' in request).toBe(false)
    expect(request.referenceImages).toEqual([])
    expect(notices).toEqual(['aspect-ratio-ignored'])
  })

  it('announces the dropped aspect ratio through the window event the app listens to', async () => {
    const windowNotices = []
    const listener = () => windowNotices.push('window-notice')
    window.addEventListener('chatgpt-aspect-ratio-ignored', listener)
    try {
      const h = engineHarness()
      await expect(h.engine.submitGeneration('no-notice positive control', [], { batchCount: 1 }))
        .resolves.toMatchObject({ success: true })
      expect(windowNotices).toEqual([])

      await expect(h.engine.submitGeneration('noticed submission', [], { batchCount: 1, aspectRatio: '9:16' }))
        .resolves.toMatchObject({ success: true })

      expect(windowNotices).toEqual(['window-notice'])
    } finally {
      window.removeEventListener('chatgpt-aspect-ratio-ignored', listener)
    }
  })

  it('maps Stop=true to the ChatGPT cancellation IPC and leaves Stop=false inert', async () => {
    const h = engineHarness()

    await h.engine.setStopRequested(false)
    expect(h.events).toEqual([])

    await h.engine.setStopRequested(true)

    expect(h.events).toEqual(['cancel'])
    expect(h.electronAPI.chatgptCancelGenerations).toHaveBeenCalledOnce()
  })
})
