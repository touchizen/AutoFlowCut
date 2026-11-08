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

function setup(video, fault) {
  const step = video ? 10 : 3
  const recorded = s3(step)
  const generation = decodeFReqInner(s3RequestBody(step))
  const text = extractSubmitPrompts(recorded.rpcid, generation.inner)[0]
  const capture = createPassiveCapture()
  const submissions = vi.fn()
  const pageJS = vi.fn(() => { throw new Error('Page JavaScript is forbidden') })
  const state = { settings: false, picker: false, panel: false, focused: false, text: '', mention: '', filename: '' }
  const wc = Object.assign(new EventEmitter(), {
    id: 7, session: {}, getURL: () => PAGE, isDestroyed: () => false, focus: vi.fn(),
    executeJavaScript: pageJS, executeJavaScriptInIsolatedWorld: pageJS,
    async insertText(value) {
      if (value === '@') state.picker = true
      else state.text += value
    },
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
      const mentionSegment = [null, [[refId, state.mention]]]
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
      const item = node('StaticText', filename, { action: () => {
        state.mention = state.filename; state.picker = false
      } })
      children.push(node('List', '자산 목록', { children: state.filename ? [item] : [] }),
        button('미디어 업로드', () => { state.panel = true }))
    }
    if (state.mention && fault !== 'missing chip') {
      const id = fault === 'wrong chip ID' || state.chipReplaced ? 'eeeeeeee-0000-4000-8000-000000000000' : refId
      children.push(button('소재', undefined, {
        children: [node('Image', state.mention, { mediaKey: 'media:' + id })],
      }))
    }
    return node('WebArea', 'Google Flow', { children })
  }
  const ax = {
    snapshot,
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
    expect(request).toMatchObject({ refs: [refId], mentions: [refId], prompts: [text], count: 1 })
    const log = responseLog(url, recorded.respBody)
    return video ? videoResultFromNetLog(log, url, request) : imageResultsFromNetLog(log, url, request)
  })
  const deps = {
    getFlowView: () => view, getMainWindow: () => null, passiveCapture: capture, flowAccessibility: ax,
    nativeImage: { createFromBuffer: () => ({ isEmpty: () => false, toPNG: () => png, toBitmap: () => png,
      getSize: () => ({ width: 1, height: 1 }) }) },
    typeFlowText: pageJS, trustedClickOnFlowView: pageJS,
    startResponseCapture: async () => ({ assertReady() {}, finish: owned, async cancel() {} }),
    downloadPassiveImage: vi.fn(async itemSession => { expect(itemSession).toBe(wc.session); return { collected: true } }),
  }
  const generate = createPassiveImageGenerator(deps, (_view, _name, action) => action({ aborted: false }), referencePreflight)
  const payload = {
    prompt: text + ' @CupPalette', model: video ? 'Omni Flash' : 'Nano Banana 2.1',
    projectId: PROJECT, aspectRatio: '9:16', duration: 4, resolution: '720p',
    refs: [{ name: 'CupPalette', base64: png.toString('base64'), mime: 'image/png' }],
    plan: { segments: [{ t: 'text', text: text + ' ' }, { t: 'mention', ref: 0 }], attach: [] },
  }
  return { run: () => generate(payload, undefined, undefined, video ? 'r2v' : null), pageJS, owned, submissions }
}

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
