# Story 토큰 사용량 표시 — 구현 플랜

> **For agentic workers:** REQUIRED SUB-SKILL: `superpowers:subagent-driven-development` 또는
> `superpowers:executing-plans` 로 task 단위 실행. 체크박스(`- [ ]`)로 추적.

**Goal:** Story 파이프라인이 도는 동안 이번 실행의 누적 토큰을 `in 8.1k / out 4.2k` 로 보여준다.

**Architecture:** provider 가 이미 받아놓고 버리는 usage 를 **단일 tap 지점**에서 가로채
main 측 tracker 에 넣고, 기존 progress IPC 로 렌더러에 실어 보낸다. provider 반환 shape 은
안 바꾼다 → 호출부 무변경.

**Tech Stack:** Electron, vitest, `@anthropic-ai/claude-agent-sdk`, `@openai/codex` app-server JSON-RPC.

**설계 근거**: `docs/plans/2026-07-17-story-token-usage-design.md` (v2, Codex+Fable 리뷰 반영).

## Global Constraints

- `@openai/codex` **0.144.5** 고정. codex payload 는 **중첩**: `params.tokenUsage.total` 을 읽는다.
- **gemini 는 범위 밖** — 프로덕션 라우터에 없다(`main.js:285` = {claude, codex}).
- **out 은 thinking 포함**(inclusive), **in 은 cache 포함**. 두 엔진 동일 정의. 분리 가능해도 안 뺀다.
- 영속 없음 · 비용($) 없음 · 스텝별 표시 없음.
- 모든 변경은 TDD. 커밋 메시지는 영어.
- **유일한 진짜 실패 모드는 조용히 틀린 합계.** 안 보이는 것보다 나쁘다.

---

## 설계 변경 — 스펙 v2 대비 (구현 중 발견)

스펙은 claude tap 지점으로 "두 파서 모두(`extractClaudeSdkResult` + `readStructuredResult`)"를 지정했다.
**코드를 열어보니 더 나은 지점이 있다.**

`llmClaude.js` 에는 `for await (const m of queryImpl(...))` 루프가 **11개**다
(122, 151, 160, 185, 201, 255, 272, 310, 337 …). 파서를 찌르면 11곳을 봐야 하고,
**새 루프가 추가되면 조용히 샌다** — 이 기능의 유일한 실패 모드가 정확히 그것이다.

그 11개 루프가 전부 지나는 단일 지점이 있다:

```js
// llmClaude.js:63 — SDK query 를 감싸는 얇은 제너레이터
async function* defaultQuery(args) {
  const { query } = await import('@anthropic-ai/claude-agent-sdk')
  yield* query(withClaudePath(args))
}
```

**결정: `defaultQuery` 를 tap 한다.** 파서가 아니라. 이유:
- 한 곳. 11곳이 아니라.
- 새 파서·새 루프가 생겨도 자동으로 잡힌다.
- `structuredClaudeCall` 의 1차/폴백 **둘 다** 이 제너레이터를 지나므로 재시도 양쪽 과금이 자동 포함된다.
- 실패 result(`is_error`)도 파서가 throw 하기 **전에** 지나가므로 잡힌다 (스펙 요구사항).

트레이드오프: 테스트가 `queryImpl` 을 주입하면 tap 을 우회한다. 그래서 Task 3 이 tap 을 **직접** 테스트한다.

---

## File Structure

| 파일 | 책임 |
|---|---|
| `electron/api/llm/usageTokens.js` (신규) | **순수 함수.** 엔진별 raw usage → `{input, output}` 정규화. 부작용 없음 |
| `electron/api/llm/usageTracker.js` (신규) | 누산기 인스턴스. 가산/교체/epoch/snapshot. 모듈 싱글톤 **금지** |
| `electron/api/llm/llmClaude.js` (수정 :63) | `defaultQuery` 에 tap 1줄 |
| `electron/api/llm/codexAppServer.js` (수정 :166) | `onNotification` 에 `thread/tokenUsage/updated` 분기 |
| `electron/story/stepMachine.js` (수정) | tracker 인스턴스 소유, epoch 관리, progress 에 usage 실어 보내기 |
| `src/hooks/useStoryPipeline.js` (수정) | usage 상태 — **`progressLog` 의 "start() 마다 비우기" 패턴을 따르면 안 된다** |
| `src/components/story/StoryView.jsx` (수정) | `in 8.1k / out 4.2k` 1줄 |

