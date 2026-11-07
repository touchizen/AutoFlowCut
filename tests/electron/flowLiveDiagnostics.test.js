import { afterEach, describe, expect, it, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import * as dom from '../../electron/flow-live-dom.js'
import * as diagnostics from '../../electron/flow-live-diagnostics.js'
import { bindPassiveRequests, createPassiveCapture } from '../../electron/flow-passive-capture.js'
import { PAGE, PROJECT, NEW, request } from '../fixtures/flow-passive-image.js'

afterEach(() => vi.useRealTimers())

describe('read-only live gallery evidence (synthetic DOM, not live proof)', () => {
  it('reads the actual Flow agent pressed state without copying composer text', () => {
    document.body.innerHTML = '<flow-agent-mode-toggle-chip><button aria-pressed="false">Agent</button></flow-agent-mode-toggle-chip><flow-rich-text-editor contenteditable="true">PRIVATE DRAFT</flow-rich-text-editor>'
    const watch = dom.observeLiveGallery(document, PAGE)
    try {
      const snapshot = watch.read()
      expect(snapshot.composer.agentPressed).toBe('false')
      expect(JSON.stringify(snapshot)).not.toContain('PRIVATE DRAFT')
    } finally { watch.disconnect() }
  })
  it('preserves placeholder lineage, request attributes, full prompt text and transient removals without DOM writes', () => {
    document.body.innerHTML = '<main data-request-id="request-1"><flow-image-tile data-tile-id="tile-1"><span>pending</span></flow-image-tile></main>'
    const before = document.documentElement.outerHTML
    const watch = dom.observeLiveGallery(document, PAGE)
    try {
      const initial = watch.read()
      expect(document.documentElement.outerHTML).toBe(before)
      const tile = document.querySelector('flow-image-tile')
      const id = initial.cards[0].rootId
      expect(initial.cards[0].ancestors.some(n => n.attributes['data-request-id'] === 'request-1')).toBe(true)
      tile.innerHTML = `<img data-media-id="${NEW}" src="https://flow-content.google/image/${NEW}?token=SECRET"><p>full original\nprompt 한글</p>`
      const transient = document.createElement('flow-image-tile')
      transient.setAttribute('data-request-id', 'transient-request')
      document.querySelector('main').append(transient)
      transient.remove()
      const actual = document.documentElement.outerHTML
      const completed = watch.read() // drain takeRecords, including add/remove between polls
      expect(completed.cards[0].rootId).toBe(id)
      expect(completed.cards[0].nodes.some(n => n.text === 'full original\nprompt 한글')).toBe(true)
      expect(completed.mutations.some(m => m.removed.some(n => n.attributes['data-request-id'] === 'transient-request'))).toBe(true)
      expect(JSON.stringify(completed)).not.toContain('SECRET')
      expect(document.documentElement.outerHTML).toBe(actual)
      watch.disconnect()
      tile.setAttribute('data-media-id', 'after-disconnect')
      expect(watch.read().mutations).toEqual([])
    } finally { watch.disconnect() }
  })

  it('records attribute replacement and explicit truncation, excluding composer contents', () => {
    document.body.innerHTML = '<flow-rich-text-editor>PRIVATE EDITOR</flow-rich-text-editor><flow-image-tile data-tile-id="old"></flow-image-tile>'
    const watch = dom.observeLiveGallery(document, PAGE)
    try {
      watch.read()
      const tile = document.querySelector('flow-image-tile')
      tile.setAttribute('data-tile-id', 'new')
      tile.textContent = 'x'.repeat(20000)
      const snapshot = watch.read()
      expect(snapshot.truncated).toBe(true)
      expect(snapshot.mutations).toEqual(expect.arrayContaining([expect.objectContaining({ attribute: 'data-tile-id', oldValue: 'old' })]))
      expect(JSON.stringify(snapshot)).not.toContain('PRIVATE EDITOR')
    } finally { watch.disconnect() }
  })

  it('serializes the probe into a distinct isolated global without touching main-world globals', () => {
    document.body.innerHTML = '<flow-image-tile></flow-image-tile>'
    const code = dom.liveGalleryCode('test_live_1107')
    try {
      expect(window.eval(code).cards).toHaveLength(1)
      expect(window.eval(dom.liveGalleryCode('test_live_1107', 'stop'))).toBe(true)
      expect(window.test_live_1107).toBeUndefined()
      expect(code).not.toMatch(/setAttribute|innerHTML\s*=|\.fetch\s*=|XMLHttpRequest/)
    } finally { window.eval(dom.liveGalleryCode('test_live_1107', 'stop')) }
  })

  it('retains text-node transitions between polls', () => {
    document.body.innerHTML = '<main><flow-image-tile><span>pending</span></flow-image-tile></main>'
    const watch = dom.observeLiveGallery(document, PAGE)
    try {
      watch.read()
      document.querySelector('span').firstChild.nodeValue = 'complete prompt'
      expect(watch.read().mutations).toEqual(expect.arrayContaining([
        expect.objectContaining({ type: 'characterData', oldValue: 'pending', text: 'complete prompt' }),
      ]))
    } finally { watch.disconnect() }
  })

  it('excludes unrelated siblings even when their parent contains gallery cards', () => {
    document.body.innerHTML = '<main><flow-image-tile></flow-image-tile></main>'
    const watch = dom.observeLiveGallery(document, PAGE)
    try {
      watch.read()
      document.querySelector('main').insertAdjacentHTML('beforeend', '<aside>PRIVATE SIDEBAR</aside>')
      document.querySelector('main').insertAdjacentHTML('beforeend', '<section><flow-image-tile>RESULT</flow-image-tile><aside>PRIVATE NESTED SIDEBAR</aside></section>')
      const snapshot = watch.read()
      expect(JSON.stringify(snapshot)).not.toContain('PRIVATE')
      expect(JSON.stringify(snapshot.mutations)).toContain('RESULT')
    } finally { watch.disconnect() }
  })

  it('distinguishes observer reinstalls in the same document before reusing local node IDs', () => {
    document.body.innerHTML = '<flow-image-tile></flow-image-tile>'
    const first = dom.observeLiveGallery(document, PAGE)
    const a = first.read()
    first.disconnect()
    const second = dom.observeLiveGallery(document, PAGE)
    try {
      const b = second.read()
      expect(a.observerId).toBeTruthy()
      expect(b.observerId).not.toBe(a.observerId)
    } finally { second.disconnect() }
  })

  it('retains transient textContent added and removed between polls', () => {
    document.body.innerHTML = '<flow-image-tile></flow-image-tile>'
    const watch = dom.observeLiveGallery(document, PAGE)
    try {
      watch.read()
      const tile = document.querySelector('flow-image-tile')
      tile.textContent = 'transient full prompt'
      tile.textContent = ''
      const snapshot = watch.read()
      expect(snapshot.mutations.flatMap(m => m.removed)).toEqual(expect.arrayContaining([
        expect.objectContaining({ tag: '#text', text: 'transient full prompt' }),
      ]))
    } finally { watch.disconnect() }
  })

  it('keeps a burst of text-node mutations bounded and marks lost evidence', () => {
    document.body.innerHTML = '<flow-image-tile></flow-image-tile>'
    const watch = dom.observeLiveGallery(document, PAGE)
    try {
      watch.read()
      const fragment = document.createDocumentFragment()
      // Large enough to exceed the recorder budget without spending seconds
      // constructing tens of thousands of real JSDOM sibling nodes.
      for (let i = 0; i < 1500; i++) fragment.append(document.createTextNode('.'))
      document.querySelector('flow-image-tile').append(fragment)
      const snapshot = watch.read()
      expect(snapshot.truncated).toBe(true)
      expect(snapshot.mutations.flatMap(m => m.added).length).toBeLessThan(1500)
      expect(JSON.stringify(snapshot).length).toBeLessThan(1024 * 1024)
    } finally { watch.disconnect() }
  })
})

function harness(extra = {}) {
  const wc = Object.assign(new EventEmitter(), { id: 7, getURL: () => PAGE, isDestroyed: () => false,
    executeJavaScriptInIsolatedWorld: vi.fn(async () => ({ cards: [], mutations: [], truncated: false })) })
  const rows = []
  const io = { mkdirSync: vi.fn(), appendFileSync: vi.fn((_file, line) => rows.push(JSON.parse(line))) }
  const env = { AUTOFLOWCUT_FLOW_LIVE_DIAGNOSTICS: '1', AUTOFLOWCUT_FLOW_LIVE_PROJECT_ID: PROJECT,
    AUTOFLOWCUT_FLOW_LIVE_DIR: '/Users/tuxxon/workspace/afc-codex/live' }
  return { wc, io, env, rows, ...extra }
}

describe('opt-in scoped main-process recorder', () => {
  it('opens only an explicitly configured diagnostic project at startup', () => {
    const { env } = harness()
    expect(diagnostics.flowLiveProjectUrl(env)).toBe(PAGE)
    expect(diagnostics.flowLiveProjectUrl({ ...env, AUTOFLOWCUT_FLOW_LIVE_DIAGNOSTICS: '0' })).toBeNull()
    expect(diagnostics.flowLiveProjectUrl({ ...env, AUTOFLOWCUT_FLOW_LIVE_PROJECT_ID: 'other/path' })).toBeNull()
    expect(diagnostics.flowLiveProjectUrl({ ...env, AUTOFLOWCUT_FLOW_LIVE_DIR: 'relative' })).toBeNull()
  })
  it.each([{}, { AUTOFLOWCUT_FLOW_LIVE_DIAGNOSTICS: '1' },
    { AUTOFLOWCUT_FLOW_LIVE_DIAGNOSTICS: '1', AUTOFLOWCUT_FLOW_LIVE_PROJECT_ID: PROJECT, AUTOFLOWCUT_FLOW_LIVE_DIR: 'relative' }])('has zero effects with disabled/incomplete configuration: %j', async env => {
    vi.useFakeTimers()
    const h = harness({ env })
    const recorder = diagnostics.createFlowLiveDiagnostics({ webContents: h.wc, ...h })
    await recorder.sample()
    recorder.before(request())
    recorder.dispose()
    expect(h.io.mkdirSync).not.toHaveBeenCalled()
    expect(h.wc.executeJavaScriptInIsolatedWorld).not.toHaveBeenCalled()
    expect(h.wc.eventNames()).toEqual([])
    expect(vi.getTimerCount()).toBe(0)
  })

  it('records only the selected project/view, strips credentials, captures completion, then cleans up', async () => {
    vi.useFakeTimers()
    const h = harness()
    const recorder = diagnostics.createFlowLiveDiagnostics({ webContents: h.wc, ...h })
    try {
      await recorder.sample()
      const raw = request({ url: request().url + '&at=SECRET&authuser=PRIVATE' })
      recorder.before(raw)
      recorder.completed({ ...raw, statusCode: 200, responseHeaders: { authorization: 'SECRET' } })
      expect(h.rows.find(r => r.kind === 'request')).toMatchObject({ requestId: 10, rpcid: 'ogiZ0b' })
      expect(h.rows.find(r => r.kind === 'completed')).toMatchObject({ requestId: 10, statusCode: 200 })
      expect(JSON.stringify(h.rows)).not.toMatch(/SECRET|PRIVATE|responseHeaders|uploadData/)
      expect(h.wc.executeJavaScriptInIsolatedWorld.mock.calls[0][0]).toBe(994)
      const requests = h.rows.filter(r => r.kind === 'request').length
      recorder.before(request({ webContentsId: 8 }))
      h.wc.getURL = () => PAGE.replace(PROJECT, NEW)
      recorder.before(request())
      await recorder.sample()
      expect(h.rows.filter(r => r.kind === 'request')).toHaveLength(requests)
    } finally { recorder.dispose() }
    expect(vi.getTimerCount()).toBe(0)
    expect(h.wc.eventNames()).toEqual([])
  })

  it('disables on disk failure without throwing or recording subsequent requests', () => {
    vi.useFakeTimers()
    const h = harness()
    h.io.appendFileSync.mockImplementation(() => { throw new Error('disk full') })
    expect(() => {
      const recorder = diagnostics.createFlowLiveDiagnostics({ webContents: h.wc, ...h })
      recorder.before(request())
      recorder.dispose()
    }).not.toThrow()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('retains payload UUIDs and image facts without saving embedded reCAPTCHA tokens', () => {
    vi.useFakeTimers()
    const h = harness()
    const recorder = diagnostics.createFlowLiveDiagnostics({ webContents: h.wc, ...h })
    try {
      recorder.before(request({}, inner => {
        inner[3][10] = ['CAPTCHA_SECRET', 1]
        inner[1][0][7][10] = ['CAPTCHA_SECRET', 1]
        inner[4] = [NEW]
      }))
      const row = h.rows.find(r => r.kind === 'request')
      expect(row.payloadUuids).toContain(NEW)
      expect(row.imageRequest).toMatchObject({ projectId: PROJECT, count: 1 })
      expect(JSON.stringify(h.rows)).not.toContain('CAPTCHA_SECRET')
    } finally { recorder.dispose() }
  })

  it('disconnects on SPA navigation away from the selected project', async () => {
    vi.useFakeTimers()
    const h = harness()
    const recorder = diagnostics.createFlowLiveDiagnostics({ webContents: h.wc, ...h })
    try {
      await recorder.sample()
      h.wc.executeJavaScriptInIsolatedWorld.mockClear()
      h.wc.getURL = () => PAGE.replace(PROJECT, NEW)
      h.wc.emit('did-navigate-in-page')
      expect(h.wc.executeJavaScriptInIsolatedWorld).toHaveBeenCalled()
      expect(h.wc.executeJavaScriptInIsolatedWorld.mock.calls.at(-1)[1][0].code).toContain('disconnect')
    } finally { recorder.dispose() }
  })

  it('bounds output and stops on view destruction', async () => {
    vi.useFakeTimers()
    const h = harness()
    const recorder = diagnostics.createFlowLiveDiagnostics({ webContents: h.wc, ...h, maxBytes: 2000 })
    h.wc.executeJavaScriptInIsolatedWorld.mockResolvedValue({ cards: ['x'.repeat(3000)], mutations: [] })
    await recorder.sample()
    expect(h.rows.at(-1)).toMatchObject({ kind: 'stop', reason: 'size-limit' })
    h.wc.emit('destroyed')
    recorder.dispose()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('disconnects a late observer installed by an in-flight read after disposal', async () => {
    vi.useFakeTimers()
    const h = harness()
    let resolve
    h.wc.executeJavaScriptInIsolatedWorld.mockImplementationOnce(() => new Promise(r => { resolve = r }))
    const recorder = diagnostics.createFlowLiveDiagnostics({ webContents: h.wc, ...h })
    const sample = recorder.sample()
    recorder.dispose()
    resolve({ cards: [], mutations: [] })
    await sample
    expect(h.rows.filter(r => r.kind === 'dom')).toHaveLength(0)
    expect(h.wc.executeJavaScriptInIsolatedWorld.mock.calls.at(-1)[1][0].code).toContain('disconnect')
    expect(vi.getTimerCount()).toBe(0)
  })

  it('discards a read that crosses an A→B→A navigation even if the final URL matches', async () => {
    vi.useFakeTimers()
    const h = harness()
    let resolve
    h.wc.executeJavaScriptInIsolatedWorld.mockImplementationOnce(() => new Promise(r => { resolve = r }))
    const recorder = diagnostics.createFlowLiveDiagnostics({ webContents: h.wc, ...h })
    try {
      const sample = recorder.sample()
      h.wc.getURL = () => PAGE.replace(PROJECT, NEW)
      h.wc.emit('did-navigate-in-page')
      h.wc.getURL = () => PAGE
      h.wc.emit('did-navigate-in-page')
      resolve({ page: PAGE.replace(PROJECT, NEW), cards: ['FOREIGN SNAPSHOT'], mutations: [] })
      await sample
      expect(JSON.stringify(h.rows)).not.toContain('FOREIGN SNAPSHOT')
    } finally { recorder.dispose() }
  })
})

it('composes diagnostic lifecycle events without replacing listeners or affecting request ownership', () => {
  const hooks = {}
  const session = { webRequest: Object.fromEntries(['onBeforeRequest', 'onCompleted', 'onErrorOccurred']
    .map(name => [name, vi.fn((_filter, fn) => { hooks[name] = fn })])) }
  const observer = createPassiveCapture()
  const diagnostic = { before: vi.fn(() => { throw new Error('diagnostic failure') }), completed: vi.fn(), failed: vi.fn() }
  const dispose = bindPassiveRequests(session, observer, () => {}, diagnostic)
  const lease = observer.begin({ webContentsId: 7, projectId: PROJECT, prompt: '궁정안에 있는 왕', count: 1 })
  lease.prepare()
  const callback = vi.fn()
  hooks.onBeforeRequest(request(), callback)
  hooks.onCompleted({ id: 10, statusCode: 200 })
  hooks.onErrorOccurred({ id: 99 })
  expect(callback).toHaveBeenCalledExactlyOnceWith({})
  expect(diagnostic.before).toHaveBeenCalledOnce()
  expect(diagnostic.completed).toHaveBeenCalledOnce()
  expect(diagnostic.failed).toHaveBeenCalledOnce()
  expect(lease.state()).toMatchObject({ error: null, complete: true })
  dispose()
})
