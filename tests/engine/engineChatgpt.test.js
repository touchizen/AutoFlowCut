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

  it('refuses an explicit batch-count opt-in that the spike never measured', async () => {
    const h = engineHarness()
    await expect(h.engine.submitGeneration(
      'measured options positive control',
      [],
      { batchCount: 1 },
    )).resolves.toMatchObject({ success: true })

    await expect(h.engine.submitGeneration('unsupported option', [], { batchCount: 4 }))
      .resolves.toMatchObject({ success: false, errorKind: 'chatgpt-batch-count-unmeasured' })
    expect(h.events).toEqual(['submit:measured options positive control'])
  })

  it('submits the app-default settings shape by omitting aspect-ratio/seed/provider/model plumbing', async () => {
    const notices = []
    const h = engineHarness({ onUnmeasuredOptionsIgnored: () => notices.push('unmeasured-options-ignored') })

    // Positive control — no aspectRatio/seed in options → no notice, submission goes through.
    await expect(h.engine.submitGeneration('no-plumbing positive control', [], { batchCount: 1 }))
      .resolves.toMatchObject({ success: true })
    expect(notices).toEqual([])

    // The exact option object every real caller (useAutomation/useSceneGeneration/
    // useReferenceGeneration) sends with the useAppSettings defaults — seed is a NUMBER
    // out of the box (seedLocked:true + random seedNo), never null.
    const submitted = await h.engine.submitGeneration('settings-shaped submission', [], {
      batchCount: 1,
      seed: 271828,
      aspectRatio: '16:9',
      model: 'gemini-nonstandard-model',
      provider: 'google',
      references: [{ id: 'ref-non-default', name: 'unused-here' }],
    })

    expect(submitted).toMatchObject({ success: true, generationId: 'engine-chatgpt-positive' })
    expect(h.events).toEqual([
      'submit:no-plumbing positive control',
      'submit:settings-shaped submission',
    ])
    const request = h.electronAPI.chatgptSubmitGeneration.mock.calls[1][0]
    expect('aspectRatio' in request).toBe(false)
    expect('seed' in request).toBe(false)
    expect('provider' in request).toBe(false)
    expect('model' in request).toBe(false)
    expect(request.referenceImages).toEqual([])
    // ONE combined notice even though both aspectRatio and seed were dropped.
    expect(notices).toEqual(['unmeasured-options-ignored'])
  })

  it('drops a seed-only submission with the same single notice instead of refusing it', async () => {
    const notices = []
    const h = engineHarness({ onUnmeasuredOptionsIgnored: () => notices.push('unmeasured-options-ignored') })

    const submitted = await h.engine.submitGeneration('seed-only submission', [], {
      batchCount: 1,
      seed: 314159,
    })

    expect(submitted).toMatchObject({ success: true, generationId: 'engine-chatgpt-positive' })
    expect(h.events).toEqual(['submit:seed-only submission'])
    const request = h.electronAPI.chatgptSubmitGeneration.mock.calls[0][0]
    expect('seed' in request).toBe(false)
    expect(notices).toEqual(['unmeasured-options-ignored'])
  })

  it('announces the dropped options through the window event the app listens to', async () => {
    const windowNotices = []
    const listener = () => windowNotices.push('window-notice')
    window.addEventListener('chatgpt-unmeasured-options-ignored', listener)
    try {
      const h = engineHarness()
      await expect(h.engine.submitGeneration('no-notice positive control', [], { batchCount: 1 }))
        .resolves.toMatchObject({ success: true })
      expect(windowNotices).toEqual([])

      await expect(h.engine.submitGeneration('noticed submission', [], { batchCount: 1, aspectRatio: '9:16', seed: 42 }))
        .resolves.toMatchObject({ success: true })

      expect(windowNotices).toEqual(['window-notice'])
    } finally {
      window.removeEventListener('chatgpt-unmeasured-options-ignored', listener)
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
