// @vitest-environment node
import { EventEmitter } from 'node:events'
import { readFile } from 'node:fs/promises'
import { basename } from 'node:path'
import { expect, it, vi } from 'vitest'
import { createPassiveImageGenerator } from '../../electron/flow-passive-image.js'
import { createPassiveCapture } from '../../electron/flow-passive-capture.js'
import { referencePreflight } from '../../electron/ipc/flow-angular.js'
import { imageResultsFromNetLog, netLogResponseBody, videoResultFromNetLog } from '../../electron/flow-native-response.js'
import { decodeFReqInner, extractSubmitPrompts, parseBatchexecuteResponse, parseUploadResponse } from '../../electron/flow-rpc-protocol.js'
import { s3, s3Payload, s3RequestBody } from '../fixtures/flow-m3-samples.js'
import { PROJECT, PAGE } from '../fixtures/flow-passive-image.js'

vi.mock('electron', () => ({ screen: { getAllDisplays: () => [] } }))
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j9ZkAAAAASUVORK5CYII=', 'base64')
const refId = parseUploadResponse(s3Payload(2)).mediaId
const node = (role, name, fields = {}) => ({ role, name, children: [], enabled: true, ...fields })
const button = (name, action, fields) => node('Button', name, { action, ...fields })
const radio = name => node('RadioButton', name, { selected: true })
function responseLog(url, body) {
  const bytes = Buffer.from(body)
  const event = (type, params, phase = 0) => ({ source: { id: 12, type: 1 }, type, params, phase })
  return JSON.stringify({
    constants: { logSourceType: { URL_REQUEST: 1 }, logEventTypes: {
      URL_REQUEST_START_JOB: 1, HTTP_TRANSACTION_READ_RESPONSE_HEADERS: 2, URL_REQUEST_JOB_FILTERED_BYTES_READ: 3,
    } },
    events: [event(1, { url, method: 'POST' }, 1), event(2, { headers: ['HTTP/1.1 200 OK'] }),
      event(3, { bytes: bytes.toString('base64'), byte_count: bytes.length })],
  })
}

