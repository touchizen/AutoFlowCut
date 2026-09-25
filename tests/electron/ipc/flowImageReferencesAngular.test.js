// @vitest-environment node
//
// M3-9 — flow:generate-image(Flow 모드)의 **레퍼런스 경로**(계획서 2026-09-25 M3 D1·D4·D9·D12 · §4 M3-9).
//   순서: 세션 → 에이전트 → 캡처 → 설정 → 캐럿 → 정리 → 사전 스캔 → (업로드 → 정리) → 컴포즈 → 게이트 → focusMainWindow → 제출 가능
//         → 재판독(텍스트+칩) → arm(expectedRefs·expectedMentions·normPrompt) → 신뢰 클릭(beforeDispatch 가 칩도 본다).
//   클릭 뒤 검증(D12): 요청(send 의 refs·mentions)·응답 되돌림(results[i].refEcho) 중 있는 근거는 전부 기대와 같아야 한다 — 레퍼런스는 집합·개수,
//   멘션은 중복을 보존한 순서열. 어긋나면 flow-references-mismatch + postClick, **다운로드 없음**. 근거가 하나도 없으면 수용 + warn + rpc-shape:ogiZ0b@refs.
//   하네스: tests/helpers/flowRefHandlerHarness.js(가짜 페이지 jsdom + 실제 createSharedHelpers + 실제 라우터 + S3 샘플).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { _resetDomStageForTests } from '../../../electron/ipc/flow-angular.js'
import { refMediaCache } from '../../../electron/flow-ref-media-cache.js'
import { setModalVisible } from '../../../electron/ipc/layout.js'
import { refHandlerHarness, settle, refInput, refSha, text, mention, session, FAKE_DOC, FAKE_PROJECT } from '../../helpers/flowRefHandlerHarness.js'
import { s3Payload } from '../../fixtures/flow-m3-samples.js'
import { respBodyWithPayload, maskedUuid as U } from '../../fixtures/flow-batchexecute-samples.js'
import { chipHtml } from '../../fixtures/flow-live-dom-m3.js'

const NOW_S = 1790240102.5
const seed = (tail, id) => refMediaCache.set(FAKE_DOC, FAKE_PROJECT, refSha(tail), id)
/** S3#9: @king(U2) 인라인 멘션 + queen(U3) ＋ 첨부 — 요청 refs [U2,U3] · mentions [U2] · 텍스트 ' and a queen in a garden' · 응답 U24(768×1376, 되돌림 [U2,U3]). */
const PLAN9 = { segments: [mention(0), text(' and a queen in a garden')], attach: [1] }
const REFS9 = () => [refInput('king'), refInput('queen')]
/** S3#19: 같은 미디어(U46) 두 번 멘션 — 요청 refs [U46] · mentions [U46,U46] · 응답 U50(되돌림 [U46]). */
const PLAN19 = { segments: [mention(0), text(' walks with '), mention(0), text(' in a garden')], attach: [] }
const MISMATCH = { success: false, errorKind: 'flow-references-mismatch', error: 'flow-references-mismatch', postClick: true }

let logSpy, warnSpy, errSpy
beforeEach(() => {
  _resetDomStageForTests()
  refMediaCache.clear()
  vi.useFakeTimers({ now: NOW_S * 1000 })
  logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
  warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
  errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => { vi.useRealTimers(); logSpy.mockRestore(); warnSpy.mockRestore(); errSpy.mockRestore() })
const logged = () => [...logSpy.mock.calls, ...warnSpy.mock.calls, ...errSpy.mock.calls].map((c) => c.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' ')).join('\n')
const at = (t, tag, from = 0) => { for (let i = from; i < t.length; i++) if (t[i] === tag || t[i].startsWith(tag)) return i; return -1 }
/** 제출 클릭 때 맵에 있던 ogiZ0b gen 을 잡아 두고 S3#n 을 흘린다. */
const capture = (n, over = {}) => {
  const box = { gen: null }
  box.onSubmit = (sp, map) => {
    box.gen = [...map.values()].find((g) => g.rpc === 'ogiZ0b') || null
    box.snapshot = box.gen && { rpc: box.gen.rpc, altRpcs: box.gen.altRpcs, expectedRefs: [...box.gen.expectedRefs], expectedMentions: [...box.gen.expectedMentions], normPrompt: box.gen.normPrompt }
    sp.send(n, over.send || {})
    sp.loadend(n, over.loadend || {})
  }
  return box
}
const noContent = (out) => { for (const w of ['queen', 'garden', 'image.png', 'king', 'user text', 'walks']) expect(out, w).not.toContain(w) }

