// @vitest-environment node
//
// M1-14a — 페이지 주입 문자열은 프로덕션에서 minify 된 main 번들에서 toString() 으로 만들어진다. 이름이 뭉개져도
// 동작해야 한다(flow-agent-toggle-minified.test.js 가 잡은 실제 장애). 각 모듈을 esbuild --minify 로 번들한 뒤
// **minified 문자열로** 실제 동작을 확인한다 — 설치 플래그만 보지 않고 send/loadend 페이로드까지.
// 규칙: 직렬화된 헬퍼는 서로를 이름으로 부르지 않는다 — 호출 지점에서 조합(정적 단언).
import { describe, it, expect, beforeAll, vi } from 'vitest'
import { buildSync } from 'esbuild'
import { JSDOM } from 'jsdom'
import vm from 'node:vm'
import { fileURLToPath } from 'node:url'
import { writeFileSync, mkdtempSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import * as plainCapture from '../../electron/flow-rpc-capture.js'
import * as plainClient from '../../electron/flow-rpc-client.js'
import * as plainDom from '../../electron/flow-composer-dom.js'
import * as plainToggle from '../../electron/flow-agent-toggle.js'
import * as plainSettings from '../../electron/flow-composer-settings.js'
import * as plainAngular from '../../electron/ipc/flow-angular.js'
import * as plainProtocol from '../../electron/flow-rpc-protocol.js'
import * as plainRefs from '../../electron/flow-composer-refs.js'
import * as plainDriver from '../../electron/flow-reference-driver.js'
import { sample, reencodeRequestBody, maskedUuid } from '../fixtures/flow-batchexecute-samples.js'
import { s3, s3RequestBody } from '../fixtures/flow-m3-samples.js'
import { PAGE_IMAGE_KO, PAGE_VIDEO_KO, CARD_MENU_BUTTONS, PROJECT_MENU_BUTTON, IMAGE_COMPOSER_KO, VIDEO_COMPOSER_KO, buildSettingsPanel } from '../fixtures/flow-live-dom-20260924.js'
import { buildPage as buildM3Page, mentionHtml, paragraph } from '../fixtures/flow-live-dom-m3.js'

const SRC = (rel) => fileURLToPath(new URL(rel, import.meta.url))
async function loadMinified(rel) {
  // electron 은 vite 빌드처럼 external — 번들에 인라인하면 electron/index.js 가 path.txt 를 찾다 throw 한다.
  const out = buildSync({ entryPoints: [SRC(rel)], bundle: true, minify: true, format: 'esm', write: false, platform: 'node', external: ['electron'] })
  const dir = mkdtempSync(join(tmpdir(), 'flow-inj-min-'))
  const file = join(dir, 'bundle.mjs')
  writeFileSync(file, out.outputFiles[0].text)
  return import(file)
}

class FakeXHR {
  constructor() { this._l = {}; this.responseType = ''; this.status = 0; this.responseText = ''; this.calls = [] }
  open(method, url) { this.calls.push(['open', method, url]) }
  setRequestHeader(k, v) { this.calls.push(['header', k, v]) }
  send(body) { this.calls.push(['send', body]) }
  addEventListener(type, fn) { (this._l[type] = this._l[type] || []).push(fn) }
  _finish(status, text) { this.status = status; this.responseText = text; for (const fn of this._l.loadend || []) fn.call(this) }
}
function vmPage(injection, { wiz } = {}) {
  class PageXHR extends FakeXHR {}
  const reports = []
  const windowObject = { XMLHttpRequest: PageXHR, location: { href: 'https://flow.google.com/project/x', pathname: '/project/x' }, electronAPI: { flowReportResponse: (p) => { reports.push(p); return Promise.resolve({ ok: true }) } } }
  if (wiz) windowObject.WIZ_global_data = wiz
  const context = vm.createContext({ window: windowObject, location: windowObject.location, XMLHttpRequest: PageXHR, document: { documentElement: { lang: 'ko' } }, console: { log() {}, warn() {}, error() {} }, Date: { now: () => 1790240102500 }, URL, URLSearchParams, JSON, String, Object, Number })
  if (injection) vm.runInContext(injection, context)
  return { windowObject, context, reports, PageXHR }
}
function runInPage(html, expr) {
  const dom = new JSDOM(`<body>${html}</body>`, { runScripts: 'outside-only' })
  dom.window.Element.prototype.getBoundingClientRect = () => ({ width: 100, height: 30 })
  return { dom, result: dom.window.eval(expr) }
}
const BATCH = 'https://flow.google.com/_/AiSandboxAngularFrontend/data/batchexecute?rpcids=ogiZ0b&source-path=%2Fproject%2Fx&bl=B&f.sid=S&hl=ko&_reqid=1&rt=c'

describe('minified 캡처 주입 — send/loadend 페이로드', () => {
  let mod
  beforeAll(async () => { mod = await loadMinified('../../electron/flow-rpc-capture.js') })

  it('ogiZ0b(S1)·YhhmEf(S2) 본문 → prompts/seq/doc, loadend → status/responseText (비-minified 와 동일)', () => {
    for (const M of [mod, plainCapture]) {
      const page = vmPage(M.FLOW_RPC_CAPTURE_INJECTION)
      const x1 = new page.windowObject.XMLHttpRequest(); x1.open('POST', BATCH); x1.send(reencodeRequestBody(sample('ogiZ0b').reqBody)); x1._finish(200, sample('ogiZ0b').respBody)
      const x2 = new page.windowObject.XMLHttpRequest(); x2.open('POST', BATCH.replace('rpcids=ogiZ0b', 'rpcids=YhhmEf')); x2.send(reencodeRequestBody(sample('YhhmEf').reqBody, { plus: true }))
      expect(page.reports[0]).toMatchObject({ kind: 'batchexecute-send', rpcid: 'ogiZ0b', seq: 1, prompts: ['궁정안에 있는 왕'], sentAt: 1790240102.5 })
      expect(page.reports[0].doc).toMatch(/^[0-9a-f]{32}$/)
      expect(page.reports[1]).toMatchObject({ kind: 'batchexecute', doc: page.reports[0].doc, seq: 1, status: 200, responseText: sample('ogiZ0b').respBody })
      expect(page.reports[2]).toMatchObject({ kind: 'batchexecute-send', rpcid: 'YhhmEf', seq: 2, prompts: ['왕이 궁전 내부를 산책하는 영상'] })
      expect(page.windowObject.__autoflowcut_rpc_capture__).toBe(true)
      expect(x1.calls.find((c) => c[0] === 'send')[1]).toBe(reencodeRequestBody(sample('ogiZ0b').reqBody))
    }
  })

  // M3-2: MZZa6b·maseQ 허용 + refs/mentions(직렬화된 extractSubmitRefs) — minified 번들이 같은 페이로드를 만든다. maseQ 는 prompts:[] 만.
  it('M3-2: S3#10·#17·#20(MZZa6b)·#19(ogiZ0b)·#4(maseQ) 페이로드가 비-minified 와 같다', () => {
    const U = maskedUuid
    const run = (M) => {
      const page = vmPage(M.FLOW_RPC_CAPTURE_INJECTION)
      for (const n of [10, 17, 20, 19, 4]) {
        const x = new page.windowObject.XMLHttpRequest()
        x.open('POST', BATCH.replace('rpcids=ogiZ0b', 'rpcids=' + s3(n).rpcid))
        x.send(s3RequestBody(n))
        expect(x.calls.find((c) => c[0] === 'send')[1]).toBe(s3RequestBody(n))
        if (n === 4) x._finish(200, s3(4).respBody)
      }
      return page.reports.map(({ doc, ...rest }) => rest)
    }
    const min = run(mod)
    expect(min).toEqual(run(plainCapture))
    expect(min[0]).toMatchObject({ rpcid: 'MZZa6b', prompts: ['The king walks slowly toward the camera'], refs: [U(2)], mentions: [] })
    expect(min[1]).toMatchObject({ rpcid: 'MZZa6b', refs: [U(2)], mentions: [U(2)] })
    expect(min[2]).toMatchObject({ rpcid: 'MZZa6b', refs: [U(52)], mentions: [U(52), U(52)] })
    expect(min[3]).toMatchObject({ rpcid: 'ogiZ0b', refs: [U(46)], mentions: [U(46), U(46)] })
    expect(min[4]).toEqual({ kind: 'batchexecute-send', rpcid: 'maseQ', rpcids: ['maseQ'], seq: 5, prompts: [], sentAt: 1790240102.5 })
    expect(min[5]).toMatchObject({ kind: 'batchexecute', rpcid: 'maseQ', seq: 5, status: 200, responseText: s3(4).respBody })
  })
})

describe('minified RPC 클라이언트 스크립트', () => {
  let mod
  beforeAll(async () => { mod = await loadMinified('../../electron/flow-rpc-client.js') })

  it('minified buildRpcRequest / readWizGlobals 는 비-minified 와 같은 요청을 만든다', () => {
    const args = { rpcid: 'nzlxg', payload: [], wiz: { at: 'A', sid: 'S', bl: 'B' }, hl: 'ko', sourcePath: '/project/x', reqid: 1 }
    expect(mod.buildRpcRequest(args)).toEqual(plainClient.buildRpcRequest(args))
    expect(mod.readWizGlobals({ SNlM0e: 'A', FdrFJe: 'S', cfb2h: 'B', oPEP7c: 'x' })).toEqual({ at: 'A', sid: 'S', bl: 'B' })
    expect(() => mod.buildRpcRequest({ ...args, rpcid: 'ogiZ0b' })).toThrow(/rpcid not allowed/)
  })

  it('minified 클라이언트가 실제로 XHR 을 열고 보낸다(open/헤더/body)', async () => {
    class SpyXHR extends FakeXHR { constructor() { super(); SpyXHR.last = this } }
    const windowObject = { XMLHttpRequest: SpyXHR, location: { pathname: '/project/x', href: 'https://flow.google.com/project/x' }, WIZ_global_data: { SNlM0e: 'A', FdrFJe: 'S', cfb2h: 'B' } }
    const context = vm.createContext({ window: windowObject, location: windowObject.location, XMLHttpRequest: SpyXHR, document: { documentElement: { lang: 'ko' } }, console: { log() {} }, Date, URL, URLSearchParams, JSON, String, Object, Number })
    const p = vm.runInContext(mod.FLOW_RPC_CALL_JS('nzlxg', '[]'), context)
    const expected = plainClient.buildRpcRequest({ rpcid: 'nzlxg', payload: [], wiz: { at: 'A', sid: 'S', bl: 'B' }, hl: 'ko', sourcePath: '/project/x', reqid: 1 })
    expect(SpyXHR.last.calls[0]).toEqual(['open', 'POST', expected.url])
    expect(SpyXHR.last.calls[SpyXHR.last.calls.length - 1]).toEqual(['send', expected.body])
    SpyXHR.last._finish(200, sample('nzlxg').respBody)
    await expect(p).resolves.toEqual({ status: 200, text: sample('nzlxg').respBody })
  })
})

describe('minified DOM 파인더·편집기·설정 스크립트 (K/D 픽스처, 비-minified 와 동일 결과)', () => {
  let dom, toggle, settings, angular
  beforeAll(async () => {
    dom = await loadMinified('../../electron/flow-composer-dom.js')
    toggle = await loadMinified('../../electron/flow-agent-toggle.js')
    settings = await loadMinified('../../electron/flow-composer-settings.js')
    angular = await loadMinified('../../electron/ipc/flow-angular.js')
  })

  it.each([['image', PAGE_IMAGE_KO], ['video', PAGE_VIDEO_KO]])('%s: FIND_GENERATE_BUTTON_JS · FIND_SETTINGS_TRIGGER_JS · AGENT_TOGGLE_SELECTOR · READ_EDITOR_TEXT_JS · READ_SETTINGS_SUMMARY_JS', (_n, html) => {
    const cases = [
      [dom.FIND_GENERATE_BUTTON_JS, plainDom.FIND_GENERATE_BUTTON_JS, (el) => el?.className],
      [dom.FIND_SETTINGS_TRIGGER_JS, plainDom.FIND_SETTINGS_TRIGGER_JS, (el) => el?.className],
      [toggle.AGENT_TOGGLE_SELECTOR, plainToggle.AGENT_TOGGLE_SELECTOR, (el) => el?.className],
      [dom.READ_EDITOR_TEXT_JS, plainDom.READ_EDITOR_TEXT_JS, (v) => v],
      [dom.READ_SETTINGS_SUMMARY_JS, plainDom.READ_SETTINGS_SUMMARY_JS, (v) => JSON.stringify(v)],
      [angular.FIND_PROMPT_EDITOR_JS, plainAngular.FIND_PROMPT_EDITOR_JS, (el) => el?.className],
    ]
    for (const [min, plain, view] of cases) {
      const a = view(runInPage(html, min).result)
      const b = view(runInPage(html, plain).result)
      expect(a).toEqual(b)
      expect(a).not.toBeUndefined()   // 빈 편집기의 READ_EDITOR_TEXT_JS 는 '' — 같은 값이면 된다
      expect(a).not.toBeNull()
    }
    expect(runInPage(html, toggle.AGENT_TOGGLE_PROBE).result).toMatchObject({ found: true, on: false })
  })

  it('설정 드라이버·패널 프로브·라디오 파인더: 패널 픽스처에서 계획·검증 결과 동일', async () => {
    const page = PROJECT_MENU_BUTTON + CARD_MENU_BUTTONS + IMAGE_COMPOSER_KO + buildSettingsPanel({ mode: 'image' })
    for (const M of [settings, plainSettings]) {
      expect(runInPage(page, M.SETTINGS_PANEL_OPEN_JS).result).toBe(true)
      expect(runInPage(CARD_MENU_BUTTONS + IMAGE_COMPOSER_KO, M.SETTINGS_PANEL_OPEN_JS).result).toBe(false)
      const radio = runInPage(page, M.FIND_RADIO_JS('mat-button-toggle-group-27', 'crop_9_16')).result
      expect(radio?.id).toBe('mat-button-toggle-95-button')
      // 이미 맞는 목표(모드 image · 비율 16:9 · 모델 검증)만 — 클릭 없이 최종 재판독 ok, 닫기는 실제 Angular 가 없어 closed:false
      const r = await runInPage(page, M.SETTINGS_DRIVER_JS({ mode: 'image', ratio: '16:9', model: 'Nano Banana 2' })).result
      expect(r).toMatchObject({ ok: true, closed: false, steps: { mode: 'already', ratio: 'already(crop_16_9)', model: 'verified' } })
      const mm = await runInPage(page, M.SETTINGS_DRIVER_JS({ mode: 'image', ratio: '16:9', model: 'Nano Banana Pro' })).result
      expect(mm).toMatchObject({ ok: false, kind: 'flow-image-model-mismatch', params: { requested: 'Nano Banana Pro', panel: 'Nano Banana 2' } })
    }
  }, 20000)

  it('SET_EDITOR_TEXT_JS(minified 모듈) 는 편집기를 찾아 같은 모양으로 답한다', async () => {
    for (const M of [angular, plainAngular]) {
      const r = await runInPage(PAGE_IMAGE_KO, M.SET_EDITOR_TEXT_JS('궁정안에 있는 왕')).result
      expect(r).toHaveProperty('ok')
      const none = await runInPage(CARD_MENU_BUTTONS, M.SET_EDITOR_TEXT_JS('x')).result
      expect(none).toEqual({ ok: false, reason: 'editor-not-found' })
    }
  })
})

// M3-4: 컴포저 레퍼런스 파인더(flow-composer-refs.js)의 *_JS — minified 번들이 M3 픽스처(ko·en)에서 같은 결과.
describe('minified 컴포저 레퍼런스 파인더(M3-4) — 비-minified 와 같은 결과', () => {
  let refs
  beforeAll(async () => { refs = await loadMinified('../../electron/flow-composer-refs.js') })

  it.each(['ko', 'en'])('%s: READ_COMPOSER_STATE_JS · 애셋 창·칩·버튼 파인더', (lang) => {
    const U = maskedUuid
    const html = buildM3Page({
      lang,
      composer: { chips: [{ id: U(2) }, { id: U(3) }, { id: null, busy: true }], editorHtml: paragraph(mentionHtml(U(2), 'king.jpg'), ' and a queen') },
      picker: { tab: 'drive_folder_upload', items: [{ id: U(2) }, { id: U(3) }, { opaque: 1 }], search: 'x' },
    })
    const el = (v) => (v ? v.outerHTML : v)
    const cases = [
      [refs.READ_COMPOSER_STATE_JS, plainRefs.READ_COMPOSER_STATE_JS, (v) => v],
      [refs.LIST_ID_ASSET_MEDIA_IDS_JS, plainRefs.LIST_ID_ASSET_MEDIA_IDS_JS, (v) => v],
      [refs.READ_PICKER_PREVIEW_MEDIA_ID_JS, plainRefs.READ_PICKER_PREVIEW_MEDIA_ID_JS, (v) => v],
      [refs.FIND_ADD_MENU_TRIGGER_JS, plainRefs.FIND_ADD_MENU_TRIGGER_JS, el],
      [refs.FIND_CLEAR_PROMPT_BUTTON_JS, plainRefs.FIND_CLEAR_PROMPT_BUTTON_JS, el],
      [refs.FIND_ADD_TO_PROMPT_BUTTON_JS, plainRefs.FIND_ADD_TO_PROMPT_BUTTON_JS, el],
      [refs.FIND_ASSET_ITEM_BY_MEDIA_ID_JS(U(3)), plainRefs.FIND_ASSET_ITEM_BY_MEDIA_ID_JS(U(3)), el],
      [refs.FIND_PICKER_TAB_JS('drive_folder_upload'), plainRefs.FIND_PICKER_TAB_JS('drive_folder_upload'), el],
      [refs.FIND_CHIP_BY_MEDIA_ID_JS(U(3)), plainRefs.FIND_CHIP_BY_MEDIA_ID_JS(U(3)), el],
    ]
    for (const [min, plain, view] of cases) {
      const a = view(runInPage(html, min).result)
      expect(a).toEqual(view(runInPage(html, plain).result))
      expect(a == null).toBe(false)
    }
    expect(runInPage(html, refs.READ_COMPOSER_STATE_JS).result).toMatchObject({
      chips: [{ mediaId: U(2), busy: false }, { mediaId: U(3), busy: false }, { mediaId: null, busy: true }],
      segments: [{ t: 'mention', mediaId: U(2), label: 'king.jpg' }, { t: 'text', text: ' and a queen' }],
      pickerOpen: true, searchDirty: true,
    })
  })
})

// M3-7·M3-8: 레퍼런스 드라이버(flow-reference-driver.js)의 페이지 표현식 — minified 번들이 jsdom 에서 같은 결과(붙여넣기 관찰 주입은 멱등·defaultPrevented 없음).
describe('minified 레퍼런스 드라이버 페이지 표현식(M3-7·M3-8) — 비-minified 와 같은 결과', () => {
  let drv
  beforeAll(async () => { drv = await loadMinified('../../electron/flow-reference-driver.js') })
  const U = maskedUuid
  const html = () => buildM3Page({
    composer: { chips: [{ id: U(2) }, { id: U(3) }], editorHtml: paragraph('A ', mentionHtml(U(2), 'king.jpg'), ' b') },
    picker: { tab: 'drive_folder_upload', items: [{ id: U(2) }, { id: U(3) }, { opaque: 1 }] },
  })
  /** 편집기 끝에 넣는 가짜 execCommand(jsdom 에는 없다) + 합성 Escape 수신 기록. */
  function page(mod) {
    const dom = new JSDOM(`<body>${html()}</body>`, { runScripts: 'outside-only' })
    const w = dom.window
    w.__autoflowcut_rpc_doc__ = 'a'.repeat(32)
    w.document.execCommand = (cmd, _u, v) => { if (cmd !== 'insertText') return false; const ps = w.document.querySelectorAll('div.ProseMirror p'); ps[ps.length - 1].append(String(v)); return true }
    const keys = []
    w.document.body.addEventListener('keydown', (e) => keys.push(e.keyCode))
    const run = (expr) => w.eval(expr)
    const out = {
      obs0: run(mod.FLOW_PASTE_OBSERVER_INJECTION), obs0again: run(mod.FLOW_PASTE_OBSERVER_INJECTION),
      append: run(mod.APPEND_EDITOR_TEXT_JS('x @y')), escape: run(mod.DISPATCH_ESCAPE_JS), doc: run(mod.READ_RPC_DOC_JS),
      picker: run(mod.READ_PICKER_STATUS_JS), chip1: run(mod.FIND_CHIP_AT_JS(1))?.outerHTML ?? null,
    }
    const e = new w.Event('paste', { bubbles: true, cancelable: true })
    Object.defineProperty(e, 'clipboardData', { value: { files: { length: 1 } } })
    w.document.querySelector('div.ProseMirror p').dispatchEvent(e)
    out.obs1 = run(mod.FLOW_PASTE_OBSERVER_INJECTION)
    out.prevented = e.defaultPrevented
    out.keys = keys
    return out
  }
  it('관찰 주입·텍스트 넣기·Escape·문서 nonce·창 상태·칩 파인더', () => {
    const min = page(drv)
    expect(min).toEqual(page(plainDriver))
    expect(min).toMatchObject({
      obs0: { n: 0, inEditor: null, files: 0 }, obs0again: { n: 0, inEditor: null, files: 0 }, obs1: { n: 1, inEditor: true, files: 1 }, prevented: false,
      append: { ok: true, grew: 3 }, escape: true, keys: [27], doc: 'a'.repeat(32), picker: { expanded: true, items: 3, uploadTab: 'selected' },
    })
    expect(min.chip1).toContain(U(3))
  })
})

describe('정적 규칙: 직렬화되는 헬퍼는 서로를 이름으로 부르지 않는다', () => {
  const helpers = {
    decodeFReqInner: plainProtocol.decodeFReqInner, extractSubmitPrompts: plainProtocol.extractSubmitPrompts, normalizePrompt: plainProtocol.normalizePrompt,
    extractSubmitRefs: plainProtocol.extractSubmitRefs,
    readWizGlobals: plainClient.readWizGlobals, buildRpcRequest: plainClient.buildRpcRequest,
    findGenerateButton: plainDom.findGenerateButton, findSettingsTrigger: plainDom.findSettingsTrigger, readSettingsSummary: plainDom.readSettingsSummary,
    findPromptEditor: plainDom.findPromptEditor, readEditorText: plainDom.readEditorText,
    scanSettingsPanel: plainSettings.scanSettingsPanel, planSettingsClicks: plainSettings.planSettingsClicks, settingsDriverCore: plainSettings.settingsDriverCore, isSettingsPanelOpen: plainSettings.isSettingsPanelOpen,
    findAgentToggle: plainToggle.findAgentToggle, isToggleOn: plainToggle.isToggleOn,
    // M3-4
    readComposerState: plainRefs.readComposerState, findAssetItemByMediaId: plainRefs.findAssetItemByMediaId, listIdAssetMediaIds: plainRefs.listIdAssetMediaIds,
    findPickerTab: plainRefs.findPickerTab, readPickerPreviewMediaId: plainRefs.readPickerPreviewMediaId, findAddMenuTrigger: plainRefs.findAddMenuTrigger,
    findClearPromptButton: plainRefs.findClearPromptButton, findAddToPromptButton: plainRefs.findAddToPromptButton, findChipByMediaId: plainRefs.findChipByMediaId,
    // M3-8
    readPickerStatus: plainDriver.readPickerStatus, findChipAt: plainDriver.findChipAt,
  }
  it.each(Object.keys(helpers))('%s 본문에 다른 헬퍼 이름 호출이 없다', (name) => {
    const body = helpers[name].toString().replace(new RegExp(`^\\s*(async\\s+)?function\\s+${name}\\s*\\(`), '')
    for (const other of Object.keys(helpers)) {
      if (other === name) continue
      expect(body, `${name} → ${other}`).not.toMatch(new RegExp(`\\b${other}\\s*\\(`))
    }
  })
})

// R2#9: 페이지 표현식 형태의 드라이버(minified) 가 **모드 전환·모델 메뉴 분기**까지 돈다 — 가짜 Angular 를 JSDOM 문서에
//   설치하고 image 패널에서 video 목표를 준다. 모듈 스코프 이름(ratioLigature 등)을 드라이버 본문이 부르면 여기서 터진다.
describe('minified SETTINGS_DRIVER_JS — 가짜 Angular 위에서 모드 전환 + 모델 메뉴 + 지연 리셋', () => {
  let settings
  beforeAll(async () => { settings = await loadMinified('../../electron/flow-composer-settings.js') })

  async function drive(M, targets, opts, page = PROJECT_MENU_BUTTON + CARD_MENU_BUTTONS + IMAGE_COMPOSER_KO + buildSettingsPanel({ mode: 'image' })) {
    const { installFakeAngular, disposeFakeAngular } = await import('../helpers/fakeFlowAngular.js')
    const dom = new JSDOM(`<body>${page}</body>`, { runScripts: 'outside-only' })
    dom.window.Element.prototype.getBoundingClientRect = () => ({ width: 100, height: 30 })
    const log = installFakeAngular(dom.window.document, opts)
    try {
      const r = await dom.window.eval(M.SETTINGS_DRIVER_JS(targets))
      return { r, log, doc: dom.window.document }
    } finally { disposeFakeAngular() }
  }

  it('image 패널 → video 목표(모드 전환 → 재스캔 → 모델 메뉴 선택 → 동기 리셋된 duration 재클릭) 가 minified 에서도 ok', async () => {
    for (const M of [settings, plainSettings]) {
      const { r, log, doc } = await drive(M, { mode: 'video', ratio: '16:9', duration: 8, resolution: '720p', count: 1, model: 'Veo 3.1 - Fast' }, { modelReset: 'sync' })
      // M2-2: 영상 step 라벨은 값을 단다(§4 M2 로그) + 입력방식 검증
      expect(r).toMatchObject({ ok: true, closed: true, steps: { mode: 'clicked(videocam)', model: 'clicked', ratio: 'already(crop_16_9)', duration: 'clicked(8)', resolution: 'already(720p)', count: 'already(x1)', input: 'material' } })
      expect(log).toEqual(['mode:videocam', 'model-trigger', 'model:veo 3.1 - fast', 'duration:8초', 'keydown:Escape:27'])
      expect(doc.querySelector('.cdk-overlay-container')).toBeNull()
    }
  }, 30000)

  it('지연 리셋(b) 도 minified 에서 2차 패스로 다시 맞춰 ok (video 패널, count x2 → x1 클릭이 duration 을 되돌린다 — M2 실기)', async () => {
    const page = PROJECT_MENU_BUTTON + CARD_MENU_BUTTONS + VIDEO_COMPOSER_KO + buildSettingsPanel({ mode: 'video', checked: { count: 'x2' } })
    const { r } = await drive(settings, { mode: 'video', ratio: '16:9', duration: 8, resolution: '720p', count: 1, model: 'Omni 1.1 Flash' }, { modelReset: 'on-count' }, page)
    expect(r).toMatchObject({ ok: true, closed: true, steps: { duration: 'reclicked(8)' } })
  }, 30000)
})

describe('정적 규칙(확장, R2#9): 드라이버·주입 헬퍼 본문은 모듈 스코프 이름을 부르지 않는다', () => {
  const MODULE_NAMES = ['ratioLigature', 'formatSteps', 'RATIO_LIGATURE', 'STEP_ORDER', 'applyComposerSettings', 'runSettingsDriver', 'SETTINGS_DRIVER_JS', 'FIND_RADIO_JS', 'SETTINGS_PANEL_OPEN_JS', 'READ_SETTINGS_SUMMARY_JS', 'FIND_SETTINGS_TRIGGER_JS', 'FLOW_RPC_CAPTURE_ALLOWLIST', 'FLOW_RPC_ALLOWLIST', 'FLOW_RPC_TIMEOUT_MS', 'RPC_PATH']
  const serialized = {
    scanSettingsPanel: plainSettings.scanSettingsPanel, planSettingsClicks: plainSettings.planSettingsClicks, settingsDriverCore: plainSettings.settingsDriverCore, isSettingsPanelOpen: plainSettings.isSettingsPanelOpen,
    readWizGlobals: plainClient.readWizGlobals, buildRpcRequest: plainClient.buildRpcRequest,
    decodeFReqInner: plainProtocol.decodeFReqInner, extractSubmitPrompts: plainProtocol.extractSubmitPrompts, normalizePrompt: plainProtocol.normalizePrompt,
    extractSubmitRefs: plainProtocol.extractSubmitRefs,
  }
  it.each(Object.keys(serialized))('%s', (name) => {
    const body = serialized[name].toString()
    for (const id of MODULE_NAMES) expect(body, `${name} → ${id}`).not.toMatch(new RegExp(`\\b${id}\\b`))
  })
  it('SETTINGS_DRIVER_JS · FLOW_RPC_CALL_JS · FLOW_RPC_CAPTURE_INJECTION 문자열도 모듈 스코프 이름을 참조하지 않는다', () => {
    const strings = [plainSettings.SETTINGS_DRIVER_JS({ mode: 'image' }), plainClient.FLOW_RPC_CALL_JS('nzlxg', '[]'), plainCapture.FLOW_RPC_CAPTURE_INJECTION]
    for (const s of strings) for (const id of MODULE_NAMES) expect(s).not.toMatch(new RegExp(`\\b${id}\\b`))
  })
})
