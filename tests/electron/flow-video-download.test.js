// @vitest-environment jsdom
//
// 새 Flow(Angular) 동영상 업스케일 다운로드 — 미디어 편집 화면(/project/<pid>/edit/<editId>)의 "미디어 다운로드" 메뉴 → 1080p/4K.
//   M2(R1#7)는 옛 Radix 메뉴 기준으로 "도달 불가"라 보고 DOM 다운로드를 막았고, 그 뒤로 서명 URL(720p 원본)만 받아 업스케일이 빠졌다.
//   그리드 타일은 hover 전 미리보기 src 에 mediaId 가 없어(2026-10-19 덤프) 편집 id(as29s 기록 [2])로 편집 화면을 연다.
//   픽스처는 tests/fixtures/flow-live-dom-download-20261019.js(같은 날 라이브 판독).
import { describe, it, expect, beforeEach } from 'vitest'
import { EventEmitter } from 'node:events'
import {
  mediaEditLocation, editorPath, findEditorDownloadTrigger, readResolutionItems, findResolutionItem, pickResolution,
  PAGE_PATH_JS, NAVIGATE_JS, EDITOR_READY_JS, EDITOR_DOWNLOAD_TRIGGER_JS, READ_RESOLUTION_ITEMS_JS, RESOLUTION_ITEM_JS,
  driveEditorDownload, returnIfStillOn, armVideoDownloadCapture, RETURN_IF_ON_JS, UUID_RE,
  EDITOR_TITLE_JS, isVideoCapturePending, waitForVideoCaptures, guardFlowNavigation,
} from '../../electron/flow-video-download.js'
import { DISPATCH_ESCAPE_JS } from '../../electron/flow-reference-driver.js'
import {
  PROJECT_ID, MEDIA_ID, EDIT_ID, GRID_PATH, EDIT_PATH, MEDIA_TITLE, editorPage, gridPage,
} from '../fixtures/flow-live-dom-download-20261019.js'

function mount(html) { document.body.innerHTML = html; return document }
function at(p, html) { window.history.replaceState(null, '', p); return mount(html) }

describe('mediaEditLocation (as29s record → editor route)', () => {
  it('reads projectId [1] and editId [2] of the record for that mediaId', () => {
    expect(mediaEditLocation([MEDIA_ID, PROJECT_ID, EDIT_ID, 'CAE', null], MEDIA_ID)).toEqual({ projectId: PROJECT_ID, editId: EDIT_ID })
  })
  it('null for another media, missing or non-UUID ids', () => {
    expect(mediaEditLocation([MEDIA_ID, PROJECT_ID, EDIT_ID], '00000000-0000-4000-8000-000000000000')).toBeNull()
    expect(mediaEditLocation([MEDIA_ID, PROJECT_ID, null], MEDIA_ID)).toBeNull()
    expect(mediaEditLocation([MEDIA_ID, 'x', EDIT_ID], MEDIA_ID)).toBeNull()
    expect(mediaEditLocation(null, MEDIA_ID)).toBeNull()
  })
  it('UUID_RE is the shared media id shape', () => {
    expect(UUID_RE.test(MEDIA_ID)).toBe(true)
    expect(UUID_RE.test('m')).toBe(false)
  })
  it('editorPath', () => {
    expect(editorPath({ projectId: PROJECT_ID, editId: EDIT_ID })).toBe(EDIT_PATH)
  })
})

