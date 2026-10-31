// @vitest-environment node
//
// 2026-10-30 I2V — flow:generate-video-i2v(Flow 모드)의 본문. 크롬 실기(flow.google.com)로 확인한 흐름:
//   ① 설정(소재) → ② 시작 프레임을 레퍼런스 칩으로 첨부(composeReferencePlan — 정리·캐시·붙여넣기 업로드·＋ 첨부·게이트) → ③ 설정(프레임 = crop_free) —
//   소재 칩 중 첫 칩이 시작 칸으로 간다 → ④ 시작 칸 = 그 id · 끝 칸 비어 있음 · 칩 하나 확인 → ⑤ 프롬프트 주입·재판독 → ⑥ 제출(arm rpc eb1hJf ·
//   altRpcs [YhhmEf, MZZa6b] · want.kind 'i2v') → 응답 모델키는 i2v 표(abra_i2v_4s …).
//   클릭 전 거부: 시작 프레임 없음(flow-i2v-start-frame-missing) · 끝 프레임(flow-i2v-end-frame-unsupported — 시작 프레임만 지원) · 칸 불일치(start-frame-mismatch:<why>).
//   클릭 뒤 거부: 페이지가 eb1hJf 가 아닌 rpc 로 보냄 → flow-references-mismatch(+rejectedMediaId) · 모델키 불일치 → flow-video-settings-mismatch.
//   하네스: tests/helpers/flowRefHandlerHarness.js(kind 'video', generateI2V).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { _resetDomStageForTests } from '../../../electron/ipc/flow-angular.js'
import { _resetUnboundCloseRecordsForTests } from '../../../electron/flow-rpc-router.js'
import { refMediaCache } from '../../../electron/flow-ref-media-cache.js'
import { refHandlerHarness, settle } from '../../helpers/flowRefHandlerHarness.js'
import { respBodyWithPayload, samplePayload, maskedUuid as U } from '../../fixtures/flow-batchexecute-samples.js'

const NOW_S = 1790240102.5
const PROMPT = 'The hand pulls the scissors up'
const i2vResp = (modelKey = 'abra_i2v_4s') => { const p = samplePayload('YhhmEf'); p[3][0][7][0][12] = modelKey; return respBodyWithPayload('eb1hJf', p) }

let logSpy, warnSpy, errSpy
beforeEach(() => {
  _resetDomStageForTests()
  _resetUnboundCloseRecordsForTests()
  refMediaCache.clear()
  vi.useFakeTimers({ now: NOW_S * 1000 })
  logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
  warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
  errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => { vi.useRealTimers(); logSpy.mockRestore(); warnSpy.mockRestore(); errSpy.mockRestore() })
const logged = () => [...logSpy.mock.calls, ...warnSpy.mock.calls, ...errSpy.mock.calls].map((c) => c.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' ')).join('\n')
const at = (t, tag, from = 0) => { for (let i = from; i < t.length; i++) if (t[i] === tag || t[i].startsWith(tag)) return i; return -1 }

/** 제출 클릭 때 맵의 I2V gen 을 잡아 두고 eb1hJf send/loadend 를 흘린다(rpcid·응답을 덮을 수 있다). */
const capture = ({ rpcid = 'eb1hJf', responseText = i2vResp() } = {}) => {
  const box = { snapshot: null }
  box.onSubmit = (sp, map) => {
    const g = [...map.values()].find((x) => x.rpc === 'eb1hJf') || null
    if (g) box.snapshot = { rpc: g.rpc, altRpcs: g.altRpcs, wantKind: g.want && g.want.kind, normPrompt: g.normPrompt }
    sp.send(14, { rpcid, rpcids: [rpcid], prompts: [PROMPT], refs: null, mentions: null })
    sp.loadend(14, { rpcid, responseText })
  }
  return box
}