function setup(video, fault, saved = null) {
  const step = video ? 10 : 3
  const recorded = s3(step)
  const generation = decodeFReqInner(s3RequestBody(step))
  const text = extractSubmitPrompts(recorded.rpcid, generation.inner)[0]
  const capture = createPassiveCapture()
  const submissions = vi.fn()
  const pageJS = vi.fn(() => { throw new Error('Page JavaScript is forbidden') })
  const savedId = saved?.mediaId || null
  const expectedId = savedId || refId
  const createFromBuffer = vi.fn(() => ({ isEmpty: () => false, toPNG: () => png, toBitmap: () => png,
    getSize: () => ({ width: 1, height: 1 }) }))
  const state = { settings: false, picker: false, panel: false, focused: false, searchFocused: false,
    search: '', text: '', mention: '', filename: '' }
  const wc = Object.assign(new EventEmitter(), {
    id: 7, session: {}, getURL: () => PAGE, isDestroyed: () => false, focus: vi.fn(),
    executeJavaScript: pageJS, executeJavaScriptInIsolatedWorld: pageJS,
    async insertText(value) {
      if (value === '@') state.picker = true
      else if (state.searchFocused) state.search += value
      else state.text += value
    },
    selectAll() { if (state.searchFocused) state.search = ''; else state.text = '' },
    sendInputEvent(event) { if (event.keyCode === 'Escape') state.picker = false },
  })
  const view = { webContents: wc }
  function observeRequest(inner, rpcid, id) {
    const form = new URLSearchParams({ 'f.req': JSON.stringify([[[rpcid, JSON.stringify(inner), null, 'generic']]]) })
    const url = 'https://flow.google.com/_/AiSandboxAngularFrontend/data/batchexecute?rpcids=' + rpcid
    capture.before({ id, webContentsId: wc.id, method: 'POST', url, uploadData: [{ bytes: Buffer.from(form.toString()) }] })
    capture.completed({ id, statusCode: 200, fromCache: false })
  }
  const leaves = () => [
    ...(state.text ? [node('StaticText', state.text)] : []),
    ...(state.mention ? [node('StaticText', state.mention)] : []),
  ]
  const snapshot = () => {
    const editor = node('TextArea', 'Prompt', { focused: state.focused, value: state.text + state.mention,
      children: leaves(), action: () => { state.focused = true } })
    const generate = button('생성 시작', () => {
      submissions(text)
      const mentionSegment = [null, [[expectedId, state.mention]]]
      const prompt = video ? generation.inner[0][0][0][2] : generation.inner[1][0][8]
      prompt[0] = [[text], mentionSegment]
      observeRequest(generation.inner, recorded.rpcid, 10)
    })
    const children = [editor, generate, node('CheckBox', '에이전트', { selected: false }),
      button('설정 트리거', () => { state.settings = !state.settings }),
      button('프롬프트 상자에 소재 추가', () => { state.picker = true })]
    if (state.settings) children.push(radio(video ? '동영상' : '이미지'), radio('9:16'), radio('x1'),
      button('모델 제품군 선택', undefined, { children: [node('StaticText', video ? 'Omni 1.1 Flash' : 'Nano Banana 2.1')] }),
      ...(video ? [radio('4초'), radio('720p'), radio('소재')] : []))
    if (state.picker) {
      const filename = fault === 'wrong picker name' ? 'another.png' : state.filename
      const item = node('StaticText', saved?.title || filename, { action: () => {
        state.mention = saved?.title || state.filename; state.picker = false; state.searchFocused = false
      } })
      if (saved?.searchable) children.push(node('TextField', 'Search assets', { value: state.search, focused: state.searchFocused,
        action: () => { state.searchFocused = true } }))
      const visibleSaved = !saved?.searchable || state.search.toLowerCase().includes(saved.title.toLowerCase())
      children.push(node('List', '자산 목록', { children: (state.filename || (saved?.title && visibleSaved)) ? [item] : [] }),
        button('미디어 업로드', () => { state.panel = true }))
    }
    if (state.mention && fault !== 'missing chip') {
      const id = fault === 'wrong chip ID' || state.chipReplaced ? 'eeeeeeee-0000-4000-8000-000000000000' : expectedId
      const mediaKey = saved?.asbKey || (saved?.opaque ? null : 'media:' + id)
      children.push(button('소재', undefined, {
        children: [node('Image', state.mention, mediaKey ? { mediaKey } : {})],
      }))
    }
    return node('WebArea', 'Google Flow', { children })
  }
  const ax = {
    snapshot,
    ...(saved?.opaque ? { imageSource: vi.fn(async (_view, selectNode, guard) => {
      guard?.()
      selectNode(snapshot())
      const urls = saved.imageUrls || [saved.imageUrl || 'https://lh3.googleusercontent.com/asb/TOKEN']
      const index = ax.imageSource.mock.calls.length - 1
      return urls[Math.min(index, urls.length - 1)]
    }) } : {}),
    async click(_view, select, options = {}) {
      if (options.beforeDispatch && !await options.beforeDispatch()) return { success: false }
      if (options.step === 'compose-submit' && fault === 'last-moment wrong chip') state.chipReplaced = true
      const root = snapshot()
      const target = select(root)
      if (!target.enabled || (options.validateSnapshot && !options.validateSnapshot(root))) return { success: false }
      options.dispatchGuard?.()
      options.onDispatched?.()
      target.action()
      return { success: true }
    },
    async openFile(filename) {
      expect(state.panel).toBe(true)
      state.panel = false
      const bytes = await readFile(filename)
      expect(bytes).toEqual(png)
      state.filename = basename(filename)
      const upload = decodeFReqInner(s3RequestBody(2)).inner
      upload[1] = bytes.toString('base64')
      upload[2] = 'image/png'
      upload[8] = state.filename
      observeRequest(upload, 'maseQ', 9)
    },
  }
  const owned = vi.fn((url, request) => {
    if (request.rpcid === 'maseQ') {
      const raw = netLogResponseBody(responseLog(url, s3(2).respBody), url)
      const receipt = parseBatchexecuteResponse(raw, 'maseQ')
      expect(receipt[0][1]).toBe(request.projectId)
      return parseUploadResponse(receipt)
    }
    expect(request).toMatchObject({ refs: [expectedId], mentions: [expectedId], prompts: [text], count: 1 })
    const log = responseLog(url, recorded.respBody)
    return video ? videoResultFromNetLog(log, url, request) : imageResultsFromNetLog(log, url, request)
  })
  const deps = {
    getFlowView: () => view, getMainWindow: () => null, passiveCapture: capture, flowAccessibility: ax,
    nativeImage: { createFromBuffer },
    typeFlowText: pageJS, trustedClickOnFlowView: pageJS,
    startResponseCapture: async () => ({ assertReady() {}, finish: owned, async cancel() {} }),
    downloadPassiveImage: vi.fn(async itemSession => { expect(itemSession).toBe(wc.session); return { collected: true } }),
    ...(saved ? { nativeReadRpc: vi.fn(async (_view, rpcid, payload) => {
      if (rpcid === 'Zzl0ze') {
        expect(payload).toEqual(['projects/' + PROJECT, null, null, null, [1]])
        return saved.rows
      }
      expect(rpcid).toBe('as29s')
      expect(payload).toEqual([saved.mediaId])
      const meta = []
      meta[10] = saved.recordUrl || 'https://lh3.googleusercontent.com/asb/TOKEN'
      return [saved.mediaId, saved.recordProject || PROJECT, saved.recordWorkflowId || 'f8b2b7be-36d8-42f8-96db-7ee991f5df1c', null, null, meta]
    }) } : {}),
  }
  const generate = createPassiveImageGenerator(deps, (_view, _name, action) => action({ aborted: false }), referencePreflight)
  const payload = {
    prompt: text + ' @CupPalette', model: video ? 'Omni Flash' : 'Nano Banana 2.1',
    projectId: PROJECT, aspectRatio: '9:16', duration: 4, resolution: '720p',
    refs: [saved ? { name: 'CupPalette', mediaId: saved.mediaId } : { name: 'CupPalette', base64: png.toString('base64'), mime: 'image/png' }],
    plan: { segments: [{ t: 'text', text: text + ' ' }, { t: 'mention', ref: 0 }], attach: [] },
  }
  return { run: () => generate(payload, undefined, undefined, video ? 'r2v' : null), pageJS, owned, submissions,
    deps, ax, state, expectedId, openFile: ax.openFile }
}

