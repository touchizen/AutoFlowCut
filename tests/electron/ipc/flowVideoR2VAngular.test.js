// @vitest-environment node
//
// M3-10 — flow:generate-video-t2v(Flow 모드)의 **레퍼런스 영상(r2v, MZZa6b)** 경로(계획서 2026-09-25 M3 D1·D10·D11·D12·D13 · §4 M3-10).
//   refs 가 있으면 arm 은 rpc:'MZZa6b' · altRpcs:['YhhmEf'] · want.kind:'r2v' — 라우터가 둘 중 실제 rpc 로 바인딩(gen.boundRpc)하고 핸들러가 판정한다:
//   boundRpc ≠ rpc(페이지가 YhhmEf 로 보냄) → 클릭 뒤 flow-references-mismatch(+rejectedMediaId, postClick) — 과금은 됐고 새 제출만 멈춘다.
//   클릭 뒤 검증(D12): 요청 refs(집합·개수)·mentions(중복 보존 순서열)·응답 되돌림 [3][0][5][6][1][1][j][2] — 어긋나면 거부, generationId·mediaId 키 없음.
//   모델키는 r2v 표로(abra_r2v_* · veo_3_1_r2v_fast_{portrait|landscape}). 클릭 전: 지원 모델 밖 → flow-references-model-unsupported {model},
//   유일 ref > FLOW_R2V_REFERENCE_LIMIT(3) → flow-references-too-many {max} — 둘 다 세션 게이트 뒤·DOM 전.
//   하네스: tests/helpers/flowRefHandlerHarness.js(kind 'video').
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { _resetDomStageForTests } from '../../../electron/ipc/flow-angular.js'
import { _resetUnboundCloseRecordsForTests } from '../../../electron/flow-rpc-router.js'
import { refMediaCache } from '../../../electron/flow-ref-media-cache.js'
import { refHandlerHarness, settle, refInput, refSha, text, mention, session, FAKE_DOC, FAKE_PROJECT } from '../../helpers/flowRefHandlerHarness.js'
import { s3Payload } from '../../fixtures/flow-m3-samples.js'
import { respBodyWithPayload, maskedUuid as U } from '../../fixtures/flow-batchexecute-samples.js'

const NOW_S = 1790240102.5
const seed = (tail, id) => refMediaCache.set(FAKE_DOC, FAKE_PROJECT, refSha(tail), id)
/** S3#17: @king(U2) 인라인 멘션 · Omni 4초 9:16 — 요청 refs [U2]·mentions [U2]·텍스트 ' walks toward the camera' → U45 · 857 · abra_r2v_4s · 되돌림 [U2]. */
const PLAN17 = { segments: [mention(0), text(' walks toward the camera')], attach: [] }
/** S3#20: 같은 미디어(U52) 두 번 멘션 → U57 · 850 · 되돌림 [U52]. */
const PLAN20 = { segments: [mention(0), text(' walks with '), mention(0), text(' in a garden')], attach: [] }
const REJECT = (media) => ({ success: false, errorKind: 'flow-references-mismatch', error: 'flow-references-mismatch', errorParams: {}, rejectedMediaId: media, postClick: true })

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
/** 제출 클릭 때 맵의 영상 gen 을 잡아 두고 S3#n 을 흘린다(over.send / over.loadend 로 덮기). */
const capture = (n, over = {}) => {
  const box = { gen: null, snapshot: null }
  box.onSubmit = (sp, map) => {
    box.gen = [...map.values()].find((g) => g.rpc === 'MZZa6b' || g.rpc === 'YhhmEf') || null
    if (box.gen) box.snapshot = { rpc: box.gen.rpc, altRpcs: box.gen.altRpcs, wantKind: box.gen.want && box.gen.want.kind, expectedRefs: [...box.gen.expectedRefs], expectedMentions: [...box.gen.expectedMentions], normPrompt: box.gen.normPrompt }
    sp.send(over.sendAs || n, over.send || {})
    sp.loadend(over.sendAs || n, over.loadend || {})
  }
  return box
}
const noKeys = (r) => { expect(r).not.toHaveProperty('generationId'); expect(r).not.toHaveProperty('mediaId') }
const noPollOrDownload = (h) => { expect(h.trace).not.toContain('poll'); expect(h.sessionFetch).not.toHaveBeenCalled() }