describe('I2V(프레임 → 영상) — 성공', () => {
  it('새 시작 프레임: 설정(소재) → 붙여넣기 업로드 → ＋ 첨부 → 설정(프레임) → 칸 확인 → 텍스트 → 제출 eb1hJf → {success, generationId, creditsLeft}', async () => {
    const box = capture()
    const h = refHandlerHarness({ kind: 'video', page: { upload: { ids: [U(4)] } }, onSubmit: box.onSubmit })
    const r = await settle(h.generateI2V(), 120000)
    expect(r).toEqual({ success: true, generationId: U(11), creditsLeft: 1040 })
    expect(box.snapshot).toEqual({ rpc: 'eb1hJf', altRpcs: ['YhhmEf', 'MZZa6b'], wantKind: 'i2v', normPrompt: PROMPT })
    const t = h.trace
    const order = [at(t, 'settings-driver'), at(t, 'paste'), at(t, 'settings-driver:frames'), at(t, 'page:input:frames'), at(t, 'set-text'), at(t, 'click:compose-submit')]
    for (let i = 1; i < order.length; i++) expect(order[i], `order step ${i}`).toBeGreaterThan(order[i - 1])
    expect(t[at(t, 'settings-driver')]).toBe('settings-driver')   // 첫 설정은 소재(input 키 없음)
    expect(h.page.counts.paste).toBe(1)
    expect(h.pendingGenerations.size).toBe(0)
    const out = logged()
    expect(out).toMatch(/\[Flow Video I2V\] \[Angular\] generate-video-i2v: .*"model":"Omni Flash"/)
    expect(out).toMatch(/\[Flow Video I2V\] \[Angular\] start frame media=00000004 ok/)
    expect(out).toMatch(/\[Flow RPC\] eb1hJf send doc=\S{8} seq=100 bound=\S+/)
    expect(out).toMatch(/\[Flow Video I2V\] \[Angular\] submitted media=00000011 creditsLeft=1040 modelKey=abra_i2v_4s/)
    for (const w of ['scissors', 'image.png']) expect(out, w).not.toContain(w)
  })

  it('2026-10-31 asb 주소(칩·칸에 id 없음): 업로드한 시작 프레임의 토큰을 as29s 로 배워 칩·칸 확인 통과 → 제출', async () => {
    const box = capture()
    const h = refHandlerHarness({ kind: 'video', page: { asb: true, upload: { ids: [U(4)] } }, as29sTokens: true, onSubmit: box.onSubmit })
    const r = await settle(h.generateI2V(), 120000)
    expect(r).toEqual({ success: true, generationId: U(11), creditsLeft: 1040 })
    expect(h.trace.filter((x) => x === 'as29s').length).toBe(1)
    const out = logged()
    expect(out).toMatch(/\[Flow Refs\] media token media=00000004 ok/)
    expect(out).toMatch(/\[Flow Video I2V\] \[Angular\] start frame media=00000004 ok/)
    expect(out).not.toMatch(/ANqvLO/)
  })

  it('같은 페이지 세션에서 같은 이미지 두 번째: 캐시 + id 썸네일이면 다시 올리지 않는다(붙여넣기 0)', async () => {
    const first = refHandlerHarness({ kind: 'video', page: { upload: { ids: [U(4)] } }, onSubmit: capture().onSubmit })
    await settle(first.generateI2V(), 120000)
    const h = refHandlerHarness({ kind: 'video', page: { assets: [{ id: U(4), session: true, name: 'image.png' }] }, onSubmit: capture().onSubmit })
    const r = await settle(h.generateI2V(), 120000)
    expect(r).toMatchObject({ success: true, generationId: U(11) })
    expect(h.page.counts.paste).toBe(0)
  })
})

