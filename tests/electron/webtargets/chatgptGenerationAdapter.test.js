// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import * as chatgpt from '../../../electron/webtargets/chatgpt/index.js'

const CDN = 'https://chatgpt.com/backend-api/estuary/content'
const prompt = 'Generate an image of a copper robot reading a blue book'
const loaded = (id) => ({
  src: `${CDN}?id=${id}&sig=fixture-secret`,
  complete: true,
  w: 1254,
  h: 1254,
})
const submitted = { composerCleared: true, submitPresent: false, stillHasPrompt: false }
const notSubmitted = { composerCleared: false, submitPresent: true, stillHasPrompt: true }

function fnNameOf(script) {
  return String(script).trim().split('\n').pop().match(/window\.(__cg_\w+__)\(/)?.[1] || null
}

function machineHarness(handlers) {
  const counts = {}
  let elapsed = 0
  return {
    counts,
    executeInView: vi.fn(async (_view, script) => {
      const fn = fnNameOf(script)
      const call = (counts[fn] = (counts[fn] ?? -1) + 1)
      const handler = handlers[fn]
      if (handler === undefined) throw new Error(`unexpected page function: ${fn}`)
      return typeof handler === 'function' ? handler(call) : handler
    }),
    now: () => elapsed,
    sleep: async (ms) => { elapsed += ms },
    typeText: vi.fn(),
    enter: vi.fn(),
    log: { info: vi.fn(), error: vi.fn() },
    deadlineMs: 30,
    cadenceMs: 5,
  }
}

function expectMeasuredMachine() {
  expect(typeof chatgpt.runGenerateStateMachine).toBe('function')
  return typeof chatgpt.runGenerateStateMachine === 'function'
}

describe('ChatGPT measured generation state machine', () => {
  it('turns the scene text into an explicit image-generation instruction', () => {
    expect(typeof chatgpt.buildImagePrompt).toBe('function')
    if (typeof chatgpt.buildImagePrompt !== 'function') return
    const result = chatgpt.buildImagePrompt('a brass observatory under violet clouds')
    expect(result).toMatch(/^(generate|create|draw|make)\b/i)
    expect(result).toMatch(/\bimage\b/i)
    expect(result).toContain('a brass observatory under violet clouds')
  })

  it('fails closed instead of inventing an unmeasured non-ASCII sendInputEvent fallback', async () => {
    if (!expectMeasuredMachine()) return
    const ascii = machineHarness({
      __cg_baseline__: { imgs: [] },
      __cg_inject__: { textMatches: false, submitPresent: true },
      __cg_verify__: { textMatches: true, submitPresent: true },
      __cg_clickSubmit__: { clicked: true },
      __cg_submitAck__: submitted,
      __cg_poll__: { imgs: [loaded('ascii-fallback-positive')] },
    })
    const asciiResult = await chatgpt.runGenerateStateMachine(
      {},
      'Generate an image of a silver astrolabe',
      ascii,
    )
    expect(asciiResult).toMatchObject({ ok: true, id: 'ascii-fallback-positive' })
    expect(ascii.typeText).toHaveBeenCalledOnce()

    const nonAscii = machineHarness({
      __cg_baseline__: { imgs: [] },
      __cg_inject__: { textMatches: false, submitPresent: false },
    })

    const result = await chatgpt.runGenerateStateMachine(
      {},
      '푸른 바다 위의 등대 이미지를 생성해줘',
      nonAscii,
    )

    expect(result).toMatchObject({ ok: false, stage: 'inject', detail: 'non-ascii-fallback-unmeasured' })
    expect(nonAscii.typeText).not.toHaveBeenCalled()
  })

  it('requires two consecutive sightings of the same new estuary id', async () => {
    if (!expectMeasuredMachine()) return
    const sequence = [
      { imgs: [loaded('single-sighting')] },
      { imgs: [loaded('stable-final')] },
      { imgs: [loaded('stable-final')] },
    ]
    const h = machineHarness({
      __cg_baseline__: { imgs: [] },
      __cg_inject__: { textMatches: true, submitPresent: true },
      __cg_clickSubmit__: { clicked: true },
      __cg_submitAck__: submitted,
      __cg_poll__: (n) => sequence[Math.min(n, sequence.length - 1)],
    })

    const result = await chatgpt.runGenerateStateMachine({}, prompt, h)

    expect(result).toMatchObject({ ok: true, id: 'stable-final' })
    expect(h.counts.__cg_poll__).toBe(2)
  })

  it('absorbs an estuary id seen before submit confirmation and accepts the later result', async () => {
    if (!expectMeasuredMachine()) return
    const h = machineHarness({
      __cg_baseline__: { imgs: [] },
      __cg_inject__: { textMatches: true, submitPresent: true },
      __cg_clickSubmit__: { clicked: true },
      __cg_submitAck__: (n) => (n === 0 ? notSubmitted : submitted),
      __cg_poll__: (n) => (n <= 2
        ? { imgs: [loaded('pre-ack-stale')] }
        : { imgs: [loaded('pre-ack-stale'), loaded('owned-final')] }),
    })

    const result = await chatgpt.runGenerateStateMachine({}, prompt, h)

    expect(result).toMatchObject({ ok: true, id: 'owned-final' })
  })

  it('downloads through the ChatGPT partition session and returns a saved image payload', async () => {
    expect(typeof chatgpt.saveImage).toBe('function')
    if (typeof chatgpt.saveImage !== 'function') return
    const events = []
    const fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      headers: { get: () => 'image/png' },
      arrayBuffer: async () => new Uint8Array([11, 22, 33]).buffer,
    }))
    const fs = {
      mkdirSync: vi.fn(() => events.push('mkdir')),
      writeFileSync: vi.fn(() => events.push('write')),
    }
    const view = { webContents: { session: { fetch } } }

    const result = await chatgpt.saveImage(view, `${CDN}?id=saved&sig=private`, {
      fs,
      outputDir: '/product-chatgpt-staging',
      now: () => 1700000000000,
      timeoutMs: 50,
    })

    expect(fetch).toHaveBeenCalledWith(`${CDN}?id=saved&sig=private`, { credentials: 'include' })
    expect(events).toEqual(['mkdir', 'write'])
    expect(result).toMatchObject({
      filePath: '/product-chatgpt-staging/generated-1700000000000.png',
      mimeType: 'image/png',
      base64: Buffer.from([11, 22, 33]).toString('base64'),
      dataUrl: `data:image/png;base64,${Buffer.from([11, 22, 33]).toString('base64')}`,
    })
  })

  it('serializes adapter submission through saving before exposing the generation id', async () => {
    expect(typeof chatgpt.createChatgptGenerationAdapter).toBe('function')
    if (typeof chatgpt.createChatgptGenerationAdapter !== 'function') return
    const h = machineHarness({
      __cg_baseline__: { imgs: [] },
      __cg_inject__: { textMatches: true, submitPresent: true },
      __cg_clickSubmit__: { clicked: true },
      __cg_submitAck__: submitted,
      __cg_poll__: { imgs: [loaded('adapter-saved')] },
    })
    const fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      headers: { get: () => 'image/png' },
      arrayBuffer: async () => new Uint8Array([44, 55]).buffer,
    }))
    const view = {
      webContents: {
        executeJavaScript: vi.fn(),
        session: { fetch },
      },
    }
    const fs = { mkdirSync: vi.fn(), writeFileSync: vi.fn() }
    const adapter = chatgpt.createChatgptGenerationAdapter({
      getView: () => view,
      ensureSession: vi.fn(async () => ({ status: 'ready', ready: true })),
      executeInView: h.executeInView,
      generateOptions: {
        now: h.now,
        sleep: h.sleep,
        deadlineMs: h.deadlineMs,
        cadenceMs: h.cadenceMs,
      },
      fs,
      getOutputDir: () => '/adapter-staging',
      now: () => 1700000000001,
      createId: () => 'adapter-job-positive',
      logger: h.log,
    })

    const submittedJob = await adapter.submit({ prompt: 'a measured quartz bridge', referenceImages: [] })

    expect(submittedJob).toEqual({ success: true, generationId: 'adapter-job-positive' })
    expect(fs.writeFileSync).toHaveBeenCalledOnce()
    await expect(adapter.observe('adapter-job-positive')).resolves.toMatchObject({ completed: true })
    await expect(adapter.collect('adapter-job-positive')).resolves.toMatchObject({
      success: true,
      images: [expect.objectContaining({
        filePath: '/adapter-staging/generated-1700000000001.png',
        dataUrl: expect.stringMatching(/^data:image\/png;base64,/),
      })],
    })
  })
})