const SAVED_ID = refId
const WORKFLOW_ID = 'f8b2b7be-36d8-42f8-96db-7ee991f5df1c'
const savedWorkflow = (workflowId = 'f8b2b7be-36d8-42f8-96db-7ee991f5df1c', mediaId = SAVED_ID,
  project = PROJECT, title = 'CupPalette-from-Flow') => {
  const row = []
  row[0] = workflowId
  row[3] = [title]
  row[3][4] = mediaId
  row[4] = project
  return row
}

const opaqueSaved = (overrides = {}) => ({ mediaId: SAVED_ID, title: 'CupPalette-from-Flow', opaque: true,
  rows: [null, [savedWorkflow(WORKFLOW_ID)]], ...overrides })

it.each(['image', 'R2V'])('reuses a saved project mediaId for %s without local bytes or upload', async kind => {
  const h = setup(kind === 'R2V', null, { mediaId: SAVED_ID, title: 'CupPalette-from-Flow', rows: [null, [savedWorkflow()]] })
  const imageFromBytes = h.deps.nativeImage.createFromBuffer
  const openFile = vi.spyOn(h.ax, 'openFile')
  const result = await h.run()
  expect(result.success).toBe(true)
  expect(h.owned).toHaveBeenCalledTimes(1)
  expect(h.submissions).toHaveBeenCalledTimes(1)
  expect(h.deps.nativeReadRpc).toHaveBeenCalledTimes(1)
  expect(openFile).not.toHaveBeenCalled()
  expect(imageFromBytes).not.toHaveBeenCalled()
  expect(h.pageJS).not.toHaveBeenCalled()
})

it('accepts an opaque saved chip only when its ASB token matches the native media record', async () => {
  const h = setup(false, null, opaqueSaved())
  const result = await h.run()
  expect(h.deps.flowAccessibility.imageSource).toHaveBeenCalledTimes(2)
  expect(h.deps.nativeReadRpc.mock.calls.map(([, rpcid, payload]) => [rpcid, payload])).toEqual([
    ['Zzl0ze', ['projects/' + PROJECT, null, null, null, [1]]], ['as29s', [SAVED_ID]],
  ])
  expect(result.success).toBe(true)
  expect(h.submissions).toHaveBeenCalledTimes(1)
})

it('accepts AX mediaKey asb:TOKEN with a matching native record without imageSource', async () => {
  const h = setup(false, null, opaqueSaved({ asbKey: 'asb:TOKEN' }))
  const result = await h.run()
  expect(result.success).toBe(true)
  expect(h.deps.flowAccessibility.imageSource).not.toHaveBeenCalled()
  expect(h.deps.nativeReadRpc).toHaveBeenCalledWith(h.deps.getFlowView(), 'as29s', [SAVED_ID])
})

it('rejects AX mediaKey asb:OTHER when native media record identifies asb:TOKEN', async () => {
  const h = setup(false, null, opaqueSaved({ asbKey: 'asb:OTHER' }))
  const result = await h.run()
  expect(result.success).toBe(false)
  expect(h.submissions).not.toHaveBeenCalled()
  expect(h.deps.flowAccessibility.imageSource).not.toHaveBeenCalled()
  expect(h.deps.nativeReadRpc).toHaveBeenCalledWith(h.deps.getFlowView(), 'as29s', [SAVED_ID])
})

