/**
 * M0-17 — Claude Agent SDK direct interrupt 계약 (Q8).
 *
 * **코드 저작이 아니라 측정이다.** 결과가 나중의 claudeOrchestrator 설계를 정한다.
 * 제품 코드(`src/`, `electron/`)는 이 파일에서 import 하거나 변경하지 않는다.
 *
 * 🔵 이미 측정된 것은 다시 재지 않는다:
 *   - m0-15 Q5: `interrupt()` receipt 는 `{still_queued:[]}`였고 후속 turn 이 답했다. 즉 session 생존.
 *     하지만 in-flight turn 절단과 interrupt 뒤 MCP tool 생존은 측정하지 못했다.
 *   - m0-2: `type:'sdk'` MCP bridge 의 `MCP_TOOL_TIMEOUT`은 hard bound 다. 12분 arm 은 이 값을
 *     30분으로 올렸을 때만 성립했다.
 *   - m0-16: `priority:'now'` message injection 경로를 측정했다. 이 파일은 그 경로를 쓰지 않고
 *     Query의 `interrupt()`를 직접 호출한다.
 *
 * 🎯 여기서 재는 Q8:
 *   1) tool 여러 회를 요구한 in-flight turn 이 direct `interrupt()` 뒤 실제로 잘리는가
 *   2) interrupt 당시 실행 중이던 tool call 은 abort signal/tool_result 에서 어떻게 보이는가
 *   3) 같은 session 의 fresh turn 에서 in-process MCP tool 세 번이 실제로 다시 동작하는가
 *   4) 잘린 turn 의 **전체 result surface** 는 무엇인가
 *   5) `interrupt()` receipt 전체 surface 는 무엇인가
 *
 * 🔴 m0-16의 초기 "Stream closed" 관측에 있던 gate confound를 Q3에서 제거한다:
 *   - 첫 turn 의 첫 tool body만 test-owned promise로 gate한다. body **안에서** 시작을 신호하므로
 *     interrupt가 실제 body 실행과 겹쳤다는 것을 안다.
 *   - `interrupt()`가 settle하면 gate를 즉시 풀고, 그 첫 body가 완전히 종료된 뒤에만 fresh turn을 쓴다.
 *   - fresh turn의 tool body 세 개는 전부 **UNGATED**다. `oldBodySettledBeforeFreshTurn`과 각 call의
 *     `gateWaited:false`를 raw에 남긴다. 따라서 fresh call 실패를 fresh-side test gate로 설명할 수 없다.
 *
 * 🔴 vacuous answer / timeout 오독 방지:
 *   - "throw하지 않았다"는 alive 증거가 아니다. fresh turn은 고유 token을 모델 출력으로 echo해야 하고,
 *     tool_use 세 개 및 대응 tool_result 세 개를 실제로 관측해야 `bridgeAfterInterrupt:'alive'`다.
 *   - tool_use 세 개 모두의 tool_result가 "Stream closed"일 때만 `dead`다. 그 밖의 불완전/혼합 표면은
 *     `mixed` 또는 `undetermined`로 남긴다.
 *   - MEASUREMENT_DEADLINE_MS는 it() timeout보다 작다. deadline이면 `timedOut:true`와 중간 관측을
 *     먼저 raw에 쓴다. timeout은 Q8의 답이 아니므로 fate는 `undetermined`다.
 *   - assertion은 SDK semantics가 아니라 관측 장치가 닫혔는지만 확인한다. cut/not-cut 및
 *     alive/dead는 모두 유효한 측정 결과다.
 *
 * ⚠️ 이 스파이크는 개발자 개인 `~/.claude`를 그대로 쓴다. SessionStart hook이 content를 주입하는
 * 것이 이미 관측됐고, Codex-side CODEX_HOME 격리에 대응하는 Claude 격리 수단은 없다. 개인 hook은
 * 통제되지 않은 변수다. 실제 Claude CLI 구독 자격증명과 네트워크도 사용한다.
 *
 * `npm run test:spike -- tests/spike/m0-17.claudeInterruptContract.spike.test.js` 로만 돈다.
 */