---

## Task 1: usageTokens — 엔진별 정규화 (순수)

**Files:**
- Create: `electron/api/llm/usageTokens.js`
- Test: `tests/electron/api/llm/usageTokens.test.js`

**Interfaces:**
- Produces: `claudeResultToUsage(message) -> {input,output}|null`,
  `codexNotifToUsage(params) -> {key,input,output}|null`

- [ ] **Step 1: 실패하는 테스트를 쓴다**

```js
import { describe, it, expect } from 'vitest'
import { claudeResultToUsage, codexNotifToUsage } from '../../../../electron/api/llm/usageTokens.js'

describe('claudeResultToUsage', () => {
  // BetaUsage: input_tokens 는 cache 를 제외한다(별도 필드). 셋을 다 더해야 진짜 입력.
  it('in 은 cache 를 포함해 합산한다 — input_tokens 만 세면 심하게 과소', () => {
    const m = { type: 'result', usage: {
      input_tokens: 100, cache_creation_input_tokens: 20, cache_read_input_tokens: 300, output_tokens: 50,
    } }
    expect(claudeResultToUsage(m)).toEqual({ input: 420, output: 50 })
  })

  it('out 은 thinking 을 포함한다 — 분리 가능해도 빼지 않는다(엔진 간 정의 일치)', () => {
    const m = { type: 'result', usage: {
      input_tokens: 10, output_tokens: 90, output_tokens_details: { thinking_tokens: 70 },
    } }
    expect(claudeResultToUsage(m).output).toBe(90) // 90-70=20 이 아니다
  })

  it('cache 필드가 없어도(null/undefined) 죽지 않는다', () => {
    expect(claudeResultToUsage({ type: 'result', usage: { input_tokens: 5, output_tokens: 7 } }))
      .toEqual({ input: 5, output: 7 })
  })

  it('실패 result 의 usage 도 집계한다 — 실제 과금이다', () => {
    const m = { type: 'result', subtype: 'error_during_execution', is_error: true,
      usage: { input_tokens: 8, output_tokens: 3 } }
    expect(claudeResultToUsage(m)).toEqual({ input: 8, output: 3 })
  })

  it('result 가 아니거나 usage 가 없으면 null', () => {
    expect(claudeResultToUsage({ type: 'stream_event' })).toBeNull()
    expect(claudeResultToUsage({ type: 'result' })).toBeNull()
    expect(claudeResultToUsage(null)).toBeNull()
  })
})

describe('codexNotifToUsage', () => {
  // 실측(0.144.5 generate-ts --experimental):
  //   ThreadTokenUsageUpdatedNotification = { threadId, turnId, tokenUsage: ThreadTokenUsage }
  //   ThreadTokenUsage = { total: TokenUsageBreakdown, last: TokenUsageBreakdown, modelContextWindow }
  const breakdown = (o) => ({ totalTokens: 0, inputTokens: 0, cachedInputTokens: 0, outputTokens: 0, reasoningOutputTokens: 0, ...o })

  it('total 을 읽는다 — last 를 읽으면 축소된다', () => {
    const params = { threadId: 't1', turnId: 'u1', tokenUsage: {
      total: breakdown({ inputTokens: 900, outputTokens: 300 }),
      last: breakdown({ inputTokens: 100, outputTokens: 40 }),
      modelContextWindow: 272000,
    } }
    expect(codexNotifToUsage(params)).toEqual({ key: 't1', input: 900, output: 300 })
  })

  it('inputTokens 는 cached 를 이미 포함한다 — cachedInputTokens 를 더하면 중복', () => {
    const params = { threadId: 't1', tokenUsage: {
      total: breakdown({ inputTokens: 500, cachedInputTokens: 400, outputTokens: 10 }), last: breakdown({}), modelContextWindow: null,
    } }
    expect(codexNotifToUsage(params).input).toBe(500) // 900 이 아니다
  })

  it('out 은 reasoning 을 포함한다 — reasoningOutputTokens 는 outputTokens 의 세부항목', () => {
    const params = { threadId: 't1', tokenUsage: {
      total: breakdown({ outputTokens: 200, reasoningOutputTokens: 150 }), last: breakdown({}), modelContextWindow: null,
    } }
    expect(codexNotifToUsage(params).output).toBe(200) // 350 도 50 도 아니다
  })

  it('평면 payload 는 거부한다 — 0.144.5 는 중첩이다', () => {
    expect(codexNotifToUsage({ threadId: 't1', tokenUsage: { inputTokens: 5, outputTokens: 5 } })).toBeNull()
  })

  it('threadId 없으면 null — key 없이는 교체를 할 수 없다', () => {
    expect(codexNotifToUsage({ tokenUsage: { total: breakdown({ inputTokens: 1 }), last: breakdown({}), modelContextWindow: null } })).toBeNull()
  })
})
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run tests/electron/api/llm/usageTokens.test.js`
Expected: FAIL — `Failed to resolve import ... usageTokens.js`