describe('레퍼런스 이미지 — 순서·성공 (M3-9)', () => {
  it('잔여 칩 + ref 둘(하나는 세션 재사용·하나는 업로드) → 정리 → 스캔 → 업로드 → 정리 → 멘션 → 첨부 → 게이트 → main 포커스 → 제출 가능 → 재판독(텍스트+칩) → arm → 클릭 → images', async () => {
    seed('king', U(2))
    const box = capture(9)
    const h = refHandlerHarness({ page: { chips: [{ id: U(9) }], assets: session(U(2)), upload: { ids: [U(3)] } }, onSubmit: box.onSubmit })
    const r = await settle(h.generate({ refs: REFS9(), plan: PLAN9 }), 120000)
    expect(r.success).toBe(true)
    expect(r.images).toHaveLength(1)
    expect(r.images[0]).toMatchObject({ mediaId: U(24), width: 768, height: 1376 })
    expect(box.snapshot).toEqual({ rpc: 'ogiZ0b', altRpcs: undefined, expectedRefs: [U(2), U(3)], expectedMentions: [U(2)], normPrompt: 'and a queen in a garden' })
    const t = h.trace
    const order = [
      at(t, 'wiz'), at(t, 'agent-probe'), at(t, 'capture-probe'), at(t, 'settings-driver'), at(t, 'click:compose-editor'),
      at(t, 'page:clear'), at(t, 'page:picker:open:add'), at(t, 'paste'), at(t, 'page:chip-id'),
    ]
    for (let i = 1; i < order.length; i++) expect(order[i], `order step ${i}`).toBeGreaterThan(order[i - 1])
    const clear2 = at(t, 'page:clear', at(t, 'page:chip-id'))
    const men = at(t, 'page:mention:')
    const add = at(t, 'page:add:')
    const focusMain = at(t, 'main-focus')
    expect(clear2).toBeGreaterThan(at(t, 'page:chip-id'))
    expect(men).toBeGreaterThan(clear2)
    expect(add).toBeGreaterThan(men)
    // 게이트 = 첨부 뒤 · main 포커스 앞의 컴포저 판독
    const gate = t.lastIndexOf('composer-state', focusMain)
    expect(gate).toBeGreaterThan(add)
    const enabled = at(t, 'submit-enabled')
    expect(enabled).toBeGreaterThan(focusMain)
    const reread = at(t, 'read-text', enabled)
    const rereadChips = at(t, 'composer-state', reread)
    const click = at(t, 'click:compose-submit')
    expect(reread).toBeGreaterThan(enabled)
    expect(rereadChips).toBeGreaterThan(reread)
    expect(click).toBeGreaterThan(rereadChips)
    // beforeDispatch(히트테스트 뒤·mouseDown 직전)도 텍스트와 칩을 본다
    expect(at(t, 'read-text', click)).toBeGreaterThan(click)
    expect(at(t, 'composer-state', at(t, 'read-text', click))).toBeLessThan(at(t, 'armed:1'))
    expect(h.page.counts.paste).toBe(1)
    expect(h.pendingGenerations.size).toBe(0)
    const out = logged()
    expect(out).toMatch(/\[Flow API\] \[Angular\] generate-image: .*"refs":2.*"mentions":1/)
    expect(out).toMatch(/\[Flow API\] \[Angular\] refs verified request=2 echo=2/)
    expect(out).toMatch(/\[Flow Refs\] gate chips=2 mentions=1 text=ok summary=same ok=true/)
    noContent(out)
  })

  it('비동기(asyncMode): 둘 다 세션 재사용(업로드 0) → {generationId, submitted} → collect 가 검증 뒤 images', async () => {
    seed('king', U(2)); seed('queen', U(3))
    const box = capture(9)
    const h = refHandlerHarness({ page: { assets: session(U(2), U(3)) }, onSubmit: box.onSubmit })
    const r = await settle(h.generate({ refs: REFS9(), plan: PLAN9, asyncMode: true }), 120000)
    expect(r).toMatchObject({ success: true, submitted: true })
    expect(h.page.counts.paste).toBe(0)
    const c = await h.ipcMain.invoke('flow:collect-generation', { generationId: r.generationId })
    expect(c.success).toBe(true)
    expect(c.images[0]).toMatchObject({ mediaId: U(24), width: 768, height: 1376 })
    expect(logged()).toMatch(/refs verified request=2 echo=2/)
    expect(h.pendingGenerations.size).toBe(0)
  })

  it('@X … @X(같은 ref 두 번 멘션): 게이트 멘션 2·칩 1 → arm expectedMentions [U46,U46]·expectedRefs [U46] → S3#19 → 성공(request=1 echo=1 mentions=2/2)', async () => {
    seed('king', U(46))
    const box = capture(19)
    const h = refHandlerHarness({ page: { assets: session(U(46)) }, onSubmit: box.onSubmit })
    const r = await settle(h.generate({ refs: [refInput('king')], plan: PLAN19 }), 120000)
    expect(r.success).toBe(true)
    expect(r.images[0]).toMatchObject({ mediaId: U(50) })
    expect(box.snapshot).toMatchObject({ expectedRefs: [U(46)], expectedMentions: [U(46), U(46)], normPrompt: 'walks with in a garden' })
    expect(h.page.mentionIds()).toEqual([U(46), U(46)])
    expect(h.page.chipIds()).toEqual([U(46)])
    expect(logged()).toMatch(/refs verified request=1 echo=1 mentions=2\/2/)
  })

  it('@X … @X 인데 send mentions [U46](하나 빠짐) → flow-references-mismatch + postClick, 다운로드 없음', async () => {
    seed('king', U(46))
    const box = capture(19, { send: { mentions: [U(46)] } })
    const h = refHandlerHarness({ page: { assets: session(U(46)) }, onSubmit: box.onSubmit })
    const r = await settle(h.generate({ refs: [refInput('king')], plan: PLAN19 }), 120000)
    expect(r).toEqual(MISMATCH)
    expect(h.sessionFetch).not.toHaveBeenCalled()
    expect(logged()).toMatch(/refs mismatch request=1\/1 echo=1\/1 mentions=1\/2/)
  })
})