import { describe, it, expect, afterEach } from 'vitest'
import { z } from 'zod'
import { appendFileSync, mkdirSync, readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { query, createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk'

const RESULT_DIR = 'docs/superpowers/specs'
const RAW = `${RESULT_DIR}/m0-17-raw.jsonl`
const TOOL_NAME = 'mcp__m0-17-interrupt__sequence_step'
const MCP_TOOL_TIMEOUT_MS = 30 * 60 * 1000
// 반드시 it()의 8분 timeout보다 작아야 timeout도 raw observation으로 닫힌다.
const MEASUREMENT_DEADLINE_MS = 7 * 60 * 1000
const SDK_VERSION = JSON.parse(readFileSync(
  new URL('../../node_modules/@anthropic-ai/claude-agent-sdk/package.json', import.meta.url),
  'utf-8',
)).version

// mutant run과 진짜 run을 raw 자체에서 구분한다(m0-14/15/16 provenance 규율).
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

// assertion 전 observation과 runner exit 사이의 증거 체인을 닫는다.
afterEach((ctx) => {
  record('__verdict__', { test: ctx?.task?.name ?? '(?)', verdict: ctx?.task?.result?.state ?? 'unknown' })
})

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const textOf = (blocks) => (Array.isArray(blocks) ? blocks : [])
  .filter((block) => block?.type === 'text')
  .map((block) => block.text)
  .join('')

const errorSurface = (error) => error == null
  ? null
  : {
      name: typeof error === 'object' ? error.name ?? null : null,
      message: String(typeof error === 'object' ? error.message ?? error : error),
      code: typeof error === 'object' ? error.code ?? null : null,
    }

const snapshot = (value) => {
  if (value === undefined) return { $type: 'undefined' }
  try { return JSON.parse(JSON.stringify(value)) } catch (error) {
    return { $type: 'unserializable', error: errorSurface(error) }
  }
}

const sortedSteps = (items, stepOf) => items.map(stepOf).sort((a, b) => a - b)
const isExpectedSteps = (steps) => JSON.stringify(steps) === JSON.stringify([1, 2, 3])

async function measureDirectInterrupt() {
  const startedAt = Date.now()
  const at = () => Date.now() - startedAt
  const cutCompletionToken = `M0_17_CUT_COMPLETED_${randomUUID().replaceAll('-', '').slice(0, 12).toUpperCase()}`
  const freshEchoToken = `M0_17_FRESH_ECHO_${randomUUID().replaceAll('-', '').slice(0, 12).toUpperCase()}`
  const toolCalls = []
  const assistants = []
  const terminalToolResults = []
  const results = []
  const events = []

  let firstToolStartedAt = null
  let firstToolGateReleasedAt = null
  let firstToolBodySettledAt = null
  let interruptCalledAt = null
  let interruptSettledAt = null
  let interruptReceipt = null
  let interruptError = null
  let freshTurnYieldedAt = null
  let freshTurnWrittenAt = null
  let streamEndedAt = null
  let streamError = null
  let timedOut = false
  let queryClosedByDeadline = false

  let signalFirstToolStarted
  const firstToolStarted = new Promise((resolve) => { signalFirstToolStarted = resolve })
  let releaseFirstTool
  const firstToolGate = new Promise((resolve) => { releaseFirstTool = resolve })
  let signalFirstToolBodySettled
  const firstToolBodySettled = new Promise((resolve) => { signalFirstToolBodySettled = resolve })
  let signalCutTurnEnded
  const cutTurnEnded = new Promise((resolve) => { signalCutTurnEnded = resolve })
  let stopPromptInput
  const promptInputStopped = new Promise((resolve) => { stopPromptInput = resolve })

  const server = createSdkMcpServer({
    name: 'm0-17-interrupt',
    version: '0.0.1',
    tools: [
      tool(
        'sequence_step',
        'Runs one numbered step. Call it exactly as many times and with the phase requested by the user.',
        { phase: z.enum(['cut', 'fresh']), step: z.number().int().min(1).max(3) },
        async ({ phase, step }, extra) => {
          const phaseOrdinal = toolCalls.filter((call) => call.phase === phase).length + 1
          const gateWaited = phase === 'cut' && phaseOrdinal === 1
          const signal = extra && typeof extra === 'object' && 'signal' in extra ? extra.signal : null
          const call = {
            ordinal: toolCalls.length + 1,
            phaseOrdinal,
            phase,
            step,
            startedAt: at(),
            endedAt: null,
            gateWaited,
            gateExitedAt: null,
            extraKeys: extra && typeof extra === 'object' ? Object.keys(extra) : [],
            signalPresent: Boolean(signal && typeof signal.addEventListener === 'function'),
            signalAbortedAtStart: signal?.aborted === true,
            signalAbortedAt: null,
            signalAbortReason: null,
            bodyOutcome: 'running',
            bodyError: null,
          }
          toolCalls.push(call)

          const onAbort = () => {
            call.signalAbortedAt ??= at()
            call.signalAbortReason ??= errorSurface(signal?.reason)
          }
          signal?.addEventListener?.('abort', onAbort, { once: true })

          try {
            if (gateWaited) {
              firstToolStartedAt = call.startedAt
              signalFirstToolStarted()
              await firstToolGate
              call.gateExitedAt = at()
            }
            const token = phase === 'fresh' ? freshEchoToken : cutCompletionToken
            call.bodyOutcome = 'returned'
            return { content: [{ type: 'text', text: `M0_17_TOOL_OK:${phase}:${step}:${token}` }] }
          } catch (error) {
            call.bodyOutcome = 'threw'
            call.bodyError = errorSurface(error)
            throw error
          } finally {
            // abort event와 gate resume가 같은 tick에 경쟁해도 final signal state를 놓치지 않는다.
            if (signal?.aborted === true) onAbort()
            signal?.removeEventListener?.('abort', onAbort)
            call.endedAt = at()
            if (gateWaited) {
              firstToolBodySettledAt = call.endedAt
              signalFirstToolBodySettled()
            }
          }
        },
        // m0-5 실측: SDK MCP tool은 기본 deferred라 alwaysLoad 없이는 body 관측이 vacuous해진다.
        { alwaysLoad: true },
      ),
    ],
  })

  async function* prompts() {
    yield {
      type: 'user',
      message: {
        role: 'user',
        content:
          `Call ${TOOL_NAME} exactly three times sequentially. `
          + 'Use {"phase":"cut","step":1}, then step 2, then step 3, and wait for each result before the next call. '
          + `After all three results, reply with exactly ${cutCompletionToken} and nothing else.`,
      },
    }

    const cutOutcome = await Promise.race([
      cutTurnEnded.then(() => 'cut-turn-ended'),
      promptInputStopped.then(() => 'input-stopped'),
    ])
    if (cutOutcome === 'input-stopped') return

    // m0-16의 confound를 fresh turn으로 운반하지 않는다: old gated body가 완전히 끝나야 다음 input을 쓴다.
    const bodyOutcome = await Promise.race([
      firstToolBodySettled.then(() => 'body-settled'),
      promptInputStopped.then(() => 'input-stopped'),
    ])
    if (bodyOutcome === 'input-stopped') return

    freshTurnYieldedAt = at()
    yield {
      type: 'user',
      message: {
        role: 'user',
        content:
          `Fresh turn. In one assistant response, issue exactly three ${TOOL_NAME} tool calls so all three attempts exist before any result is interpreted. `
          + 'Use {"phase":"fresh","step":1}, {"phase":"fresh","step":2}, and {"phase":"fresh","step":3}. '
          + `Every fresh tool body is ungated. After all three tool results, reply with exactly ${freshEchoToken} and nothing else.`,
      },
    }
    // async generator resume = Query.streamInput이 위 message의 transport.write를 끝내고 다음 item을 요청함.
    freshTurnWrittenAt = at()
  }

  // m0-2의 장기-call arm과 같은 명시적 bound. 프로세스 전역이므로 반드시 원복하고 그 사실을 기록한다.
  const previousMcpToolTimeout = Object.hasOwn(process.env, 'MCP_TOOL_TIMEOUT')
    ? process.env.MCP_TOOL_TIMEOUT
    : null
  process.env.MCP_TOOL_TIMEOUT = String(MCP_TOOL_TIMEOUT_MS)
  let mcpToolTimeoutRestored = false
  let restoredMcpToolTimeout = null

  let q = null
  let interruptTask = null
  let deadline = null
  let turn = 1
  try {
    q = query({
      prompt: prompts(),
      options: {
        mcpServers: { 'm0-17-interrupt': server },
        tools: [TOOL_NAME],
        allowedTools: [TOOL_NAME],
        permissionMode: 'bypassPermissions',
        allowDangerouslySkipPermissions: true,
        maxTurns: 12,
        model: 'sonnet',
      },
    })

    // direct interrupt의 유일한 호출 지점. priority:'now' message injection은 전혀 쓰지 않는다.
    interruptTask = (async () => {
      const startOutcome = await Promise.race([
        firstToolStarted.then(() => 'tool-started'),
        promptInputStopped.then(() => 'input-stopped'),
      ])
      if (startOutcome === 'input-stopped') return
      interruptCalledAt = at()
      try {
        interruptReceipt = snapshot(await q.interrupt())
      } catch (error) {
        interruptError = errorSurface(error)
      } finally {
        interruptSettledAt = at()
        // receipt 뒤 test-owned hold를 남기지 않는다. body가 settle한 뒤에만 fresh turn이 시작된다.
        firstToolGateReleasedAt = at()
        releaseFirstTool()
      }
    })()

    deadline = setTimeout(() => {
      timedOut = true
      queryClosedByDeadline = true
      stopPromptInput()
      releaseFirstTool()
      q.close()
    }, MEASUREMENT_DEADLINE_MS)

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
          sessionId: msg.session_id ?? null,
          text: textOf(blocks),
          toolUses: blocks
            .filter((block) => block?.type === 'tool_use')
            .map((block) => ({ id: block.id, name: block.name, input: snapshot(block.input) })),
        }
        assistants.push(assistant)
        event.text = assistant.text
        event.toolUses = assistant.toolUses
      }

      const blocks = msg?.message?.content
      if (Array.isArray(blocks)) {
        event.toolResults = []
        for (const block of blocks) {
          if (block?.type !== 'tool_result') continue
          const text = JSON.stringify(block.content) ?? ''
          const terminal = {
            at: event.at,
            turn,
            sessionId: msg.session_id ?? null,
            toolUseId: block.tool_use_id ?? null,
            isError: block.is_error === true,
            content: snapshot(block.content),
            text,
            isStreamClosed: /Stream closed/i.test(text),
            isAbortErrorInterrupt: /AbortError:\s*interrupt/i.test(text),
            fullSurface: snapshot(block),
          }
          terminalToolResults.push(terminal)
          event.toolResults.push(terminal)
        }
      }

      if (msg.type === 'result') {
        const result = {
          at: event.at,
          turn,
          sessionId: msg.session_id ?? null,
          keys: Object.keys(msg),
          // Q4: 해석용 subset만이 아니라 SDK가 낸 result message 전체를 보존한다.
          fullSurface: snapshot(msg),
        }
        results.push(result)
        event.result = result.fullSurface
        events.push(event)
        if (turn === 1) {
          signalCutTurnEnded()
          if (firstToolStartedAt == null) stopPromptInput()
        }
        turn += 1
        if (turn > 2) break
        continue
      }

      events.push(event)
    }
    streamEndedAt = at()
  } catch (error) {
    streamError = errorSurface(error)
    stopPromptInput()
  } finally {
    if (deadline) clearTimeout(deadline)
    stopPromptInput()
    releaseFirstTool()
    q?.close()
    if (interruptTask) await Promise.race([interruptTask, sleep(1_000)])

    if (previousMcpToolTimeout == null) delete process.env.MCP_TOOL_TIMEOUT
    else process.env.MCP_TOOL_TIMEOUT = previousMcpToolTimeout
    restoredMcpToolTimeout = Object.hasOwn(process.env, 'MCP_TOOL_TIMEOUT')
      ? process.env.MCP_TOOL_TIMEOUT
      : null
    mcpToolTimeoutRestored = restoredMcpToolTimeout === previousMcpToolTimeout
  }

  const cutResult = results.find((result) => result.turn === 1) ?? null
  const freshResult = results.find((result) => result.turn === 2) ?? null
  const cutToolUses = assistants
    .filter((assistant) => assistant.turn === 1)
    .flatMap((assistant) => assistant.toolUses)
    .filter((use) => use.name === TOOL_NAME)
  const freshToolUses = assistants
    .filter((assistant) => assistant.turn === 2)
    .flatMap((assistant) => assistant.toolUses)
    .filter((use) => use.name === TOOL_NAME)
  const cutToolCalls = toolCalls.filter((call) => call.phase === 'cut')
  const freshToolCalls = toolCalls.filter((call) => call.phase === 'fresh')
  const cutToolResults = terminalToolResults.filter((result) => result.turn === 1)
  const freshToolResults = terminalToolResults.filter((result) => result.turn === 2)
  const firstCutToolUse = cutToolUses.find((use) => use.input?.phase === 'cut' && use.input?.step === 1) ?? null
  const firstCutToolResult = firstCutToolUse
    ? cutToolResults.find((result) => result.toolUseId === firstCutToolUse.id) ?? null
    : null
  const firstCall = cutToolCalls[0] ?? null

  const interruptOverlappedFirstTool = Boolean(
    firstCall
    && interruptCalledAt != null
    && firstCall.startedAt <= interruptCalledAt
    && firstCall.endedAt >= interruptCalledAt,
  )
  const oldBodySettledBeforeFreshTurn = Boolean(
    firstToolBodySettledAt != null
    && freshTurnYieldedAt != null
    && firstToolBodySettledAt <= freshTurnYieldedAt,
  )
  // Handler의 유일한 gate 조건은 phase==='cut' && phaseOrdinal===1이다. bridge가 fresh body 진입 전에
  // 죽는 경우에도 "body가 관측되지 않았다"를 "gate됐다"로 오독하지 않도록 설계 사실과 실행 관측을 분리한다.
  const freshToolsUngatedByConstruction = true
  const freshGateWaitCount = freshToolCalls.filter((call) => call.gateWaited).length
  const observedFreshCallsAllUngated = freshToolCalls.every((call) => call.gateWaited === false)

  const cutSteps = sortedSteps(cutToolCalls, (call) => call.step)
  const cutSuccessfulToolResults = cutToolResults.filter((result) => (
    !result.isError && result.text.includes('M0_17_TOOL_OK:cut:')
  ))
  const cutSequenceCompleted = (
    isExpectedSteps(cutSteps)
    && cutSuccessfulToolResults.length === 3
  )
  let turnCutFate = 'undetermined'
  if (!timedOut && interruptOverlappedFirstTool && cutResult) {
    turnCutFate = cutSequenceCompleted ? 'not-cut' : 'cut'
  }

  const cutTokenEchoedByModel = assistants
    .filter((assistant) => assistant.turn === 1)
    .some((assistant) => assistant.text.includes(cutCompletionToken))
    || String(cutResult?.fullSurface?.result ?? '').includes(cutCompletionToken)
  const postInterruptCutTurnEvents = interruptCalledAt == null
    ? []
    : events.filter((event) => event.turn === 1 && event.at >= interruptCalledAt)

  const freshSteps = sortedSteps(freshToolCalls, (call) => call.step)
  const freshUseSteps = sortedSteps(freshToolUses, (use) => use.input?.step ?? -1)
  const freshSuccessfulToolResults = freshToolResults.filter((result) => (
    !result.isError && result.text.includes('M0_17_TOOL_OK:fresh:')
  ))
  const freshStreamClosedToolResults = freshToolResults.filter((result) => (
    result.isError && result.isStreamClosed
  ))
  const freshTokenEchoedByModel = assistants
    .filter((assistant) => assistant.turn === 2)
    .some((assistant) => assistant.text.includes(freshEchoToken))
    || String(freshResult?.fullSurface?.result ?? '').includes(freshEchoToken)

  const sessionIdsByTurn = (wantedTurn) => [...new Set(events
    .filter((event) => event.turn === wantedTurn && event.sessionId)
    .map((event) => event.sessionId))]
  const cutSessionIds = sessionIdsByTurn(1)
  const freshSessionIds = sessionIdsByTurn(2)
  const sameSession = cutSessionIds.length === 1
    && freshSessionIds.length === 1
    && cutSessionIds[0] === freshSessionIds[0]

  const aliveEvidence = (
    sameSession
    && freshTurnWrittenAt != null
    && isExpectedSteps(freshUseSteps)
    && isExpectedSteps(freshSteps)
    && freshSuccessfulToolResults.length === 3
    && freshStreamClosedToolResults.length === 0
    && freshTokenEchoedByModel
    && Boolean(freshResult)
    && observedFreshCallsAllUngated
  )
  const deadEvidence = (
    sameSession
    && isExpectedSteps(freshUseSteps)
    && freshToolResults.length === 3
    && freshStreamClosedToolResults.length === 3
    && freshSuccessfulToolResults.length === 0
    && Boolean(freshResult)
    && freshToolsUngatedByConstruction
  )

  let bridgeAfterInterrupt = 'undetermined'
  if (!timedOut && aliveEvidence) bridgeAfterInterrupt = 'alive'
  else if (!timedOut && deadEvidence) bridgeAfterInterrupt = 'dead'
  else if (!timedOut && freshToolResults.length > 0) bridgeAfterInterrupt = 'mixed'

  const q3TrustFailures = []
  if (timedOut) q3TrustFailures.push('measurement timed out; timeout is not a bridge result')
  if (!interruptOverlappedFirstTool) q3TrustFailures.push('direct interrupt did not overlap a running first tool body')
  if (interruptError) q3TrustFailures.push('interrupt() threw instead of returning a receipt')
  if (interruptReceipt == null) q3TrustFailures.push('interrupt() receipt was not observed')
  if (!cutResult) q3TrustFailures.push('cut turn result boundary was not observed')
  if (!oldBodySettledBeforeFreshTurn) q3TrustFailures.push('old gated body was not proven settled before fresh turn')
  if (freshTurnWrittenAt == null) q3TrustFailures.push('fresh turn transport.write completion was not observed')
  if (!sameSession) q3TrustFailures.push('fresh turn was not proven to use the same non-null session_id')
  if (!isExpectedSteps(freshUseSteps)) q3TrustFailures.push('model did not issue all three requested fresh tool_use blocks')
  if (!observedFreshCallsAllUngated) q3TrustFailures.push('an entered fresh tool body unexpectedly waited on a gate')
  if (!freshResult) q3TrustFailures.push('fresh turn result boundary was not observed')
  if (!mcpToolTimeoutRestored) q3TrustFailures.push('MCP_TOOL_TIMEOUT was not restored')

  return {
    cutCompletionToken,
    freshEchoToken,
    timing: {
      firstToolStartedAt,
      interruptCalledAt,
      interruptSettledAt,
      firstToolGateReleasedAt,
      firstToolBodySettledAt,
      freshTurnYieldedAt,
      freshTurnWrittenAt,
      streamEndedAt,
    },
    mcpToolTimeout: {
      setToMs: MCP_TOOL_TIMEOUT_MS,
      setToValue: String(MCP_TOOL_TIMEOUT_MS),
      previousValue: previousMcpToolTimeout,
      restoredValue: restoredMcpToolTimeout,
      restored: mcpToolTimeoutRestored,
    },
    interrupt: {
      directMethod: 'Query.interrupt()',
      receipt: interruptReceipt,
      error: interruptError,
      overlappedFirstToolBody: interruptOverlappedFirstTool,
    },
    turnCutFate,
    turnCutFateEvidence: {
      cutSequenceCompleted,
      cutTokenEchoedByModel,
      cutToolUseSteps: cutToolUses.map((use) => use.input?.step ?? null),
      cutToolCallSteps: cutToolCalls.map((call) => call.step),
      cutSuccessfulToolResultCount: cutSuccessfulToolResults.length,
      postInterruptCutTurnEvents,
    },
    inFlightToolCallAfterInterrupt: {
      bodyCall: firstCall,
      signalAborted: firstCall?.signalAbortedAt != null,
      terminalToolResult: firstCutToolResult,
      surfacedAsAbortErrorInterrupt: firstCutToolResult?.isAbortErrorInterrupt === true,
    },
    cutTurnResultFullSurface: cutResult?.fullSurface ?? null,
    bridgeAfterInterrupt,
    bridgeAfterInterruptEvidence: {
      sameSession,
      cutSessionIds,
      freshSessionIds,
      oldBodySettledBeforeFreshTurn,
      freshToolsUngatedByConstruction,
      observedFreshCallCount: freshToolCalls.length,
      freshGateWaitCount,
      observedFreshCallsAllUngated,
      freshTurnWrittenAt,
      freshToolUseSteps: freshUseSteps,
      freshToolCallSteps: freshSteps,
      freshToolResultCount: freshToolResults.length,
      freshSuccessfulToolResultCount: freshSuccessfulToolResults.length,
      freshStreamClosedCount: freshStreamClosedToolResults.length,
      freshAnyStreamClosed: freshStreamClosedToolResults.length > 0,
      everyFreshToolResult: freshToolResults,
      freshTokenEchoedByModel,
      freshResultFullSurface: freshResult?.fullSurface ?? null,
      aliveEvidence,
      deadEvidence,
    },
    q3Trust: {
      apparatusTrustworthy: q3TrustFailures.length === 0,
      failures: q3TrustFailures,
      uncontrolledVariable:
        'Developer personal ~/.claude is used; a SessionStart hook injects content and there is no Claude equivalent of Codex CODEX_HOME isolation.',
    },
    timedOut,
    queryClosedByDeadline,
    streamError,
    toolCalls,
    terminalToolResults,
    results,
    assistants,
    events,
  }
}

