/**
 * M0-15 — Claude Agent SDK orchestrator 계약 (HANDOFF §2.3).
 *
 * **코드 저작이 아니라 측정이다.** 결과가 설계를 정한다.
 *
 * 🔵 이미 측정된 것은 다시 재지 않는다 (핸드오프 §2.3 의 6문항 중 3개는 이미 답이 있다):
 *   Q1 persistent thread → **m0-5**: 한 Query 에 후속 user message 통과 (`followUpAnswered`).
 *   Q3 tool bridge       → **m0-2**: `type:'sdk'` in-process MCP + `MCP_TOOL_TIMEOUT` 이 hard bound.
 *                          12분 블로킹 툴도 **종단 tool_result** 로 온다 (폴링 불필요).
 *   Q4 승인 게이트       → **m0-5**: `canUseTool` 을 **600,020ms** 붙잡아도 tool body 1회 + 종단 result.
 *                          → **Codex 의 급소(`'never'` = 즉시 decline)에 해당하는 함정이 없다.**
 *                             Claude 는 응답할 때까지 기다린다.
 *
 * 🎯 그래서 여기서는 **남은 3개만** 잰다: Q2(per-turn model) / Q5(abort) / Q6(모델 목록).
 *
 * 🔴 타입은 이미 답을 **주장**한다 — `setModel(model?)` / `supportedModels()` / `interrupt()`.
 *    그러나 **타입은 주장이지 측정이 아니다.** Codex 의 급소가 정확히 이 간극이었다:
 *    `approvalPolicy:'never'` 는 타입상 "안 묻는다" 였지만 실제로는 **즉시 decline** 이었다.
 *
 *    특히 `setModel` 은 **session 단위**다 (per-turn 인자가 없다 — Codex 의 `turn/start.model` 과 다르다).
 *    우리 UX 계약(§4)은 *"진행 중 턴은 그대로, 다음 turn 부터 적용"* 이다. 그런데 Claude 의 한 "턴" 은
 *    **모델 요청 여러 개**다 (assistant → tool_use → tool_result → assistant …). setModel 이 그 사이에
 *    끼면 **진행 중 턴이 도중에 모델을 갈아탈 수 있다.** 그러면 계약이 조용히 깨진다.
 *    → 반드시 실측한다. 이게 이 스파이크의 핵심이다.
 *
 * 관측 기준(ground truth): assistant message 의 **`message.model`** — 그 응답을 실제로 만든 모델을
 * 서버가 스스로 보고한다 (Codex 쪽 rollout jsonl 에 대응).
 *
 * `npm run test:spike -- tests/spike/m0-15.claudeOrchestratorContract.spike.test.js` 로만 돈다.
 * 실제 Claude CLI 자격증명(구독)을 쓴다. ⚠️ 유효한 API 키를 넣지 않는다(m0-1 의 D23-1 참고).
 */