describe('레퍼런스 이미지 — 클릭 뒤 검증 (D12)', () => {
  const setup = (over) => {
    seed('king', U(2)); seed('queen', U(3))
    const box = capture(9, over)
    return { box, h: refHandlerHarness({ page: { assets: session(U(2), U(3)) }, onSubmit: box.onSubmit }) }
  }

  it('send refs [U9](요청이 다른 레퍼런스) → flow-references-mismatch + postClick, sessionFetch 미호출 — 동기·비동기 둘 다', async () => {
    const { h } = setup({ send: { refs: [U(9)] } })
    expect(await settle(h.generate({ refs: REFS9(), plan: PLAN9 }), 120000)).toEqual(MISMATCH)
    expect(h.sessionFetch).not.toHaveBeenCalled()
    expect(logged()).toMatch(/refs mismatch request=1\/2 echo=2\/2 mentions=1\/1 → flow-references-mismatch/)
    _resetDomStageForTests()
    const b = setup({ send: { refs: [U(9)] } })
    const ra = await settle(b.h.generate({ refs: REFS9(), plan: PLAN9, asyncMode: true }), 120000)
    expect(ra).toMatchObject({ success: true, submitted: true })
    expect(await b.h.ipcMain.invoke('flow:collect-generation', { generationId: ra.generationId })).toEqual(MISMATCH)
    expect(b.h.sessionFetch).not.toHaveBeenCalled()
  })

  // 코드 리뷰 R1-B1: 레퍼런스 = 중복 없는 집합 — 길이가 같고 원소가 전부 기대 안에 있어도 한 id 가 두 번이면 다른 레퍼런스(queen)는 안 실린 것이다.
  it('send refs [U2,U2](길이 같고 원소는 기대 안 — 중복) → flow-references-mismatch, 다운로드 없음', async () => {
    const { h } = setup({ send: { refs: [U(2), U(2)] } })
    expect(await settle(h.generate({ refs: REFS9(), plan: PLAN9 }), 120000)).toEqual(MISMATCH)
    expect(h.sessionFetch).not.toHaveBeenCalled()
  })

  it('응답 되돌림 [U2,U2](중복) → 같은 거부', async () => {
    const p = s3Payload(9)
    p[0][0][6][0][15][3][0][1][2] = U(2)
    const { h } = setup({ loadend: { responseText: respBodyWithPayload('ogiZ0b', p) } })
    expect(await settle(h.generate({ refs: REFS9(), plan: PLAN9 }), 120000)).toEqual(MISMATCH)
    expect(h.sessionFetch).not.toHaveBeenCalled()
  })

  it('요청은 맞고 응답 되돌림만 어긋남([15][3][0][0][2] = U9) → 같은 거부', async () => {
    const p = s3Payload(9)
    p[0][0][6][0][15][3][0][0][2] = U(9)
    const { h } = setup({ loadend: { responseText: respBodyWithPayload('ogiZ0b', p) } })
    expect(await settle(h.generate({ refs: REFS9(), plan: PLAN9 }), 120000)).toEqual(MISMATCH)
    expect(h.sessionFetch).not.toHaveBeenCalled()
  })

  it('근거가 하나도 없음(send refs·mentions null · 되돌림 없음) → 수용 + warn + reportDomFailure(rpc-shape:ogiZ0b@refs)', async () => {
    const p = s3Payload(9)
    p[0][0][6][0][15][3] = []
    const { h } = setup({ send: { refs: null, mentions: null }, loadend: { responseText: respBodyWithPayload('ogiZ0b', p) } })
    const r = await settle(h.generate({ refs: REFS9(), plan: PLAN9 }), 120000)
    expect(r.success).toBe(true)
    expect(r.images[0]).toMatchObject({ mediaId: U(24) })
    expect(h.onDomFailure.mock.calls.some((c) => c[0] === 'rpc-shape:ogiZ0b@refs')).toBe(true)
    expect(logged()).toMatch(/refs unverifiable/)
  })
})