describe('probes (editor page)', () => {
  it('picks the header "media download" trigger, never the timeline hotbar one', () => {
    const doc = at(EDIT_PATH, editorPage())
    const btn = findEditorDownloadTrigger(doc)
    expect(btn).not.toBeNull()
    expect(btn.hasAttribute('flowhotbarbutton')).toBe(false)
    expect(btn.closest('.cta-buttons')).not.toBeNull()
    expect(findEditorDownloadTrigger(at(GRID_PATH, gridPage()))).toBeNull()
  })

  it('reads the resolution items of the open menu, with disabled state', () => {
    const doc = at(EDIT_PATH, editorPage({ menuOpen: true }))
    expect(readResolutionItems(doc)).toEqual([
      { res: '270p', disabled: false },
      { res: '720p', disabled: false },
      { res: '1080p', disabled: false },
      { res: '4k', disabled: true },
    ])
    expect(findResolutionItem(doc, '1080p').textContent).toContain('1080p')
    expect(readResolutionItems(at(EDIT_PATH, editorPage()))).toEqual([])
  })

  it('EDITOR_READY_JS is true only on that path with the trigger rendered', () => {
    at(EDIT_PATH, editorPage())
    expect(window.eval(EDITOR_READY_JS(EDIT_PATH))).toBe(true)
    expect(window.eval(EDITOR_READY_JS(GRID_PATH))).toBe(false)
    at(EDIT_PATH, gridPage())
    expect(window.eval(EDITOR_READY_JS(EDIT_PATH))).toBe(false)
  })

  it('NAVIGATE_JS moves the SPA (replaceState + popstate) without adding history entries', () => {
    at(GRID_PATH, gridPage())
    const entries = window.history.length
    let popped = 0
    const onPop = () => { popped++ }
    window.addEventListener('popstate', onPop)
    window.eval(NAVIGATE_JS(EDIT_PATH))
    window.eval(NAVIGATE_JS(GRID_PATH))
    window.removeEventListener('popstate', onPop)
    expect(window.eval(PAGE_PATH_JS)).toBe(GRID_PATH)
    expect(popped).toBe(2)
    expect(window.history.length).toBe(entries)   // 뒤로 가기가 임시 편집 화면을 다시 열지 않는다(Codex R1 #4)
  })

  it('EDITOR_TITLE_JS reads the media title from the editor heading (null elsewhere)', () => {
    at(EDIT_PATH, editorPage())
    expect(window.eval(EDITOR_TITLE_JS)).toBe(MEDIA_TITLE)
    at(GRID_PATH, gridPage())
    expect(window.eval(EDITOR_TITLE_JS)).toBeNull()
  })

  it('injected JS strings behave like the functions (self-contained when stringified)', () => {
    const doc = at(EDIT_PATH, editorPage({ menuOpen: true }))
    expect(window.eval(EDITOR_DOWNLOAD_TRIGGER_JS)).toBe(findEditorDownloadTrigger(doc))
    expect(window.eval(READ_RESOLUTION_ITEMS_JS)).toEqual(readResolutionItems(doc))
    expect(window.eval(RESOLUTION_ITEM_JS('1080p'))).toBe(findResolutionItem(doc, '1080p'))
  })
})

describe('pickResolution', () => {
  const items = (fourK, hd = false) => [
    { res: '720p', disabled: false }, { res: '1080p', disabled: hd }, { res: '4k', disabled: fourK },
  ]
  it('takes the requested upscale when enabled', () => {
    expect(pickResolution(items(true), '1080p')).toEqual({ res: '1080p' })
    expect(pickResolution(items(false), '4k')).toEqual({ res: '4k' })
  })
  it('steps 4K down to 1080p when 4K is locked (user decision 2026-10-19)', () => {
    expect(pickResolution(items(true), '4k')).toEqual({ res: '1080p', downgradedFrom: '4k' })
  })
  it('gives up when no upscale at or below the request is enabled', () => {
    expect(pickResolution(items(true, true), '1080p')).toBeNull()
    expect(pickResolution(items(true, true), '4k')).toBeNull()
    expect(pickResolution([], '1080p')).toBeNull()
  })
})

/**
 * Fake Angular: SPA navigation mounts the page for the new path (editor or grid); clicking the header trigger opens the
 * resolution menu; the resolution click is recorded.
 */
