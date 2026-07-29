import { describe, it, expect, vi } from 'vitest'
import { runGenerateStateMachine } from '../../electron/spike-chatgpt-automate.js'

const CDN = 'https://chatgpt.com/backend-api/estuary/content'
const loaded = (id) => ({ src: `${CDN}?id=${id}&sig=1`, complete: true, w: 1024, h: 1024 })
const PROMPT = 'a single red apple on a white background'

// callPage 는 정의블록 + 마지막 줄 호출식 → 마지막 줄에서 함수 이름을 뽑는다.
function fnNameOf(script) {
  const m = String(script).trim().split('\n').pop().match(/window\.(__cg_\w+__)\(/)
  return m ? m[1] : null
}

// handlers: { __cg_x__: value | (callIndexForThatFn) => value }  — 함수면 호출 회차(0-based)를 받는다.
function makeHarness(handlers) {
  const counts = {}
  const calls = []
  const executeInView = vi.fn(async (_view, script) => {
    const fn = fnNameOf(script)
    calls.push(fn)
    const n = (counts[fn] = (counts[fn] ?? -1) + 1)
    const h = handlers[fn]
    if (h === undefined) throw new Error(`unexpected page fn: ${fn}`)
    const v = typeof h === 'function' ? h(n) : h
    if (v instanceof Error) throw v
    return v
  })
  let t = 0
  return {
    executeInView, calls, counts,
    now: () => t,
    sleep: async (ms) => { t += ms },
    typeText: vi.fn(),
    enter: vi.fn(),
    log: { info: vi.fn(), error: vi.fn() },
    advance: (ms) => { t += ms },
  }
}
const ACK_SUBMITTED = { composerCleared: true, submitPresent: false, stillHasPrompt: false }
const ACK_NOT_SUBMITTED = { composerCleared: false, submitPresent: true, stillHasPrompt: true }

describe('runGenerateStateMachine — happy path', () => {
  it('baseline → inject A → click → ack → two identical new ids → ok', async () => {
    const h = makeHarness({
      __cg_baseline__: { imgs: [loaded('old1')] },
      __cg_inject__: { textMatches: true, submitPresent: true },
      __cg_clickSubmit__: { clicked: true },
      __cg_submitAck__: ACK_SUBMITTED,
      __cg_poll__: (n) => (n === 0 ? { imgs: [loaded('old1')] } : { imgs: [loaded('old1'), loaded('new1')] }),
    })
    const r = await runGenerateStateMachine({}, PROMPT, h)
    expect(r).toEqual({ ok: true, src: `${CDN}?id=new1&sig=1`, id: 'new1', injectMethod: 'execCommand', submitMethod: 'click' })
    // 순서를 고정한다 — clickSubmit(주 제출 경로)을 지우거나 poll 을 ack 앞으로 옮기면 실패해야 한다.
    expect(h.calls.slice(0, 5)).toEqual(['__cg_baseline__', '__cg_inject__', '__cg_clickSubmit__', '__cg_submitAck__', '__cg_poll__'])
    expect(h.counts.__cg_poll__).toBe(2)             // 3회차(2연속 안정)에서 수락
    expect(h.typeText).not.toHaveBeenCalled()
    expect(h.enter).not.toHaveBeenCalled()
    expect(h.counts.__cg_verify__).toBeUndefined()   // A 성공이면 verify 안 씀
  })
})

describe('injection fallback A → B', () => {
  it('falls back to sendInputEvent typing and re-verifies without re-injecting', async () => {
    const h = makeHarness({
      __cg_baseline__: { imgs: [] },
      __cg_inject__: { textMatches: false, submitPresent: false },
      __cg_verify__: { textMatches: true, submitPresent: true },
      __cg_clickSubmit__: { clicked: true },
      __cg_submitAck__: ACK_SUBMITTED,
      __cg_poll__: { imgs: [loaded('new1')] },
    })
    const r = await runGenerateStateMachine({}, PROMPT, h)
    expect(r.ok).toBe(true)
    expect(r.injectMethod).toBe('sendInputEvent')
    expect(h.typeText).toHaveBeenCalledWith({}, PROMPT)
    expect(h.counts.__cg_inject__).toBe(0)           // __cg_inject__ 는 딱 1회(재-inject 금지)
  })
  it('a rejecting inject eval is a context failure, not an injection failure (no blind typing)', async () => {
    const h = makeHarness({
      __cg_baseline__: { imgs: [] },
      __cg_inject__: () => new Error('context destroyed'),
    })
    h.reprobe = vi.fn(async () => false)
    const r = await runGenerateStateMachine({}, PROMPT, h)
    expect(r).toMatchObject({ ok: false, stage: 'context' })
    expect(h.typeText).not.toHaveBeenCalled()          // 죽은 페이지에 trusted 타이핑 금지
    expect(h.counts.__cg_inject__).toBe(2)             // 3회 재시도 후 포기
  })

  it('a malformed (but resolved) inject value is a context failure, not a fallback trigger', async () => {
    const h = makeHarness({
      __cg_baseline__: { imgs: [] },
      __cg_inject__: { textMatches: 'yes' },        // 계약 밖 값
    })
    const r = await runGenerateStateMachine({}, PROMPT, h)
    expect(r).toMatchObject({ ok: false, stage: 'context' })
    expect(h.typeText).not.toHaveBeenCalled()
  })

  it('a malformed baseline is a context failure (an empty set would make old images look new)', async () => {
    const h = makeHarness({ __cg_baseline__: { imgs: 'nope' } })
    const r = await runGenerateStateMachine({}, PROMPT, h)
    expect(r).toMatchObject({ ok: false, stage: 'context' })
    expect(h.calls).toEqual(['__cg_baseline__'])
  })

  it('a malformed verify value is a context failure too', async () => {
    const h = makeHarness({
      __cg_baseline__: { imgs: [] },
      __cg_inject__: { textMatches: false, submitPresent: false },
      __cg_verify__: {},                           // textMatches 없음
    })
    const r = await runGenerateStateMachine({}, PROMPT, h)
    expect(r).toMatchObject({ ok: false, stage: 'context' })
    expect(h.calls).not.toContain('__cg_clickSubmit__')
  })

  it('a rejecting verify eval after fallback B is also a context failure', async () => {
    const h = makeHarness({
      __cg_baseline__: { imgs: [] },
      __cg_inject__: { textMatches: false, submitPresent: false },
      __cg_verify__: () => new Error('context destroyed'),
    })
    const r = await runGenerateStateMachine({}, PROMPT, h)
    expect(r).toMatchObject({ ok: false, stage: 'context' })
    expect(h.typeText).toHaveBeenCalledOnce()
    expect(h.calls).not.toContain('__cg_clickSubmit__')
  })

  it('fails with stage:inject when B also does not match', async () => {
    const h = makeHarness({
      __cg_baseline__: { imgs: [] },
      __cg_inject__: { textMatches: false, submitPresent: false },
      __cg_verify__: { textMatches: false, submitPresent: false },
    })
    const r = await runGenerateStateMachine({}, PROMPT, h)
    expect(r.ok).toBe(false)
    expect(r.stage).toBe('inject')
    expect(h.calls).not.toContain('__cg_clickSubmit__')
  })
})

describe('submit fallback — Enter', () => {
  it('presses Enter once after two consecutive notSubmitted acks + a re-check', async () => {
    const h = makeHarness({
      __cg_baseline__: { imgs: [] },
      __cg_inject__: { textMatches: true, submitPresent: true },
      __cg_clickSubmit__: { clicked: true },
      // ack 회차: 0,1 = 안 먹음(streak 2) → 2 = ack2 재검증(안 먹음) → Enter → 이후 제출됨
      __cg_submitAck__: (n) => (n <= 2 ? ACK_NOT_SUBMITTED : ACK_SUBMITTED),
      // 이미지는 제출이 ack 된 뒤에 뜬다(생성은 컴포저가 비워진 다음 시작된다)
      __cg_poll__: (n) => (n >= 2 ? { imgs: [loaded('new1')] } : { imgs: [] }),
    })
    h.enter = vi.fn()
    const r = await runGenerateStateMachine({}, PROMPT, h)
    expect(h.enter).toHaveBeenCalledTimes(1)
    expect(r.ok).toBe(true)
    expect(r.submitMethod).toBe('enter')
  })
  it('does NOT press Enter after a single notSubmitted observation', async () => {
    // 시간 기준 픽스처여야 `>= 2` → `>= 1` 뮤테이션이 여기서 죽는다. 호출 회차 기준이면
    // 뮤턴트가 같은 사이클에 쏘는 ack2 가 다음 회차(=제출됨) 값을 먹어 Enter 가 안 나가 통과해버린다.
    const h = makeHarness({
      __cg_baseline__: { imgs: [] },
      __cg_inject__: { textMatches: true, submitPresent: true },
      __cg_clickSubmit__: { clicked: true },
      __cg_submitAck__: () => (h.now() < 3000 ? ACK_NOT_SUBMITTED : ACK_SUBMITTED),
      __cg_poll__: (n) => (n === 0 ? { imgs: [] } : { imgs: [loaded('new1')] }),
    })
    const r = await runGenerateStateMachine({}, PROMPT, h)
    expect(h.enter).not.toHaveBeenCalled()
    expect(r.ok).toBe(true)
  })
  it('does NOT press Enter when the ack2 re-check shows the submit landed (slow click)', async () => {
    const h = makeHarness({
      __cg_baseline__: { imgs: [] },
      __cg_inject__: { textMatches: true, submitPresent: true },
      __cg_clickSubmit__: { clicked: true },
      // 0,1 = 안 먹음(streak 2), 2 = ack2 재검증 시점엔 이미 제출됨 → Enter 금지
      __cg_submitAck__: (n) => (n <= 1 ? ACK_NOT_SUBMITTED : ACK_SUBMITTED),
      __cg_poll__: (n) => (n === 0 ? { imgs: [] } : { imgs: [loaded('new1')] }),
    })
    const r = await runGenerateStateMachine({}, PROMPT, h)
    expect(h.enter).not.toHaveBeenCalled()
    expect(r.ok).toBe(true)
  })
  it('retries the Enter fallback after an ack2 eval rejection (never permanently blocked)', async () => {
    const h = makeHarness({
      __cg_baseline__: { imgs: [] },
      __cg_inject__: { textMatches: true, submitPresent: true },
      __cg_clickSubmit__: { clicked: true },
      // n=2 가 첫 ack2 재검증 — 그 한 번만 reject 시킨다
      __cg_submitAck__: (n) => (n === 2 ? new Error('transient') : ACK_NOT_SUBMITTED),
      __cg_poll__: { imgs: [] },
    })
    const r = await runGenerateStateMachine({}, PROMPT, h)
    expect(h.enter).toHaveBeenCalledTimes(1)   // 나중 사이클에서 재검증 성공 → Enter 발화
    expect(r.stage).toBe('submit')
  })

  it('never presses Enter once a submit has been acknowledged (sticky ack)', async () => {
    const h = makeHarness({
      __cg_baseline__: { imgs: [] },
      __cg_inject__: { textMatches: true, submitPresent: true },
      __cg_clickSubmit__: { clicked: true },
      // 제출이 한 번 확인된 뒤 컴포저에 프롬프트가 다시 나타나도(복원/재렌더) Enter 금지
      __cg_submitAck__: (n) => (n === 0 ? ACK_SUBMITTED : ACK_NOT_SUBMITTED),
      __cg_poll__: { imgs: [] },
    })
    const r = await runGenerateStateMachine({}, PROMPT, h)
    expect(h.enter).not.toHaveBeenCalled()
    expect(r.stage).toBe('poll')            // ack 됐으므로 submit 이 아니라 poll 실패
  })

  it('a rejected ack breaks the notSubmitted streak (Enter needs two CONSECUTIVE observations)', async () => {
    let enterAt = null
    const h = makeHarness({
      __cg_baseline__: { imgs: [] },
      __cg_inject__: { textMatches: true, submitPresent: true },
      __cg_clickSubmit__: { clicked: true },
      __cg_submitAck__: (n) => (n === 1 ? new Error('transient') : ACK_NOT_SUBMITTED),
      __cg_poll__: { imgs: [] },
    })
    h.enter = vi.fn(() => { enterAt = h.now() })
    await runGenerateStateMachine({}, PROMPT, h)
    expect(h.enter).toHaveBeenCalledTimes(1)
    expect(enterAt).toBe(6000)   // 스트릭을 안 끊으면 4500 에 나간다(관측 실패를 미제출로 오인)
  })

  it('presses Enter at most once even if the composer never clears', async () => {
    const h = makeHarness({
      __cg_baseline__: { imgs: [] },
      __cg_inject__: { textMatches: true, submitPresent: true },
      __cg_clickSubmit__: { clicked: true },
      __cg_submitAck__: ACK_NOT_SUBMITTED,
      __cg_poll__: { imgs: [] },
    })
    const r = await runGenerateStateMachine({}, PROMPT, h)
    expect(h.enter).toHaveBeenCalledTimes(1)
    expect(r).toEqual({ ok: false, stage: 'submit', detail: 'deadline' })   // 제출 ack 없음 → submit
  })
})

describe('submit acknowledgement is required (D3)', () => {
  it('does not read a missing submit button as "submitted" while the prompt is still there', async () => {
    const h = makeHarness({
      __cg_baseline__: { imgs: [] },
      __cg_inject__: { textMatches: true, submitPresent: true },
      __cg_clickSubmit__: { clicked: false },
      // 버튼은 아직 렌더 안 됐고 프롬프트는 그대로 → 제출된 게 아니다
      __cg_submitAck__: { composerCleared: false, submitPresent: false, stillHasPrompt: true },
      __cg_poll__: { imgs: [] },
    })
    const r = await runGenerateStateMachine({}, PROMPT, h)
    expect(h.enter).toHaveBeenCalledTimes(1)          // 미제출로 인식 → Enter fallback 이 살아 있어야
    expect(r).toEqual({ ok: false, stage: 'submit', detail: 'deadline' })   // 'poll' 이면 오인 ack
  })

  it('treats "different text + no submit button" as unknown, not submitted', async () => {
    const h = makeHarness({
      __cg_baseline__: { imgs: [] },
      __cg_inject__: { textMatches: true, submitPresent: true },
      __cg_clickSubmit__: { clicked: true },
      // 컴포저가 비지도 않았고 프롬프트도 아닌 상태 — 제출로 읽으면 안 된다
      __cg_submitAck__: { composerCleared: false, submitPresent: false, stillHasPrompt: false },
      __cg_poll__: { imgs: [loaded('new1')] },
    })
    const r = await runGenerateStateMachine({}, PROMPT, h)
    expect(r).toEqual({ ok: false, stage: 'submit', detail: 'deadline' })
  })

  it('never accepts an image while the submit is unacknowledged', async () => {
    const h = makeHarness({
      __cg_baseline__: { imgs: [] },
      __cg_inject__: { textMatches: true, submitPresent: true },
      __cg_clickSubmit__: { clicked: true },
      // 불확정 상태(다른 텍스트 + 버튼 존재): submitted 도 notSubmitted 도 아님
      __cg_submitAck__: { composerCleared: false, submitPresent: true, stillHasPrompt: false },
      __cg_poll__: { imgs: [loaded('new1')] },        // 안정된 새 이미지가 계속 보여도
      })
    const r = await runGenerateStateMachine({}, PROMPT, h)
    expect(r).toEqual({ ok: false, stage: 'submit', detail: 'deadline' })
    expect(h.enter).not.toHaveBeenCalled()
  })
})

describe('reject streaks are per page function and must be consecutive', () => {
  it('gives up when ONE page function keeps failing even though the others succeed', async () => {
    const h = makeHarness({
      __cg_baseline__: { imgs: [] },
      __cg_inject__: { textMatches: true, submitPresent: true },
      __cg_clickSubmit__: { clicked: true },
      __cg_submitAck__: () => new Error('__cg_submitAck__ is broken'),
      __cg_poll__: { imgs: [] },                 // 이건 계속 성공한다
    })
    h.reprobe = vi.fn(async () => true)          // 로그인·컴포저는 멀쩡
    const r = await runGenerateStateMachine({}, PROMPT, h)
    expect(r).toMatchObject({ ok: false, stage: 'context' })
    expect(h.now()).toBeLessThan(120000)         // 스트릭을 합치면 여기서 120s 를 다 태운다
  })

  it('scattered (non-consecutive) rejections never trip the context guard', async () => {
    const h = makeHarness({
      __cg_baseline__: { imgs: [] },
      __cg_inject__: { textMatches: true, submitPresent: true },
      __cg_clickSubmit__: { clicked: true },
      __cg_submitAck__: (n) => (n % 2 === 0 ? new Error('flaky') : ACK_SUBMITTED),   // 성공이 스트릭을 끊는다
      __cg_poll__: (n) => (n < 6 ? { imgs: [] } : { imgs: [loaded('new1')] }),
    })
    h.reprobe = vi.fn(async () => false)
    const r = await runGenerateStateMachine({}, PROMPT, h)
    expect(r.ok).toBe(true)
    expect(h.reprobe).not.toHaveBeenCalled()     // 성공 시 스트릭 리셋을 지우면 여기서 context 로 죽는다
  })
})

describe('pre-acknowledgement images are absorbed, never accepted', () => {
  it('an image visible before the submit ack is treated as pre-existing; a later new one wins', async () => {
    const h = makeHarness({
      __cg_baseline__: { imgs: [] },
      __cg_inject__: { textMatches: true, submitPresent: true },
      __cg_clickSubmit__: { clicked: true },
      // 첫 사이클은 아직 미제출 — 그 사이 직전 turn 의 늦은 이미지('stale')가 렌더된다
      __cg_submitAck__: (n) => (n === 0 ? ACK_NOT_SUBMITTED : ACK_SUBMITTED),
      __cg_poll__: (n) => (n <= 2 ? { imgs: [loaded('stale')] } : { imgs: [loaded('stale'), loaded('new2')] }),
    })
    const r = await runGenerateStateMachine({}, PROMPT, h)
    expect(r.ok).toBe(true)
    expect(r.id).toBe('new2')     // 'stale' 을 수락하면(흡수 로직 제거 시) 여기서 죽는다
  })
})

describe('image acceptance stability', () => {
  it('does not accept a new id seen only once (partial frame swap)', async () => {
    const seq = [
      { imgs: [loaded('prev')] },      // 1회차: prev
      { imgs: [loaded('other')] },     // 2회차: 다른 id → 불안정
      { imgs: [loaded('other')] },     // 3회차: 같은 id 2연속 → 수락
    ]
    const h = makeHarness({
      __cg_baseline__: { imgs: [] },
      __cg_inject__: { textMatches: true, submitPresent: true },
      __cg_clickSubmit__: { clicked: true },
      __cg_submitAck__: ACK_SUBMITTED,
      __cg_poll__: (n) => seq[Math.min(n, seq.length - 1)],
    })
    const r = await runGenerateStateMachine({}, PROMPT, h)
    expect(r.ok).toBe(true)
    expect(r.id).toBe('other')
    expect(h.counts.__cg_poll__).toBe(2)   // 0,1,2 중 3회차(index 2)에서 수락
  })
  it('never accepts baseline ids, non-estuary srcs, or same-id/new-sig', async () => {
    const h = makeHarness({
      __cg_baseline__: { imgs: [loaded('old1')] },
      __cg_inject__: { textMatches: true, submitPresent: true },
      __cg_clickSubmit__: { clicked: true },
      __cg_submitAck__: ACK_SUBMITTED,
      __cg_poll__: {
        imgs: [
          { src: `${CDN}?id=old1&sig=REFRESHED`, complete: true, w: 1024, h: 1024 },
          { src: 'https://chatgpt.com/backend-api/files/f?id=new9', complete: true, w: 1024, h: 1024 },
          { src: 'blob:https://chatgpt.com/x', complete: true, w: 1024, h: 1024 },
        ],
      },
    })
    const r = await runGenerateStateMachine({}, PROMPT, h)
    expect(r).toEqual({ ok: false, stage: 'poll', detail: 'deadline' })   // 제출은 ack 됨 → poll
  })
})

describe('deadline and context loss', () => {
  it('treats a malformed poll value as a context failure', async () => {
    const h = makeHarness({
      __cg_baseline__: { imgs: [] },
      __cg_inject__: { textMatches: true, submitPresent: true },
      __cg_clickSubmit__: { clicked: true },
      __cg_submitAck__: ACK_SUBMITTED,
      __cg_poll__: { imgs: 'nope' },
    })
    const r = await runGenerateStateMachine({}, PROMPT, h)
    expect(r).toMatchObject({ ok: false, stage: 'context' })
  })

  it('stops at the single 120s deadline (not per-phase)', async () => {
    const h = makeHarness({
      __cg_baseline__: { imgs: [] },
      __cg_inject__: { textMatches: true, submitPresent: true },
      __cg_clickSubmit__: { clicked: true },
      __cg_submitAck__: ACK_SUBMITTED,
      __cg_poll__: { imgs: [] },
    })
    const r = await runGenerateStateMachine({}, PROMPT, h)
    expect(r.stage).toBe('poll')
    // 1.5s cadence 로 t=1500…118500 의 79회 실행. 80번째 sleep 은 정확히 deadline 에 닿아
    // eval 없이 break 한다 → 마지막 호출 인덱스 78.
    expect(h.counts.__cg_poll__).toBe(78)
    expect(h.now()).toBe(120000)
  })
  it('fails early with stage:context after repeated eval rejects + a failed re-probe', async () => {
    const h = makeHarness({
      __cg_baseline__: { imgs: [] },
      __cg_inject__: { textMatches: true, submitPresent: true },
      __cg_clickSubmit__: { clicked: true },
      __cg_submitAck__: () => new Error('Script failed to execute: context destroyed'),
      __cg_poll__: () => new Error('context destroyed'),
    })
    h.reprobe = vi.fn(async () => false)   // 안정 로그아웃/DOM 부재
    const r = await runGenerateStateMachine({}, PROMPT, h)
    expect(r.ok).toBe(false)
    expect(r.stage).toBe('context')
    expect(h.reprobe).toHaveBeenCalled()
    expect(h.now()).toBeLessThan(120000)   // 120s 낭비하지 않음
  })
  it('keeps going when the re-probe says the page is fine (transient navigation)', async () => {
    let pollOk = false
    const h = makeHarness({
      __cg_baseline__: { imgs: [] },
      __cg_inject__: { textMatches: true, submitPresent: true },
      __cg_clickSubmit__: { clicked: true },
      __cg_submitAck__: (n) => (n < 4 ? new Error('transient') : ACK_SUBMITTED),
      __cg_poll__: (n) => (n < 4 ? new Error('transient') : (pollOk = true, { imgs: [loaded('new1')] })),
    })
    h.reprobe = vi.fn(async () => true)
    const r = await runGenerateStateMachine({}, PROMPT, h)
    expect(h.reprobe).toHaveBeenCalled()
    expect(pollOk).toBe(true)
    expect(r.ok).toBe(true)
  })
  it('retries a rejecting baseline 3× before failing with stage:context', async () => {
    const h = makeHarness({ __cg_baseline__: () => new Error('destroyed') })
    h.reprobe = vi.fn(async () => false)
    const r = await runGenerateStateMachine({}, PROMPT, h)
    expect(r).toMatchObject({ ok: false, stage: 'context' })
    expect(h.calls).toEqual(['__cg_baseline__', '__cg_baseline__', '__cg_baseline__'])   // bounded retry(§3-F)
    expect(h.now()).toBe(3000)            // 재시도 사이 cadence 만큼만 대기, 루프엔 안 들어감
  })

  it('recovers when a transient baseline rejection succeeds on retry', async () => {
    const h = makeHarness({
      __cg_baseline__: (n) => (n === 0 ? new Error('transient') : { imgs: [] }),
      __cg_inject__: { textMatches: true, submitPresent: true },
      __cg_clickSubmit__: { clicked: true },
      __cg_submitAck__: ACK_SUBMITTED,
      __cg_poll__: { imgs: [loaded('new1')] },
    })
    const r = await runGenerateStateMachine({}, PROMPT, h)
    expect(r.ok).toBe(true)
    expect(h.counts.__cg_baseline__).toBe(1)   // 2회 호출(index 1)
  })

  it('gives up with stage:context when the page probes alive but evals keep failing', async () => {
    const h = makeHarness({
      __cg_baseline__: { imgs: [] },
      __cg_inject__: { textMatches: true, submitPresent: true },
      __cg_clickSubmit__: { clicked: true },
      __cg_submitAck__: () => new Error('page fn broken'),
      __cg_poll__: () => new Error('page fn broken'),
    })
    h.reprobe = vi.fn(async () => true)     // 로그인·컴포저는 멀쩡 — 그래도 영원히 돌면 안 된다
    const r = await runGenerateStateMachine({}, PROMPT, h)
    expect(r).toMatchObject({ ok: false, stage: 'context' })
    expect(h.now()).toBeLessThan(120000)
  })
})