- [ ] **Step 3: 최소 구현**

```js
/**
 * 엔진별 raw usage → { input, output } 정규화. 순수 함수.
 *
 * 정의(두 엔진 동일):
 *   in  = cache 포함 총 입력
 *   out = thinking/reasoning 포함 총 출력
 * 분리 가능해도 빼지 않는다 — 빼면 같은 "out" 이 엔진마다 다른 걸 세게 된다.
 */

const n = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : 0)

/**
 * Claude Agent SDK 의 result 메시지(usage: BetaUsage).
 * BetaUsage 의 input_tokens 는 cache 를 **제외**한다(cache_*_input_tokens 가 별도 필드).
 * agent SDK 는 캐시 리드가 입력의 대부분이라 input_tokens 만 세면 심하게 과소.
 * 실패 result(SDKResultError)도 usage 가 필수이며 실제 과금이므로 집계한다.
 */
export function claudeResultToUsage(message) {
  if (message?.type !== 'result') return null
  const u = message.usage
  if (!u) return null
  return {
    input: n(u.input_tokens) + n(u.cache_creation_input_tokens) + n(u.cache_read_input_tokens),
    output: n(u.output_tokens),
  }
}

/**
 * codex app-server `thread/tokenUsage/updated` 의 params.
 * 0.144.5 실측 스키마(`codex app-server generate-ts --experimental` → v2/):
 *   ThreadTokenUsageUpdatedNotification = { threadId, turnId, tokenUsage: ThreadTokenUsage }
 *   ThreadTokenUsage = { total: TokenUsageBreakdown, last: TokenUsageBreakdown, modelContextWindow }
 *   TokenUsageBreakdown = { totalTokens, inputTokens, cachedInputTokens, outputTokens, reasoningOutputTokens }
 * total 은 thread 누적, last 는 직전 응답 delta → 누적을 읽고 threadId 로 교체한다.
 * inputTokens 는 cached 를 이미 포함하므로 cachedInputTokens 를 더하면 중복이다.
 */
export function codexNotifToUsage(params) {
  const key = params?.threadId
  const total = params?.tokenUsage?.total
  if (!key || !total || typeof total !== 'object') return null
  return { key, input: n(total.inputTokens), output: n(total.outputTokens) }
}
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run tests/electron/api/llm/usageTokens.test.js`
Expected: PASS (11 tests)

- [ ] **Step 5: 커밋**

```bash
git add electron/api/llm/usageTokens.js tests/electron/api/llm/usageTokens.test.js
git commit -m "feat(story-usage): normalize per-engine token usage

Claude reports input_tokens excluding cache, so the three input fields must be
summed; codex reports inputTokens already including cache, so adding
cachedInputTokens would double-count. Both keep thinking inside output: it is
separable on either engine, but subtracting it would make 'out' mean different
things per engine."
```

---

## Task 2: usageTracker — 누산기 (가산 vs 교체, epoch)

**Files:**
- Create: `electron/api/llm/usageTracker.js`
- Test: `tests/electron/api/llm/usageTracker.test.js`

**Interfaces:**
- Consumes: 없음 (순수 상태 머신)
- Produces: `createUsageTracker() -> { addDelta({input,output}), setCumulative({key,input,output}), snapshot() -> {input,output}, beginRun() -> epoch, currentEpoch() -> number }`

- [ ] **Step 1: 실패하는 테스트를 쓴다**