function fakeCtx({ fourKDisabled = true, upscale1080Disabled = false, editorRenders = true } = {}) {
  const calls = { steps: [], chosen: null, escapes: 0, navigations: [] }
  const ctx = {
    exec: async (js) => {
      if (js === DISPATCH_ESCAPE_JS) { calls.escapes++; return true }
      const before = window.location.pathname
      const r = window.eval(js)
      const after = window.location.pathname
      if (after !== before) {
        calls.navigations.push(after)
        mount(after.includes('/edit/') ? (editorRenders ? editorPage() : '<main></main>') : gridPage())
      }
      return r
    },
    trustedClick: async (js, opts) => {
      const el = window.eval(js)
      if (!el) return { success: false, error: 'not found' }
      if (el.disabled || el.getAttribute('disabled') === 'true') return { success: false, error: 'Button is disabled' }
      calls.steps.push(opts.step)
      if (el.closest('.cta-buttons')) mount(editorPage({ menuOpen: true, fourKDisabled, upscale1080Disabled }))
      else calls.chosen = el.textContent.trim()
      return { success: true }
    },
    isAborted: () => false,
    sleep: async () => {},
  }
  return { ctx, calls }
}

describe('driveEditorDownload', () => {
  beforeEach(() => { at(GRID_PATH, gridPage()) })

  it('opens the editor route, then "media download" → 1080p', async () => {
    const { ctx, calls } = fakeCtx()
    const r = await driveEditorDownload(ctx, { path: EDIT_PATH, resolution: '1080p' })
    expect(r).toEqual({ ok: true, res: '1080p' })
    expect(calls.navigations).toEqual([EDIT_PATH])
    expect(calls.steps).toEqual(['download-menu', 'download-resolution'])
    expect(calls.chosen).toContain('1080p')
    expect(window.location.pathname).toBe(EDIT_PATH)   // 돌아가기는 호출자가 파일을 받은 뒤에
  })

  it('asks for 4K, gets 1080p when 4K is locked', async () => {
    const { ctx, calls } = fakeCtx({ fourKDisabled: true })
    const r = await driveEditorDownload(ctx, { path: EDIT_PATH, resolution: '4k' })
    expect(r).toEqual({ ok: true, res: '1080p', downgradedFrom: '4k' })
    expect(calls.chosen).toContain('1080p')
  })

  it('closes the menu and reports flow-upscale-unavailable when no upscale is enabled', async () => {
    const { ctx, calls } = fakeCtx({ upscale1080Disabled: true })
    const r = await driveEditorDownload(ctx, { path: EDIT_PATH, resolution: '1080p' })
    expect(r).toMatchObject({ ok: false, kind: 'flow-upscale-unavailable' })
    expect(calls.chosen).toBeNull()
    expect(calls.escapes).toBeGreaterThan(0)
  })

  it('reports flow-download-editor-not-ready without clicking when the editor never renders', async () => {
    const { ctx, calls } = fakeCtx({ editorRenders: false })
    const r = await driveEditorDownload(ctx, { path: EDIT_PATH, resolution: '1080p' })
    expect(r).toMatchObject({ ok: false, kind: 'flow-download-editor-not-ready' })
    expect(calls.steps).toEqual([])
  })

  it('clicks the trigger once more when the first click does not open the menu (live 2026-10-19: right after an app restart)', async () => {
    const { ctx, calls } = fakeCtx()
    const click = ctx.trustedClick
    let menuClicks = 0
    ctx.trustedClick = async (js, opts) => {
      if (opts.step === 'download-menu' && ++menuClicks === 1) { calls.steps.push(opts.step); return { success: true } }   // 눌렸지만 메뉴가 안 열림
      return click(js, opts)
    }
    const r = await driveEditorDownload(ctx, { path: EDIT_PATH, resolution: '1080p' })
    expect(r).toEqual({ ok: true, res: '1080p' })
    expect(calls.steps).toEqual(['download-menu', 'download-menu', 'download-resolution'])
  })

  it('a resolution click that was dispatched but timed out still counts as clicked (Fable R2 #3: wait for the file)', async () => {
    const { ctx } = fakeCtx()
    const click = ctx.trustedClick
    ctx.trustedClick = async (js, opts) => (opts.step === 'download-resolution' ? { success: false, dispatched: true, error: 'mouseup timeout' } : click(js, opts))
    const r = await driveEditorDownload(ctx, { path: EDIT_PATH, resolution: '1080p' })
    expect(r).toMatchObject({ ok: true, res: '1080p' })
  })

  it('reports menu-failed when the second trigger click fails too', async () => {
    const { ctx, calls } = fakeCtx()
    let n = 0
    ctx.trustedClick = async (_js, opts) => {
      if (opts.step === 'download-menu') { calls.steps.push(opts.step); return ++n === 1 ? { success: true } : { success: false, error: 'covered' } }
      return { success: false }
    }
    const r = await driveEditorDownload(ctx, { path: EDIT_PATH, resolution: '1080p' })
    expect(r).toMatchObject({ ok: false, kind: 'flow-download-menu-failed', reason: 'menu-trigger:covered' })
    expect(calls.steps).toEqual(['download-menu', 'download-menu'])
  })

  it('a watchdog abort during beforeResolutionClick stops before the resolution click (Fable R3 #3)', async () => {
    const { ctx, calls } = fakeCtx()
    let aborted = false
    ctx.isAborted = () => aborted
    ctx.beforeResolutionClick = async () => { aborted = true }
    const r = await driveEditorDownload(ctx, { path: EDIT_PATH, resolution: '1080p' })
    expect(r).toMatchObject({ ok: false, kind: 'flow-download-aborted' })
    expect(calls.steps).toEqual(['download-menu'])
    expect(calls.chosen).toBeNull()
  })

  it('reports flow-download-menu-failed and closes menus when the menu never opens', async () => {
    const { ctx, calls } = fakeCtx()
    ctx.trustedClick = async () => ({ success: false, error: 'covered' })
    const r = await driveEditorDownload(ctx, { path: EDIT_PATH, resolution: '1080p' })
    expect(r).toMatchObject({ ok: false, kind: 'flow-download-menu-failed' })
    expect(calls.escapes).toBeGreaterThan(0)
  })
})