describe('레퍼런스 이미지 — mouseDown 직전 칩 변화 (D9 · Q1)', () => {
  it('히트테스트 뒤·mouseDown 직전에 칩 +1 → 미디스패치 거부, gen 삭제, 클릭 전 text-injection-failed(editor-changed-before-click) — postClick 없음', async () => {
    seed('king', U(2)); seed('queen', U(3))
    const box = capture(9)
    const h = refHandlerHarness({
      page: { assets: session(U(2), U(3)) }, onSubmit: box.onSubmit,
      beforeDispatchHook: (page) => page.document.querySelector('.af-ingredient-list').insertAdjacentHTML('beforeend', chipHtml({ id: U(9) })),
    })
    const r = await settle(h.generate({ refs: REFS9(), plan: PLAN9 }), 120000)
    expect(r).toEqual({ success: false, errorKind: 'text-injection-failed', error: 'text-injection-failed', reason: 'editor-changed-before-click' })
    expect(h.trace).toContain('dispatch-refused')
    expect(h.trace.filter((x) => x.startsWith('armed:'))).toEqual([])
    expect(box.gen).toBeNull()
    expect(h.pendingGenerations.size).toBe(0)
    expect(logged()).toMatch(/composer chips changed between the hit-test and the mouseDown chips=3 want=2/)
  })
})

