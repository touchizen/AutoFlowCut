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
import { sample, reencodeRequestBody } from '../fixtures/flow-batchexecute-samples.js'
import { PAGE_IMAGE_KO, PAGE_VIDEO_KO, CARD_MENU_BUTTONS, PROJECT_MENU_BUTTON, IMAGE_COMPOSER_KO, buildSettingsPanel } from '../fixtures/flow-live-dom-20260924.js'

const SRC = (rel) => fileURLToPath(new URL(rel, import.meta.url))
async function loadMinified(rel) {
  const out = buildSync({ entryPoints: [SRC(rel)], bundle: true, minify: true, format: 'esm', write: false, platform: 'node' })
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

describe('정적 규칙: 직렬화되는 헬퍼는 서로를 이름으로 부르지 않는다', () => {
  const helpers = {
    decodeFReqInner: plainProtocol.decodeFReqInner, extractSubmitPrompts: plainProtocol.extractSubmitPrompts, normalizePrompt: plainProtocol.normalizePrompt,
    readWizGlobals: plainClient.readWizGlobals, buildRpcRequest: plainClient.buildRpcRequest,
    findGenerateButton: plainDom.findGenerateButton, findSettingsTrigger: plainDom.findSettingsTrigger, readSettingsSummary: plainDom.readSettingsSummary,
    findPromptEditor: plainDom.findPromptEditor, readEditorText: plainDom.readEditorText,
    scanSettingsPanel: plainSettings.scanSettingsPanel, planSettingsClicks: plainSettings.planSettingsClicks, settingsDriverCore: plainSettings.settingsDriverCore, isSettingsPanelOpen: plainSettings.isSettingsPanelOpen,
    findAgentToggle: plainToggle.findAgentToggle, isToggleOn: plainToggle.isToggleOn,
  }
  it.each(Object.keys(helpers))('%s 본문에 다른 헬퍼 이름 호출이 없다', (name) => {
    const body = helpers[name].toString().replace(new RegExp(`^\\s*(async\\s+)?function\\s+${name}\\s*\\(`), '')
    for (const other of Object.keys(helpers)) {
      if (other === name) continue
      expect(body, `${name} → ${other}`).not.toMatch(new RegExp(`\\b${other}\\s*\\(`))
    }
  })
})
