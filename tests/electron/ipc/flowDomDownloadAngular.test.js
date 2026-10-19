// @vitest-environment node
//
// flow:dom-download-video 를 새 Flow(Angular)에서 다시 연다 — M2(R1#7) 이후 unsupportedOnAngular 로 막혀 서명 URL(720p 원본)만 받았고
//   업스케일(1080p/4K)이 빠졌다. 순서: 입력 검증 → as29s 로 편집 위치(projectId·editId) → 다운로드 직렬화(downloadMutex)
//   → will-download 가로채기(임시 폴더) → DOM 단계(편집 화면으로 이동 → "미디어 다운로드" → 해상도 → 파일 대기 → 원래 화면으로)
//   → base64. 핸들러·임시 폴더는 어느 경로든 정리하고, 어느 경로든 시작한 화면으로 돌아간다.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import fs from 'node:fs'
import { EventEmitter } from 'node:events'
import { registerFlowAPIIPC } from '../../../electron/ipc/flow-api.js'
import { _resetDomStageForTests } from '../../../electron/ipc/flow-angular.js'
import { PAGE_PATH_JS, READ_RESOLUTION_ITEMS_JS, EDITOR_DOWNLOAD_TRIGGER_JS } from '../../../electron/flow-video-download.js'
import { respBodyWithPayload } from '../../fixtures/flow-batchexecute-samples.js'

const MEDIA = 'ba1764fb-6f24-49d4-9b1e-6c13af2f1f7b'
const PROJECT = 'f4f8378f-f606-43ff-9aa7-fabca351d2f4'
const EDIT = 'd2ac9584-3ba2-47fa-a529-8a4c85416f07'
const GRID = `/project/${PROJECT}`
const EDITOR = `/project/${PROJECT}/edit/${EDIT}`

function makeIpcMain() {
  const handlers = new Map()
  return { handle: (c, fn) => handlers.set(c, fn), invoke: (c, p) => handlers.get(c)({}, p) }
}

/** Electron DownloadItem 흉내 — setSavePath 에 파일을 쓰고 'done'(completed)을 낸다. */
function fakeItem(name, mime, savedPaths, doneState = 'completed', events = []) {
  const item = new EventEmitter()
  item.getFilename = () => name
  item.getMimeType = () => mime
  item.getURL = () => 'blob:https://flow.google.com/9f1c'
  item.getState = () => 'progressing'
  item.cancel = vi.fn()
  item.setSavePath = (p) => {
    savedPaths.push(p)
    events.push('download')
    fs.writeFileSync(p, Buffer.alloc(2048, 7))
    setTimeout(() => item.emit('done', {}, doneState), 10)
  }
  return item
}

