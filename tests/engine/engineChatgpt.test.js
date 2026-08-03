import { describe, expect, it, vi } from 'vitest'
import { createChatgptEngine } from '../../src/engine/engineChatgpt.js'

function engineHarness() {
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
  return { engine: createChatgptEngine({ electronAPI }), electronAPI, events }
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

  it('refuses batch, aspect-ratio, and seed controls that the spike never measured', async () => {
    const h = engineHarness()
    await expect(h.engine.submitGeneration(
      'measured options positive control',
      [],
      { batchCount: 1 },
    )).resolves.toMatchObject({ success: true })

    const cases = [
      [{ batchCount: 4 }, 'chatgpt-batch-count-unmeasured'],
      [{ batchCount: 1, aspectRatio: '16:9' }, 'chatgpt-aspect-ratio-unmeasured'],
      [{ batchCount: 1, seed: 314159 }, 'chatgpt-seed-unmeasured'],
    ]
    for (const [options, errorKind] of cases) {
      await expect(h.engine.submitGeneration('unsupported option', [], options))
        .resolves.toMatchObject({ success: false, errorKind })
    }
    expect(h.events).toEqual(['submit:measured options positive control'])
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
