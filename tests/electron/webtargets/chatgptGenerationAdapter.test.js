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

function firstArgOf(script) {
  const call = String(script).trim().split('\n').pop()
  const serialized = call.slice(call.indexOf('(') + 1, call.lastIndexOf(')'))
  return JSON.parse(serialized)
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
      return typeof handler === 'function' ? handler(call, script) : handler
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

function adapterHarness({
  handlers,
  fetch: fetchOverride,
  createId = () => 'adapter-harness-job',
  saveTimeoutMs = 50,
  ensureSession: ensureSessionOverride,
} = {}) {
  const h = machineHarness(handlers || {
    __cg_baseline__: { imgs: [] },
    __cg_inject__: { textMatches: true, submitPresent: true },
    __cg_clickSubmit__: { clicked: true },
    __cg_submitAck__: submitted,
    __cg_poll__: { imgs: [loaded('adapter-harness-image')] },
  })
  const fetch = fetchOverride || vi.fn(async () => ({
    ok: true,
    status: 200,
    headers: { get: () => 'image/png' },
    arrayBuffer: async () => new Uint8Array([71, 83]).buffer,
  }))
  const view = {
    webContents: {
      executeJavaScript: vi.fn(),
      getURL: vi.fn(() => 'https://chatgpt.com/c/adapter-harness'),
      session: { fetch },
    },
  }
  const fs = { mkdirSync: vi.fn(), writeFileSync: vi.fn() }
  const ensureSession = ensureSessionOverride || vi.fn(async () => ({ status: 'ready', ready: true }))
  const adapter = chatgpt.createChatgptGenerationAdapter({
    getView: () => view,
    ensureSession,
    executeInView: h.executeInView,
    generateOptions: {
      now: h.now,
      sleep: h.sleep,
      typeText: h.typeText,
      enter: h.enter,
      deadlineMs: h.deadlineMs,
      cadenceMs: h.cadenceMs,
    },
    fs,
    getOutputDir: () => '/adapter-harness-staging',
    now: () => 1700000000099,
    createId,
    logger: h.log,
    saveTimeoutMs,
  })
  return { adapter, ensureSession, fetch, fs, h, view }
}

function expectMeasuredMachine() {
  expect(typeof chatgpt.runGenerateStateMachine).toBe('function')
  return typeof chatgpt.runGenerateStateMachine === 'function'
}

async function waitForCall(spy) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (spy.mock.calls.length > 0) return
    await Promise.resolve()
  }
  throw new Error('expected call was not observed')
}