```js
import { describe, it, expect } from 'vitest'
import { createUsageTracker } from '../../../../electron/api/llm/usageTracker.js'

describe('createUsageTracker', () => {
  it('delta 는 더한다 (claude)', () => {
    const t = createUsageTracker()
    t.addDelta({ input: 10, output: 5 })
    t.addDelta({ input: 3, output: 2 })
    expect(t.snapshot()).toEqual({ input: 13, output: 7 })
  })

  // 이 기능의 급소. codex 는 thread 누적치를 보내므로 더하면 뻥튀기된다.
  it('같은 key 의 cumulative 는 교체한다 — 더하면 뻥튀기', () => {
    const t = createUsageTracker()
    t.setCumulative({ key: 't1', input: 100, output: 40 })
    t.setCumulative({ key: 't1', input: 250, output: 90 })
    expect(t.snapshot()).toEqual({ input: 250, output: 90 }) // 350/130 이 아니다
  })

  it('다른 key 의 cumulative 는 합산한다 — codex 는 호출당 새 thread', () => {
    const t = createUsageTracker()
    t.setCumulative({ key: 't1', input: 100, output: 10 })
    t.setCumulative({ key: 't2', input: 200, output: 20 })
    expect(t.snapshot()).toEqual({ input: 300, output: 30 })
  })

  it('엔진 혼합 — delta 와 cumulative 가 한 실행에 섞여도 맞다', () => {
    const t = createUsageTracker()
    t.addDelta({ input: 10, output: 1 })
    t.setCumulative({ key: 't1', input: 100, output: 40 })
    t.addDelta({ input: 5, output: 2 })
    t.setCumulative({ key: 't1', input: 250, output: 90 }) // 교체
    expect(t.snapshot()).toEqual({ input: 265, output: 93 }) // 15 + 250, 3 + 90
  })

  it('beginRun 은 epoch 를 올리고 합계를 0 으로 되돌린다', () => {
    const t = createUsageTracker()
    t.addDelta({ input: 10, output: 5 })
    const e1 = t.currentEpoch()
    const e2 = t.beginRun()
    expect(e2).toBeGreaterThan(e1)
    expect(t.snapshot()).toEqual({ input: 0, output: 0 })
  })

  it('beginRun 은 codex key 도 지운다 — 이전 실행 thread 가 새 합계에 남으면 안 된다', () => {
    const t = createUsageTracker()
    t.setCumulative({ key: 't1', input: 100, output: 40 })
    t.beginRun()
    expect(t.snapshot()).toEqual({ input: 0, output: 0 })
  })

  // 늦게 끝난 이전 실행이 새 실행을 오염시키면 안 된다.
  it('지난 epoch 의 기록은 무시한다', () => {
    const t = createUsageTracker()
    const stale = t.currentEpoch()
    t.beginRun()
    t.addDelta({ input: 999, output: 999 }, stale)
    t.setCumulative({ key: 't9', input: 999, output: 999 }, stale)
    expect(t.snapshot()).toEqual({ input: 0, output: 0 })
  })

  it('현재 epoch 를 명시해 기록하면 반영된다', () => {
    const t = createUsageTracker()
    const e = t.currentEpoch()
    t.addDelta({ input: 4, output: 1 }, e)
    expect(t.snapshot()).toEqual({ input: 4, output: 1 })
  })

  it('null/빈 기록은 무시한다', () => {
    const t = createUsageTracker()
    t.addDelta(null); t.setCumulative(null); t.setCumulative({ input: 1, output: 1 })
    expect(t.snapshot()).toEqual({ input: 0, output: 0 })
  })
})
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run tests/electron/api/llm/usageTracker.test.js`
Expected: FAIL — resolve import 실패

- [ ] **Step 3: 최소 구현**

```js
/**
 * 실행 단위 토큰 누산기. **모듈 싱글톤으로 만들지 말 것** —
 * createStepMachine 안에 인스턴스로 두어야 프로젝트 전환 시 함께 죽는다.
 *
 * 엔진마다 보고 방식이 다르다:
 *   claude — 호출당 delta        → addDelta (가산)
 *   codex  — thread 누적치        → setCumulative (key 별 교체)
 * 같은 통에 넣고 전부 더하면 codex 가 뻥튀기된다.
 *
 * epoch: "실행 시작"은 이 앱에 단일 이벤트가 아니다(자동 진행 = start() 연쇄).
 * beginRun() 은 사용자가 새 실행을 승인한 시점에만 부른다 — start() 마다가 아니다.
 * 늦게 끝난 이전 실행의 콜백은 자기 epoch 를 들고 오므로 무시된다.
 */
export function createUsageTracker() {
  let epoch = 1
  let deltaIn = 0
  let deltaOut = 0
  const cumulative = new Map() // key -> {input, output}

  const fresh = (at) => at === undefined || at === epoch

  return {
    currentEpoch: () => epoch,

    beginRun() {
      epoch += 1
      deltaIn = 0
      deltaOut = 0
      cumulative.clear()
      return epoch
    },

    addDelta(u, at) {
      if (!u || !fresh(at)) return
      deltaIn += u.input || 0
      deltaOut += u.output || 0
    },

    setCumulative(u, at) {
      if (!u?.key || !fresh(at)) return
      cumulative.set(u.key, { input: u.input || 0, output: u.output || 0 })
    },

    snapshot() {
      let input = deltaIn
      let output = deltaOut
      for (const v of cumulative.values()) { input += v.input; output += v.output }
      return { input, output }
    },
  }
}
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run tests/electron/api/llm/usageTracker.test.js`
Expected: PASS (9 tests)