describe('returnIfStillOn', () => {
  it('goes back to where the download started while still on the editor', async () => {
    at(EDIT_PATH, editorPage())
    const { ctx, calls } = fakeCtx()
    expect(await returnIfStillOn(ctx, { editPath: EDIT_PATH, back: GRID_PATH })).toBe('returned')
    expect(window.location.pathname).toBe(GRID_PATH)
    expect(calls.navigations).toEqual([GRID_PATH])
  })
  it('compares and navigates in one page script (Codex R2 #4: no gap for the user to move in between)', () => {
    at(EDIT_PATH, editorPage())
    expect(window.eval(RETURN_IF_ON_JS(EDIT_PATH, GRID_PATH))).toBe('navigated')
    expect(window.location.pathname).toBe(GRID_PATH)
    at('/project/other', gridPage())
    expect(window.eval(RETURN_IF_ON_JS(EDIT_PATH, GRID_PATH))).toBe('user-moved')
    expect(window.location.pathname).toBe('/project/other')
  })

  it('does nothing once the DOM stage was aborted (Fable #6: no zombie navigation)', async () => {
    at(EDIT_PATH, editorPage())
    const { ctx, calls } = fakeCtx()
    ctx.isAborted = () => true
    expect(await returnIfStillOn(ctx, { editPath: EDIT_PATH, back: GRID_PATH })).toBe('aborted')
    expect(calls.navigations).toEqual([])
  })

  it('stays put when the download started on that same editor (Codex R2 #3)', async () => {
    at(EDIT_PATH, editorPage())
    const { ctx, calls } = fakeCtx()
    expect(await returnIfStillOn(ctx, { editPath: EDIT_PATH, back: EDIT_PATH })).toBe('returned')
    expect(calls.navigations).toEqual([])
  })

  it("leaves the user's own navigation alone (Codex R1 #2)", async () => {
    at('/project/other', gridPage())
    const { ctx, calls } = fakeCtx()
    expect(await returnIfStillOn(ctx, { editPath: EDIT_PATH, back: GRID_PATH })).toBe('user-moved')
    expect(window.location.pathname).toBe('/project/other')
    expect(calls.navigations).toEqual([])
  })
})