describe('M0-17 — Claude Agent SDK direct interrupt 계약 (Q8)', () => {
  it('Q8: direct interrupt가 in-flight turn을 자르고 같은 session의 fresh MCP bridge는 살아 있는가', async () => {
    const observation = await measureDirectInterrupt()
    record('Q8 direct interrupt + fresh MCP bridge', observation)

    // SDK semantics는 assertion하지 않는다. 아래는 관측 장치가 실제 창을 만들고 닫았는지만 확인한다.
    expect(observation.timedOut, '측정 deadline이 먼저 끝났다').toBe(false)
    expect(observation.timing.firstToolStartedAt, '첫 tool body 내부 시작 신호를 받지 못했다').not.toBeNull()
    expect(observation.timing.interruptCalledAt, 'direct interrupt()를 호출하지 못했다').not.toBeNull()
    expect(observation.timing.interruptSettledAt, 'interrupt() receipt/error 표면이 settle하지 않았다').not.toBeNull()
    expect(observation.interrupt.overlappedFirstToolBody, 'interrupt()가 실행 중 tool body와 겹치지 않았다').toBe(true)
    expect(observation.cutTurnResultFullSurface, 'interrupt 대상 turn의 result 경계를 관측하지 못했다').not.toBeNull()
    expect(
      observation.bridgeAfterInterruptEvidence.oldBodySettledBeforeFreshTurn,
      'old gated body가 끝나기 전에 fresh turn이 시작돼 Q3가 confound됐다',
    ).toBe(true)
    expect(observation.bridgeAfterInterruptEvidence.freshTurnWrittenAt, 'fresh turn transport.write를 관측하지 못했다').not.toBeNull()
    expect(observation.bridgeAfterInterruptEvidence.sameSession, 'fresh turn의 동일 session_id를 증명하지 못했다').toBe(true)
    expect(
      observation.bridgeAfterInterruptEvidence.freshToolUseSteps,
      'fresh turn이 요청한 tool_use 세 개를 모두 내지 않았다',
    ).toEqual([1, 2, 3])
    expect(
      observation.bridgeAfterInterruptEvidence.freshGateWaitCount,
      '실행된 fresh tool body 중 test-owned gate를 기다린 호출이 있다',
    ).toBe(0)
    expect(
      observation.bridgeAfterInterruptEvidence.freshResultFullSurface,
      'fresh turn의 result 경계를 관측하지 못했다',
    ).not.toBeNull()
    expect(observation.mcpToolTimeout.restored, 'MCP_TOOL_TIMEOUT을 원복하지 못했다').toBe(true)
  }, 8 * 60 * 1000)
})