- [ ] **Step 5: 뮤테이션 검증 — 하네스가 진짜로 병을 잡는지**

`usageTracker.js` 의 `cumulative.set(...)` 을 일시적으로 누적 가산으로 바꾼다:

```js
const prev = cumulative.get(u.key) || { input: 0, output: 0 }
cumulative.set(u.key, { input: prev.input + (u.input||0), output: prev.output + (u.output||0) })
```

Run: `npx vitest run tests/electron/api/llm/usageTracker.test.js`
Expected: **FAIL** — "같은 key 의 cumulative 는 교체한다" 가 죽어야 한다(250 vs 350).
죽지 않으면 테스트가 제품이 가는 길을 안 지난 것이다. **확인 후 되돌린다.**

- [ ] **Step 6: 커밋**

```bash
git add electron/api/llm/usageTracker.js tests/electron/api/llm/usageTracker.test.js
git commit -m "feat(story-usage): per-run token tracker with engine-aware accumulation

Codex reports a thread-cumulative total on every notification while claude
reports a per-call delta, so summing both the same way over-counts codex. Keep
them apart: deltas add, cumulatives replace by thread key.

A run here is a chain of separate start() calls, so resetting per start() would
erase the earlier steps' totals. beginRun() bumps an epoch instead, and stale
callbacks from a previous run carry their own epoch and are dropped."
```

---

## Task 3: claude tap — `defaultQuery` 한 곳

**Files:**
- Modify: `electron/api/llm/llmClaude.js:63-66`
- Test: `tests/electron/api/llm/llmClaude.usageTap.test.js`

**Interfaces:**
- Consumes: `claudeResultToUsage` (Task 1)
- Produces: `setClaudeUsageSink(fn|null)` — main 이 tracker 를 물린다

- [ ] **Step 1: 실패하는 테스트를 쓴다**

```js
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setClaudeUsageSink, __tapQueryForTest } from '../../../../electron/api/llm/llmClaude.js'

describe('claude usage tap', () => {
  beforeEach(() => setClaudeUsageSink(null))

  const results = (...ms) => (async function* () { for (const m of ms) yield m })()

  it('result 메시지의 usage 를 sink 에 흘린다', async () => {
    const seen = []
    setClaudeUsageSink((u) => seen.push(u))
    const out = []
    for await (const m of __tapQueryForTest(() => results(
      { type: 'stream_event' },
      { type: 'result', subtype: 'success', result: 'ok', usage: { input_tokens: 10, cache_read_input_tokens: 90, output_tokens: 4 } },
    ))({})) out.push(m)

    expect(seen).toEqual([{ input: 100, output: 4 }])
    expect(out).toHaveLength(2) // tap 은 스트림을 소비하지 않고 통과시킨다
  })

  it('실패 result 의 usage 도 흘린다 — 파서가 throw 하기 전에 지나간다', async () => {
    const seen = []
    setClaudeUsageSink((u) => seen.push(u))
    for await (const _ of __tapQueryForTest(() => results(
      { type: 'result', subtype: 'error_during_execution', is_error: true, usage: { input_tokens: 7, output_tokens: 2 } },
    ))({})) { /* drain */ }
    expect(seen).toEqual([{ input: 7, output: 2 }])
  })

  it('sink 가 없으면 조용히 통과한다', async () => {
    const out = []
    for await (const m of __tapQueryForTest(() => results({ type: 'result', usage: { input_tokens: 1, output_tokens: 1 } }))({})) out.push(m)
    expect(out).toHaveLength(1)
  })

  it('sink 가 던져도 스트림을 깨지 않는다 — 계측이 제품을 죽이면 안 된다', async () => {
    setClaudeUsageSink(() => { throw new Error('boom') })
    const out = []
    for await (const m of __tapQueryForTest(() => results({ type: 'result', usage: { input_tokens: 1, output_tokens: 1 } }))({})) out.push(m)
    expect(out).toHaveLength(1)
  })
})
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run tests/electron/api/llm/llmClaude.usageTap.test.js`
Expected: FAIL — `setClaudeUsageSink is not a function`

