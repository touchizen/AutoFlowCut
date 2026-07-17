/**
 * M0-16 — Claude Agent SDK steer 계약 (HANDOFF §2.3 Q7).
 *
 * **코드 저작이 아니라 측정이다.** 결과가 나중의 claudeOrchestrator 설계를 정한다.
 * 제품 코드(`src/`, `electron/`)는 이 파일에서 import 하거나 변경하지 않는다.
 *
 * 🎯 미측정이던 한 조각만 잰다: 실행 중인 Claude turn 에 두 번째 user message 를 넣으면
 *   1) 현재 turn 에 합쳐지는가, 다음 turn 으로 queue 되는가, 아니면 거부되는가
 *   2) Codex `expectedTurnId` 같은 race guard 가 SDK 표면에 있는가
 *   3) 주입 시점에 실행 중이던 tool call 이 살아남는가
 *   4) 주입한 nonce 가 실제 모델 출력에 도달하며, 어느 turn 에서 회수되는가
 *
 * 🔴 vacuous green 방지:
 *   - "에러가 없었다"로는 통과하지 않는다. 매 run 고유 nonce 를 만들고 assistant/result 출력에서
 *     회수 여부와 turn 을 기록한다. **미회수 자체는 SDK의 답일 수 있으므로 실패 조건이 아니다.**
 *   - 첫 result 뒤 같은 session 에 nonce 를 언급하지 않는 neutral follow-up 을 보내고, 별도 fixed token 을
 *     회수해야 한다. 그래야 nonce 미회수를 "다음 turn 이 없었다"와 혼동하지 않는다(m0-15 F1 교훈).
 *   - 한 번에 끝나는 텍스트 turn 을 재지 않는다. 제품 모양처럼 MCP tool 을 3회 호출시키고,
 *     첫 tool body 를 test-owned promise 로 붙잡은 동안 두 번째 user message 를 write 한다.
 *   - write 뒤에도 750ms 동안 body 를 붙잡아, 주입과 in-flight tool window 가 실제로 겹치게 한다.
 *
 * `injectionFate` 는 SDK 답을 PASS/FAIL 로 만들지 않고 first-class observation 으로 남긴다:
 *   joined-in-flight = nonce 가 원래 turn 에 나타남
 *   queued-next-turn = nonce 가 뒤 turn 에 나타남
 *   dropped          = 원래 3-step turn 과 neutral 후속 turn 은 완주했지만 nonce 는 끝내 안 나타남
 *   preempted-turn   = 주입 뒤 첫 result 가 outstanding tool body 종료보다 먼저 와 원래 turn 을 절단함
 *   undetermined     = 위 판정에 필요한 관측 장치가 닫히지 않음 (이 경우만 red)
 *
 * `priority` 를 생략한 일반 streaming input 과 SDKUserMessage 가 노출하는 `priority:'now'` 를
 * 같은 조건에서 각각 잰다. 둘 중 하나를 제품 설계로 선택하는 것은 이 스파이크의 일이 아니다.
 *
 * ⚠️ 이 스파이크는 개발자 개인 `~/.claude` 를 그대로 쓴다. SessionStart hook 이 추가 content 를
 * 주입하는 것이 raw 에서 이미 관측됐고, Codex 쪽 CODEX_HOME 격리에 대응하는 Claude 격리 수단은
 * 여기 없다. 따라서 개인 hook 은 **통제되지 않은 변수**다. 실제 Claude CLI 구독 자격증명과
 * 네트워크도 사용한다.
 *
 * `npm run test:spike -- tests/spike/m0-16.claudeSteerContract.spike.test.js` 로만 돈다.
 */