describe('armVideoDownloadCapture (Codex R1 #1: only our video, only once)', () => {
  function fakeItem(name, mime) {
    const item = new EventEmitter()
    item.getFilename = () => name
    item.getMimeType = () => mime
    item.savePath = null
    item.setSavePath = (p) => { item.savePath = p }
    item.getState = () => 'progressing'
    item.cancel = () => { item.cancelled = true }
    return item
  }
  const session = () => {
    const s = new EventEmitter()
    return s
  }

  it('ignores non-video downloads, captures the first video, then stops listening', async () => {
    const s = session()
    const cap = armVideoDownloadCapture(s, '/tmp/flow-dl-x', { timeoutMs: 1000 })
    const pdf = fakeItem('report.pdf', 'application/pdf')
    s.emit('will-download', {}, pdf)
    expect(pdf.savePath).toBeNull()
    const vid = fakeItem('Amber_1080p.mp4', 'video/mp4')
    s.emit('will-download', {}, vid)
    expect(vid.savePath).toBe('/tmp/flow-dl-x/Amber_1080p.mp4')
    expect(s.listenerCount('will-download')).toBe(0)
    const later = fakeItem('other.mp4', 'video/mp4')
    s.emit('will-download', {}, later)
    expect(later.savePath).toBeNull()
    vid.emit('done', {}, 'completed')
    await expect(cap.wait()).resolves.toEqual({ path: '/tmp/flow-dl-x/Amber_1080p.mp4' })
    cap.dispose()
  })

  it('ignores a video from a foreign host (Codex R2 #1)', () => {
    const s = session()
    const cap = armVideoDownloadCapture(s, '/tmp/d', { timeoutMs: 1000 })
    const foreign = fakeItem('trailer.mp4', 'video/mp4')
    foreign.getURL = () => 'https://cdn.example.com/trailer.mp4'
    s.emit('will-download', {}, foreign)
    expect(foreign.savePath).toBeNull()
    const ours = fakeItem('Amber_1080p.mp4', 'video/mp4')
    ours.getURL = () => 'blob:https://flow.google.com/1b2c'
    s.emit('will-download', {}, ours)
    expect(ours.savePath).toBe('/tmp/d/Amber_1080p.mp4')
    cap.dispose()
  })

  it('cancels a captured download that is still running when the wait times out (Fable #3)', async () => {
    const s = session()
    const cap = armVideoDownloadCapture(s, '/tmp/d', { timeoutMs: 20 })
    const vid = fakeItem('a.mp4', 'video/mp4')
    s.emit('will-download', {}, vid)
    await expect(cap.wait()).resolves.toEqual({ error: 'timeout' })
    cap.dispose()
    expect(vid.cancelled).toBe(true)
  })

  it('does not cancel a download that already completed', async () => {
    const s = session()
    const cap = armVideoDownloadCapture(s, '/tmp/d', { timeoutMs: 1000 })
    const vid = fakeItem('a.mp4', 'video/mp4')
    s.emit('will-download', {}, vid)
    vid.emit('done', {}, 'completed')
    await cap.wait()
    cap.dispose()
    expect(vid.cancelled).toBeUndefined()
  })

  it("takes only the file named after this media's title and the clicked resolution (Codex R3 #1 · Fable R2 #4)", () => {
    const s = session()
    const cap = armVideoDownloadCapture(s, '/tmp/d', { timeoutMs: 1000, title: MEDIA_TITLE, res: '1080p' })
    const other = fakeItem('Neon_city_at_night_1080p_20261019.mp4', 'video/mp4')
    s.emit('will-download', {}, other)
    const wrongRes = fakeItem('Amber_light_particles_drifting_720p_20261019.mp4', 'video/mp4')
    s.emit('will-download', {}, wrongRes)
    expect(other.savePath).toBeNull()
    expect(wrongRes.savePath).toBeNull()
    const ours = fakeItem('Amber_light_particles_drifting_1080p_20261019110901.mp4', 'video/mp4')
    s.emit('will-download', {}, ours)
    expect(ours.savePath).toBe('/tmp/d/Amber_light_particles_drifting_1080p_20261019110901.mp4')
    cap.dispose()
  })

  it('reads the resolution from the last token — a title containing "4K" does not confuse it (Codex R4 #3 · Fable R3 #1)', () => {
    const s = session()
    const cap = armVideoDownloadCapture(s, '/tmp/d', { timeoutMs: 1000, title: 'Cinematic 4K drone shot', res: '1080p' })
    const ours = fakeItem('Cinematic_4K_drone_shot_1080p_20261019.mp4', 'video/mp4')
    s.emit('will-download', {}, ours)
    expect(ours.savePath).toBe('/tmp/d/Cinematic_4K_drone_shot_1080p_20261019.mp4')
    cap.dispose()
  })

  it('a requested resolution needs a resolution token in the name (Codex R4 #2)', () => {
    const s = session()
    const ignored = []
    const cap = armVideoDownloadCapture(s, '/tmp/d', { timeoutMs: 1000, title: MEDIA_TITLE, res: '1080p', onIgnored: (i) => ignored.push(i.reason) })
    const noTok = fakeItem('Amber_light_particles_drifting.mp4', 'video/mp4')
    s.emit('will-download', {}, noTok)
    expect(noTok.savePath).toBeNull()
    expect(ignored).toEqual(['resolution'])
    cap.dispose()
  })

  it('a non-ASCII (e.g. Korean) title is not used for name matching — Flow may strip it (Fable R3 #2)', () => {
    const s = session()
    const cap = armVideoDownloadCapture(s, '/tmp/d', { timeoutMs: 1000, title: '호박색 빛 입자가 흐르는 배경', res: '1080p' })
    const ours = fakeItem('_1080p_20261019.mp4', 'video/mp4')
    s.emit('will-download', {}, ours)
    expect(ours.savePath).toBe('/tmp/d/_1080p_20261019.mp4')
    cap.dispose()
  })

  it('abort(reason) settles the wait at once and cancels a running item (left the editor / document gone)', async () => {
    const s = session()
    const cap = armVideoDownloadCapture(s, '/tmp/d', { timeoutMs: 5000 })
    const vid = fakeItem('a.mp4', 'video/mp4')
    s.emit('will-download', {}, vid)
    cap.abort('left-editor')
    await expect(cap.wait()).resolves.toEqual({ error: 'left-editor' })
    expect(vid.cancelled).toBe(true)
    cap.dispose()
  })

  it('reports every ignored download with its reason (live diagnosis)', () => {
    const s = session()
    const ignored = []
    const cap = armVideoDownloadCapture(s, '/tmp/d', { timeoutMs: 1000, title: MEDIA_TITLE, res: '1080p', onIgnored: (info) => ignored.push(info) })
    const pdf = fakeItem('a.pdf', 'application/pdf')
    s.emit('will-download', {}, pdf)
    const other = fakeItem('Neon_city_1080p_1.mp4', 'video/mp4')
    s.emit('will-download', {}, other)
    const wrongRes = fakeItem('Amber_light_particles_drifting_720p_1.mp4', 'video/mp4')
    s.emit('will-download', {}, wrongRes)
    expect(ignored.map((i) => i.reason)).toEqual(['not-video', 'title', 'resolution'])
    expect(ignored[1]).toMatchObject({ name: 'Neon_city_1080p_1.mp4' })
    cap.dispose()
  })

  it('without a known title it still checks the resolution token', () => {
    const s = session()
    const cap = armVideoDownloadCapture(s, '/tmp/d', { timeoutMs: 1000, title: null, res: '1080p' })
    const wrongRes = fakeItem('Something_720p_1.mp4', 'video/mp4')
    s.emit('will-download', {}, wrongRes)
    expect(wrongRes.savePath).toBeNull()
    const ours = fakeItem('Something_1080p_1.mp4', 'video/mp4')
    s.emit('will-download', {}, ours)
    expect(ours.savePath).toBe('/tmp/d/Something_1080p_1.mp4')
    cap.dispose()
  })

  it('waitForVideoCaptures resolves once every capture is disposed (the whole download op is over), or at its limit', async () => {
    const s = session()
    const cap = armVideoDownloadCapture(s, '/tmp/d', { timeoutMs: 1000 })
    const vid = fakeItem('a.mp4', 'video/mp4')
    s.emit('will-download', {}, vid)
    let settled = false
    const w = waitForVideoCaptures(2000).then((r) => { settled = true; return r })
    vid.emit('done', {}, 'completed')
    await cap.wait()
    await new Promise((r) => setTimeout(r, 30))
    expect(settled).toBe(false)          // 파일은 왔지만 호출자가 아직 돌아가는 중
    cap.dispose()
    await expect(w).resolves.toBe(true)
    await expect(waitForVideoCaptures(50)).resolves.toBe(true)   // 남은 것 없음
  })

  it('waitForVideoCaptures gives up at its limit', async () => {
    const cap = armVideoDownloadCapture(session(), '/tmp/d', { timeoutMs: 1000 })
    await expect(waitForVideoCaptures(30)).resolves.toBe(false)
    cap.dispose()
  })

  it('isVideoCapturePending is true from arming until dispose (Fable R2 #1)', async () => {
    const s = session()
    expect(isVideoCapturePending()).toBe(false)
    const cap = armVideoDownloadCapture(s, '/tmp/d', { timeoutMs: 1000 })
    expect(isVideoCapturePending()).toBe(true)
    const vid = fakeItem('a.mp4', 'video/mp4')
    s.emit('will-download', {}, vid)
    vid.emit('done', {}, 'completed')
    await cap.wait()
    expect(isVideoCapturePending()).toBe(true)
    cap.dispose()
    cap.dispose()   // idempotent
    expect(isVideoCapturePending()).toBe(false)
  })

  it('reports an interrupted download', async () => {
    const s = session()
    const cap = armVideoDownloadCapture(s, '/tmp/d', { timeoutMs: 1000 })
    const vid = fakeItem('a.mp4', 'video/mp4')
    s.emit('will-download', {}, vid)
    vid.emit('done', {}, 'interrupted')
    await expect(cap.wait()).resolves.toEqual({ error: 'download-interrupted' })
    cap.dispose()
  })

  it('times out when nothing arrives, and dispose detaches the listener', async () => {
    const s = session()
    const cap = armVideoDownloadCapture(s, '/tmp/d', { timeoutMs: 30 })
    await expect(cap.wait()).resolves.toEqual({ error: 'timeout' })
    cap.dispose()
    expect(s.listenerCount('will-download')).toBe(0)
  })

  it('dispose cancels a capture still in progress', () => {
    const s = session()
    const cap = armVideoDownloadCapture(s, '/tmp/d', { timeoutMs: 1000 })
    const vid = fakeItem('a.mp4', 'video/mp4')
    s.emit('will-download', {}, vid)
    cap.dispose()
    expect(vid.cancelled).toBe(true)
  })
})