- [ ] **Step 3: 최소 구현** — `llmClaude.js` 의 `defaultQuery`(:63) 를 교체

```js
// --- token usage tap ---------------------------------------------------------
// llmClaude 에는 `for await (const m of queryImpl(...))` 루프가 11개 있다(122,151,160,185,
// 201,255,272,310,337 …). 파서를 찌르면 11곳을 봐야 하고 새 루프가 생기면 조용히 샌다 —
// 이 기능의 유일한 실패 모드가 정확히 그것이다. 그 11개가 전부 지나는 곳이 여기 하나다.
// structuredClaudeCall 의 1차/폴백도 둘 다 지나므로 재시도 양쪽 과금이 자동 포함된다.
let claudeUsageSink = null

/** main 이 tracker 를 물린다. null 로 해제. */
export function setClaudeUsageSink(fn) { claudeUsageSink = fn }

function tapQuery(makeStream) {
  return async function* (args) {
    for await (const m of makeStream(args)) {
      if (claudeUsageSink) {
        // 계측 실패가 생성을 죽이면 안 된다.
        try {
          const u = claudeResultToUsage(m)
          if (u) claudeUsageSink(u)
        } catch { /* 계측은 best-effort */ }
      }
      yield m
    }
  }
}

/** @internal 테스트 전용 — 실제 SDK 없이 tap 동작을 고정한다. */
export const __tapQueryForTest = tapQuery

async function* defaultQuery(args) {
  const { query } = await import('@anthropic-ai/claude-agent-sdk')
  yield* tapQuery((a) => query(withClaudePath(a)))(args)
}
```

파일 상단 import 에 추가:

```js
import { claudeResultToUsage } from './usageTokens.js'
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run tests/electron/api/llm/llmClaude.usageTap.test.js`
Expected: PASS (4 tests)

- [ ] **Step 5: 기존 claude 테스트 회귀**

Run: `npx vitest run tests/electron/api/llm/`
Expected: 전부 PASS (Task 1·2·3 추가분 포함)

- [ ] **Step 6: 커밋**

```bash
git add electron/api/llm/llmClaude.js tests/electron/api/llm/llmClaude.usageTap.test.js
git commit -m "feat(story-usage): tap claude token usage at the query generator

The design doc named the two result parsers as the collection point, but there
are eleven separate query loops in this file and a twelfth would silently go
uncounted — which is this feature's one real failure mode. Every one of them
goes through defaultQuery, so tap there instead: one place, and new parsers or
loops are covered for free. It also catches the structured call's retry
fallback, which bills twice, and error results, which the parsers throw on
before the usage can be read."
```

---

## Task 4: codex tap — `thread/tokenUsage/updated` 분기

**Files:**
- Modify: `electron/api/llm/codexAppServer.js:163-184` (`onNotification`)
- Test: `tests/electron/api/llm/codexAppServer.usage.test.js`

**Interfaces:**
- Consumes: `codexNotifToUsage` (Task 1)
- Produces: `runCodexTurn` 의 옵션에 `onUsage({key,input,output})` 추가

- [ ] **Step 1: 실패하는 테스트를 쓴다** — 실제 알림 모양 fixture 사용