describe('레퍼런스 이미지 — 드라이버 실패는 클릭 전 결과로 (D14)', () => {
  it('클립보드에 Finder 파일(text/uri-list) → flow-reference-clipboard-busy — 쓰기·붙여넣기·제출 없음', async () => {
    const h = refHandlerHarness({ page: { assets: [] }, clipboard: { formats: ['text/plain', 'text/uri-list'], text: 'file:///x' }, sample: 9 })
    const r = await settle(h.generate({ refs: [refInput('king')], plan: { segments: [mention(0), text(' smiles')], attach: [] } }), 120000)
    expect(r).toEqual({ success: false, errorKind: 'flow-reference-clipboard-busy', error: 'flow-reference-clipboard-busy' })
    expect(h.clipboard.calls).not.toContain('writeImage')
    expect(h.page.counts.paste).toBe(0)
    expect(h.trace).not.toContain('click:compose-submit')
    expect(h.pendingGenerations.size).toBe(0)
  })

  it('애셋 검색창 오염 → flow-reference-attach-failed reason picker-search-dirty — 제출 없음', async () => {
    seed('king', U(2))
    const h = refHandlerHarness({ page: { assets: session(U(2)), search: '한' }, sample: 9 })
    const r = await settle(h.generate({ refs: [refInput('king')], plan: { segments: [mention(0), text(' smiles')], attach: [] } }), 120000)
    expect(r).toEqual({ success: false, errorKind: 'flow-reference-attach-failed', error: 'flow-reference-attach-failed', reason: 'picker-search-dirty' })
    expect(h.trace).not.toContain('click:compose-submit')
  })
})

