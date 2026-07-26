// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { defaultStoryState } from '../../../electron/story/storyStore.js'

const storeMocks = vi.hoisted(() => ({
  store: null,
}))

vi.mock('../../../electron/story/storyStore.js', async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...actual,
    createStoryStore: () => storeMocks.store,
  }
})

import { createStepMachine } from '../../../electron/story/stepMachine.js'

function deferred() {
  let resolve
  const promise = new Promise((done) => { resolve = done })
  return { promise, resolve }
}

describe('synthPreview abort isolation', () => {
  let emitted
  let scenes

  beforeEach(() => {
    emitted = []
    scenes = {
      scenes: [{
        sceneNo: 1,
        segments: [{ id: 'seg-1', type: 'narration', speaker: 'narrator', text: '지연 합성', emotion: 'normal' }],
      }],
    }
    storeMocks.store = {
      load: vi.fn(async () => defaultStoryState()),
      save: vi.fn(async () => {}),
      loadText: vi.fn(async (relPath) => (
        relPath === 'scenes.json' ? JSON.stringify(scenes) : null
      )),
      loadTextStrict: vi.fn(async () => null),
      saveBinary: vi.fn(async () => {}),
      saveText: vi.fn(async () => {}),
      updateText: vi.fn(async () => {}),
      remove: vi.fn(async () => {}),
    }
  })

  it('abort 중 지연 TTS가 resolve돼도 preview 저장과 후속 emit을 하지 않는다', async () => {
    const synthesis = deferred()
    const synthesize = vi.fn(() => synthesis.promise)
    const machine = createStepMachine({
      projectPath: '/work/story-project',
      llm: {},
      tts: { synthesize },
      probe: vi.fn(async () => 1000),
      emit: (channel, payload) => emitted.push({ channel, payload }),
      getApiKey: () => 'key',
    })
    await machine.open()
    emitted.length = 0

    const preview = machine.synthPreview({
      segmentIds: ['seg-1'],
      speakers: [{ id: 'narrator', voice: { provider: 'typecast', voiceId: 'voice-1' } }],
    })
    await vi.waitFor(() => expect(synthesize).toHaveBeenCalledTimes(1))

    await machine.abort()
    emitted.length = 0
    storeMocks.store.saveBinary.mockClear()
    storeMocks.store.saveText.mockClear()

    synthesis.resolve({ audio: Buffer.from('late-audio'), format: 'wav' })
    await expect(preview).resolves.toEqual({ aborted: true })

    expect(synthesize.mock.calls[0][0].signal).toBeInstanceOf(AbortSignal)
    expect(synthesize.mock.calls[0][0].signal.aborted).toBe(true)
    expect(storeMocks.store.saveBinary).not.toHaveBeenCalled()
    expect(storeMocks.store.saveText).not.toHaveBeenCalled()
    expect(emitted).toEqual([])
  })
})