```js
import { describe, it, expect } from 'vitest'
import { handleUsageNotification } from '../../../../electron/api/llm/codexAppServer.js'

// 0.144.5 실측 스키마. 축약 객체로 시험하면 제품이 가는 길을 안 지난다.
const breakdown = (o) => ({ totalTokens: 0, inputTokens: 0, cachedInputTokens: 0, outputTokens: 0, reasoningOutputTokens: 0, ...o })
const notif = (o) => ({ threadId: 't1', turnId: 'u1', tokenUsage: {
  total: breakdown(o.total || {}), last: breakdown(o.last || {}), modelContextWindow: 272000,
} })

describe('codex thread/tokenUsage/updated', () => {
  it('중첩 total 을 읽어 onUsage 에 넘긴다', () => {
    const seen = []
    handleUsageNotification('thread/tokenUsage/updated', notif({ total: { inputTokens: 900, outputTokens: 300 } }), (u) => seen.push(u))
    expect(seen).toEqual([{ key: 't1', input: 900, output: 300 }])
  })

  it('다른 method 는 무시한다', () => {
    const seen = []
    handleUsageNotification('turn/completed', { turn: { status: 'completed' } }, (u) => seen.push(u))
    expect(seen).toEqual([])
  })

  it('onUsage 가 없어도 죽지 않는다', () => {
    expect(() => handleUsageNotification('thread/tokenUsage/updated', notif({ total: { inputTokens: 1 } }), undefined)).not.toThrow()
  })

  it('onUsage 가 던져도 삼킨다 — 이 콜백은 stdout 핸들러 안에서 돈다', () => {
    expect(() => handleUsageNotification('thread/tokenUsage/updated', notif({ total: { inputTokens: 1 } }), () => { throw new Error('boom') })).not.toThrow()
  })
})
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run tests/electron/api/llm/codexAppServer.usage.test.js`
Expected: FAIL — `handleUsageNotification is not a function`

- [ ] **Step 3: 최소 구현** — `codexAppServer.js` 에 추가

```js
import { codexNotifToUsage } from './usageTokens.js'

/**
 * `thread/tokenUsage/updated` 알림 → onUsage. 다른 method 는 통과.
 * 이 함수는 stdout 이벤트 핸들러 안에서 돈다 — 여기서 던지면 uncaught 가 되고
 * 턴 정리(finally)를 건너뛴다. 계측 실패가 생성을 죽이면 안 되므로 전부 삼킨다.
 * @internal export 는 테스트가 실제 알림 모양을 고정하기 위한 것이다.
 */
export function handleUsageNotification(method, params, onUsage) {
  if (method !== 'thread/tokenUsage/updated' || !onUsage) return
  try {
    const u = codexNotifToUsage(params)
    if (u) onUsage(u)
  } catch { /* 계측은 best-effort */ }
}
```

`onNotification`(:166) 의 분기 체인 **맨 앞**에 한 줄 — 기존 3개 분기는 손대지 않는다:

```js
onNotification: (message) => {
  try {
    const { method, params } = message
    handleUsageNotification(method, params, onUsage)   // ← 추가
    if (method === 'item/agentMessage/delta') {
      // ... 기존 그대로
```

`runCodexTurn` 시그니처의 옵션 구조분해에 `onUsage` 를 추가한다(기존 `onDelta` 옆).

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run tests/electron/api/llm/codexAppServer.usage.test.js`
Expected: PASS (4 tests)

- [ ] **Step 5: codex 회귀**

Run: `npx vitest run tests/electron/api/llm/`
Expected: 전부 PASS

- [ ] **Step 6: 커밋**

```bash
git add electron/api/llm/codexAppServer.js tests/electron/api/llm/codexAppServer.usage.test.js
git commit -m "feat(story-usage): read codex token usage from thread/tokenUsage/updated

The notification was not handled at all. Its payload is nested — reading
params.tokenUsage.inputTokens yields undefined — so take params.tokenUsage.total,
which is the thread's running total. Schema confirmed by generating the app
server's own bindings from the vendored 0.144.5 binary rather than inferring it.

