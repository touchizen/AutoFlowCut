// @vitest-environment node
//
// M3-9 · M3-10 — referencePreflight(flowView, {refs, plan})(계획서 2026-09-25 M3 D1 · D4): 두 핸들러(이미지·영상)가 ensureOnProjectComposer 뒤·DOM 단계 전에 부르는
//   이름 붙은 사전 검사 하나. ① plan 모양(세그먼트 타입·인덱스 범위·문자열·개수 ≤ 64) → 아니면 reason bad-plan ② projectIdFromFlowUrl → null 이면 no-project-id
//   ③ timeoutMs = DOM_STAGE_TIMEOUT_MS(120s) + 120s × 유일 ref 수(sha256 기준). 레퍼런스가 없으면 ③ 만(= 기존 120s).
//   결과의 refs 는 main 이 base64 에서 만든 {bytes, sha} — 경로를 받지 않는다(D2).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createHash } from 'node:crypto'
import { referencePreflight } from '../../../electron/ipc/flow-angular.js'

const PROJECT = '134cf5b5-6a64-47b8-8709-6de4c6b0e44c'
const URL_OK = `https://flow.google.com/project/${PROJECT}`
const view = (url = URL_OK) => ({ webContents: { getURL: () => url } })
const png = (tail) => Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from(String(tail))])
const ref = (tail) => ({ base64: png(tail).toString('base64'), mime: 'image/png' })
const sha = (b) => createHash('sha256').update(b).digest('hex')
const text = (t) => ({ t: 'text', text: t })
const mention = (i) => ({ t: 'mention', ref: i })

let warnSpy
beforeEach(() => { warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {}) })
afterEach(() => { warnSpy.mockRestore() })

describe('referencePreflight — 워치독 예산(정확히)', () => {
  it('ref 0개 120000 · 1개 240000 · 2개 360000 · 3개 480000 — 120+60n·일률 360s 같은 식은 빨갛다', () => {
    expect(referencePreflight(view(), {})).toMatchObject({ ok: true, timeoutMs: 120000 })
    expect(referencePreflight(view(), { refs: [], plan: null })).toMatchObject({ ok: true, timeoutMs: 120000 })
    const cases = [[1, 240000], [2, 360000], [3, 480000]]
    for (const [n, ms] of cases) {
      const refs = Array.from({ length: n }, (_x, i) => ref('r' + i))
      const plan = { segments: [text('a '), ...refs.map((_r, i) => mention(i))], attach: [] }
      expect(referencePreflight(view(), { refs, plan }), `n=${n}`).toMatchObject({ ok: true, timeoutMs: ms })
    }
  })

  it('유일 ref 는 바이트(sha256)로 센다 — 같은 이미지 두 ref 는 업로드 1회라 예산도 1개분(240000)', () => {
    const r = referencePreflight(view(), { refs: [ref('king'), ref('king')], plan: { segments: [mention(0), text(' and '), mention(1)], attach: [] } })
    expect(r).toMatchObject({ ok: true, timeoutMs: 240000 })
  })

  it('성공 결과: projectId(URL 에서) + refs = [{bytes, sha}](main 이 base64 에서 계산) — 순서 보존', () => {
    const r = referencePreflight(view(), { refs: [ref('king'), ref('queen')], plan: { segments: [mention(0)], attach: [1] } })
    expect(r.ok).toBe(true)
    expect(r.projectId).toBe(PROJECT)
    expect(r.refs.map((x) => x.sha)).toEqual([sha(png('king')), sha(png('queen'))])
    expect(Buffer.isBuffer(r.refs[0].bytes)).toBe(true)
    expect(r.refs[1].bytes.equals(png('queen'))).toBe(true)
  })
})