describe('ChatGPT measured generation state machine', () => {
  it('turns the scene text into an explicit image-generation instruction', () => {
    expect(typeof chatgpt.buildImagePrompt).toBe('function')
    if (typeof chatgpt.buildImagePrompt !== 'function') return
    const result = chatgpt.buildImagePrompt('a brass observatory under violet clouds')
    expect(result).toMatch(/^(generate|create|draw|make)\b/i)
    expect(result).toMatch(/\bimage\b/i)
    expect(result).toContain('a brass observatory under violet clouds')

    const multiline = chatgpt.buildImagePrompt('first ridge\n\nsecond ridge')
    const korean = chatgpt.buildImagePrompt('푸른 바다 위의\n등대')
    expect(multiline).toContain('first ridge second ridge')
    expect(korean).toContain('푸른 바다 위의 등대')
    expect(multiline).not.toMatch(/[\r\n]/)
    expect(korean).not.toMatch(/[\r\n]/)
  })

  it('keeps a Korean scene on measured execCommand injection when ProseMirror absorbs line breaks', async () => {
    if (!expectMeasuredMachine()) return
    const makeHarness = (id) => machineHarness({
      __cg_baseline__: { imgs: [] },
      __cg_inject__: (_call, script) => ({
        textMatches: !firstArgOf(script).includes('\n'),
        submitPresent: true,
      }),
      __cg_clickSubmit__: { clicked: true },
      __cg_submitAck__: submitted,
      __cg_poll__: { imgs: [loaded(id)] },
    })

    const ascii = makeHarness('single-line-ascii-control')
    const asciiResult = await chatgpt.runGenerateStateMachine(
      {},
      'Generate an image of a single line silver astrolabe',
      ascii,
    )
    expect(asciiResult).toMatchObject({ ok: true, id: 'single-line-ascii-control' })
    expect(ascii.typeText).not.toHaveBeenCalled()

    const korean = makeHarness('korean-scene-result')
    const koreanResult = await chatgpt.runGenerateStateMachine(
      {},
      chatgpt.buildImagePrompt('푸른 바다 위의 등대'),
      korean,
    )

    expect(koreanResult).toMatchObject({ ok: true, id: 'korean-scene-result' })
    expect(koreanResult).not.toMatchObject({ detail: 'non-ascii-fallback-unmeasured' })
    expect(korean.typeText).not.toHaveBeenCalled()
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

  it('uses the measured two-streak plus re-check Enter fallback once', async () => {
    if (!expectMeasuredMachine()) return
    const events = []
    const h = machineHarness({
      __cg_baseline__: { imgs: [] },
      __cg_inject__: { textMatches: true, submitPresent: true },
      __cg_clickSubmit__: { clicked: true },
      __cg_submitAck__: (call) => (call <= 2 ? notSubmitted : submitted),
      __cg_poll__: (call) => call >= 2 ? { imgs: [loaded('enter-fallback-result')] } : { imgs: [] },
    })
    h.enter = () => events.push('enter')

    const result = await chatgpt.runGenerateStateMachine({}, prompt, h)

    expect(events).toEqual(['enter'])
    expect(result).toMatchObject({ ok: true, id: 'enter-fallback-result', submitMethod: 'enter' })
  })

  it('never retries Enter after its once-only fallback even if the composer stays uncleared', async () => {
    if (!expectMeasuredMachine()) return
    const events = []
    const h = machineHarness({
      __cg_baseline__: { imgs: [] },
      __cg_inject__: { textMatches: true, submitPresent: true },
      __cg_clickSubmit__: { clicked: true },
      __cg_submitAck__: notSubmitted,
      __cg_poll__: { imgs: [] },
    })
    h.enter = () => events.push('enter')

    const result = await chatgpt.runGenerateStateMachine({}, prompt, h)

    expect(events).toEqual(['enter'])
    expect(result).toEqual({ ok: false, stage: 'submit', detail: 'deadline' })
  })

  it('keeps submitted acknowledgement sticky and never emits a later duplicate Enter', async () => {
    if (!expectMeasuredMachine()) return
    const events = []
    const h = machineHarness({
      __cg_baseline__: { imgs: [] },
      __cg_inject__: { textMatches: true, submitPresent: true },
      __cg_clickSubmit__: { clicked: true },
      __cg_submitAck__: (call) => call === 0 ? submitted : notSubmitted,
      __cg_poll__: { imgs: [] },
    })
    h.enter = () => events.push('enter')

    const result = await chatgpt.runGenerateStateMachine({}, prompt, h)

    expect(events).toEqual([])
    expect(result).toEqual({ ok: false, stage: 'poll', detail: 'deadline' })
  })

  it('honors an already-aborted job before any page click or evaluation', async () => {
    if (!expectMeasuredMachine()) return
    const positive = machineHarness({
      __cg_baseline__: { imgs: [] },
      __cg_inject__: { textMatches: true, submitPresent: true },
      __cg_clickSubmit__: { clicked: true },
      __cg_submitAck__: submitted,
      __cg_poll__: { imgs: [loaded('abort-positive-control')] },
    })
    await expect(chatgpt.runGenerateStateMachine({}, prompt, positive))
      .resolves.toMatchObject({ ok: true, id: 'abort-positive-control' })

    const controller = new AbortController()
    controller.abort()
    const cancelled = machineHarness({
      __cg_baseline__: { imgs: [] },
      __cg_inject__: { textMatches: true, submitPresent: true },
      __cg_clickSubmit__: { clicked: true },
      __cg_submitAck__: submitted,
      __cg_poll__: { imgs: [loaded('must-not-be-observed')] },
    })

    const result = await chatgpt.runGenerateStateMachine({}, prompt, {
      ...cancelled,
      signal: controller.signal,
    })

    expect(result).toEqual({ ok: false, stage: 'cancel', detail: 'cancelled' })
    expect(cancelled.executeInView).not.toHaveBeenCalled()
  })

  it('stops polling when cancellation arrives during an active page state machine', async () => {
    if (!expectMeasuredMachine()) return
    const controller = new AbortController()
    const events = []
    const h = machineHarness({
      __cg_baseline__: { imgs: [] },
      __cg_inject__: { textMatches: true, submitPresent: true },
      __cg_clickSubmit__: { clicked: true },
      __cg_submitAck__: submitted,
      __cg_poll__: () => {
        events.push('poll')
        controller.abort()
        return { imgs: [loaded('cancelled-poll-result')] }
      },
    })

    const result = await chatgpt.runGenerateStateMachine({}, prompt, {
      ...h,
      signal: controller.signal,
    })

    expect(result).toEqual({ ok: false, stage: 'cancel', detail: 'cancelled' })
    expect(events).toEqual(['poll'])
  })

  it('logs only safe origin/error-name metadata while still accepting a stable image', async () => {
    if (!expectMeasuredMachine()) return
    const h = machineHarness({
      __cg_baseline__: { imgs: [], href: 'https://chatgpt.com/c/non-default-log-fixture' },
      __cg_inject__: { textMatches: true, submitPresent: true },
      __cg_clickSubmit__: { clicked: true },
      __cg_submitAck__: submitted,
      __cg_poll__: { imgs: [loaded('must-not-appear-in-logs')] },
    })

    const result = await chatgpt.runGenerateStateMachine({}, prompt, h)

    expect(result).toMatchObject({ ok: true, id: 'must-not-appear-in-logs' })
    const metadata = [...h.log.info.mock.calls, ...h.log.error.mock.calls]
      .flatMap(call => call.filter(value => value && typeof value === 'object'))
    expect(metadata.length).toBeGreaterThan(0)
    for (const value of metadata) {
      expect(Object.keys(value).every(key => ['origin', 'errorName'].includes(key))).toBe(true)
      expect(JSON.stringify(value)).not.toContain('must-not-appear-in-logs')
      expect(JSON.stringify(value)).not.toContain('sig=')
    }
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

    expect(fetch).toHaveBeenCalledWith(`${CDN}?id=saved&sig=private`, {
      credentials: 'include',
      signal: expect.any(AbortSignal),
    })
    expect(events).toEqual(['mkdir', 'write'])
    expect(result).toMatchObject({
      filePath: '/product-chatgpt-staging/generated-1700000000000.png',
      mimeType: 'image/png',
      base64: Buffer.from([11, 22, 33]).toString('base64'),
      dataUrl: `data:image/png;base64,${Buffer.from([11, 22, 33]).toString('base64')}`,
    })
  })

  it('aborts the authenticated partition fetch when its bounded save timeout wins', async () => {
    expect(typeof chatgpt.saveImage).toBe('function')
    if (typeof chatgpt.saveImage !== 'function') return
    const positiveFetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      headers: { get: () => 'image/png' },
      arrayBuffer: async () => new Uint8Array([5, 8, 13]).buffer,
    }))
    await expect(chatgpt.saveImage(
      { webContents: { session: { fetch: positiveFetch } } },
      `${CDN}?id=timeout-positive&sig=private`,
      { fs: { mkdirSync: vi.fn(), writeFileSync: vi.fn() }, timeoutMs: 50 },
    )).resolves.toMatchObject({ mimeType: 'image/png' })

    let receivedSignal
    const stalledFetch = vi.fn((_src, options) => {
      receivedSignal = options?.signal
      return new Promise(() => {})
    })
    await expect(chatgpt.saveImage(
      { webContents: { session: { fetch: stalledFetch } } },
      `${CDN}?id=timeout-negative&sig=private`,
      { fs: { mkdirSync: vi.fn(), writeFileSync: vi.fn() }, timeoutMs: 5 },
    )).rejects.toThrow(/operation-timeout/)

    expect(receivedSignal).toBeInstanceOf(AbortSignal)
    expect(receivedSignal.aborted).toBe(true)
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

  it('keeps the estuary content id out of the collected IPC payload', async () => {
    if (!expectMeasuredMachine()) return
    const h = adapterHarness({
      handlers: {
        __cg_baseline__: { imgs: [] },
        __cg_inject__: { textMatches: true, submitPresent: true },
        __cg_clickSubmit__: { clicked: true },
        __cg_submitAck__: submitted,
        __cg_poll__: { imgs: [loaded('estuary-content-id-must-not-cross-ipc')] },
      },
      createId: () => 'ipc-payload-privacy-job',
    })

    await expect(h.adapter.submit({
      prompt: 'a payload-privacy control scene',
      referenceImages: [],
      batchCount: 1,
    })).resolves.toEqual({ success: true, generationId: 'ipc-payload-privacy-job' })
    const collected = await h.adapter.collect('ipc-payload-privacy-job')

    // Positive control: the payload still carries everything the renderer consumes.
    expect(collected.success).toBe(true)
    expect(collected.images[0]).toMatchObject({
      filePath: '/adapter-harness-staging/generated-1700000000099.png',
      base64: expect.any(String),
      dataUrl: expect.stringMatching(/^data:image\/png;base64,/),
    })
    // The content-correlating estuary id must not cross IPC in the event/result payload.
    expect(collected.images[0]).not.toHaveProperty('id')
    expect(JSON.stringify(collected)).not.toContain('estuary-content-id-must-not-cross-ipc')
  })

  it('fails closed on a malformed non-array reference envelope after an empty-array positive control', async () => {
    if (!expectMeasuredMachine()) return
    let nextId = 0
    const h = adapterHarness({ createId: () => `reference-shape-${++nextId}` })

    await expect(h.adapter.submit({
      prompt: 'text-only positive control with empty references',
      referenceImages: [],
      batchCount: 1,
    })).resolves.toMatchObject({ success: true, generationId: 'reference-shape-1' })
    const baselineCalls = h.h.executeInView.mock.calls.length

    const refused = await h.adapter.submit({
      prompt: 'must not reach the composer',
      referenceImages: { data: 'malformed-reference-envelope' },
      batchCount: 1,
    })

    expect(refused).toMatchObject({
      success: false,
      errorKind: 'chatgpt-reference-images-unmeasured',
    })
    expect(h.h.executeInView).toHaveBeenCalledTimes(baselineCalls)
  })

  it('refuses unmeasured batch, aspect-ratio, and seed options instead of reporting clean success', async () => {
    if (!expectMeasuredMachine()) return
    const positive = adapterHarness({ createId: () => 'measured-options-positive' })
    await expect(positive.adapter.submit({
      prompt: 'one image with no unmeasured controls',
      referenceImages: [],
      batchCount: 1,
    })).resolves.toEqual({ success: true, generationId: 'measured-options-positive' })

    const cases = [
      [{ batchCount: 3 }, 'chatgpt-batch-count-unmeasured'],
      [{ batchCount: 1, aspectRatio: '9:16' }, 'chatgpt-aspect-ratio-unmeasured'],
      [{ batchCount: 1, seed: 8675309 }, 'chatgpt-seed-unmeasured'],
    ]
    for (const [options, errorKind] of cases) {
      const negative = adapterHarness()
      const refused = await negative.adapter.submit({
        prompt: `negative option control ${errorKind}`,
        referenceImages: [],
        ...options,
      })
      expect(refused).toMatchObject({ success: false, errorKind })
      expect(negative.h.executeInView).not.toHaveBeenCalled()
    }
  })

  it('logs the constant state-machine detail for non-exception failures without prompt or content metadata', async () => {
    if (!expectMeasuredMachine()) return
    const secretPrompt = '비공개 한국어 프롬프트'
    const h = adapterHarness({
      handlers: {
        __cg_baseline__: { imgs: [], href: 'https://chatgpt.com/c/non-exception-failure' },
        __cg_inject__: { textMatches: false, submitPresent: true },
      },
      createId: () => 'non-exception-failure-job',
    })

    const result = await h.adapter.submit({
      prompt: secretPrompt,
      referenceImages: [],
      batchCount: 1,
    })

    expect(result).toMatchObject({ success: false, errorKind: 'chatgpt-generation-inject' })
    const serializedLogs = JSON.stringify(h.h.log.error.mock.calls)
    expect(serializedLogs).toContain('non-ascii-fallback-unmeasured')
    expect(serializedLogs).not.toContain(secretPrompt)
    const metadata = h.h.log.error.mock.calls
      .flatMap(call => call.filter(value => value && typeof value === 'object'))
    expect(metadata).toContainEqual({
      origin: 'https://chatgpt.com',
      errorName: 'non-ascii-fallback-unmeasured',
    })
  })

  it('cancels a running adapter job during a never-settling authenticated fetch and becomes idle', async () => {
    if (!expectMeasuredMachine()) return
    const events = []
    let fetchSignal
    const fetch = vi.fn((_src, options) => {
      events.push('fetch-start')
      fetchSignal = options?.signal
      return new Promise(() => {})
    })
    const h = adapterHarness({
      fetch,
      createId: () => 'cancel-running-fetch-job',
      saveTimeoutMs: 50,
    })

    const pending = h.adapter.submit({
      prompt: 'cancel the stalled fetch',
      referenceImages: [],
      batchCount: 1,
    })
    await waitForCall(fetch)
    events.push('cancel-request')

    const cancelResult = await h.adapter.cancelAll()
    const submitResult = await pending
    await h.adapter.awaitIdle()
    events.push('idle')

    expect(cancelResult).toMatchObject({ success: true })
    expect(submitResult).toMatchObject({
      success: false,
      errorKind: 'chatgpt-generation-cancelled',
    })
    expect(fetchSignal).toBeInstanceOf(AbortSignal)
    expect(fetchSignal.aborted).toBe(true)
    expect(events).toEqual(['fetch-start', 'cancel-request', 'idle'])
  })

  it('deletes a cancelled job on terminal collect instead of leaking it for the session', async () => {
    if (!expectMeasuredMachine()) return
    const fetch = vi.fn(() => new Promise(() => {}))
    const h = adapterHarness({ fetch, createId: () => 'reap-on-collect-job' })

    const pending = h.adapter.submit({
      prompt: 'cancel then collect twice',
      referenceImages: [],
      batchCount: 1,
    })
    await waitForCall(fetch)
    // Positive control: an active (running) job must survive clear().
    await expect(h.adapter.clear()).resolves.toEqual({ success: true })
    await expect(h.adapter.observe('reap-on-collect-job')).resolves.toMatchObject({
      success: true, completed: false, state: 'running',
    })

    await h.adapter.cancelAll()
    await expect(pending).resolves.toMatchObject({
      success: false, errorKind: 'chatgpt-generation-cancelled',
    })

    // First collect returns the terminal cancellation result…
    await expect(h.adapter.collect('reap-on-collect-job')).resolves.toMatchObject({
      success: false, errorKind: 'chatgpt-generation-cancelled',
    })
    // …and the terminal collect deletes the entry: a second collect finds nothing.
    await expect(h.adapter.collect('reap-on-collect-job')).resolves.toMatchObject({
      success: false, errorKind: 'chatgpt-generation-not-found',
    })
  })

  it('clear() reaps a cancelled job that was never collected', async () => {
    if (!expectMeasuredMachine()) return
    const fetch = vi.fn(() => new Promise(() => {}))
    const h = adapterHarness({ fetch, createId: () => 'reap-on-clear-job' })

    const pending = h.adapter.submit({
      prompt: 'cancel then clear without collecting',
      referenceImages: [],
      batchCount: 1,
    })
    await waitForCall(fetch)
    await h.adapter.cancelAll()
    await expect(pending).resolves.toMatchObject({
      success: false, errorKind: 'chatgpt-generation-cancelled',
    })
    // Positive control: before clear() the cancelled job is still observable.
    await expect(h.adapter.observe('reap-on-clear-job')).resolves.toMatchObject({
      completed: true, state: 'cancelled',
    })

    await expect(h.adapter.clear()).resolves.toEqual({ success: true })

    await expect(h.adapter.observe('reap-on-clear-job')).resolves.toMatchObject({
      success: false, errorKind: 'chatgpt-generation-not-found',
    })
  })

  it('owns cancellation before the session probe resolves and never evaluates the page', async () => {
    if (!expectMeasuredMachine()) return
    const positive = adapterHarness({ createId: () => 'session-probe-positive' })
    await expect(positive.adapter.submit({
      prompt: 'ready session positive control',
      referenceImages: [],
      batchCount: 1,
    })).resolves.toMatchObject({ success: true, generationId: 'session-probe-positive' })

    let releaseProbe
    let firstProbe = true
    const events = []
    const ensureSession = vi.fn(() => {
      if (!firstProbe) return Promise.resolve({ status: 'ready', ready: true })
      firstProbe = false
      events.push('session-probe')
      return new Promise(resolve => { releaseProbe = resolve })
    })
    const negative = adapterHarness({
      ensureSession,
      createId: () => 'session-probe-cancelled',
    })
    const pending = negative.adapter.submit({
      prompt: 'must not reach page evaluation after Stop',
      referenceImages: [],
      batchCount: 1,
    })
    await waitForCall(ensureSession)
    events.push('cancel-request')

    await negative.adapter.cancelAll()
    releaseProbe({ status: 'ready', ready: true })
    const result = await pending
    await negative.adapter.awaitIdle()

    expect(result).toMatchObject({
      success: false,
      errorKind: 'chatgpt-generation-cancelled',
    })
    expect(negative.h.executeInView).not.toHaveBeenCalled()
    expect(events).toEqual(['session-probe', 'cancel-request'])
  })
})
