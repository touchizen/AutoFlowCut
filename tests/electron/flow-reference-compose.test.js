// @vitest-environment node
//
// M3-8 — 컴포즈 드라이버(계획서 2026-09-25 M3 D7·D8·D9 · D16): closePicker · clearComposer · scanUploadedAssets · attachAsset · insertMention ·
//   appendText · composeReferencePlan · readGate. 가짜 페이지(tests/helpers/fakeFlowComposer.js)는 프로브에서 본 대로 움직인다 —
//   ＋ 트리거 토글 · 탭 · 항목(미리보기) · 추가(창 자동 닫힘; ＋ = 칩, @ = 멘션 노드 + 뒤 공백 + 칩, 같은 미디어면 칩 병합·끝으로) ·
//   정확히 '@' 인 insertText 만 @ 창을 연다 · @ 창은 트리거 무반응·body 합성 Escape 로 닫힘('@' 뒤 입력 삭제) · 창이 열린 동안 지우기 무반응 ·
//   칩 hover+클릭 제거 · 이번 세션 업로드만 id 썸네일(나머지 불투명) · 첫 열기 누락 · 편집기 붙여넣기 업로드.
//   게이트는 한 번의 판독: 창 닫힘 · 바쁜 칩 없음 · 칩 id 집합 == 기대 · 멘션 id 순서열 == 기대(중복 포함) · 텍스트 정규화 == 기대 · 설정 요약 불변.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createHash } from 'node:crypto'
import {
  composeReferencePlan, clearComposer, closePicker, scanUploadedAssets, attachAsset, insertMention, appendText, readGate,
} from '../../electron/flow-reference-driver.js'
import { READ_SETTINGS_SUMMARY_JS } from '../../electron/flow-composer-dom.js'
import { refMediaCache } from '../../electron/flow-ref-media-cache.js'
import { makeRefDriverHarness, pngBytes, FAKE_DOC, FAKE_PROJECT } from '../helpers/fakeFlowComposer.js'
import { uuid as U, paragraph, mentionHtml } from '../fixtures/flow-live-dom-m3.js'

const NOW_S = 1790240102.5
const sha = (b) => createHash('sha256').update(b).digest('hex')
const ref = (tail) => { const bytes = pngBytes(tail); return { bytes, sha: sha(bytes) } }
const R0 = ref('king'), R1 = ref('queen'), R2 = ref('castle')
const M0 = U(10), M1 = U(11), M2 = U(12)
const ATTACH_FAILED = 'flow-reference-attach-failed'
const session = (...ids) => ids.map((id) => ({ id, session: true, name: 'image.png' }))
const seed = (r, id) => refMediaCache.set(FAKE_DOC, FAKE_PROJECT, r.sha, id)
const text = (t) => ({ t: 'text', text: t })
const mention = (i) => ({ t: 'mention', ref: i })

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

async function drive(promise, maxMs = 120000, stepMs = 100) {
  let done = false
  const p = promise.then((v) => { done = true; return v })
  for (let t = 0; t < maxMs && !done; t += stepMs) await vi.advanceTimersByTimeAsync(stepMs)
  return p
}
const compose = (h, refs, plan) => drive(composeReferencePlan(h.ctx, { refs, plan }))
/** 클릭 전 실패의 공통 단언 — 드라이버는 제출 gen 을 arm 하지 않고 생성 버튼을 누르지 않는다. */
function expectNoSubmit(h) {
  expect(h.pendingGenerations.size).toBe(0)
  expect(h.page.log.some((x) => x.startsWith('tclick:compose-submit'))).toBe(false)
}
const summaryOf = (h) => h.page.exec(READ_SETTINGS_SUMMARY_JS)