describe('레퍼런스 영상(r2v) — 성공', () => {
  it('@king 1개 · Omni 4초 · 9:16: 인라인 멘션 컴포즈 → arm MZZa6b + altRpcs [YhhmEf] + want.kind r2v → S3#17 → {success, generationId:U45, creditsLeft:857}', async () => {
    seed('king', U(2))
    const box = capture(17)
    const h = refHandlerHarness({ kind: 'video', page: { assets: session(U(2)) }, onSubmit: box.onSubmit })
    const r = await settle(h.generate({ refs: [refInput('king')], plan: PLAN17 }), 120000)
    expect(r).toEqual({ success: true, generationId: U(45), creditsLeft: 857 })
    expect(box.snapshot).toEqual({ rpc: 'MZZa6b', altRpcs: ['YhhmEf'], wantKind: 'r2v', expectedRefs: [U(2)], expectedMentions: [U(2)], normPrompt: 'walks toward the camera' })
    const t = h.trace
    const order = [at(t, 'credits'), at(t, 'settings-driver'), at(t, 'click:compose-editor'), at(t, 'page:picker:open'), at(t, 'page:mention:'), at(t, 'main-focus'), at(t, 'submit-enabled'), at(t, 'click:compose-submit')]
    for (let i = 1; i < order.length; i++) expect(order[i], `order step ${i}`).toBeGreaterThan(order[i - 1])
    expect(h.page.counts.paste).toBe(0)
    expect(h.pendingGenerations.size).toBe(0)
    noPollOrDownload(h)
    const out = logged()
    expect(out).toMatch(/\[Flow Video T2V\] \[Angular\] generate-video-t2v: .*"refs":1.*"mentions":1/)
    expect(out).toMatch(/\[Flow RPC\] MZZa6b send doc=\S{8} seq=100 bound=\S+/)
    expect(out).toMatch(/\[Flow Video T2V\] \[Angular\] submitted media=00000045 creditsLeft=857 modelKey=abra_r2v_4s refs=1\/1 mentions=1\/1/)
    for (const w of ['king', 'walks', 'camera', 'image.png', 'user text']) expect(out, w).not.toContain(w)
  })

  it('@X … @X(같은 ref 두 번 멘션): 게이트 멘션 2·칩 1 → S3#20 → {success, generationId:U57, creditsLeft:850}, refs=1/1 mentions=2/2', async () => {
    seed('king', U(52))
    const box = capture(20)
    const h = refHandlerHarness({ kind: 'video', page: { assets: session(U(52)) }, onSubmit: box.onSubmit })
    const r = await settle(h.generate({ refs: [refInput('king')], plan: PLAN20 }), 120000)
    expect(r).toEqual({ success: true, generationId: U(57), creditsLeft: 850 })
    expect(box.snapshot).toMatchObject({ expectedRefs: [U(52)], expectedMentions: [U(52), U(52)] })
    expect(logged()).toMatch(/submitted media=00000057 creditsLeft=850 modelKey=abra_r2v_4s refs=1\/1 mentions=2\/2/)
  })

  it('MZZa6b send 가 클릭 뒤 20s 에 와도 정상 바인딩(15s 훅은 크레딧 재판독만) → success', async () => {
    seed('king', U(2))
    const h = refHandlerHarness({
      kind: 'video', page: { assets: session(U(2)) }, credits: [900],
      onSubmit: (sp) => { setTimeout(() => sp.send(17), 20000); setTimeout(() => sp.loadend(17), 22000) },
    })
    const r = await settle(h.generate({ refs: [refInput('king')], plan: PLAN17 }), 120000)
    expect(r).toEqual({ success: true, generationId: U(45), creditsLeft: 857 })
    expect(h.trace.filter((x) => x === 'credits')).toHaveLength(2)
    expect(logged()).toMatch(/\[Flow RPC\] MZZa6b send doc=\S{8} seq=100 bound=\S+ late/)
  })
})

