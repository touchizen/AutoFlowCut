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
 *   - cut turn result 뒤 FRESH_TURN_GAP_MS 동안 input을 쓰지 않고 그 사이 activity를 따로 기록한다.
 *     result와 fresh write가 같은 millisecond였던 첫 run의 timing confound를 반복하지 않는다.
 *   - fresh turn의 tool body 세 개는 전부 **UNGATED**다. `oldBodySettledBeforeFreshTurn`과 각 call의
 *     `gateWaited:false`를 raw에 남긴다. 따라서 fresh call 실패를 fresh-side test gate로 설명할 수 없다.
 *
 * 🔴 vacuous answer / timeout 오독 방지:
 *   - "throw하지 않았다"는 alive 증거가 아니다. fresh tool_use 하나라도 그 body가 실제 실행되고
 *     고유 token을 담은 non-error tool_result로 왕복하면 `bridgeAfterInterrupt:'alive'`다. 3회 요청의
 *     완료 수와 모델의 final token echo는 별도 기록하되, 모델 재량으로 bridge 양성 증거를 veto하지 않는다.
 *   - 발행된 fresh tool_use 전부가 "Stream closed" terminal result로 끝나고 성공 왕복이 0일 때 `dead`다.
 *     tool_use 없이 fresh result가 끝나면 `model-declined-no-tool-use`, 장치가 안 닫히면 `undetermined`다.
 *   - MEASUREMENT_DEADLINE_MS는 it() timeout보다 작다. deadline이면 `timedOut:true`와 중간 관측을
 *     먼저 raw에 쓴다. timeout은 Q8의 답이 아니므로 fate는 `undetermined`다.
 *   - assertion은 SDK semantics가 아니라 관측 장치가 닫혔는지만 확인한다. cut/not-cut 및
 *     alive/dead/model-declined/mixed는 모두 유효한 측정 결과다.
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
const FRESH_TURN_GAP_MS = 5_000
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
  let freshTurnGapStartedAt = null
  let freshTurnGapEndedAt = null
  let freshTurnGapStartedEventIndex = null
  let freshTurnGapEndedEventIndex = null
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
        'Returns a side-effect-free text marker for one numbered step. Call it exactly as requested by the user.',
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

    // result와 fresh write를 같은 tick에 두지 않는다. index 경계는 timestamp 동률이어도 gap event를 구분한다.
    freshTurnGapStartedAt = at()
    freshTurnGapStartedEventIndex = events.length
    const gapOutcome = await Promise.race([
      sleep(FRESH_TURN_GAP_MS).then(() => 'gap-elapsed'),
      promptInputStopped.then(() => 'input-stopped'),
    ])
    if (gapOutcome === 'input-stopped') return
    freshTurnGapEndedAt = at()
    freshTurnGapEndedEventIndex = events.length

    freshTurnYieldedAt = at()
    // 🔴 여기는 **평범한 사용자 요청**이어야 한다. 그게 제품의 모양이기도 하다 —
    //    사용자가 Stop 을 누른 뒤 그냥 다음 메시지를 친다.
    //    이전 판(“이건 system interrupt 지 사용자 거부가 아니고 그 취소는 이 턴에 적용 안 된다”)은
    //    stop 을 우회하려 **미리 논증**했고, 모델이 그걸 정확히 prompt injection 으로 판정해 거부했다:
    //      "거부 직후에 나타나서, 왜 stop 이 적용 안 되는지 미리 논증하고, 거의 동일한 tool-call 을
    //       즉시 반복하라고 요구하는 건 명시적 stop 신호를 넘어가게 설득하려는 시도의 특징을 갖는다.
    //       그 지시가 정말 당신에게서 온 건지 주입된 건지 확인할 방법이 없다."
    //    모델이 옳았다. interrupt 의 tool_result 는 "STOP … wait for the user to tell you how to proceed" 이고,
    //    **사용자의 다음 진짜 메시지가 바로 그 'how to proceed'** 다. 설득할 게 아니라 그냥 시키면 된다.
    //    (모델 자신이 알려준 길: "진행을 원하면 그냥 직접 확인해달라, 그럼 실행하겠다.")
    yield {
      type: 'user',
      message: {
        role: 'user',
        content:
          `Call ${TOOL_NAME} exactly three times with `
          + '{"phase":"fresh","step":1}, {"phase":"fresh","step":2}, and {"phase":"fresh","step":3}. '
          + `After the tool results, reply with exactly ${freshEchoToken} and nothing else.`,
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
          stopReason: msg.message?.stop_reason ?? msg.stop_reason ?? null,
          toolUses: blocks
            .filter((block) => block?.type === 'tool_use')
            .map((block) => ({ id: block.id, name: block.name, input: snapshot(block.input) })),
        }
        assistants.push(assistant)
        event.text = assistant.text
        event.stopReason = assistant.stopReason
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
  const freshAssistants = assistants.filter((assistant) => assistant.turn === 2)
  const freshAssistantMessages = freshAssistants.map((assistant) => ({
    at: assistant.at,
    uuid: assistant.uuid,
    text: assistant.text,
    stopReason: assistant.stopReason,
  }))
  const freshAssistantCombinedText = freshAssistants.map((assistant) => assistant.text).join('')
  const freshResultText = typeof freshResult?.fullSurface?.result === 'string'
    ? freshResult.fullSurface.result
    : ''
  const freshModelOutputText = freshAssistantCombinedText || freshResultText
  const freshResultSucceeded = freshResult?.fullSurface?.subtype === 'success'
    && freshResult.fullSurface.is_error === false
  const freshStopReasons = [
    ...freshAssistants.map((assistant) => assistant.stopReason),
    freshResult?.fullSurface?.stop_reason ?? null,
  ].filter((reason) => reason != null)
  const freshTokenEchoedByModel = assistants
    .filter((assistant) => assistant.turn === 2)
    .some((assistant) => assistant.text.includes(freshEchoToken))
    || freshResultText.includes(freshEchoToken)

  // tool_use id → 실제 body 실행 → 같은 id의 terminal marker를 한 묶음으로 기록한다.
  // 모델이 나머지 두 call을 생략해도 성공 round-trip 하나면 bridge가 살아 있다는 양성 증거다.
  const freshRoundTrips = freshToolUses.map((use) => {
    const phase = use.input?.phase ?? null
    const step = use.input?.step ?? null
    const bodyCall = freshToolCalls.find((call) => call.phase === phase && call.step === step) ?? null
    const terminalToolResult = freshToolResults.find((result) => result.toolUseId === use.id) ?? null
    const expectedMarker = `M0_17_TOOL_OK:fresh:${step}:${freshEchoToken}`
    return {
      toolUse: use,
      bodyCall,
      terminalToolResult,
      bodyRan: Boolean(bodyCall),
      nonErrorTerminalResult: terminalToolResult?.isError === false,
      expectedMarker,
      markerReturned: terminalToolResult?.text.includes(expectedMarker) === true,
      successful: Boolean(
        phase === 'fresh'
        && bodyCall
        && terminalToolResult?.isError === false
        && terminalToolResult.text.includes(expectedMarker),
      ),
      streamClosed: terminalToolResult?.isError === true && terminalToolResult.isStreamClosed === true,
    }
  })
  const successfulFreshRoundTrips = freshRoundTrips.filter((roundTrip) => roundTrip.successful)
  const allIssuedFreshUsesTargetFreshPhase = freshRoundTrips.length > 0
    && freshRoundTrips.every((roundTrip) => roundTrip.toolUse.input?.phase === 'fresh')
  const everyIssuedFreshUseWasStreamClosed = freshRoundTrips.length > 0
    && freshRoundTrips.every((roundTrip) => roundTrip.streamClosed)

  const freshTurnGapDurationMs = freshTurnGapStartedAt != null && freshTurnGapEndedAt != null
    ? freshTurnGapEndedAt - freshTurnGapStartedAt
    : null
  const freshTurnDelayAfterCutResultMs = cutResult?.at != null && freshTurnYieldedAt != null
    ? freshTurnYieldedAt - cutResult.at
    : null
  const freshTurnGapEvents = Number.isInteger(freshTurnGapStartedEventIndex)
    && Number.isInteger(freshTurnGapEndedEventIndex)
    ? events.slice(freshTurnGapStartedEventIndex, freshTurnGapEndedEventIndex)
    : []
  const substantiveFreshTurnGapEvents = freshTurnGapEvents.filter((event) => (
    event.type === 'assistant' || event.type === 'user' || event.type === 'result'
  ))

  const sessionIdsByTurn = (wantedTurn) => [...new Set(events
    .filter((event) => event.turn === wantedTurn && event.sessionId)
    .map((event) => event.sessionId))]
  const cutSessionIds = sessionIdsByTurn(1)
  const freshSessionIds = sessionIdsByTurn(2)
  const sameSession = cutSessionIds.length === 1
    && freshSessionIds.length === 1
    && cutSessionIds[0] === freshSessionIds[0]

  const q3TrustFailures = []
  if (timedOut) q3TrustFailures.push('measurement timed out; timeout is not a bridge result')
  if (!interruptOverlappedFirstTool) q3TrustFailures.push('direct interrupt did not overlap a running first tool body')
  if (interruptError) q3TrustFailures.push('interrupt() threw instead of returning a receipt')
  if (interruptReceipt == null) q3TrustFailures.push('interrupt() receipt was not observed')
  if (!cutResult) q3TrustFailures.push('cut turn result boundary was not observed')
  if (!oldBodySettledBeforeFreshTurn) q3TrustFailures.push('old gated body was not proven settled before fresh turn')
  if (freshTurnGapStartedAt == null) q3TrustFailures.push('post-result fresh-turn gap did not start')
  if (freshTurnGapEndedAt == null) q3TrustFailures.push('post-result fresh-turn gap did not close')
  if (freshTurnGapDurationMs != null && freshTurnGapDurationMs < FRESH_TURN_GAP_MS) {
    q3TrustFailures.push('post-result fresh-turn gap was shorter than configured')
  }
  if (substantiveFreshTurnGapEvents.length > 0) {
    q3TrustFailures.push('assistant/user/result activity occurred inside the isolated fresh-turn gap')
  }
  if (freshTurnWrittenAt == null) q3TrustFailures.push('fresh turn transport.write completion was not observed')
  if (!sameSession) q3TrustFailures.push('fresh turn was not proven to use the same non-null session_id')
  if (!observedFreshCallsAllUngated) q3TrustFailures.push('an entered fresh tool body unexpectedly waited on a gate')
  if (!freshResult) q3TrustFailures.push('fresh turn result boundary was not observed')
  if (!mcpToolTimeoutRestored) q3TrustFailures.push('MCP_TOOL_TIMEOUT was not restored')

  const apparatusTrustworthy = q3TrustFailures.length === 0
  const aliveEvidence = apparatusTrustworthy && successfulFreshRoundTrips.length >= 1
  const deadEvidence = apparatusTrustworthy
    && freshRoundTrips.length >= 1
    && successfulFreshRoundTrips.length === 0
    && allIssuedFreshUsesTargetFreshPhase
    && everyIssuedFreshUseWasStreamClosed
    && freshToolsUngatedByConstruction
  const modelDeclinedNoToolUse = apparatusTrustworthy
    && freshToolUses.length === 0
    && freshResultSucceeded
    && freshModelOutputText.trim().length > 0

  let bridgeAfterInterrupt = 'undetermined'
  if (aliveEvidence) bridgeAfterInterrupt = 'alive'
  else if (deadEvidence) bridgeAfterInterrupt = 'dead'
  else if (modelDeclinedNoToolUse) bridgeAfterInterrupt = 'model-declined-no-tool-use'
  else if (apparatusTrustworthy) {
    bridgeAfterInterrupt = 'mixed'
  }

  return {
    cutCompletionToken,
    freshEchoToken,
    timing: {
      firstToolStartedAt,
      interruptCalledAt,
      interruptSettledAt,
      firstToolGateReleasedAt,
      firstToolBodySettledAt,
      freshTurnGapStartedAt,
      freshTurnGapEndedAt,
      freshTurnGapMs: FRESH_TURN_GAP_MS,
      freshTurnGapDurationMs,
      freshTurnDelayAfterCutResultMs,
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
      freshTurnGap: {
        configuredMs: FRESH_TURN_GAP_MS,
        startedAt: freshTurnGapStartedAt,
        endedAt: freshTurnGapEndedAt,
        durationMs: freshTurnGapDurationMs,
        delayAfterCutResultMs: freshTurnDelayAfterCutResultMs,
        startedEventIndex: freshTurnGapStartedEventIndex,
        endedEventIndex: freshTurnGapEndedEventIndex,
        events: freshTurnGapEvents,
        substantiveEvents: substantiveFreshTurnGapEvents,
      },
      freshTurnWrittenAt,
      freshToolUseCount: freshToolUses.length,
      freshToolUseSteps: freshUseSteps,
      freshToolCallSteps: freshSteps,
      freshToolResultCount: freshToolResults.length,
      freshSuccessfulToolResultCount: freshSuccessfulToolResults.length,
      successfulFreshRoundTripCount: successfulFreshRoundTrips.length,
      freshRoundTrips,
      allIssuedFreshUsesTargetFreshPhase,
      everyIssuedFreshUseWasStreamClosed,
      freshStreamClosedCount: freshStreamClosedToolResults.length,
      freshAnyStreamClosed: freshStreamClosedToolResults.length > 0,
      everyFreshToolResult: freshToolResults,
      freshAssistantMessages,
      freshAssistantCombinedText,
      freshResultText,
      freshModelOutputText,
      freshResultSucceeded,
      freshStopReasons,
      freshTokenEchoedByModel,
      freshResultFullSurface: freshResult?.fullSurface ?? null,
      aliveEvidence,
      deadEvidence,
      modelDeclinedNoToolUse,
    },
    q3Trust: {
      apparatusTrustworthy,
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
    expect(
      observation.bridgeAfterInterruptEvidence.freshTurnGap.startedAt,
      'cut result 뒤 fresh-turn gap을 시작하지 못했다',
    ).not.toBeNull()
    expect(
      observation.bridgeAfterInterruptEvidence.freshTurnGap.endedAt,
      'cut result 뒤 fresh-turn gap을 닫지 못했다',
    ).not.toBeNull()
    expect(
      observation.bridgeAfterInterruptEvidence.freshTurnGap.durationMs,
      'fresh-turn gap이 설정값보다 짧았다',
    ).toBeGreaterThanOrEqual(FRESH_TURN_GAP_MS)
    expect(
      observation.bridgeAfterInterruptEvidence.freshTurnGap.delayAfterCutResultMs,
      'fresh turn이 cut result 뒤 충분히 떨어지지 않았다',
    ).toBeGreaterThanOrEqual(FRESH_TURN_GAP_MS)
    expect(observation.bridgeAfterInterruptEvidence.freshTurnWrittenAt, 'fresh turn transport.write를 관측하지 못했다').not.toBeNull()
    expect(observation.bridgeAfterInterruptEvidence.sameSession, 'fresh turn의 동일 session_id를 증명하지 못했다').toBe(true)
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