describe('레퍼런스 이미지 — referencePreflight 배선 (D1·D4)', () => {
  // executeJavaScript 는 읽기 전용 프로브뿐 — 세션 게이트의 WIZ · ensureOnProjectComposer 의 페이지 판독(interactiveCount) · 진단 보고(reportDomFailure)의 스캔.
  //   계획서의 "WIZ 뿐"은 D1 순서(ensureOnProjectComposer 뒤)와 진단 보고를 셈에 넣지 않은 표현 — DOM 단계(에이전트·캡처·설정·컴포저) 스크립트가 없음을 본다.
  const readOnlyProbe = (s) => s.includes('WIZ_global_data.SNlM0e') || s.includes('interactiveCount') || s.includes('const scan =')

  it('plan 범위 밖 → flow-reference-attach-failed reason bad-plan — DOM 단계 없음(읽기 전용 프로브뿐, 클릭·클립보드·뷰포트 없음)', async () => {
    const h = refHandlerHarness({ sample: 9 })
    const r = await settle(h.generate({ refs: [refInput('king')], plan: { segments: [mention(5)], attach: [] } }))
    expect(r).toEqual({ success: false, errorKind: 'flow-reference-attach-failed', error: 'flow-reference-attach-failed', reason: 'bad-plan' })
    const scripts = h.executeJavaScript.mock.calls.map((c) => String(c[0]))
    expect(scripts.filter((s) => !readOnlyProbe(s))).toEqual([])
    expect(h.trace.filter((x) => ['agent-probe', 'capture-probe', 'settings-driver', 'composer-state'].includes(x))).toEqual([])
    expect(h.trustedClickOnFlowView).not.toHaveBeenCalled()
    expect(h.clipboard.calls).toEqual([])
    expect(h.setAutomationKeyLock).not.toHaveBeenCalled()
    expect(h.onDomFailure.mock.calls.some((c) => c[0] === 'refs:bad-plan')).toBe(true)
  })

  it('프로젝트 컴포저가 아닌 URL(projectId 없는 요청이 홈에서) → reason no-project-id — DOM 단계 없음', async () => {
    const h = refHandlerHarness({ url: 'https://flow.google.com/', sample: 9 })
    const r = await settle(h.generate({ projectId: null, refs: [refInput('king')], plan: { segments: [mention(0)], attach: [] } }))
    expect(r).toEqual({ success: false, errorKind: 'flow-reference-attach-failed', error: 'flow-reference-attach-failed', reason: 'no-project-id' })
    expect(h.executeJavaScript.mock.calls.map((c) => String(c[0])).filter((s) => !readOnlyProbe(s))).toEqual([])
    expect(h.trustedClickOnFlowView).not.toHaveBeenCalled()
    expect(h.setAutomationKeyLock).not.toHaveBeenCalled()
  })

  it('ref 2개 + 설정 드라이버가 370s 에야 돌아옴 → 359s 엔 타임아웃 없음, 361s 에 dom-stage-timeout; 좀비는 클립보드·붙여넣기·애셋 창·제출 없음', async () => {
    const h = refHandlerHarness({
      page: { assets: [] }, sample: 9,
      settings: new Promise((r) => setTimeout(() => r({ ok: true, closed: true, steps: {} }), 370000)),
    })
    let result = null
    h.generate({ refs: REFS9(), plan: PLAN9 }).then((v) => { result = v })
    await vi.advanceTimersByTimeAsync(359000)
    expect(result).toBeNull()
    await vi.advanceTimersByTimeAsync(2000)
    expect(result).toEqual({ success: false, errorKind: 'flow-settings-not-applied', error: 'flow-settings-not-applied', reason: 'dom-stage-timeout' })
    await vi.advanceTimersByTimeAsync(60000)
    expect(h.clipboard.calls).toEqual([])
    expect(h.page.counts.paste).toBe(0)
    expect(h.trace.some((x) => x.startsWith('page:picker:open'))).toBe(false)
    expect(h.trace).not.toContain('click:compose-submit')
    expect(h.pendingGenerations.size).toBe(0)
    expect(logged()).toMatch(/DOM stage timed out after 360s/)
  })
})

describe('레퍼런스 이미지 — 숨은 뷰(0×0) (D16)', () => {
  it('제자리 확장 + 방패 안에서 붙여넣기·애셋 창 — 첫 bounds 확장이 붙여넣기·창 열기보다 앞, 방패는 그 둘을 감싸고, 레이아웃 원복은 제출 클릭 뒤', async () => {
    setModalVisible(true)
    let r
    let h
    try {
      const box = capture(9)
      seed('king', U(2))
      h = refHandlerHarness({ hidden: true, page: { assets: session(U(2)), upload: { ids: [U(3)] } }, onSubmit: box.onSubmit })
      r = await settle(h.generate({ refs: REFS9(), plan: PLAN9 }), 120000)
    } finally { setModalVisible(false) }
    expect(r.success).toBe(true)
    const t = h.trace
    const enlarge = t.findIndex((x) => /^bounds:\d+x\d+$/.test(x) && !x.endsWith('0x0'))
    expect(enlarge).toBeGreaterThanOrEqual(0)
    expect(enlarge).toBeLessThan(at(t, 'paste'))
    expect(enlarge).toBeLessThan(at(t, 'page:picker:open:add'))
    expect(at(t, 'shield:on')).toBeLessThan(at(t, 'paste'))
    expect(at(t, 'shield:off')).toBeGreaterThan(at(t, 'click:compose-submit'))
    const lastBounds = t.map((x, i) => [x, i]).filter(([x]) => x.startsWith('bounds:')).at(-1)[1]
    expect(lastBounds).toBeGreaterThan(at(t, 'click:compose-submit'))
    expect(logged()).toMatch(/view hidden 0x0 → automation viewport \d+x\d+ in-place shielded/)
  })
})