describe('레퍼런스 영상(r2v) — 클릭 뒤 거부 (D10·D12): postClick + rejectedMediaId, generationId·mediaId 키 없음', () => {
  const run = async (n, over, plan = PLAN17, id = U(2)) => {
    seed('king', id)
    const box = capture(n, over)
    const h = refHandlerHarness({ kind: 'video', page: { assets: session(id) }, onSubmit: box.onSubmit })
    return { h, r: await settle(h.generate({ refs: [refInput('king')], plan }), 120000) }
  }

  it('페이지가 YhhmEf 로 보냄(boundRpc ≠ MZZa6b) → flow-references-mismatch + rejectedMediaId(U35)', async () => {
    const { h, r } = await run(17, { sendAs: 14 })
    expect(r).toEqual(REJECT(U(35)))
    noKeys(r)
    noPollOrDownload(h)
    expect(logged()).toMatch(/bound rpc YhhmEf ≠ MZZa6b/)
  })

  it('send mentions [](멘션이 빠짐) → mismatch + rejectedMediaId(U45)', async () => {
    const { h, r } = await run(17, { send: { mentions: [] } })
    expect(r).toEqual(REJECT(U(45)))
    noKeys(r)
    noPollOrDownload(h)
  })

  it('S3#17 인데 send refs [U9] → mismatch + rejectedMediaId(U45) — 폴·다운로드 없음', async () => {
    const { h, r } = await run(17, { send: { refs: [U(9)] } })
    expect(r).toEqual(REJECT(U(45)))
    noKeys(r)
    noPollOrDownload(h)
    expect(logged()).toMatch(/refs mismatch request=1\/1 echo=1\/1 mentions=1\/1 → flow-references-mismatch/)
  })

  it('send refs [U2](맞음)인데 응답 되돌림 [3][0][5][6][1][1][0][2] = U9 → 같은 거부', async () => {
    const p = s3Payload(17)
    p[3][0][5][6][1][1][0][2] = U(9)
    const { h, r } = await run(17, { loadend: { responseText: respBodyWithPayload('MZZa6b', p) } })
    expect(r).toEqual(REJECT(U(45)))
    noKeys(r)
    noPollOrDownload(h)
  })

  it('중복 멘션 부정: S3#20 인데 send mentions [U52](하나 빠짐) → mismatch — 순서·중복을 보존한 동등 비교(집합·포함 비교 아님)', async () => {
    const { r } = await run(20, { send: { mentions: [U(52)] } }, PLAN20, U(52))
    expect(r).toEqual(REJECT(U(57)))
    noKeys(r)
  })

  it('모델키 abra_t2v_4s(MZZa6b 응답) → flow-video-settings-mismatch {expected …r2v, actual} + rejectedMediaId', async () => {
    const p = s3Payload(17)
    p[3][0][7][0][12] = 'abra_t2v_4s'
    const { r } = await run(17, { loadend: { responseText: respBodyWithPayload('MZZa6b', p) } })
    expect(r).toEqual({
      success: false, errorKind: 'flow-video-settings-mismatch', error: 'flow-video-settings-mismatch',
      errorParams: { expected: 'Omni Flash 4s 9:16 720p r2v', actual: 'abra_t2v_4s' }, rejectedMediaId: U(45), postClick: true,
    })
    noKeys(r)
  })

  it('Veo 3.1 - Fast 16:9 요청에 veo_3_1_r2v_fast_portrait(S3#15) → flow-video-settings-mismatch + rejectedMediaId(U40)', async () => {
    seed('king', U(2))
    const box = capture(15)
    const h = refHandlerHarness({ kind: 'video', page: { assets: session(U(2)) }, onSubmit: box.onSubmit, summary: { text: '동영상 x1', ligatures: ['crop_16_9'] } })
    const r = await settle(h.generate({ model: 'Veo 3.1 - Fast', duration: 8, aspectRatio: '16:9', refs: [refInput('king')], plan: { segments: [text('The king raises his hand and smiles')], attach: [0] } }), 120000)
    expect(r).toEqual({
      success: false, errorKind: 'flow-video-settings-mismatch', error: 'flow-video-settings-mismatch',
      errorParams: { expected: 'Veo 3.1 - Fast 8s 16:9 720p r2v', actual: 'veo_3_1_r2v_fast_portrait' }, rejectedMediaId: U(40), postClick: true,
    })
    expect(box.snapshot).toMatchObject({ rpc: 'MZZa6b', expectedRefs: [U(2)], expectedMentions: [] })
  })
})