describe('referencePreflight — bad-plan', () => {
  const R2 = [ref('king'), ref('queen')]
  it.each([
    ['plan 없음', { refs: R2 }],
    ['segments 가 배열 아님', { refs: R2, plan: { segments: 'x', attach: [] } }],
    ['attach 가 배열 아님', { refs: R2, plan: { segments: [mention(0)], attach: null } }],
    ['멘션 인덱스 범위 밖', { refs: R2, plan: { segments: [mention(2)], attach: [] } }],
    ['멘션 인덱스 음수', { refs: R2, plan: { segments: [mention(-1)], attach: [] } }],
    ['멘션 인덱스 정수 아님', { refs: R2, plan: { segments: [{ t: 'mention', ref: '0' }], attach: [] } }],
    ['첨부 인덱스 범위 밖', { refs: R2, plan: { segments: [mention(0)], attach: [5] } }],
    ['모르는 세그먼트 타입', { refs: R2, plan: { segments: [{ t: 'chip', ref: 0 }], attach: [] } }],
    ['텍스트가 문자열 아님', { refs: R2, plan: { segments: [{ t: 'text', text: 3 }], attach: [] } }],
    ['세그먼트 65개', { refs: R2, plan: { segments: Array.from({ length: 65 }, () => text('a')), attach: [0, 1] } }],
    ['ref 에 base64 없음', { refs: [{ mime: 'image/png' }], plan: { segments: [mention(0)], attach: [] } }],
    ['ref base64 가 빈 바이트', { refs: [{ base64: '', mime: 'image/png' }], plan: { segments: [mention(0)], attach: [] } }],
    ['ref 가 배열 아님', { refs: 'x', plan: { segments: [text('a')], attach: [] } }],
  ])('%s → {ok:false, reason:bad-plan}', (_l, input) => {
    expect(referencePreflight(view(), input)).toEqual({ ok: false, reason: 'bad-plan' })
  })

  it('세그먼트 64개는 통과(경계)', () => {
    const r = referencePreflight(view(), { refs: [ref('king')], plan: { segments: [mention(0), ...Array.from({ length: 63 }, () => text('a'))], attach: [] } })
    expect(r).toMatchObject({ ok: true, timeoutMs: 240000 })
  })

  it('레퍼런스가 없어도 plan 이 오면 모양을 본다 — 멘션이 있는데 refs 가 비면 bad-plan', () => {
    expect(referencePreflight(view(), { refs: [], plan: { segments: [mention(0)], attach: [] } })).toEqual({ ok: false, reason: 'bad-plan' })
    expect(referencePreflight(view(), { refs: [], plan: { segments: [text('a king')], attach: [] } })).toMatchObject({ ok: true, timeoutMs: 120000 })
  })
})

describe('referencePreflight — no-project-id', () => {
  const input = { refs: [ref('king')], plan: { segments: [mention(0)], attach: [] } }
  it.each([
    ['프로젝트 밖(홈)', 'https://flow.google.com/'],
    ['캐릭터 하위 경로', `https://flow.google.com/project/${PROJECT}/character`],
    ['쿼리의 project', `https://flow.google.com/?next=/project/${PROJECT}`],
    ['옛 도메인', `https://labs.google/fx/tools/flow/project/${PROJECT}`],
    ['다른 호스트', `https://evil.example/project/${PROJECT}`],
  ])('%s → {ok:false, reason:no-project-id}', (_l, url) => {
    expect(referencePreflight(view(url), input)).toEqual({ ok: false, reason: 'no-project-id' })
  })

  it('레퍼런스가 없으면 프로젝트 id 를 보지 않는다(③ 만)', () => {
    expect(referencePreflight(view('https://flow.google.com/'), { refs: [] })).toMatchObject({ ok: true, timeoutMs: 120000 })
  })

  it('실패 로그는 reason 만 — URL·프로젝트 id 없음', () => {
    referencePreflight(view(`https://flow.google.com/?next=/project/${PROJECT}`), input)
    const out = warnSpy.mock.calls.map((c) => c.map(String).join(' ')).join('\n')
    expect(out).toMatch(/\[Flow Refs\] preflight failed reason=no-project-id/)
    expect(out).not.toContain(PROJECT)
    expect(out).not.toContain('flow.google.com')
  })
})
