// @vitest-environment node
//
// M3-7 — 레퍼런스 업로드 드라이버 uploadReferenceByPaste(ctx, ref) + FLOW_PASTE_OBSERVER_INJECTION(계획서 2026-09-25 M3 D4 · D4-c · D5 · D16).
//   하네스: 가짜 페이지(tests/helpers/fakeFlowComposer.js — 페이지 스크립트는 jsdom window.eval 로 실제로 돈다) + 가짜 클립보드 + **실제** 라우터
//   (routeReportResponse·buildReportCtx) + 붙여넣기에 이어 예약되는 maseQ send/loadend(S3#4) + 가짜 타이머.
//   절차: 사전 판독(편집기 포커스·창 닫힘·바쁜 칩 없음 — 클립보드에 손대기 전) → 스냅샷(uri-list 면 거부) → 디코드 → gen arm → 관찰 주입 →
//   writeImage → paste → 관찰(≤3s, exec 마다 1s race) → **관찰 즉시 복원**(finally + 붙여넣기 뒤 5s 백스톱) → send 마감 15s → loadend →
//   칩 검증(**id img 까지** ≤15s — busy 해제만으로는 안 된다, P1a) → 캐시 기록.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createHash } from 'node:crypto'
import { JSDOM } from 'jsdom'
import { uploadReferenceByPaste, FLOW_PASTE_OBSERVER_INJECTION } from '../../electron/flow-reference-driver.js'
import { refMediaCache } from '../../electron/flow-ref-media-cache.js'
import { makeRefDriverHarness, maseQBody, pngBytes, FAKE_DOC, FAKE_PROJECT } from '../helpers/fakeFlowComposer.js'
import { uuid as U } from '../fixtures/flow-live-dom-m3.js'
import { respBodyFailure } from '../fixtures/flow-batchexecute-samples.js'

const NOW_S = 1790240102.5
const sha = (b) => createHash('sha256').update(b).digest('hex')
const KING = pngBytes('king-reference')
const REF = { index: 0, bytes: KING, sha: sha(KING) }
const ATTACH_FAILED = 'flow-reference-attach-failed'