describe('I2V — 클릭 전 거부(0크레딧): 제출 클릭 없음', () => {
  const noSubmit = (h) => { expect(h.trace).not.toContain('click:compose-submit'); expect(h.pendingGenerations.size).toBe(0) }

  it('startImage 없음 → flow-i2v-start-frame-missing(DOM 접촉 없음)', async () => {
    const h = refHandlerHarness({ kind: 'video' })
    const r = await settle(h.generateI2V({ startImage: null }), 10000)
    expect(r).toEqual({ success: false, errorKind: 'flow-i2v-start-frame-missing', error: 'flow-i2v-start-frame-missing' })
    expect(h.trace).not.toContain('settings-driver')
    noSubmit(h)
  })

  it('endImage 가 있으면 flow-i2v-end-frame-unsupported(새 Flow 는 시작 프레임만 — 조용히 버리지 않는다)', async () => {
    const h = refHandlerHarness({ kind: 'video' })
    const r = await settle(h.generateI2V({ endImage: 'aGVsbG8=' }), 10000)
    expect(r).toEqual({ success: false, errorKind: 'flow-i2v-end-frame-unsupported', error: 'flow-i2v-end-frame-unsupported' })
    noSubmit(h)
  })

  it('프레임 전환 뒤 시작 칸이 다른 이미지면 flow-reference-attach-failed(start-frame-mismatch)', async () => {
    const h = refHandlerHarness({
      kind: 'video', page: { upload: { ids: [U(4)] } }, onSubmit: capture().onSubmit,
      afterSettings: (s, page) => {
        if (!s.includes('"input":"frames"')) return
        const img = page.document.querySelector('.frame-trigger img')
        if (img) img.setAttribute('src', 'https://flow-content.google/image/' + U(9) + '?x=1')
      },
    })
    const r = await settle(h.generateI2V(), 120000)
    expect(r).toEqual({ success: false, errorKind: 'flow-reference-attach-failed', error: 'flow-reference-attach-failed', reason: 'start-frame-mismatch:start' })
    noSubmit(h)
  })

  it('텍스트 주입 뒤 애셋 창이 열려 있으면(편집기의 @ 등) start-frame-mismatch(picker-open) — 열린 창은 제출 클릭을 가린다', async () => {
    const h = refHandlerHarness({
      kind: 'video', page: { upload: { ids: [U(4)] } }, onSubmit: capture().onSubmit,
      afterSettings: (s, page) => {
        if (!s.includes('"input":"frames"')) return
        // 프레임 전환 뒤 텍스트 주입 때 창이 열린 것처럼 — 애셋 항목(button.asset-item)이 문서에 생긴다
        page.document.body.insertAdjacentHTML('beforeend', '<div class="cdk-overlay-pane"><button class="asset-item" role="option"></button></div>')
      },
    })
    const r = await settle(h.generateI2V(), 120000)
    expect(r).toEqual({ success: false, errorKind: 'flow-reference-attach-failed', error: 'flow-reference-attach-failed', reason: 'start-frame-mismatch:picker-open' })
    expect(logged()).toMatch(/start frame slot mismatch why=picker-open/)
    noSubmit(h)
  })

  // Codex 3차 M4: 칸 판독이 워치독(DOM 단계 상한) 뒤에 돌아오면 — 방패·입력 잠금이 이미 풀렸다 — Flow 에 포커스를 주거나 편집기를 누르지 않는다(사용자 입력이 Flow 로 샌다).
  it('칸 판독이 워치독 뒤에 돌아와도 그 뒤로 포커스·캐럿 클릭·주입 없음', async () => {
    let delayed = false
    const h = refHandlerHarness({
      kind: 'video', page: { upload: { ids: [U(4)] } }, onSubmit: capture().onSubmit,
      execDelay: (s) => (!delayed && s.includes('frame-trigger') ? ((delayed = true), 300000) : 0),
    })
    await settle(h.generateI2V(), 400000)
    // 핸들러는 워치독에서 이미 돌아왔다 — 늦은 판독(300s) 뒤의 좀비가 마저 돌도록 시계를 더 돌린다
    for (let i = 0; i < 400; i++) await vi.advanceTimersByTimeAsync(1000)
    expect(h.trace).toContain('exec-delayed')
    const t = h.trace
    const off = t.indexOf('keylock:off')
    expect(off).toBeGreaterThan(-1)
    expect(t.slice(off).some((x) => x === 'click:compose-editor' || x.startsWith('set-text') || x === 'focus')).toBe(false)
    expect(t.filter((x) => x === 'click:compose-editor')).toHaveLength(1)
    noSubmit(h)
  })

  // Codex 4차 M2: 칸 확인은 워치독 전에 끝났지만 그 뒤 캐럿 클릭(도우미의 대기 포함) 중에 워치독이 울리면 — 누르기 직전(beforeDispatch)에 멈춘다.
  it('두 번째 캐럿 클릭이 워치독 뒤로 밀리면 누르지 않는다(dispatch-refused)', async () => {
    const h = refHandlerHarness({
      kind: 'video', page: { upload: { ids: [U(4)] } }, onSubmit: capture().onSubmit,
      clickDelay: (step, n) => (step === 'compose-editor' && n === 2 ? 300000 : 0),
    })
    await settle(h.generateI2V(), 400000)
    for (let i = 0; i < 400; i++) await vi.advanceTimersByTimeAsync(1000)
    const t = h.trace
    expect(t).toContain('dispatch-refused:compose-editor')
    const off = t.indexOf('keylock:off')
    expect(off).toBeGreaterThan(-1)
    expect(t.slice(off).some((x) => x === 'dispatched:compose-editor' || x.startsWith('set-text'))).toBe(false)
    noSubmit(h)
  })

  it('프레임 설정이 실패하면 그 설정 실패로 닫는다(제출 없음)', async () => {
    const h = refHandlerHarness({
      kind: 'video', page: { upload: { ids: [U(4)] } },
      settings: (s) => (s.includes('"input":"frames"') ? { ok: false, kind: 'flow-settings-not-applied', reason: 'input-mode-not-offered:frames', steps: {}, closed: true } : undefined),
    })
    const r = await settle(h.generateI2V(), 120000)
    expect(r).toMatchObject({ success: false, errorKind: 'flow-settings-not-applied', reason: 'input-mode-not-offered:frames' })
    noSubmit(h)
  })
})