describe('레퍼런스 영상(r2v) — 클릭 전 거부 (D1·D11·D13)', () => {
  // 세션 게이트 뒤·ensureOnProjectComposer 전 — executeJavaScript 는 WIZ 프로브뿐
  it('refs + Veo 3.1 - Quality → flow-references-model-unsupported {model} — WIZ 외 executeJavaScript 0회', async () => {
    const h = refHandlerHarness({ kind: 'video', sample: 17 })
    const r = await settle(h.generate({ model: 'Veo 3.1 - Quality', duration: 8, refs: [refInput('king')], plan: PLAN17 }))
    expect(r).toEqual({ success: false, errorKind: 'flow-references-model-unsupported', error: 'flow-references-model-unsupported', errorParams: { model: 'Veo 3.1 - Quality' } })
    expect(h.executeJavaScript.mock.calls.map((c) => String(c[0])).filter((s) => !s.includes('WIZ_global_data.SNlM0e'))).toEqual([])
    expect(h.trustedClickOnFlowView).not.toHaveBeenCalled()
  })

  it('유일 ref 4개 → flow-references-too-many {max:3} — WIZ 외 executeJavaScript 0회; 같은 바이트 둘이 섞여 유일 3개면 이 검사는 통과(뒤의 plan 검사가 판정)', async () => {
    const four = [refInput('a'), refInput('b'), refInput('c'), refInput('d')]
    const plan4 = { segments: four.map((_r, i) => mention(i)), attach: [] }
    const h = refHandlerHarness({ kind: 'video', sample: 17 })
    const r = await settle(h.generate({ refs: four, plan: plan4 }))
    expect(r).toEqual({ success: false, errorKind: 'flow-references-too-many', error: 'flow-references-too-many', errorParams: { max: 3 } })
    expect(h.executeJavaScript.mock.calls.map((c) => String(c[0])).filter((s) => !s.includes('WIZ_global_data.SNlM0e'))).toEqual([])
    _resetDomStageForTests()
    const dup = refHandlerHarness({ kind: 'video', sample: 17 })
    const r2 = await settle(dup.generate({ refs: [refInput('a'), refInput('b'), refInput('c'), refInput('a')], plan: { segments: [mention(9)], attach: [] } }))
    expect(r2).toMatchObject({ errorKind: 'flow-reference-attach-failed', reason: 'bad-plan' })
  })

  it('plan 범위 밖 → flow-reference-attach-failed reason bad-plan — DOM 단계 없음(읽기 전용 프로브뿐 — 크레딧·설정·컴포저 없음)', async () => {
    const h = refHandlerHarness({ kind: 'video', sample: 17 })
    const r = await settle(h.generate({ refs: [refInput('king')], plan: { segments: [mention(3)], attach: [] } }))
    expect(r).toEqual({ success: false, errorKind: 'flow-reference-attach-failed', error: 'flow-reference-attach-failed', reason: 'bad-plan' })
    const readOnly = (s) => s.includes('WIZ_global_data.SNlM0e') || s.includes('interactiveCount') || s.includes('const scan =')
    expect(h.executeJavaScript.mock.calls.map((c) => String(c[0])).filter((s) => !readOnly(s))).toEqual([])
    expect(h.trace.filter((x) => ['credits', 'agent-probe', 'settings-driver', 'composer-state'].includes(x))).toEqual([])
    expect(h.trustedClickOnFlowView).not.toHaveBeenCalled()
  })

  it('ref 2개 + 설정 드라이버가 370s 에야 돌아옴 → 359s 엔 타임아웃 없음, 361s 에 dom-stage-timeout(영상 호출 자리의 timeoutMs) — 좀비는 클립보드·붙여넣기·제출 없음', async () => {
    const h = refHandlerHarness({
      kind: 'video', page: { assets: [] }, sample: 17,
      settings: new Promise((r) => setTimeout(() => r({ ok: true, closed: true, steps: {} }), 370000)),
    })
    let result = null
    h.generate({ refs: [refInput('king'), refInput('queen')], plan: { segments: [mention(0), text(' and '), mention(1)], attach: [] } }).then((v) => { result = v })
    await vi.advanceTimersByTimeAsync(359000)
    expect(result).toBeNull()
    await vi.advanceTimersByTimeAsync(2000)
    expect(result).toEqual({ success: false, errorKind: 'flow-settings-not-applied', error: 'flow-settings-not-applied', reason: 'dom-stage-timeout' })
    await vi.advanceTimersByTimeAsync(60000)
    expect(h.clipboard.calls).toEqual([])
    expect(h.page.counts.paste).toBe(0)
    expect(h.trace).not.toContain('click:compose-submit')
    expect(h.pendingGenerations.size).toBe(0)
    expect(logged()).toMatch(/\[Flow Video T2V\] \[Angular\] DOM stage timed out after 360s/)
  })
})