function harness({ items, record, editorRenders = true, deliver = true, unrelatedFirst = false, userMovesTo = null, pathReadFails = false, doneState = 'completed', earlyVideo = false } = {}) {
  const savedPaths = []
  const session = new EventEmitter()
  const steps = []
  const navigations = []
  const events = []
  const early = Object.assign(new EventEmitter(), { getFilename: () => 'other_clip.mp4', getMimeType: () => 'video/mp4', getURL: () => 'blob:https://flow.google.com/aa', setSavePath: vi.fn() })
  const unrelated = Object.assign(new EventEmitter(), { getFilename: () => 'invoice.pdf', getMimeType: () => 'application/pdf', setSavePath: vi.fn() })
  let page = GRID
  const executeJavaScript = vi.fn(async (js) => {
    if (js.includes('readWizGlobals')) {   // callFlowRpc(as29s)
      return { status: 200, text: respBodyWithPayload('as29s', record ?? [MEDIA, PROJECT, EDIT, 'CAE', null]) }
    }
    if (js === PAGE_PATH_JS) {
      if (pathReadFails && !navigations.length) throw new Error('render frame disposed')
      return page
    }
    const ret = /if \(location\.pathname !== "([^"]+)"\) return 'user-moved';\s*history\.replaceState\(history\.state, '', "([^"]+)"\)/.exec(js)
    if (ret) {
      if (page !== ret[1]) return 'user-moved'
      page = ret[2]; navigations.push(page); events.push('nav:' + page); return 'navigated'
    }
    const nav = /history\.replaceState\(history\.state, '', "([^"]+)"\)/.exec(js)
    if (nav) {
      page = nav[1]; navigations.push(page); events.push('nav:' + page)
      // 가로채기는 해상도 클릭 직전에만 걸린다 — 편집 화면으로 가는 동안 끼어든 동영상 다운로드는 잡히지 않는다(Fable #7)
      if (earlyVideo) session.emit('will-download', {}, early)
      return page
    }
    if (js.includes('editorReady(document, ')) return editorRenders && js.includes(JSON.stringify(page))
    if (js === READ_RESOLUTION_ITEMS_JS) return items ?? [
      { res: '270p', disabled: false }, { res: '720p', disabled: false }, { res: '1080p', disabled: false }, { res: '4k', disabled: true },
    ]
    return true
  })
  const flowView = {
    getBounds: () => ({ x: 0, y: 0, width: 957, height: 1022 }),
    setBounds: vi.fn(),
    webContents: {
      getURL: () => `https://flow.google.com${page}`, executeJavaScript, sendInputEvent: vi.fn(),
      isFocused: () => true, focus: vi.fn(), isDestroyed: () => false, session,
    },
  }
  const trustedClickOnFlowView = vi.fn(async (js, opts) => {
    steps.push(opts.step)
    if (opts.step === 'download-menu') expect(js).toBe(EDITOR_DOWNLOAD_TRIGGER_JS)
    if (opts.step === 'download-resolution') {
      if (userMovesTo) page = userMovesTo   // 클릭과 돌아가기 사이에 사용자가 옮겼다
      // Flow 가 업스케일을 끝내고 내려보낸다 → will-download(그 전에 사용자의 관계없는 다운로드가 끼어들 수 있다)
      if (deliver) {
        setTimeout(() => {
          if (unrelatedFirst) session.emit('will-download', {}, unrelated)
          session.emit('will-download', {}, fakeItem('Amber_light_particles_drifting_1080p.mp4', 'video/mp4', savedPaths, doneState, events))
        }, 50)
      }
    }
    return { success: true }
  })
  const getFlowView = vi.fn(() => flowView)
  const deps = {
    getFlowView, getCurrentMode: () => 'flow', getFlowAgentOn: () => false,
    getMainWindow: () => ({ webContents: { focus: vi.fn() }, getContentBounds: () => ({ x: 0, y: 0, width: 1600, height: 1000 }) }),
    trustedClickOnFlowView, sessionFetch: vi.fn(), pendingGenerations: new Map(), getCapturedProjectId: () => PROJECT, fetchMediaAsBase64: vi.fn(),
  }
  const ipc = makeIpcMain()
  registerFlowAPIIPC(ipc, deps)
  return { ipc, deps, flowView, steps, session, unrelated, early, savedPaths, navigations, events, page: () => page }
}