describe('I2V — 클릭 뒤 거부: postClick + rejectedMediaId, generationId 없음', () => {
  it('페이지가 YhhmEf(T2V)로 보냄 → flow-references-mismatch + rejectedMediaId', async () => {
    const box = capture({ rpcid: 'YhhmEf', responseText: respBodyWithPayload('YhhmEf', samplePayload('YhhmEf')) })
    const h = refHandlerHarness({ kind: 'video', page: { upload: { ids: [U(4)] } }, onSubmit: box.onSubmit })
    const r = await settle(h.generateI2V(), 120000)
    expect(r).toEqual({ success: false, errorKind: 'flow-references-mismatch', error: 'flow-references-mismatch', errorParams: {}, rejectedMediaId: U(11), postClick: true })
    expect(logged()).toMatch(/bound rpc YhhmEf ≠ eb1hJf/)
  })

  it('응답 모델키가 i2v 가 아니면(abra_t2v_4s) flow-video-settings-mismatch {expected …i2v, actual}', async () => {
    const box = capture({ responseText: i2vResp('abra_t2v_4s') })
    const h = refHandlerHarness({ kind: 'video', page: { upload: { ids: [U(4)] } }, onSubmit: box.onSubmit })
    const r = await settle(h.generateI2V(), 120000)
    expect(r).toEqual({
      success: false, errorKind: 'flow-video-settings-mismatch', error: 'flow-video-settings-mismatch',
      errorParams: { expected: 'Omni Flash 4s 9:16 720p i2v', actual: 'abra_t2v_4s' }, rejectedMediaId: U(11), postClick: true,
    })
  })
})