import { describe, it, expect, afterEach } from 'vitest'
import { z } from 'zod'
import { appendFileSync, mkdirSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { query, createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk'

const RESULT_DIR = 'docs/superpowers/specs'

// provenance 스탬프 — 이유는 m0-14 의 같은 블록 주석 참고 (뮤턴트 run 과 진짜 run 이 raw 에서 구분돼야 한다).
const gitSha = (() => {
  try { return execFileSync('git', ['rev-parse', '--short', 'HEAD'], { encoding: 'utf-8' }).trim() } catch { return null }
})()
const gitDirty = (() => {
  try { return execFileSync('git', ['status', '--porcelain'], { encoding: 'utf-8' }).trim().length > 0 } catch { return null }
})()

const record = (label, data) => {
  mkdirSync(RESULT_DIR, { recursive: true })
  appendFileSync(`${RESULT_DIR}/m0-15-raw.jsonl`, JSON.stringify({
    runId: process.env.SPIKE_RUN_ID ?? null,
    gitSha,
    gitDirty,
    mutant: process.env.SPIKE_MUTANT ?? null,
    label,
    ...data,
  }) + '\n')
}

afterEach((ctx) => {
  record('__verdict__', { test: ctx?.task?.name ?? '(?)', verdict: ctx?.task?.result?.state ?? 'unknown' })
})
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// 값이 확연히 다른 두 모델을 쓴다 — resolvedModel 이 달라야 "바뀌었다" 를 말할 수 있다.
const MODEL_A = 'haiku'   // → claude-haiku-4-5-*
const MODEL_B = 'sonnet'  // → claude-sonnet-5
const isA = (m) => /haiku/.test(m ?? '')
const isB = (m) => /sonnet/.test(m ?? '')

describe('M0-15 — Claude Agent SDK orchestrator 계약 (Q2/Q5/Q6)', () => {
  it('Q6 🎯 모델 목록을 **프로그램적으로** 얻는다 (하드코딩 불필요)', async () => {
    async function* prompts() { yield { type: 'user', message: { role: 'user', content: 'Reply with exactly: HI' } } }
    const q = query({ prompt: prompts(), options: { permissionMode: 'default', maxTurns: 2 } })
    const models = await q.supportedModels()
    record('Q6 supportedModels', { count: models.length, models })
    await q.interrupt().catch(() => {})

    expect(models.length).toBeGreaterThan(0)
    // Codex 의 model/list 와 같은 자리 = 카탈로그 IPC 에 Claude 소스를 붙일 수 있다.
    expect(models[0]).toHaveProperty('value')
    // 🔵 Codex 와 다른 점: Claude 는 'default' 가 **명시적 행**이고 resolvedModel 로 무엇인지 알려준다.
    //    (Codex 는 model 을 **생략**하는 게 default 이고, 생략하면 직전 모델이 sticky 하게 남는다 — m0-14.)
    const def = models.find((m) => m.value === 'default')
    record('Q6 default-row', { hasDefaultRow: Boolean(def), resolvedModel: def?.resolvedModel ?? null })
  }, 3 * 60 * 1000)

  it('Q2 🎯 setModel 로 **턴 사이** 모델을 바꾸면, 다음 턴이 새 모델로 오고 맥락은 유지된다', async () => {
    const token = 'ZEBRA-4417'
    const assistants = []
    let pushTurn2
    const gate = new Promise((r) => { pushTurn2 = r })

    async function* prompts() {
      yield { type: 'user', message: { role: 'user', content: `Remember this token: ${token}. Reply with exactly the token and nothing else.` } }
      await gate
      yield { type: 'user', message: { role: 'user', content: 'What token did I ask you to remember? Reply with exactly that token and nothing else.' } }
    }

    const q = query({ prompt: prompts(), options: { permissionMode: 'default', maxTurns: 8, model: MODEL_A } })

    // 🔴 턴 경계는 **`result` 메시지**다. assistant 메시지로 턴을 세면 안 된다 —
    //    첫 실측에서 정확히 그렇게 했다가 **아무것도 측정하지 못했다**:
    //    turn1 의 첫 assistant 는 `text:""` (빈 프레임) 였고, 거기서 턴을 넘겨 setModel 을 불러버렸다.
    //    그래서 "turn2" 로 기록된 것이 실은 **turn1 의 답**("ZEBRA-4417") 이었다.
    //    → 그 run 의 green/red 는 setModel 과 아무 상관이 없었다.
    let turn = 1
    let switched = false
    for await (const msg of q) {
      if (msg.type === 'assistant') {
        const text = (msg.message?.content ?? []).filter((b) => b?.type === 'text').map((b) => b.text).join('')
        assistants.push({ turn, model: msg.message?.model ?? null, text: text.slice(0, 60) })
        continue
      }
      if (msg.type === 'result' && turn === 1 && !switched) {
        switched = true
        await q.setModel(MODEL_B)   // ← **턴이 끝난 뒤** 전환 (계약: 다음 턴부터 적용)
        turn = 2
        pushTurn2()
        continue
      }
      if (msg.type === 'result' && turn === 2) break
    }
    record('Q2 setModel-between-turns', { assistants })

    // 빈 프레임(text:'')이 섞인다 — 턴별로 **내용이 있는 마지막** 응답이 그 턴의 답이다.
    const answerOf = (n) => [...assistants].reverse().find((a) => a.turn === n && a.text.trim())
    const t1 = answerOf(1)
    const t2 = answerOf(2)
    expect(isA(t1?.model), `turn1 은 ${MODEL_A} 여야 한다 (실측: ${t1?.model})`).toBe(true)
    expect(isB(t2?.model), `turn2 는 setModel 후 ${MODEL_B} 여야 한다 (실측: ${t2?.model})`).toBe(true)
    // 맥락 유지 = persistent thread (m0-5 의 followUp 과 같은 성질을 model 전환 하에서 재확인)
    expect(t2?.text, 'setModel 후에도 이전 턴의 토큰을 기억해야 한다').toContain(token)
  }, 5 * 60 * 1000)

  /**
   * 🔴 이 스파이크의 핵심 질문.
   *
   * 우리 UX 계약: "진행 중 턴은 기존 모델로 계속, 다음 턴부터 새 모델."
   * Codex 는 `turn/start.model` 이라 턴 경계가 곧 모델 경계다.
   * Claude 는 `setModel` 이 **session 단위**이고 한 턴 = 모델 요청 여러 개다.
   * → 턴 **한가운데서**(툴 승인 대기 중) setModel 을 부르면, 그 턴의 **나머지 요청**이 새 모델로 갈까?
   *
   * 이 답이 설계를 가른다:
   *   - 안 바뀐다 → Codex 와 같은 계약. selector 를 그대로 매핑하면 된다.
   *   - 바뀐다   → setModel 을 **턴 경계까지 지연**시켜야 한다 (pendingModel 을 들고 있다가 다음 턴에 적용).
   */
  it('🔴 Q2-b setModel 을 **진행 중 턴 한가운데**서 부르면 그 턴이 모델을 갈아타는가', async () => {
    const assistants = []
    let setModelAt = null

    const server = createSdkMcpServer({
      name: 'm0-15-gate',
      version: '0.0.1',
      tools: [
        tool('slow_echo', 'Echoes the text. Always call this when asked.', { text: z.string() },
          async ({ text }) => ({ content: [{ type: 'text', text: `GATED_OK:${text}` }] }),
          // ⚠️ MCP 툴 기본은 deferred — alwaysLoad 없으면 실행이 안 된다 (m0-5 에서 실증).
          { alwaysLoad: true }),
      ],
    })

    // 🔴 두 번째 user message 가 **반드시** 필요하다.
    //    "in-flight 턴이 A 로 유지된다"(측정됨) 와 "그 setModel 이 다음 턴에 적용된다"(별개 명제)는 다르다.
    //    후자를 안 재면 **"in-flight 중 부른 setModel 은 통째로 drop 된다"** 는 대안 가설을 못 배제한다.
    //    drop 이면 계약은 반대 방향으로 깨진다(사용자가 바꿨는데 다음 턴도 옛 모델, 에러 없음)
    //    → 그때는 pendingModel/경계 재호출 장치가 **필요하다.** 즉 이 두 번째 턴이 설계를 가른다.
    let pushTurn2
    const gate = new Promise((r) => { pushTurn2 = r })
    async function* prompts() {
      yield { type: 'user', message: { role: 'user', content: 'Call the slow_echo tool with text "ping". After you get the result, reply with the tool result text only.' } }
      await gate
      yield { type: 'user', message: { role: 'user', content: 'Reply with exactly: SECOND_TURN' } }
    }

    let q
    q = query({
      prompt: prompts(),
      options: {
        mcpServers: { 'm0-15-gate': server },
        permissionMode: 'default',
        maxTurns: 8,
        model: MODEL_A,
        // 승인을 붙잡고 있는 동안 = **턴이 확실히 in-flight** 인 창. 여기서 모델을 바꾼다.
        canUseTool: async (_toolName, input) => {
          await q.setModel(MODEL_B)
          setModelAt = 'during-tool-approval'
          await sleep(500)
          return { behavior: 'allow', updatedInput: input }
        },
      },
    })

    let turn = 1
    for await (const msg of q) {
      if (msg.type === 'assistant') {
        const blocks = msg.message?.content ?? []
        assistants.push({
          turn,
          model: msg.message?.model ?? null,
          hasToolUse: blocks.some((b) => b?.type === 'tool_use'),
          text: blocks.filter((b) => b?.type === 'text').map((b) => b.text).join('').slice(0, 60),
        })
        continue
      }
      // 턴 경계는 result (Q2 에서 배운 것 — assistant 로 세면 빈 프레임에 속는다)
      if (msg.type === 'result' && turn === 1) { turn = 2; pushTurn2(); continue }
      if (msg.type === 'result' && turn === 2) break
    }
    const t1 = assistants.filter((a) => a.turn === 1)
    const beforeTool = t1.find((a) => a.hasToolUse)
    const afterTool = t1.filter((a) => !a.hasToolUse).pop()
    const switchedMidTurn = isA(beforeTool?.model) && isB(afterTool?.model)
    // 🎯 F1: mid-turn 에 부른 setModel 이 **다음 턴에 적용되는가** (drop 되는가)
    const nextTurn = [...assistants].reverse().find((a) => a.turn === 2 && a.text.trim())
    const appliedNextTurn = isB(nextTurn?.model)
    record('Q2-b setModel-mid-turn', {
      setModelAt, assistants,
      beforeToolModel: beforeTool?.model ?? null,
      afterToolModel: afterTool?.model ?? null,
      switchedMidTurn,
      nextTurnModel: nextTurn?.model ?? null,
      appliedNextTurn,
    })

    // 전제: 툴 호출을 낸 요청은 A 여야 한다 (setModel 이 그 뒤에 불렸으므로).
    expect(isA(beforeTool?.model), `tool_use 요청은 ${MODEL_A} 여야 한다 (실측: ${beforeTool?.model})`).toBe(true)

    // 🎯 실측 결과(2026-07-16, sdk 0.3.207): **갈아타지 않는다.**
    //    tool 승인 중에 setModel(B) 를 불렀는데도 그 턴의 assistant 4개가 전부 A 였다.
    //
    // 🔴 이 green 이 "setModel 이 그냥 안 먹는다" 로 난 게 아님을 보증하는 건 **위 Q2 테스트**다:
    //    같은 API 가 턴 사이에서는 실제로 모델을 바꾼다(haiku→sonnet 실측). 즉 Q2 가 Q2-b 의
    //    **positive control** 이다. 둘이 같이 있어야 "in-flight 턴은 안 바뀐다" 가 의미를 갖는다.
    //    (Q2 가 red 로 바뀌면 이 테스트의 green 은 즉시 무의미해진다 — 그때 같이 보라.)
    //
    expect(isA(afterTool?.model), `in-flight 턴은 모델을 갈아타지 않아야 한다 (실측: ${afterTool?.model})`).toBe(true)
    expect(switchedMidTurn).toBe(false)

    // 🔴 F1 (적대 리뷰가 잡은 구멍): 위 두 assertion 만으로는 설계 결론을 낼 수 없다.
    //    "in-flight 턴 유지" 와 "그 setModel 이 다음 턴에 적용" 은 **다른 명제**이고,
    //    후자를 안 재면 "mid-turn setModel 은 drop 된다" 가 살아남는다.
    //      - 다음 턴이 B  → 지연 적용됨. 계약 일치 → pendingModel 장치 불필요.
    //      - 다음 턴이 A  → **drop**. 사용자가 바꿨는데 조용히 무시됨 → 경계 재호출 장치 **필요**.
    expect(nextTurn?.model, '다음 턴의 모델이 관측돼야 한다').toBeTruthy()
    expect(appliedNextTurn, `mid-turn setModel 이 다음 턴에 적용되는가 (실측: ${nextTurn?.model})`).toBe(true)
  }, 5 * 60 * 1000)

  /**
   * Q5 — abort 의미론. 핸드오프 질문은 **두 개**다: (1) 진행 중 턴이 중단되는가 (2) 중단 후 세션이 사는가.
   *
   * 🔵 **여기서 측정된 것은 (2) 뿐이다.** (1)은 **미측정** — 아래 `it.skip` 참조.
   *    나눠 놓은 이유: 한 테스트가 둘을 같이 주장하면, (2)의 green 이 (1)까지 증명한 것처럼 읽힌다.
   *    실제로 1차 버전이 정확히 그 상태였다(적대 리뷰 F6 이 잡음): "세션이 살아있다" 만 재놓고
   *    제목은 'abort 의미론' 이었다 — **interrupt 가 no-op 이어도 통과**하는 테스트였다.
   */
  it('Q5 🎯 interrupt() 는 receipt 를 주고, **세션이 죽지 않는다** (후속 턴이 답한다)', async () => {
    const events = []
    let interrupted = null
    let afterInterruptAnswered = null
    let streamError = null
    let pushNext

    const gate = new Promise((r) => { pushNext = r })
    async function* prompts() {
      yield { type: 'user', message: { role: 'user', content: 'Count slowly from 1 to 100, one number per line.' } }
      await gate
      yield { type: 'user', message: { role: 'user', content: 'Reply with exactly: AFTER_INTERRUPT_OK' } }
    }

    const q = query({ prompt: prompts(), options: { permissionMode: 'default', maxTurns: 8, model: MODEL_A } })
    try {
      for await (const msg of q) {
        events.push({ type: msg.type })
        if (msg.type === 'assistant' && !interrupted) {
          const receipt = await q.interrupt().catch((e) => ({ error: String(e?.message || e) }))
          interrupted = { receipt: receipt ?? null }
          pushNext()
          continue
        }
        if (msg.type === 'assistant' && interrupted) {
          const text = (msg.message?.content ?? []).filter((b) => b?.type === 'text').map((b) => b.text).join('')
          if (text.includes('AFTER_INTERRUPT_OK')) { afterInterruptAnswered = true; break }
        }
      }
    } catch (e) {
      streamError = String(e?.message || e)
    }
    record('Q5 interrupt-then-continue', {
      interrupted, afterInterruptAnswered, streamError,
      eventTypes: events.map((e) => e.type),
    })
    // 🎯 실측: receipt `{still_queued: []}` (CLI 가 `interrupt_receipt_v1` 광고) + 세션 생존.
    //    Codex 의 turn/interrupt 후 thread 가 살아있는 것과 같은 성질 → close/reopen 없이 Stop 후 계속 가능.
    expect(interrupted, 'interrupt() 호출 자체는 되어야 한다').toBeTruthy()
    expect(streamError, 'interrupt 가 stream 을 에러로 죽이면 안 된다').toBeNull()
    expect(afterInterruptAnswered, 'interrupt 후에도 세션이 살아 후속 턴에 답해야 한다').toBe(true)
    // ⚠️ 여기서 "턴이 잘렸다" 는 **주장하지 않는다.** 아래 skip 이 그 이유다.
  }, 5 * 60 * 1000)

  /**
   * 🔴 **미측정 (핸드오프 §2.3 Q5 의 절반). 스펙에서 "중단된다" 고 단정하지 말 것.**
   *
   * 두 번 시도했고 둘 다 **관측에 실패**했다 (같은 함정을 다시 파지 않도록 기록):
   *   1) "1..100 세게 하고 100 미만이면 잘린 것" →
   *      (a) 빈 assistant 프레임을 보고 끊어 `countedTo:null` = **관측 실패가 green** 이 됐다.
   *      (b) 고쳤더니 `countedTo:100` — 모델이 1..100 을 **한 assistant 메시지에 통째로** 보낸다.
   *          우리가 그 메시지를 볼 땐 이미 텍스트가 끝났다 → 이 설계로는 mid-turn 을 못 끊는다.
   *   2) "툴 6회 호출 중 Stop → 나머지 호출이 안 난다" → interrupt 후 스트림이 후속 턴을 내지 않아
   *      **10분 타임아웃**. record 도 못 남겼다.
   *
   * 다음 시도 후보: `includePartialMessages: true` 로 **partial stream event** 를 받아 스트리밍
   * 도중에 끊고, 그 턴의 최종 텍스트/`result` 가 잘렸는지 본다. (SDKResultMessage 에는 'interrupted'
   * 전용 subtype 이 없어 보인다 — success/error 뿐이라 subtype 만으론 판정이 안 된다.)
   *
   * 제품 영향: Stop 버튼의 **"진행 중 턴이 실제로 멈춘다"** 는 Claude 경로에서 아직 **증명 안 됨**.
   * (Codex 경로는 m0-10/m2 에서 turn/interrupt 로 확인됨.) 세션 생존만 확인됐다.
   */
  it.skip('🔴 [미측정] interrupt() 가 진행 중 턴을 실제로 절단하는가 (관측 방법 미확립)', () => {})

})