describe('flow:dom-download-video on the new Flow (Angular)', () => {
  beforeEach(() => { _resetDomStageForTests() })

  it('opens the editor from the as29s record, picks 1080p, returns the upscaled file and goes back to the grid', async () => {
    const h = harness()
    const r = await h.ipc.invoke('flow:dom-download-video', { mediaId: MEDIA, resolution: '1080p' })
    expect(r).toMatchObject({ success: true, resolution: '1080p', mimeType: 'video/mp4' })
    expect(r.base64.startsWith('data:video/mp4;base64,')).toBe(true)
    expect(Buffer.from(r.base64.split(',')[1], 'base64')).toHaveLength(2048)
    expect(h.steps).toEqual(['download-menu', 'download-resolution'])
    expect(h.navigations).toEqual([EDITOR, GRID])
    expect(h.page()).toBe(GRID)
    // 클릭 직후 그리드로 돌아가 DOM 단계를 놓고, 파일은 그 뒤에 기다린다(Fable #1·#2)
    expect(h.events).toEqual(['nav:' + EDITOR, 'nav:' + GRID, 'download'])
    expect(h.session.listenerCount('will-download')).toBe(0)
    expect(fs.existsSync(h.savedPaths[0])).toBe(false)   // temp dir cleaned
  }, 15000)

  it("leaves an unrelated download alone and takes only the video (Codex R1 #1)", async () => {
    const h = harness({ unrelatedFirst: true })
    const r = await h.ipc.invoke('flow:dom-download-video', { mediaId: MEDIA, resolution: '1080p' })
    expect(r).toMatchObject({ success: true, resolution: '1080p' })
    expect(h.unrelated.setSavePath).not.toHaveBeenCalled()
    expect(h.savedPaths).toHaveLength(1)
  }, 15000)

  it("does not undo the user's navigation made before the return (Codex R1 #2)", async () => {
    const h = harness({ userMovesTo: `/project/${PROJECT}/edit/11111111-2222-4333-8444-555555555555` })
    const r = await h.ipc.invoke('flow:dom-download-video', { mediaId: MEDIA, resolution: '1080p' })
    expect(r).toMatchObject({ success: true })
    expect(h.navigations).toEqual([EDITOR])
  }, 15000)

  it('a video download fired while opening the editor is not captured (Fable #7)', async () => {
    const h = harness({ earlyVideo: true })
    const r = await h.ipc.invoke('flow:dom-download-video', { mediaId: MEDIA, resolution: '1080p' })
    expect(r).toMatchObject({ success: true })
    expect(h.early.setSavePath).not.toHaveBeenCalled()
  }, 15000)

  it('an interrupted download ends as flow-download-error (the engine then falls back to 720p)', async () => {
    const h = harness({ doneState: 'interrupted' })
    const r = await h.ipc.invoke('flow:dom-download-video', { mediaId: MEDIA, resolution: '1080p' })
    expect(r).toMatchObject({ success: false, errorKind: 'flow-download-error', reason: 'download-interrupted' })
    expect(h.session.listenerCount('will-download')).toBe(0)
  }, 15000)

  it('starting on that same editor leaves the user there (Codex R2 #3)', async () => {
    const h = harness()
    await h.flowView.webContents.executeJavaScript(`(function () {\n  history.replaceState(history.state, '', ${JSON.stringify(EDITOR)});`)
    h.navigations.length = 0
    const r = await h.ipc.invoke('flow:dom-download-video', { mediaId: MEDIA, resolution: '1080p' })
    expect(r).toMatchObject({ success: true })
    expect(h.page()).toBe(EDITOR)
  }, 15000)

  it('returns to the project grid when the starting path could not be read', async () => {
    const h = harness({ pathReadFails: true })
    const r = await h.ipc.invoke('flow:dom-download-video', { mediaId: MEDIA, resolution: '1080p' })
    expect(r).toMatchObject({ success: true })
    expect(h.navigations).toEqual([EDITOR, GRID])
  }, 15000)

  it('asks for 4K, takes 1080p when 4K is locked, and says so', async () => {
    const h = harness()
    const r = await h.ipc.invoke('flow:dom-download-video', { mediaId: MEDIA, resolution: '4k' })
    expect(r).toMatchObject({ success: true, resolution: '1080p', downgradedFrom: '4k' })
  }, 15000)

  it('flow-upscale-unavailable: no file wait, and still back on the grid', async () => {
    const h = harness({ items: [{ res: '720p', disabled: false }, { res: '1080p', disabled: true }, { res: '4k', disabled: true }] })
    const r = await h.ipc.invoke('flow:dom-download-video', { mediaId: MEDIA, resolution: '1080p' })
    expect(r).toMatchObject({ success: false, errorKind: 'flow-upscale-unavailable' })
    expect(h.steps).toEqual(['download-menu'])
    expect(h.page()).toBe(GRID)
    expect(h.session.listenerCount('will-download')).toBe(0)
  })

  it('flow-download-editor-not-ready when the editor never renders — no clicks, back on the grid', async () => {
    const h = harness({ editorRenders: false })
    const r = await h.ipc.invoke('flow:dom-download-video', { mediaId: MEDIA, resolution: '1080p' })
    expect(r).toMatchObject({ success: false, errorKind: 'flow-download-editor-not-ready' })
    expect(h.steps).toEqual([])
    expect(h.page()).toBe(GRID)
  }, 20000)

  it('flow-download-edit-unknown when as29s does not give an editor location — the view is not driven', async () => {
    const h = harness({ record: [MEDIA, PROJECT, null] })
    const r = await h.ipc.invoke('flow:dom-download-video', { mediaId: MEDIA, resolution: '1080p' })
    expect(r).toMatchObject({ success: false, errorKind: 'flow-download-edit-unknown' })
    expect(h.navigations).toEqual([])
    expect(h.steps).toEqual([])
  })

  it('refuses a non-UUID mediaId or an unknown resolution before touching the view', async () => {
    for (const payload of [{ mediaId: 'm', resolution: '1080p' }, { mediaId: MEDIA, resolution: '8k' }]) {
      const h = harness()
      const r = await h.ipc.invoke('flow:dom-download-video', payload)
      expect(r).toMatchObject({ success: false, errorKind: 'flow-download-invalid-input' })
      expect(h.deps.getFlowView).not.toHaveBeenCalled()
    }
  })
})