let logSpy, warnSpy, errSpy
beforeEach(() => {
  vi.useFakeTimers({ now: NOW_S * 1000 })
  refMediaCache.clear()
  logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
  warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
  errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => { vi.useRealTimers(); logSpy.mockRestore(); warnSpy.mockRestore(); errSpy.mockRestore() })
const logged = () => [...logSpy.mock.calls, ...warnSpy.mock.calls, ...errSpy.mock.calls].map((c) => c.map(String).join(' ')).join('\n')

/** 가짜 시계에서 드라이버를 굴린다 — settle 된 시각(ms, 시작 기준)도 돌려준다. */
async function drive(promise, maxMs = 60000, stepMs = 100) {
  const t0 = Date.now()
  let done = false
  let at = null
  const p = promise.then((v) => { done = true; at = Date.now() - t0; return v })
  for (let t = 0; t < maxMs && !done; t += stepMs) await vi.advanceTimersByTimeAsync(stepMs)
  return { result: await p, at }
}
/** 첫 등장 순서가 tags 순서인가. */
function expectInOrder(trace, tags) {
  const idx = tags.map((t) => trace.indexOf(t))
  for (let i = 0; i < tags.length; i++) expect(idx[i], `${tags[i]} in trace ${JSON.stringify(trace)}`).toBeGreaterThanOrEqual(0)
  for (let i = 1; i < tags.length; i++) expect(idx[i], `${tags[i - 1]} before ${tags[i]}`).toBeGreaterThan(idx[i - 1])
}

describe('uploadReferenceByPaste — 정상 경로', () => {
  it('trace: state-read → snapshot → writeImage → paste → paste-observed → restore → maseQ send → loadend → chip-id → cache:set (복원이 send 보다 먼저); Lexical 형식은 진행', async () => {
    const h = makeRefDriverHarness()
    const write = vi.spyOn(h.clipboard, 'write')
    const { result } = await drive(uploadReferenceByPaste(h.ctx, REF))
    expect(result).toEqual({ ok: true, mediaId: U(3) })
    expectInOrder(h.trace, ['state-read', 'clipboard:snapshot', 'clipboard:writeImage', 'paste', 'paste-observed', 'clipboard:restore', 'maseQ:send', 'maseQ:loadend', 'chip-id', 'cache:set'])
    // 사용자 클립보드(앱 텍스트창 복사 — Lexical 형식 포함)는 text/html 로 돌아왔다(앱 전용 형식은 버린다)
    expect(write.mock.calls.map((c) => c[0])).toEqual([{ text: 'user text', html: '<p>user text</p>' }])
    expect(h.clipboard.state.formats).toEqual(['text/plain', 'text/html'])
    expect(refMediaCache.get(FAKE_DOC, FAKE_PROJECT, REF.sha)).toBe(U(3))
    expect(h.pendingGenerations.size).toBe(0)
    expect(h.page.counts.paste).toBe(1)
    const out = logged()
    expect(out).toMatch(/\[Flow Upload\] ref#0 bytes=\d+ sha=[0-9a-f]{8} formats=3 fileCopy=false/)
    expect(out).toMatch(/\[Flow Upload\] paste observed files=1 target=editor ms=\d+/)
    expect(out).toMatch(/\[Flow Upload\] clipboard restored/)
    expect(out).toMatch(/\[Flow Upload\] ref#0 uploaded media=00000003 chipIdAfter=\d+/)
    expect(out).toMatch(/\[Flow Refs\] cache set media=00000003/)
  })

  it('칩 수명 busyMs:100 · imgMs:9600 → 결과는 9.6s 이후에만 — busy 해제(와 loadend 7.5s) 시점에 성공하는 구현은 빨갛다', async () => {
    const h = makeRefDriverHarness({ page: { upload: { busyMs: 100, imgMs: 9600 } } })
    let settled = false
    const p = uploadReferenceByPaste(h.ctx, REF).then((v) => { settled = true; return v })
    await vi.advanceTimersByTimeAsync(9500)
    expect(h.trace).toContain('maseQ:loadend')
    expect(settled).toBe(false)
    const { result, at } = await drive(p)
    expect(result).toEqual({ ok: true, mediaId: U(3) })
    expect(at + 9500).toBeGreaterThanOrEqual(9600)
  })

  it('loadend 뒤 15s 안에 id img 가 없다 → chip-no-id, 캐시 기록 없음, gen 삭제', async () => {
    const h = makeRefDriverHarness({ page: { upload: { busyMs: 100, imgMs: Infinity } } })
    const { result, at } = await drive(uploadReferenceByPaste(h.ctx, REF))
    expect(result).toEqual({ ok: false, kind: ATTACH_FAILED, reason: 'chip-no-id' })
    expect(at).toBeGreaterThanOrEqual(7500 + 15000)
    expect(h.trace).not.toContain('cache:set')
    expect(h.pendingGenerations.size).toBe(0)
    expect(h.report.map((r) => r.step)).toEqual(['upload:chip-no-id'])
  })
})

describe('uploadReferenceByPaste — 클립보드에 손대기 전의 거부', () => {
  it('activeElement 가 애셋 검색창 → focus-not-editor, availableFormats·writeImage·paste 미호출, gen 없음', async () => {
    const h = makeRefDriverHarness({ page: { picker: 'add', focus: 'picker-search' } })
    const { result } = await drive(uploadReferenceByPaste(h.ctx, REF))
    expect(result).toEqual({ ok: false, kind: ATTACH_FAILED, reason: 'focus-not-editor' })
    expect(h.clipboard.calls).toEqual([])
    expect(h.page.counts.paste).toBe(0)
    expect(h.pendingGenerations.size).toBe(0)
  })

  it('편집기 포커스인데 애셋 창이 열려 있음 → picker-open; 바쁜 칩 → chip-busy (둘 다 클립보드 미접촉)', async () => {
    const a = makeRefDriverHarness({ page: { picker: 'at', focus: 'editor' } })
    expect((await drive(uploadReferenceByPaste(a.ctx, REF))).result).toEqual({ ok: false, kind: ATTACH_FAILED, reason: 'picker-open' })
    expect(a.clipboard.calls).toEqual([])
    const b = makeRefDriverHarness({ page: { chips: [{ id: null, busy: true }] } })
    expect((await drive(uploadReferenceByPaste(b.ctx, REF))).result).toEqual({ ok: false, kind: ATTACH_FAILED, reason: 'chip-busy' })
    expect(b.clipboard.calls).toEqual([])
    expect(b.page.counts.paste).toBe(0)
  })

  it('클립보드에 Finder 파일 복사(text/uri-list) → flow-reference-clipboard-busy, writeImage·paste 미호출, 클립보드 그대로', async () => {
    const h = makeRefDriverHarness({ clipboard: { formats: ['text/plain', 'text/uri-list'], text: '/Users/me/secret.png' } })
    const { result } = await drive(uploadReferenceByPaste(h.ctx, REF))
    expect(result).toEqual({ ok: false, kind: 'flow-reference-clipboard-busy' })
    expect(h.clipboard.calls).not.toContain('writeImage')
    expect(h.clipboard.calls).not.toContain('readText')
    expect(h.page.counts.paste).toBe(0)
    expect(h.clipboard.state).toMatchObject({ formats: ['text/plain', 'text/uri-list'], text: '/Users/me/secret.png' })
    expect(h.pendingGenerations.size).toBe(0)
    expect(logged()).not.toMatch(/secret\.png/)
  })

  it('디코드 안 되는 바이트 → image-decode-failed, writeImage·paste 없음', async () => {
    const h = makeRefDriverHarness()
    const gif = Buffer.from('GIF89a-not-decodable')
    const { result } = await drive(uploadReferenceByPaste(h.ctx, { index: 0, bytes: gif, sha: sha(gif) }))
    expect(result).toEqual({ ok: false, kind: ATTACH_FAILED, reason: 'image-decode-failed' })
    expect(h.clipboard.calls).not.toContain('writeImage')
    expect(h.page.counts.paste).toBe(0)
    expect(h.pendingGenerations.size).toBe(0)
  })

  it('isAborted() 가 처음부터 true → 클립보드·붙여넣기 없음; 스냅샷 뒤 쓰기 전에 true → writeImage·paste 없음, gen 삭제', async () => {
    const a = makeRefDriverHarness({ aborted: () => true })
    const ra = (await drive(uploadReferenceByPaste(a.ctx, REF))).result
    expect(ra).toMatchObject({ ok: false, reason: 'dom-stage-aborted' })
    expect(a.clipboard.calls).toEqual([])
    expect(a.page.counts.paste).toBe(0)
    let b = null
    b = makeRefDriverHarness({ aborted: () => b.trace.includes('clipboard:snapshot') })
    const rb = (await drive(uploadReferenceByPaste(b.ctx, REF))).result
    expect(rb).toMatchObject({ ok: false, reason: 'dom-stage-aborted' })
    expect(b.clipboard.calls).not.toContain('writeImage')
    expect(b.page.counts.paste).toBe(0)
    expect(b.pendingGenerations.size).toBe(0)
  })
})

describe('uploadReferenceByPaste — 붙여넣기·관찰·복원', () => {
  it('관찰 exec 가 영영 settle 안 함(죽은 문서) → 붙여넣기 뒤 5s 안에 clipboard:restore, paste-not-observed, gen 삭제, cache:set 없음', async () => {
    const h = makeRefDriverHarness({ hangObserver: true })
    let settled = false
    const p = uploadReferenceByPaste(h.ctx, REF).then((v) => { settled = true; return v })
    await vi.advanceTimersByTimeAsync(5000)
    expect(h.trace).toContain('paste')
    expect(h.trace).toContain('observer:hang')
    expect(h.trace).toContain('clipboard:restore')
    const { result } = await drive(p)
    expect(settled).toBe(true)
    expect(result).toEqual({ ok: false, kind: ATTACH_FAILED, reason: 'paste-not-observed' })
    expect(h.pendingGenerations.size).toBe(0)
    expect(h.trace).not.toContain('cache:set')
    expect(h.clipboard.state.text).toBe('user text')
  })

  it('관찰된 붙여넣기의 대상이 편집기 밖 → paste-wrong-target, 복원됨, gen 삭제', async () => {
    const h = makeRefDriverHarness({ page: { pasteTarget: '.af-header input.search-input' } })
    const { result } = await drive(uploadReferenceByPaste(h.ctx, REF))
    expect(result).toEqual({ ok: false, kind: ATTACH_FAILED, reason: 'paste-wrong-target' })
    expect(h.trace).toContain('clipboard:restore')
    expect(h.pendingGenerations.size).toBe(0)
    expect(h.trace).not.toContain('maseQ:send')
  })

  it('사용자가 업로드 도중 다른 것을 복사 → 복원하지 않는다(그 복사가 남는다), 업로드는 성공', async () => {
    let h = null
    h = makeRefDriverHarness({ upload: { onPaste: () => h.clipboard.userCopiesText('copied meanwhile') } })
    const { result } = await drive(uploadReferenceByPaste(h.ctx, REF))
    expect(result).toEqual({ ok: true, mediaId: U(3) })
    expect(h.clipboard.state).toMatchObject({ text: 'copied meanwhile', formats: ['text/plain'] })
    expect(h.trace).not.toContain('clipboard:restore')
    expect(logged()).toMatch(/clipboard changed during upload — not restored/)
  })

  it('send 가 안 온다 → 붙여넣기 뒤 15s 에 upload-not-sent', async () => {
    const h = makeRefDriverHarness({ upload: { noSend: true } })
    const { result, at } = await drive(uploadReferenceByPaste(h.ctx, REF))
    expect(result).toEqual({ ok: false, kind: ATTACH_FAILED, reason: 'upload-not-sent' })
    expect(at).toBeGreaterThanOrEqual(15000)
    expect(at).toBeLessThan(17000)
    expect(h.pendingGenerations.size).toBe(0)
  })
})

describe('uploadReferenceByPaste — maseQ 결과·칩 검증', () => {
  it('maseQ 실패 프레임 → upload-rpc-error, 캐시 기록 없음, 보고 upload:upload-rpc-error', async () => {
    const h = makeRefDriverHarness({ upload: { responseText: () => respBodyFailure('maseQ', 3) } })
    const { result } = await drive(uploadReferenceByPaste(h.ctx, REF))
    expect(result).toEqual({ ok: false, kind: ATTACH_FAILED, reason: 'upload-rpc-error' })
    expect(h.trace).not.toContain('cache:set')
    expect(h.report.map((r) => r.step)).toEqual(['upload:upload-rpc-error'])
  })

  it('loadend 의 id ≠ 칩 id → chip-mismatch, 캐시 기록 없음', async () => {
    const h = makeRefDriverHarness({ page: { upload: { ids: [U(9)] } }, upload: { responseText: () => maseQBody(U(3)) } })
    const { result } = await drive(uploadReferenceByPaste(h.ctx, REF))
    expect(result).toEqual({ ok: false, kind: ATTACH_FAILED, reason: 'chip-mismatch' })
    expect(h.trace).not.toContain('cache:set')
    expect(refMediaCache.get(FAKE_DOC, FAKE_PROJECT, REF.sha)).toBeNull()
  })

  it('붙여넣기 하나에 새 칩 둘 → chip-mismatch', async () => {
    const h = makeRefDriverHarness({ page: { upload: { extraChip: true } } })
    const { result } = await drive(uploadReferenceByPaste(h.ctx, REF))
    expect(result).toEqual({ ok: false, kind: ATTACH_FAILED, reason: 'chip-mismatch' })
    expect(h.trace).not.toContain('cache:set')
  })

  it('이미 칩이 하나 있으면(L0=1) 새 칩 하나만 늘어야 한다 → 성공, 캐시는 바인딩된 gen.doc 으로', async () => {
    const h = makeRefDriverHarness({ page: { chips: [{ id: U(5) }] } })
    const { result } = await drive(uploadReferenceByPaste(h.ctx, REF))
    expect(result).toEqual({ ok: true, mediaId: U(3) })
    expect(h.page.chipIds()).toEqual([U(5), U(3)])
    expect(refMediaCache.get(FAKE_DOC, FAKE_PROJECT, REF.sha)).toBe(U(3))
  })

  it('로그·보고에 base64·파일명(image.png)·클립보드 내용이 없다', async () => {
    const h = makeRefDriverHarness({ upload: { responseText: () => respBodyFailure('maseQ', 3) } })
    await drive(uploadReferenceByPaste(h.ctx, REF))
    const ok = makeRefDriverHarness()
    await drive(uploadReferenceByPaste(ok.ctx, REF))
    const out = logged() + JSON.stringify([h.report, ok.report])
    expect(out).not.toContain('image.png')
    expect(out).not.toContain(KING.toString('base64'))
    expect(out).not.toContain('king-reference')
    expect(out).not.toContain('user text')
  })
})

describe('FLOW_PASTE_OBSERVER_INJECTION — 문서 capture 단계 paste 리스너(카운터·대상·파일 수만)', () => {
  const page = () => {
    const dom = new JSDOM('<!doctype html><body><div contenteditable="true" class="ProseMirror"><p>x</p></div><input class="other"></body>', { runScripts: 'outside-only' })
    return dom.window
  }
  const firePaste = (w, sel, files) => {
    const e = new w.Event('paste', { bubbles: true, cancelable: true })
    Object.defineProperty(e, 'clipboardData', { value: { files: { length: files } } })
    w.document.querySelector(sel).dispatchEvent(e)
    return e
  }

  it('멱등(두 번 주입해도 붙여넣기 하나 = n+1) · 편집기 대상·파일 수 · defaultPrevented 없음 · 뒤 리스너도 받는다', () => {
    const w = page()
    expect(w.eval(FLOW_PASTE_OBSERVER_INJECTION)).toEqual({ n: 0, inEditor: null, files: 0 })
    expect(w.eval(FLOW_PASTE_OBSERVER_INJECTION)).toEqual({ n: 0, inEditor: null, files: 0 })
    let later = 0
    w.document.querySelector('div.ProseMirror').addEventListener('paste', () => { later++ })
    const e = firePaste(w, 'div.ProseMirror p', 1)
    expect(e.defaultPrevented).toBe(false)
    expect(later).toBe(1)
    expect(w.eval(FLOW_PASTE_OBSERVER_INJECTION)).toEqual({ n: 1, inEditor: true, files: 1 })
    firePaste(w, 'input.other', 0)
    expect(w.eval(FLOW_PASTE_OBSERVER_INJECTION)).toEqual({ n: 2, inEditor: false, files: 0 })
  })
})