it('searches an initially empty project asset picker by the verified title', async () => {
  const h = setup(false, null, { mediaId: SAVED_ID, title: 'CupPalette-from-Flow', searchable: true,
    rows: [null, [savedWorkflow(WORKFLOW_ID)]] })
  const openFile = vi.spyOn(h.ax, 'openFile')
  const result = await h.run()
  expect(h.state.search).toBe('CupPalette-from-Flow')
  expect(result.success).toBe(true)
  expect(h.submissions).toHaveBeenCalledTimes(1)
  expect(openFile).not.toHaveBeenCalled()
})

it.each([
  ['wrong ASB token', opaqueSaved({ imageUrl: 'https://lh3.googleusercontent.com/asb/OTHER' })],
  ['wrong workflow', opaqueSaved({ recordWorkflowId: '867f308d-69bd-4d16-8dab-1aa4a3a8a026' })],
])('rejects an opaque chip with %s before submit', async (_case, saved) => {
  const h = setup(false, null, saved)
  const openFile = vi.spyOn(h.ax, 'openFile')
  const result = await h.run()
  expect(result.success).toBe(false)
  expect(h.submissions).not.toHaveBeenCalled()
  expect(h.deps.flowAccessibility.imageSource).toHaveBeenCalledTimes(1)
  expect(h.deps.nativeReadRpc).toHaveBeenCalledWith(h.deps.getFlowView(), 'as29s', [SAVED_ID])
  expect(openFile).not.toHaveBeenCalled()
})

it('rechecks an opaque thumbnail before submit and rejects a token that changes after initial proof', async () => {
  const h = setup(false, null, opaqueSaved({ imageUrls: [
    'https://lh3.googleusercontent.com/asb/TOKEN', 'https://lh3.googleusercontent.com/asb/OTHER',
  ] }))
  const result = await h.run()
  expect(result.success).toBe(false)
  expect(h.deps.flowAccessibility.imageSource).toHaveBeenCalledTimes(2)
  expect(h.deps.nativeReadRpc.mock.calls.filter(([, rpcid]) => rpcid === 'as29s')).toHaveLength(1)
  expect(h.submissions).not.toHaveBeenCalled()
})

it.each([
  ['ambiguous title', [null, [savedWorkflow(), savedWorkflow('867f308d-69bd-4d16-8dab-1aa4a3a8a026', '7f27ef43-e0f3-47cb-9ef2-1e19d9c191da')]]],
  ['foreign project', [null, [savedWorkflow('f8b2b7be-36d8-42f8-96db-7ee991f5df1c', SAVED_ID, '00000000-0000-4000-8000-000000000000')]]],
  ['missing media row', [null, []]],
  ['matching workflow ID with a different media UUID', [null, [savedWorkflow(SAVED_ID, '7f27ef43-e0f3-47cb-9ef2-1e19d9c191da')]]],
])('rejects saved references with %s before submit and without opening the file panel', async (_case, rows) => {
  const h = setup(false, null, { mediaId: SAVED_ID, title: 'CupPalette-from-Flow', rows })
  const openFile = vi.spyOn(h.ax, 'openFile')
  const result = await h.run()
  expect(result.success).toBe(false)
  expect(h.submissions).not.toHaveBeenCalled()
  expect(h.deps.nativeReadRpc).toHaveBeenCalledTimes(1)
  expect(openFile).not.toHaveBeenCalled()
  expect(h.pageJS).not.toHaveBeenCalled()
})

it.each(['image', 'R2V'])('completes one %s submission with a verified trailing inline reference and no page JS', async kind => {
  const video = kind === 'R2V'
  const h = setup(video)
  const result = await h.run()
  expect(result).toMatchObject(video
    ? { success: true, generationId: s3Payload(10)[3][0][0] }
    : { success: true, images: [{ collected: true }], flowSubmission: { postClick: true } })
  expect(h.owned).toHaveBeenCalledTimes(2)
  expect(h.submissions).toHaveBeenCalledTimes(1)
  expect(h.pageJS).not.toHaveBeenCalled()
})
it.each([
  ['wrong picker name', 'reference-asset-not-unique'],
  ['missing chip', 'reference-chip-not-added'],
  ['wrong chip ID', 'reference-media-id-mismatch'],
  ['last-moment wrong chip', 'submit-unconfirmed'],
])(
  'rejects %s before generating', async (fault, reason) => {
    const h = setup(false, fault)
    expect(await h.run()).toMatchObject({ success: false, reason })
    expect(h.submissions).not.toHaveBeenCalled()
    expect(h.pageJS).not.toHaveBeenCalled()
  }, 12000)