describe('composeReferencePlan — 재사용(세션 목록에 있음)', () => {
  it('[A @r0 walks with @r1 and @r0] + attach r2, 세 id 모두 세션 목록에 → 멘션 [m0,m1,m0] · 칩 {m0,m1,m2} · paste 0회 · 텍스트 정규화 일치(자동 공백 흡수)', async () => {
    seed(R0, M0); seed(R1, M1); seed(R2, M2)
    const h = makeRefDriverHarness({ page: { assets: session(M0, M1, M2) } })
    const plan = { segments: [text('A '), mention(0), text(' walks with '), mention(1), text(' and '), mention(0)], attach: [2] }
    const r = await compose(h, [R0, R1, R2], plan)
    expect(r).toEqual({
      ok: true, expectedRefs: [M0, M1, M2], expectedMentions: [M0, M1, M0], normPrompt: 'A walks with and',
      editorExpected: 'A image.png walks with image.png and image.png',
    })
    expect(h.page.mentionIds()).toEqual([M0, M1, M0])
    expect([...h.page.chipIds()].sort()).toEqual([M0, M1, M2].sort())
    expect(h.page.counts.paste).toBe(0)
    expect(h.pendingGenerations.size).toBe(0)
    expect(h.page.pickerKind()).toBeNull()
    const out = logged()
    expect(out).toMatch(/\[Flow Refs\] assets scan tab=upload idItems=3 cached=3 found=3 missing=0 reopened=0/)
    expect(out).toMatch(/\[Flow Refs\] mention ref#0 media=00000010 ok/)
    expect(out).toMatch(/\[Flow Refs\] attach ref#2 media=00000012 via=add-menu chip=ok/)
    expect(out).toMatch(/\[Flow Refs\] gate chips=3 mentions=3 text=ok summary=same ok=true/)
    expect(out).not.toMatch(/image\.png|walks|queen|king/)
  })

  it('캐시 hit 인데 첫 스캔에 없음(firstOpenMissing) → 닫고 다시 열기 1회 → 찾음 → 업로드 0회', async () => {
    seed(R0, M0)
    const h = makeRefDriverHarness({ page: { assets: session(M0), firstOpenMissing: true } })
    const r = await compose(h, [R0], { segments: [mention(0), text(' smiles')], attach: [] })
    expect(r).toMatchObject({ ok: true, expectedMentions: [M0], expectedRefs: [M0] })
    expect(h.page.counts.paste).toBe(0)
    expect(h.page.log.filter((x) => x.startsWith('picker:open:add'))).toEqual(['picker:open:add:missing', 'picker:open:add'])
    expect(logged()).toMatch(/assets scan tab=upload idItems=1 cached=1 found=1 missing=0 reopened=1/)
  })

  it('두 번 다 없음 → 그 ref 만 업로드 1회 + 캐시 교체 + 업로드 뒤 정리 → 새 id 로 멘션', async () => {
    seed(R0, U(7))   // 캐시엔 있는데 페이지 목록엔 없다
    seed(R1, M1)
    const h = makeRefDriverHarness({ page: { assets: session(M1) } })
    const r = await compose(h, [R0, R1], { segments: [mention(0), text(' and '), mention(1)], attach: [] })
    expect(r).toMatchObject({ ok: true, expectedMentions: [U(3), M1], expectedRefs: [U(3), M1] })
    expect(h.page.counts.paste).toBe(1)
    expect(refMediaCache.get(FAKE_DOC, FAKE_PROJECT, R0.sha)).toBe(U(3))
    expect(h.trace).toContain('cache:delete')
    // 업로드 칩은 컴포즈 전에 정리됐다 — 업로드(chip-id) 뒤에 지우기가 있고 그 뒤에 멘션
    const t = h.page.log
    expect(t.lastIndexOf('clear')).toBeGreaterThan(t.indexOf('paste:editor'))
    expect(t.findIndex((x) => x.startsWith('mention:'))).toBeGreaterThan(t.lastIndexOf('clear'))
    expect(logged()).toMatch(/assets scan tab=upload idItems=1 cached=2 found=1 missing=1 reopened=1/)
  })

  it('앞 세션 업로드(불투명 항목)만 있는 ref → 불투명 항목 클릭 없음, 업로드', async () => {
    const h = makeRefDriverHarness({ page: { assets: [{ id: U(7), session: false, name: 'image.png' }] } })
    const r = await compose(h, [R0], { segments: [text('x')], attach: [0] })
    expect(r).toMatchObject({ ok: true, expectedRefs: [U(3)] })
    expect(h.page.counts.paste).toBe(1)
    expect(h.page.log).not.toContain('item:opaque')
  })

  it('같은 sha 두 ref → 업로드 1회, 두 멘션 모두 그 id', async () => {
    const same = ref('king')
    const h = makeRefDriverHarness({ page: { assets: [] } })
    const r = await compose(h, [R0, same], { segments: [mention(0), text(' and '), mention(1)], attach: [] })
    expect(r).toMatchObject({ ok: true, expectedMentions: [U(3), U(3)], expectedRefs: [U(3)] })
    expect(h.page.counts.paste).toBe(1)
  })
})

describe('composeReferencePlan — 텍스트·애셋 창 실패(전부 클릭 전)', () => {
  it("텍스트 세그먼트 '@'(창을 여는 가짜) → at-sign-opened-picker, 창은 정리됨, arm·제출 없음", async () => {
    seed(R0, M0)
    const h = makeRefDriverHarness({ page: { assets: session(M0) } })
    const r = await compose(h, [R0], { segments: [text('@')], attach: [0] })
    expect(r).toEqual({ ok: false, kind: ATTACH_FAILED, reason: 'at-sign-opened-picker' })
    expect(h.page.pickerKind()).toBeNull()
    expectNoSubmit(h)
    expect(h.report.map((x) => x.step)).toEqual(['refs:at-sign-opened-picker'])
  })

  it("'mail a@b.com now' 은 한 번에 넣으면 창을 안 연다 → 정상", async () => {
    seed(R0, M0)
    const h = makeRefDriverHarness({ page: { assets: session(M0) } })
    const r = await compose(h, [R0], { segments: [text('mail a@b.com now')], attach: [0] })
    expect(r).toMatchObject({ ok: true, normPrompt: 'mail a@b.com now', expectedRefs: [M0] })
  })

  it('애셋 검색창에 글자 → picker-search-dirty, 업로드·추가 없음', async () => {
    seed(R0, M0)
    const h = makeRefDriverHarness({ page: { assets: session(M0), search: '왕' } })
    const r = await compose(h, [R0], { segments: [text('x')], attach: [0] })
    expect(r).toEqual({ ok: false, kind: ATTACH_FAILED, reason: 'picker-search-dirty' })
    expect(h.page.counts.paste).toBe(0)
    expect(h.page.log.some((x) => x.startsWith('add:') || x.startsWith('mention:'))).toBe(false)
    expect(h.page.pickerKind()).toBeNull()
    expectNoSubmit(h)
  })

  it('미리보기 id 가 다름 → preview-mismatch(추가 없음); 미리보기 불투명 → 검사 생략·칩 id 로 확정', async () => {
    seed(R0, M0)
    const a = makeRefDriverHarness({ page: { assets: session(M0), preview: { id: U(99) } } })
    expect(await compose(a, [R0], { segments: [text('x')], attach: [0] })).toEqual({ ok: false, kind: ATTACH_FAILED, reason: 'preview-mismatch' })
    expect(a.page.log.some((x) => x.startsWith('add:'))).toBe(false)
    expect(a.page.pickerKind()).toBeNull()
    expectNoSubmit(a)
    refMediaCache.clear(); seed(R0, M0)
    const b = makeRefDriverHarness({ page: { assets: session(M0), preview: { opaque: 1 } } })
    expect(await compose(b, [R0], { segments: [text('x')], attach: [0] })).toMatchObject({ ok: true, expectedRefs: [M0] })
  })

  it('애셋 창 첫 클릭 헛돔 → 1회 재클릭으로 진행; 두 번 다 헛돔 → picker-not-open', async () => {
    seed(R0, M0)
    const a = makeRefDriverHarness({ page: { assets: session(M0), triggerDudClicks: 1 } })
    expect(await compose(a, [R0], { segments: [text('x')], attach: [0] })).toMatchObject({ ok: true })
    expect(a.page.log.filter((x) => x === 'trigger:dud')).toHaveLength(1)
    refMediaCache.clear(); seed(R0, M0)
    const b = makeRefDriverHarness({ page: { assets: session(M0), triggerDudClicks: 2 } })
    expect(await compose(b, [R0], { segments: [text('x')], attach: [0] })).toEqual({ ok: false, kind: ATTACH_FAILED, reason: 'picker-not-open' })
    expect(b.page.log.filter((x) => x.startsWith('tclick:refs-picker-open'))).toHaveLength(2)
    expectNoSubmit(b)
  })

  it("'@' 가 창을 안 엶 → mention-trigger-not-working", async () => {
    seed(R0, M0)
    const h = makeRefDriverHarness({ page: { assets: session(M0), atOpens: false } })
    expect(await compose(h, [R0], { segments: [mention(0)], attach: [] })).toEqual({ ok: false, kind: ATTACH_FAILED, reason: 'mention-trigger-not-working' })
    expectNoSubmit(h)
  })
})

describe('게이트 — 칩 집합 · 멘션 순서열(클릭 전)', () => {
  it('추가 뒤 여분 칩 → chip-set-mismatch', async () => {
    seed(R0, M0)
    const h = makeRefDriverHarness({ page: { assets: session(M0), extraChipOnAdd: U(98) } })
    expect(await compose(h, [R0], { segments: [text('x')], attach: [0] })).toEqual({ ok: false, kind: ATTACH_FAILED, reason: 'chip-set-mismatch' })
    expectNoSubmit(h)
  })

  it('칩 개수는 같고 id 하나가 다름(＋ 추가 때 페이지가 m1 칩을 m9 로 바꿈 — 추가한 m2 는 맞다) → chip-set-mismatch', async () => {
    seed(R1, M1); seed(R2, M2)
    const h = makeRefDriverHarness({ page: { assets: session(M1, M2), addAlsoSwaps: { from: M1, to: U(9) } } })
    const r = await compose(h, [R1, R2], { segments: [mention(0), text(' in')], attach: [1] })
    expect(r).toEqual({ ok: false, kind: ATTACH_FAILED, reason: 'chip-set-mismatch' })
    expect(h.page.chipIds()).toHaveLength(2)
    expectNoSubmit(h)
  })

  it('readGate 직접 — 칩 [m0,m1,m9] vs 기대 {m0,m1,m2}(같은 개수) → chip-set-mismatch; 같은 id 두 칩 → chip-set-mismatch', async () => {
    const h = makeRefDriverHarness({ page: { chips: [{ id: M0 }, { id: M1 }, { id: U(9) }], editorHtml: paragraph('x') } })
    const summary = await summaryOf(h)
    expect(await drive(readGate(h.ctx, { refs: [M0, M1, M2], mentions: [], texts: ['x'], summary }))).toEqual({ ok: false, kind: ATTACH_FAILED, reason: 'chip-set-mismatch' })
    const d = makeRefDriverHarness({ page: { chips: [{ id: M0 }, { id: M0 }], editorHtml: paragraph('x') } })
    expect(await drive(readGate(d.ctx, { refs: [M0], mentions: [], texts: ['x'], summary }))).toEqual({ ok: false, kind: ATTACH_FAILED, reason: 'chip-set-mismatch' })
    expectNoSubmit(h)
  })

  it('readGate 직접 — 멘션 순서 뒤바뀜 [m1,m0] vs [m0,m1] → mention-mismatch', async () => {
    const h = makeRefDriverHarness({ page: { chips: [{ id: M0 }, { id: M1 }], editorHtml: paragraph(mentionHtml(M1, 'image.png'), ' and ', mentionHtml(M0, 'image.png'), ' ') } })
    const summary = await summaryOf(h)
    expect(await drive(readGate(h.ctx, { refs: [M0, M1], mentions: [M0, M1], texts: [' and '], summary }))).toEqual({ ok: false, kind: ATTACH_FAILED, reason: 'mention-mismatch' })
  })

  it('readGate 직접 — 멘션 순서열 길이는 같고 id 하나가 다름 [m0,m1,m9] vs [m0,m1,m0] → mention-mismatch', async () => {
    const h = makeRefDriverHarness({
      page: { chips: [{ id: M1 }, { id: M0 }], editorHtml: paragraph('A ', mentionHtml(M0, 'image.png'), ' b ', mentionHtml(M1, 'image.png'), ' c ', mentionHtml(U(9), 'image.png'), ' ') },
    })
    const summary = await summaryOf(h)
    expect(await drive(readGate(h.ctx, { refs: [M0, M1], mentions: [M0, M1, M0], texts: ['A ', ' b ', ' c '], summary }))).toEqual({ ok: false, kind: ATTACH_FAILED, reason: 'mention-mismatch' })
  })

  it('readGate 직접 — 텍스트 다름 → text-mismatch · 설정 요약 바뀜 → summary-changed · 통과 시 editorExpected = 라벨 포함 정규화', async () => {
    const h = makeRefDriverHarness({ page: { chips: [{ id: M0 }], editorHtml: paragraph(mentionHtml(M0, 'image.png'), '  walks  ') } })
    const summary = await summaryOf(h)
    expect(await drive(readGate(h.ctx, { refs: [M0], mentions: [M0], texts: [' runs'], summary }))).toEqual({ ok: false, kind: ATTACH_FAILED, reason: 'text-mismatch' })
    expect(await drive(readGate(h.ctx, { refs: [M0], mentions: [M0], texts: [' walks'], summary: { ...summary, text: 'Imagen 4 x1' } }))).toEqual({ ok: false, kind: ATTACH_FAILED, reason: 'summary-changed' })
    expect(await drive(readGate(h.ctx, { refs: [M0], mentions: [M0], texts: [' walks'], summary }))).toMatchObject({ ok: true, editorExpected: 'image.png walks' })
  })

  it('readGate 직접 — 창이 열려 있음 → picker-open · 바쁜 칩 → chip-busy', async () => {
    const a = makeRefDriverHarness({ page: { picker: 'add', chips: [{ id: M0 }], editorHtml: paragraph('x') } })
    const summary = await summaryOf(a)
    expect(await drive(readGate(a.ctx, { refs: [M0], mentions: [], texts: ['x'], summary }))).toEqual({ ok: false, kind: ATTACH_FAILED, reason: 'picker-open' })
    const b = makeRefDriverHarness({ page: { chips: [{ id: M0 }, { id: null, busy: true }], editorHtml: paragraph('x') } })
    expect(await drive(readGate(b.ctx, { refs: [M0], mentions: [], texts: ['x'], summary }))).toEqual({ ok: false, kind: ATTACH_FAILED, reason: 'chip-busy' })
  })
})

describe('clearComposer · closePicker', () => {
  it('시작 때 @ 창이 열려 있음 → 트리거 클릭 무반응 → 합성 Escape → 닫힘 → 지우기 → 비워짐', async () => {
    const h = makeRefDriverHarness({ page: { picker: 'at', chips: [{ id: U(5) }], editorHtml: paragraph('hello @') } })
    expect(await drive(clearComposer(h.ctx))).toEqual({ ok: true })
    const t = h.page.log
    expect(t).toContain('trigger:ignored')
    expect(t.indexOf('picker:close:escape')).toBeGreaterThan(t.indexOf('trigger:ignored'))
    expect(t.indexOf('clear')).toBeGreaterThan(t.indexOf('picker:close:escape'))
    expect(t).not.toContain('clear:ignored')
    expect(h.page.chipIds()).toEqual([])
    expect(h.page.editorText()).toBe('')
    expect(logged()).toMatch(/\[Flow Refs\] composer clear chips=1→0 editorLen=\d+→0/)
  })

  it('지우기가 칩을 남기는 페이지 → 칩마다 hover+클릭으로 제거', async () => {
    const h = makeRefDriverHarness({ page: { clearLeavesChips: true, chips: [{ id: U(5) }, { id: U(6) }], editorHtml: paragraph('x') } })
    expect(await drive(clearComposer(h.ctx))).toEqual({ ok: true })
    expect(h.page.log.filter((x) => x.startsWith('chip:remove:'))).toHaveLength(2)
    expect(h.page.chipIds()).toEqual([])
  })

  it('빈 컴포저 → 클릭 없이 ok(로그 chips=0 editorLen=0)', async () => {
    const h = makeRefDriverHarness()
    expect(await drive(clearComposer(h.ctx))).toEqual({ ok: true })
    expect(h.page.log.some((x) => x.startsWith('tclick:'))).toBe(false)
    expect(logged()).toMatch(/\[Flow Refs\] composer clear chips=0 editorLen=0/)
  })

  it('＋ 창은 트리거 클릭으로 닫는다(Escape 없음) · 닫힌 창은 아무것도 안 한다', async () => {
    const h = makeRefDriverHarness({ page: { picker: 'add' } })
    expect(await drive(closePicker(h.ctx))).toEqual({ ok: true })
    expect(h.page.log).toContain('picker:close:trigger')
    expect(h.page.log).not.toContain('picker:close:escape')
    const n = h.page.log.length
    expect(await drive(closePicker(h.ctx))).toEqual({ ok: true })
    expect(h.page.log.length).toBe(n)
  })
})

describe('단계 함수 — 직접 호출', () => {
  it('scanUploadedAssets: 업로드 탭의 id 썸네일만(불투명 제외), 창을 닫고 나온다', async () => {
    const h = makeRefDriverHarness({ page: { assets: [...session(M0, M1), { id: U(7), session: false }] } })
    expect(await drive(scanUploadedAssets(h.ctx, { wantIds: [M0] }))).toEqual({ ok: true, ids: [M0, M1], tab: 'upload', reopened: 0 })
    expect(h.page.pickerKind()).toBeNull()
    expect(h.page.log).toContain('tab:drive_folder_upload')
  })

  it('appendText: 캐럿 끝에 통째로 · insertMention: 멘션 노드 +1 · 칩 · 끝의 @ 사라짐 · attachAsset: ＋ 로 칩', async () => {
    const h = makeRefDriverHarness({ page: { assets: session(M0, M1) } })
    expect(await drive(appendText(h.ctx, 'The '))).toEqual({ ok: true })
    expect(await drive(insertMention(h.ctx, M0, 0))).toEqual({ ok: true })
    expect(await drive(appendText(h.ctx, ' sits'))).toEqual({ ok: true })
    expect(await drive(attachAsset(h.ctx, M1, 1))).toEqual({ ok: true })
    expect(h.page.editorText()).toBe('The image.png  sits')
    expect(h.page.mentionIds()).toEqual([M0])
    expect(h.page.chipIds()).toEqual([M0, M1])
  })

  it('isAborted → 좀비는 클릭·exec 없이 dom-stage-aborted', async () => {
    const h = makeRefDriverHarness({ page: { assets: session(M0) }, aborted: () => true })
    expect(await drive(composeReferencePlan(h.ctx, { refs: [R0], plan: { segments: [text('x')], attach: [0] } }))).toMatchObject({ ok: false, reason: 'dom-stage-aborted' })
    expect(h.page.log.some((x) => x.startsWith('tclick:'))).toBe(false)
    expect(h.trace).toEqual([])
  })
})