import { describe, it, expect, afterEach } from 'vitest'
import { z } from 'zod'
import { appendFileSync, mkdirSync, readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { query, createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk'

const RESULT_DIR = 'docs/superpowers/specs'
const RAW = `${RESULT_DIR}/m0-16-raw.jsonl`
const TOOL_NAME = 'mcp__m0-16-steer__sequence_step'
const SDK_DTS = readFileSync(
  new URL('../../node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts', import.meta.url),
  'utf-8',
)
const SDK_VERSION = JSON.parse(readFileSync(
  new URL('../../node_modules/@anthropic-ai/claude-agent-sdk/package.json', import.meta.url),
  'utf-8',
)).version

// provenance 스탬프 — mutant run 과 진짜 run 을 raw 자체에서 구분한다(m0-14/15 규율).
const gitSha = (() => {
  try { return execFileSync('git', ['rev-parse', '--short', 'HEAD'], { encoding: 'utf-8' }).trim() } catch { return null }
})()
const gitDirty = (() => {
  try { return execFileSync('git', ['status', '--porcelain'], { encoding: 'utf-8' }).trim().length > 0 } catch { return null }
})()

const record = (label, data) => {
  mkdirSync(RESULT_DIR, { recursive: true })
  appendFileSync(RAW, JSON.stringify({
    runId: process.env.SPIKE_RUN_ID ?? null,
    gitSha,
    gitDirty,
    mutant: process.env.SPIKE_MUTANT ?? null,
    sdkVersion: SDK_VERSION,
    label,
    ...data,
  }) + '\n')
}

// assertion 전에 쓴 observation 과 runner exit 사이의 증거 체인을 닫는다.
afterEach((ctx) => {
  record('__verdict__', { test: ctx?.task?.name ?? '(?)', verdict: ctx?.task?.result?.state ?? 'unknown' })
})

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const textOf = (blocks) => (Array.isArray(blocks) ? blocks : [])
  .filter((block) => block?.type === 'text')
  .map((block) => block.text)
  .join('')

async function measureMidTurnInjection({ priority }) {
  const startedAt = Date.now()
  const at = () => Date.now() - startedAt
  const nonce = `CLAUDE_STEER_M0_16_${Date.now().toString(36).toUpperCase()}_${process.pid}`
  const original = `CLAUDE_ORIGINAL_M0_16_${randomUUID().replaceAll('-', '').slice(0, 12).toUpperCase()}`
  const followUpToken = `CLAUDE_FOLLOWUP_M0_16_${randomUUID().replaceAll('-', '').slice(0, 12).toUpperCase()}`
  const initialMessageUuid = randomUUID()
  const injectedMessageUuid = randomUUID()
  const followUpMessageUuid = randomUUID()
  const toolCalls = []
  const terminalToolResults = []
  const assistants = []
  const results = []
  const events = []
  let injectionYieldedAt = null
  let injectionWrittenAt = null
  let firstToolStartedAt = null
  let firstToolReleasedAt = null
  let followUpYieldedAt = null
  let followUpWrittenAt = null
  let streamError = null
  let timedOut = false

  let signalFirstToolStarted
  const firstToolStarted = new Promise((resolve) => { signalFirstToolStarted = resolve })
  let stopPromptInput
  const promptInputStopped = new Promise((resolve) => { stopPromptInput = resolve })
  let releaseFirstTool
  const firstToolGate = new Promise((resolve) => { releaseFirstTool = resolve })
  let signalFirstTurnEnded
  const firstTurnEnded = new Promise((resolve) => { signalFirstTurnEnded = resolve })

  const server = createSdkMcpServer({
    name: 'm0-16-steer',
    version: '0.0.1',
    tools: [
      tool(
        'sequence_step',
        'Runs one numbered sequence step. Call it exactly once for each requested step, in order.',
        { step: z.number().int().min(1).max(3) },
        async ({ step }) => {
          const call = { ordinal: toolCalls.length + 1, step, startedAt: at(), endedAt: null }
          toolCalls.push(call)
          if (call.ordinal === 1) {
            firstToolStartedAt = call.startedAt
            signalFirstToolStarted()
            await firstToolGate
          }
          call.endedAt = at()
          return { content: [{ type: 'text', text: `SEQUENCE_STEP_OK:${step}:CALL_${call.ordinal}` }] }
        },
        // m0-5 실측: SDK MCP tool 은 기본 deferred 라 alwaysLoad 없이는 실행 관측이 vacuous 해진다.
        { alwaysLoad: true },
      ),
    ],
  })

  async function* prompts() {
    yield {
      type: 'user',
      uuid: initialMessageUuid,
      message: {
        role: 'user',
        content:
          `Call ${TOOL_NAME} exactly three times sequentially, with step 1, then 2, then 3. `
          + `Do not skip any call. After all three tool results, reply with exactly ${original} and nothing else.`,
      },
    }

    // tool body 내부 신호이므로 이 gate 가 열리면 "모델이 tool_use 를 말했다"가 아니라 실제 body 실행 중이다.
    // 인증 실패/모델 거부처럼 tool 이 시작되기 전에 result 가 오면 generator 도 즉시 닫는다.
    // 이 탈출구가 없으면 결과는 1초 만에 왔어도 이 await 때문에 5분 deadline 까지 매달린다.
    const gateOutcome = await Promise.race([
      firstToolStarted.then(() => 'tool-started'),
      promptInputStopped.then(() => 'input-stopped'),
    ])
    if (gateOutcome === 'input-stopped') return
    injectionYieldedAt = at()
    yield {
      type: 'user',
      uuid: injectedMessageUuid,
      ...(priority ? { priority } : {}),
      message: {
        role: 'user',
        content:
          `Live correction. Keep the in-flight call alive and still complete sequence steps 1, 2, and 3 exactly once. `
          + `If all steps already finished, do not repeat them. Change only the final reply: output exactly ${nonce} and nothing else.`,
      },
    }
    // async generator 가 resume 됐다는 것은 Query.streamInput 이 위 message 의 transport.write 를 await 한 뒤
    // 다음 item 을 요청했다는 뜻이다. 이 시점에도 tool body 를 750ms 더 붙잡는다.
    injectionWrittenAt = at()
    await sleep(750)
    firstToolReleasedAt = at()
    releaseFirstTool()

    // 첫 result 가 곧 제품의 turn 경계다. 같은 Query/session 을 닫지 않고 neutral 후속 turn 을 민다.
    const followUpOutcome = await Promise.race([
      firstTurnEnded.then(() => 'first-turn-ended'),
      promptInputStopped.then(() => 'input-stopped'),
    ])
    if (followUpOutcome === 'input-stopped') return
    followUpYieldedAt = at()
    yield {
      type: 'user',
      uuid: followUpMessageUuid,
      message: {
        role: 'user',
        // nonce 를 언급하거나 회수를 요구하면 queue/drop 판정을 test prompt 가 오염시킨다.
        content: `This is a separate neutral follow-up. Reply with exactly ${followUpToken} and nothing else.`,
      },
    }
    followUpWrittenAt = at()
  }

  const q = query({
    prompt: prompts(),
    options: {
      mcpServers: { 'm0-16-steer': server },
      tools: [TOOL_NAME],
      allowedTools: [TOOL_NAME],
      permissionMode: 'bypassPermissions',
      allowDangerouslySkipPermissions: true,
      maxTurns: 12,
      model: 'sonnet',
    },
  })

  const querySurface = {
    streamInput: typeof q.streamInput,
    steer: typeof q.steer,
    interrupt: typeof q.interrupt,
    cancelAsyncMessage: typeof q.cancelAsyncMessage,
  }

  const timeout = setTimeout(() => {
    timedOut = true
    stopPromptInput()
    releaseFirstTool?.()
    q.close()
  }, 5 * 60 * 1000)

  let turn = 1
  try {
    for await (const msg of q) {
      const event = {
        at: at(),
        turn,
        type: msg.type,
        subtype: msg.subtype ?? null,
        uuid: msg.uuid ?? null,
        sessionId: msg.session_id ?? null,
      }

      if (msg.type === 'assistant') {
        const blocks = msg.message?.content ?? []
        const assistant = {
          at: event.at,
          turn,
          uuid: msg.uuid ?? null,
          model: msg.message?.model ?? null,
          text: textOf(blocks),
          toolUses: blocks
            .filter((block) => block?.type === 'tool_use')
            .map((block) => ({ id: block.id, name: block.name, input: block.input })),
        }
        assistants.push(assistant)
        event.text = assistant.text
        event.toolUses = assistant.toolUses
      }

      const blocks = msg?.message?.content
      if (Array.isArray(blocks)) {
        for (const block of blocks) {
          if (block?.type !== 'tool_result') continue
          const terminal = {
            at: event.at,
            turn,
            toolUseId: block.tool_use_id ?? null,
            isError: block.is_error === true,
            text: JSON.stringify(block.content),
          }
          terminalToolResults.push(terminal)
          event.toolResult = terminal
        }
      }

      if (msg.type === 'result') {
        if (firstToolStartedAt == null) stopPromptInput()
        const result = {
          at: event.at,
          turn,
          subtype: msg.subtype,
          isError: msg.is_error,
          result: msg.result ?? null,
          uuid: msg.uuid ?? null,
          identifierKeys: Object.keys(msg).filter((key) => /(?:id|uuid|turn)/i.test(key)),
        }
        results.push(result)
        if (turn === 1 && firstToolStartedAt != null) signalFirstTurnEnded()
        event.result = msg.result ?? null
        events.push(event)
        turn += 1
        continue
      }
      events.push(event)
    }
  } catch (error) {
    streamError = String(error?.message || error)
    stopPromptInput()
  } finally {
    clearTimeout(timeout)
    stopPromptInput()
    releaseFirstTool?.()
    q.close()
  }

  const turnsContaining = (token) => [...new Set([
    ...assistants.filter((message) => message.text.includes(token)).map((message) => message.turn),
    ...results.filter((message) => message.result?.includes(token)).map((message) => message.turn),
  ])]
  const recoveredTurns = turnsContaining(nonce)
  const originalTurns = turnsContaining(original)
  const followUpRecoveredTurns = turnsContaining(followUpToken)
  const firstCall = toolCalls[0] ?? null
  const injectionOverlappedFirstTool = Boolean(
    firstCall
    && injectionWrittenAt != null
    && firstCall.startedAt <= injectionWrittenAt
    && firstCall.endedAt >= injectionWrittenAt,
  )
  const firstToolResult = firstCall
    ? terminalToolResults.find((result) => result.text.includes(`SEQUENCE_STEP_OK:${firstCall.step}:CALL_${firstCall.ordinal}`)) ?? null
    : null
  const firstInFlightToolSurvived = Boolean(firstCall?.endedAt != null && firstToolResult && !firstToolResult.isError)
  const successfulSequenceToolResults = terminalToolResults.filter((result) => (
    !result.isError && result.text.includes('SEQUENCE_STEP_OK:')
  ))
  const toolSteps = toolCalls.map((call) => call.step)
  const originalToolSequenceCompleted = (
    JSON.stringify(toolSteps) === JSON.stringify([1, 2, 3])
    && toolCalls.every((call) => call.endedAt != null)
    && successfulSequenceToolResults.length === 3
  )
  const firstResult = results[0] ?? null
  const originalTurnEndedWhileFirstToolOutstanding = Boolean(
    firstResult
    && firstCall
    && injectionWrittenAt != null
    && firstResult.at >= injectionWrittenAt
    && firstToolReleasedAt != null
    // test-owned gate를 풀기 전에 result가 왔으므로 body는 정의상 아직 outstanding이다.
    && firstResult.at < firstToolReleasedAt,
  )
  const followUpObserved = followUpRecoveredTurns.some((recoveredTurn) => recoveredTurn > 1)

  let injectionFate = 'undetermined'
  if (injectionOverlappedFirstTool && followUpObserved && results.length >= 2) {
    if (originalTurnEndedWhileFirstToolOutstanding) injectionFate = 'preempted-turn'
    else if (recoveredTurns.includes(1)) injectionFate = 'joined-in-flight'
    else if (recoveredTurns.some((recoveredTurn) => recoveredTurn > 1)) injectionFate = 'queued-next-turn'
    else if (originalToolSequenceCompleted) injectionFate = 'dropped'
  }

  const fateEvidence = {
    nonceRecovered: recoveredTurns.length > 0,
    recoveredTurns,
    originalTurns,
    followUpObserved,
    followUpRecoveredTurns,
    originalToolSequenceCompleted,
    originalTurnEndedWhileFirstToolOutstanding,
    firstInFlightToolSurvived,
    toolSteps,
    successfulSequenceToolResultCount: successfulSequenceToolResults.length,
    turnCount: results.length,
    resultTurns: results.map((result) => ({ turn: result.turn, at: result.at, subtype: result.subtype, isError: result.isError })),
  }

  return {
    priority: priority ?? null,
    nonce,
    original,
    followUpToken,
    initialMessageUuid,
    injectedMessageUuid,
    followUpMessageUuid,
    querySurface,
    sdkExposesExpectedTurnIdGuard: querySurface.steer === 'function',
    resultIdentifierKeys: [...new Set(results.flatMap((result) => result.identifierKeys))],
    timing: {
      firstToolStartedAt,
      injectionYieldedAt,
      injectionWrittenAt,
      firstToolReleasedAt,
      firstToolEndedAt: firstCall?.endedAt ?? null,
      firstResultAt: firstResult?.at ?? null,
      followUpYieldedAt,
      followUpWrittenAt,
    },
    injectionOverlappedFirstTool,
    injectionFate,
    fateEvidence,
    recoveredTurns,
    originalTurns,
    followUpRecoveredTurns,
    nonceRecovered: recoveredTurns.length > 0,
    followUpObserved,
    originalToolSequenceCompleted,
    toolCalls,
    terminalToolResults,
    firstInFlightToolSurvived,
    turnCount: results.length,
    resultCount: results.length,
    executionErrors: results.filter((result) => result.isError).map((result) => result.result),
    results,
    assistants,
    streamError,
    timedOut,
    events,
  }
}

describe('M0-16 — Claude Agent SDK steer 계약 (Q7)', () => {
  it('Q7-2: 공개 Query/SDKUserMessage 표면에 turn-targeted steer race guard가 있는가', () => {
    async function* noPrompts() {}
    const q = query({ prompt: noPrompts(), options: { maxTurns: 1 } })
    const queryDeclaration = SDK_DTS.slice(
      SDK_DTS.indexOf('export declare interface Query extends'),
      SDK_DTS.indexOf('export declare function query('),
    )
    const userMessageDeclaration = SDK_DTS.slice(
      SDK_DTS.indexOf('export declare type SDKUserMessage ='),
      SDK_DTS.indexOf('export declare type SDKUserMessageReplay ='),
    )
    const observation = {
      querySurface: {
        streamInput: typeof q.streamInput,
        steer: typeof q.steer,
        interrupt: typeof q.interrupt,
        cancelAsyncMessage: typeof q.cancelAsyncMessage,
      },
      queryDeclarationHasSteer: /\bsteer\s*\(/.test(queryDeclaration),
      queryDeclarationHasExpectedTurnId: /\bexpected(?:TurnId|_turn_id)\b/.test(queryDeclaration),
      userMessageFields: [...userMessageDeclaration.matchAll(/^\s{4}([A-Za-z_][A-Za-z0-9_]*)\??:/gm)]
        .map((match) => match[1]),
      userMessageHasTurnTarget: /\b(?:expectedTurnId|expected_turn_id|turnId|turn_id)\b/.test(userMessageDeclaration),
    }
    q.close()
    record('Q7 race-guard API surface', observation)

    expect(observation.querySurface.streamInput).toBe('function')
    expect(observation.querySurface.steer).toBe('undefined')
    expect(observation.queryDeclarationHasSteer).toBe(false)
    expect(observation.queryDeclarationHasExpectedTurnId).toBe(false)
    expect(observation.userMessageHasTurnTarget).toBe(false)
    // 메시지 UUID/priority 는 있지만 active turn id precondition 은 아니다.
    expect(observation.userMessageFields).toContain('uuid')
    expect(observation.userMessageFields).toContain('priority')
  })

  for (const arm of [
    { label: 'priority 생략', priority: null },
    { label: "priority:'now'", priority: 'now' },
  ]) {
    it(`${arm.label}: in-flight tool 중 user message 주입의 실제 의미론`, async () => {
      const observation = await measureMidTurnInjection({ priority: arm.priority })
      record(`Q7 mid-turn injection (${arm.label})`, observation)

      // assertion 은 SDK가 어떤 semantics 를 택했는지가 아니라 관측 장치가 실제로 닫혔는지만 본다.
      expect(observation.timedOut, '측정이 timeout 으로 끝났다').toBe(false)
      expect(observation.timing.firstToolStartedAt, '실제 tool body 가 한 번도 시작되지 않았다').not.toBeNull()
      expect(observation.timing.injectionWrittenAt, '주입 message 의 transport.write 완료를 관측하지 못했다').not.toBeNull()
      expect(observation.injectionOverlappedFirstTool, '주입 write 와 in-flight tool 실행이 겹치지 않았다').toBe(true)
      expect(observation.timing.followUpWrittenAt, '첫 result 뒤 neutral follow-up 을 write 하지 못했다').not.toBeNull()
      expect(observation.followUpObserved, 'neutral follow-up token 을 뒤 turn 에서 회수하지 못했다').toBe(true)
      expect(observation.turnCount, '후속 turn 경계를 관측하지 못했다').toBeGreaterThanOrEqual(2)
      expect(observation.injectionFate, '주입 의미론을 판정하지 못했다').not.toBe('undetermined')
    }, 8 * 60 * 1000)
  }
})