The handler runs inside the stdout event handler, where a throw becomes uncaught
and skips turn cleanup, so instrumentation failures are swallowed."
```

---

## Task 5: stepMachine 배선 — tracker 소유 + run 경계 + progress 에 싣기

**Files:**
- Modify: `electron/story/stepMachine.js` (createStepMachine, send)
- Test: `tests/electron/story/stepMachine.usage.test.js`

**Interfaces:**
- Consumes: `createUsageTracker` (Task 2), `setClaudeUsageSink` (Task 3), codex `onUsage` (Task 4)
- Produces: progress payload 에 `usage: {input, output}`

- [ ] **Step 1: 실패하는 테스트를 쓴다**

```js
// 이 파일의 테스트는 기존 stepMachine 테스트의 하네스 관습을 따른다.
// (tests/electron/story/stepMachine.audioImport.test.js 의 machine 생성 헬퍼 참고)
```

**핵심 3건 — 전부 "조용히 틀린 합계"를 직접 겨눈다:**

1. `machine.usageTracker` 는 machine 인스턴스마다 **다른 객체**여야 한다 (모듈 싱글톤 금지).
   두 machine 을 만들어 한쪽에 기록하고 다른 쪽 snapshot 이 0 인지 본다 → **프로젝트 전환 격리**.
2. `start()` 를 두 번 연달아 부르면 앞의 합계가 **남아 있어야** 한다 → `progressLog` 함정 회귀.
   (v1 의 "start() 가 누산기를 안 지운다"는 start() 가 참조도 안 하는 모듈에 대한 준-항진명제였다.
   이 테스트는 **start 를 실제로 두 번 부르고 합계가 단조 증가**하는지 본다.)
3. progress 이벤트 payload 에 `usage` 가 실려 나간다.

- [ ] **Step 2~6**: 실패 확인 → 구현 → 통과 → 회귀 → 커밋.

**구현 요지** (정확한 코드는 Step 1 에서 하네스를 읽고 확정한다 — 이 파일은 2000줄이 넘고
기존 send/DI 관습을 따라야 한다):
- `createStepMachine` 안에서 `const usageTracker = createUsageTracker()`
- 사용자가 새 실행을 승인한 지점에서 `usageTracker.beginRun()` — **`start()` 마다가 아니다**
- claude: `setClaudeUsageSink((u) => usageTracker.addDelta(u, epochAtCall))`
- codex: `runCodexTurn` 에 `onUsage: (u) => usageTracker.setCumulative(u, epochAtCall)`
- 기존 progress `send()`(:262 — 이미 `projectToken`/operationId 를 붙인다) 에 `usage: usageTracker.snapshot()` 추가

---

## Task 6: 렌더러 표시

**Files:**
- Modify: `src/hooks/useStoryPipeline.js` (usage 상태)
- Modify: `src/components/story/StoryView.jsx` (1줄 표시)
- Test: `tests/hooks/useStoryPipeline.usage.test.js`, `tests/components/story/StoryView.usage.test.jsx`

- [ ] **Step 1: 실패하는 테스트를 쓴다**

**핵심**: usage 상태는 **`progressLog` 의 패턴을 따르면 안 된다.**
`useStoryPipeline.js:378` 의 `setProgressLog([])` 처럼 `start()` 마다 비우면
sink 를 main 에 둔 게 **무의미해진다** — 숫자가 렌더러에서 똑같이 죽는다.

1. `start()` 를 두 번 부른 뒤에도 usage 가 안 지워진다 (setProgressLog([]) 옆에 setUsage(null) 을
   **추가하면 죽는** 테스트 — 그게 이 테스트의 존재 이유).
2. `in 8.1k / out 4.2k` 포맷 (1000 미만은 그대로, 1000 이상은 k).
3. usage 가 없으면 아무것도 안 그린다.

- [ ] **Step 2~6**: 실패 확인 → 구현 → 통과 → 회귀 → 커밋.

---

## Task 7: 전체 회귀 + 스펙 상태 갱신

- [ ] **Step 1: 전체 스위트**

Run: `npx vitest run`
Expected: **6261 + 신규 통과, 실패 0.**

> ⚠️ **`npm run test:run` 은 실패해도 exit 0 이다. 숫자를 직접 봐라.**
> 파일 하나가 파싱 에러로 통째로 안 돌아도 총계가 조용히 줄어들 뿐이다.
> 위 명령은 `npx vitest run` 을 직접 쓴다(exit code 가 정확하다).

- [ ] **Step 2: 스펙 문서 상태 갱신**

`docs/plans/2026-07-17-story-token-usage-design.md` 의 상태 줄을 구현 완료로 바꾸고,
**Task 3 의 설계 변경**(파서 2곳 → `defaultQuery` 1곳)을 반영한다. 스펙이 코드와 어긋난 채 남으면
다음 사람이 v1 의 잘못된 수집 지점을 다시 믿는다.

- [ ] **Step 3: Codex + Fable 리뷰** (마일스톤 관습)

구조·중복·에러방지. findings 0 까지 루프. **스코프 안에서** 0 이면 끝낸다.

- [ ] **Step 4: 커밋 + 푸시**

---

## 남은 것 (이 플랜 밖)

- **실앱 눈검증** — 테스트는 "숫자가 눈에 띄는가"를 못 잡는다. 앱 재시작 후 Story 실행하며
  숫자가 실제로 오르는지, 스텝 전환에서 안 죽는지 본다.
- 화자 오디오 눈검증(별건, 여전히 미완).