describe('guardFlowNavigation (Codex R4 #1 · Fable R3 #5: every reload of the Flow view waits for a pending upscaled download)', () => {
  function fakeWebContents() {
    const calls = []
    return { calls, loadURL: async (u) => { calls.push('load:' + u) }, reload: () => { calls.push('reload') } }
  }
  it('loadURL and reload wait until the pending download is over', async () => {
    const wc = fakeWebContents()
    let pending = true
    let release
    const gate = new Promise((r) => { release = r })
    guardFlowNavigation(wc, { isPending: () => pending, wait: () => gate.then(() => true), log: () => {} })
    const p = wc.loadURL('https://flow.google.com/project/x')
    wc.reload()
    await new Promise((r) => setTimeout(r, 20))
    expect(wc.calls).toEqual([])
    pending = false
    release()
    await p
    await new Promise((r) => setTimeout(r, 0))
    expect(wc.calls).toEqual(['load:https://flow.google.com/project/x', 'reload'])
  })
  it('navigates at once when nothing is pending', async () => {
    const wc = fakeWebContents()
    guardFlowNavigation(wc, { isPending: () => false, wait: async () => true, log: () => {} })
    await wc.loadURL('u')
    wc.reload()
    expect(wc.calls).toEqual(['load:u', 'reload'])
  })
})
