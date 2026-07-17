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
 * 🔴 vacuous green / confound 방지:
 *   - "에러가 없었다"나 "nonce 를 출력하지 않았다"로는 delivery/drop 을 판정하지 않는다. 모델이 전달된
 *     지시를 따르지 않을 수 있기 때문이다. text 와 thinking 의 nonce 회수를 분리해 turn 별로 기록한다.
 *   - 첫 result 뒤 QUEUED_TURN_GAP_MS 동안 아무 input 도 더 넣지 않는다. 이미 queue 된 injection 만으로
 *     다음 turn 이 시작/출력되는지 기록한 뒤에야 nonce 를 언급하지 않는 neutral follow-up 을 보낸다.
 *   - neutral follow-up 완료 뒤 nonce 를 알려주지 않는 3차 probe 로 이전 special token 기억을 묻는다.
 *     nonce echo 는 delivery 의 양성 증거이고 NONE 은 transcript에 delivery node가 없다는 증거와 함께만
 *     discard 판정에 쓴다.
 *   - SDK stream 밖의 Claude CLI transcript 도 읽어 injected UUID enqueue/queued_command/assistant ancestry 를
 *     기록한다. transcript unavailable 을 절대로 discarded 로 취급하지 않는다.
 *   - 한 번에 끝나는 텍스트 turn 을 재지 않는다. 제품 모양처럼 MCP tool 을 3회 호출시키고,
 *     첫 tool body 를 test-owned promise 로 붙잡은 동안 두 번째 user message 를 write 한다.
 *   - write 뒤에도 750ms 동안 body 를 붙잡아, 주입과 in-flight tool window 가 실제로 겹치게 한다.
 *
 * 서로 독립인 두 축을 first-class observation 으로 남긴다:
 *   originalTurnFate: completed | preempted | ended-incomplete | undetermined
 *   injectedMessageFate: joined-in-flight | delivered-next-turn | discarded | undetermined
 * 원래 turn preemption 은 injected message delivery 판정을 short-circuit 하지 않는다.
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
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { query, createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk'

const RESULT_DIR = 'docs/superpowers/specs'
const RAW = `${RESULT_DIR}/m0-16-raw.jsonl`
const TOOL_NAME = 'mcp__m0-16-steer__sequence_step'
const QUEUED_TURN_GAP_MS = 5_000
const TRANSCRIPT_SETTLE_MS = 250
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

const thinkingOf = (blocks) => (Array.isArray(blocks) ? blocks : [])
  .filter((block) => block?.type === 'thinking')
  .map((block) => block.thinking ?? block.text ?? '')
  .join('')

function readTranscriptEvidence({ sessionId, injectedMessageUuid, nonce, assistants }) {
  if (!sessionId) {
    return { status: 'unavailable', reason: 'SDK stream exposed no session_id', path: null }
  }

  const projectSlug = process.cwd().replace(/[^A-Za-z0-9]/g, '-')
  const path = join(homedir(), '.claude', 'projects', projectSlug, `${sessionId}.jsonl`)
  if (!existsSync(path)) {
    return { status: 'unavailable', reason: 'session transcript file not found', path }
  }

  try {
    const rows = readFileSync(path, 'utf-8')
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line))
    const assistantTurnByUuid = new Map(assistants.map((message) => [message.uuid, message.turn]))
    const directMessageIndex = rows.findIndex((row) => row.uuid === injectedMessageUuid)
    const queuedCommandAttachmentIndex = rows.findIndex((row) => (
      row.type === 'attachment'
      && row.attachment?.type === 'queued_command'
      && row.attachment?.source_uuid === injectedMessageUuid
    ))
    const deliveryRootIndex = queuedCommandAttachmentIndex >= 0
      ? queuedCommandAttachmentIndex
      : directMessageIndex
    const deliveryRoot = deliveryRootIndex >= 0 ? rows[deliveryRootIndex] : null
    const byUuid = new Map(rows.filter((row) => row.uuid).map((row) => [row.uuid, row]))

    const ancestryFrom = (row, ancestorUuid) => {
      const reversed = []
      const seen = new Set()
      let cursor = row
      while (cursor?.uuid && !seen.has(cursor.uuid)) {
        seen.add(cursor.uuid)
        reversed.push(cursor.uuid)
        if (cursor.uuid === ancestorUuid) return reversed.reverse()
        cursor = cursor.parentUuid ? byUuid.get(cursor.parentUuid) : null
      }
      return null
    }

    let followingAssistant = null
    if (deliveryRoot?.uuid) {
      for (let index = deliveryRootIndex + 1; index < rows.length; index += 1) {
        const row = rows[index]
        if (row.type !== 'assistant' || !row.uuid) continue
        const ancestry = ancestryFrom(row, deliveryRoot.uuid)
        if (!ancestry) continue
        followingAssistant = {
          index,
          uuid: row.uuid,
          parentUuid: row.parentUuid ?? null,
          sdkTurn: assistantTurnByUuid.get(row.uuid) ?? null,
          directChild: row.parentUuid === deliveryRoot.uuid,
          ancestry,
        }
        break
      }
    }

    return {
      status: 'available',
      path,
      parsedRowCount: rows.length,
      injectedMessageAppears: directMessageIndex >= 0 || queuedCommandAttachmentIndex >= 0,
      directMessageIndex: directMessageIndex >= 0 ? directMessageIndex : null,
      queuedCommandAttachment: queuedCommandAttachmentIndex >= 0,
      queuedCommandAttachmentIndex: queuedCommandAttachmentIndex >= 0
        ? queuedCommandAttachmentIndex
        : null,
      deliveryRoot: deliveryRoot
        ? {
            kind: queuedCommandAttachmentIndex >= 0 ? 'queued_command' : 'direct-user-message',
            index: deliveryRootIndex,
            uuid: deliveryRoot.uuid ?? null,
            parentUuid: deliveryRoot.parentUuid ?? null,
            sourceUuid: deliveryRoot.attachment?.source_uuid ?? injectedMessageUuid,
          }
        : null,
      followingAssistant,
      transcriptContainsNonce: rows.some((row) => JSON.stringify(row).includes(nonce)),
    }
  } catch (error) {
    return { status: 'unavailable', reason: String(error?.message || error), path }
  }
}

async function measureMidTurnInjection({ priority }) {
  const startedAt = Date.now()
  const at = () => Date.now() - startedAt
  const nonce = `CLAUDE_STEER_M0_16_${Date.now().toString(36).toUpperCase()}_${process.pid}`
  const original = `CLAUDE_ORIGINAL_M0_16_${randomUUID().replaceAll('-', '').slice(0, 12).toUpperCase()}`
  const followUpToken = `CLAUDE_FOLLOWUP_M0_16_${randomUUID().replaceAll('-', '').slice(0, 12).toUpperCase()}`
  const initialMessageUuid = randomUUID()
  const injectedMessageUuid = randomUUID()
  const followUpMessageUuid = randomUUID()
  const probeMessageUuid = randomUUID()
  const toolCalls = []
  const terminalToolResults = []
  const assistants = []
  const results = []
  const events = []
  let injectionYieldedAt = null
  let injectionWrittenAt = null
  let firstToolStartedAt = null
  let firstToolReleasedAt = null
  let gapStartedAt = null
  let gapEndedAt = null
  let followUpYieldedAt = null
  let followUpWrittenAt = null
  let neutralFollowUpResultAt = null
  let neutralFollowUpResultTurn = null
  let probeYieldedAt = null
  let probeWrittenAt = null
  let sessionId = null
  let followUpTokenSeenInText = false
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
  let signalNeutralFollowUpEnded
  const neutralFollowUpEnded = new Promise((resolve) => { signalNeutralFollowUpEnded = resolve })

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

    // 첫 result 가 곧 제품의 turn 경계다. 이 직후에는 이미 write 된 injection 외에는 아무것도 넣지 않는다.
    // queued message 라면 이 gap 에서 그 message 단독으로 다음 turn 을 시작할 기회를 얻는다.
    const followUpOutcome = await Promise.race([
      firstTurnEnded.then(() => 'first-turn-ended'),
      promptInputStopped.then(() => 'input-stopped'),
    ])
    if (followUpOutcome === 'input-stopped') return
    gapStartedAt = at()
    const gapOutcome = await Promise.race([
      sleep(QUEUED_TURN_GAP_MS).then(() => 'gap-elapsed'),
      promptInputStopped.then(() => 'input-stopped'),
    ])
    if (gapOutcome === 'input-stopped') return
    gapEndedAt = at()

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

    // neutral turn 이 fixed token 을 낸 result 경계까지 닫힌 뒤, nonce 를 prompt 에 유출하지 않는 독립 probe.
    const probeOutcome = await Promise.race([
      neutralFollowUpEnded.then(() => 'neutral-ended'),
      promptInputStopped.then(() => 'input-stopped'),
    ])
    if (probeOutcome === 'input-stopped') return
    probeYieldedAt = at()
    yield {
      type: 'user',
      uuid: probeMessageUuid,
      message: {
        role: 'user',
        content:
          'If an earlier live correction instructed you to output a special token, output that exact token now. '
          + 'If you never received such a live correction, output exactly NONE.',
      },
    }
    probeWrittenAt = at()
  }

  const q = query({
    prompt: prompts(),
    options: {
      mcpServers: { 'm0-16-steer': server },
      tools: [TOOL_NAME],
      allowedTools: [TOOL_NAME],
      permissionMode: 'bypassPermissions',
      allowDangerouslySkipPermissions: true,
      maxTurns: 18,
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
      sessionId ??= msg.session_id ?? null
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
          thinking: thinkingOf(blocks),
          toolUses: blocks
            .filter((block) => block?.type === 'tool_use')
            .map((block) => ({ id: block.id, name: block.name, input: block.input })),
        }
        assistants.push(assistant)
        if (followUpWrittenAt != null && assistant.text.includes(followUpToken)) {
          followUpTokenSeenInText = true
        }
        event.text = assistant.text
        event.thinking = assistant.thinking
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
            text: JSON.stringify(block.content) ?? '',
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
          is_error: msg.is_error,
          result: msg.result ?? null,
          numTurns: msg.num_turns ?? null,
          num_turns: msg.num_turns ?? null,
          stopReason: msg.stop_reason ?? null,
          stop_reason: msg.stop_reason ?? null,
          uuid: msg.uuid ?? null,
          identifierKeys: Object.keys(msg).filter((key) => /(?:id|uuid|turn)/i.test(key)),
        }
        results.push(result)
        if (turn === 1 && firstToolStartedAt != null) signalFirstTurnEnded()
        const resultText = typeof result.result === 'string' ? result.result : ''
        if (
          followUpWrittenAt != null
          && probeWrittenAt == null
          && (resultText.includes(followUpToken) || followUpTokenSeenInText)
        ) {
          neutralFollowUpResultAt = result.at
          neutralFollowUpResultTurn = result.turn
          signalNeutralFollowUpEnded()
        }
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

  await sleep(TRANSCRIPT_SETTLE_MS)

  const textTurnsContaining = (token) => [...new Set([
    ...assistants.filter((message) => message.text.includes(token)).map((message) => message.turn),
    ...results
      .filter((message) => typeof message.result === 'string' && message.result.includes(token))
      .map((message) => message.turn),
  ])]
  const thinkingTurnsContaining = (token) => [...new Set(
    assistants.filter((message) => message.thinking.includes(token)).map((message) => message.turn),
  )]
  const nonceInTextTurns = textTurnsContaining(nonce)
  const nonceInThinkingTurns = thinkingTurnsContaining(nonce)
  const originalTurns = textTurnsContaining(original)
  const followUpRecoveredTurns = textTurnsContaining(followUpToken)
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

  const gapEvents = gapStartedAt == null || gapEndedAt == null
    ? []
    : events.filter((event) => event.at >= gapStartedAt && event.at <= gapEndedAt && event.turn > 1)
  const gapAssistants = assistants.filter((message) => (
    gapStartedAt != null
    && gapEndedAt != null
    && message.at >= gapStartedAt
    && message.at <= gapEndedAt
    && message.turn > 1
  ))
  const gapResults = results.filter((message) => (
    gapStartedAt != null
    && gapEndedAt != null
    && message.at >= gapStartedAt
    && message.at <= gapEndedAt
    && message.turn > 1
  ))
  const gapTurnStarted = gapEvents.some((event) => (
    event.type === 'assistant'
    || event.type === 'result'
    || event.type === 'user'
    || event.type === 'system'
  ))
  const gapActivityObserved = gapEvents.length > 0
  const gapTurnOutput = {
    assistantText: gapAssistants.map((message) => ({ turn: message.turn, at: message.at, text: message.text })),
    assistantThinking: gapAssistants.map((message) => ({ turn: message.turn, at: message.at, thinking: message.thinking })),
    results: gapResults.map((message) => ({ turn: message.turn, at: message.at, result: message.result })),
    eventTypes: gapEvents.map((event) => ({ turn: event.turn, at: event.at, type: event.type, subtype: event.subtype })),
  }
  const nonceInGapText = gapAssistants.some((message) => message.text.includes(nonce))
    || gapResults.some((message) => typeof message.result === 'string' && message.result.includes(nonce))
  const nonceInGapThinking = gapAssistants.some((message) => message.thinking.includes(nonce))

  // millisecond timestamp 동률로 neutral result 를 probe result 로 잘못 세지 않도록 turn 경계를 쓴다.
  const probeAssistants = assistants.filter((message) => (
    neutralFollowUpResultTurn != null && message.turn > neutralFollowUpResultTurn
  ))
  const probeResults = results.filter((message) => (
    neutralFollowUpResultTurn != null && message.turn > neutralFollowUpResultTurn
  ))
  const probeOutput = {
    assistantText: probeAssistants.map((message) => ({ turn: message.turn, at: message.at, text: message.text })),
    assistantThinking: probeAssistants.map((message) => ({ turn: message.turn, at: message.at, thinking: message.thinking })),
    results: probeResults.map((message) => ({
      turn: message.turn,
      at: message.at,
      result: message.result,
      num_turns: message.num_turns,
    })),
  }
  const probeTurnObserved = probeResults.length > 0
  const probeNonceInText = probeAssistants.some((message) => message.text.includes(nonce))
    || probeResults.some((message) => typeof message.result === 'string' && message.result.includes(nonce))
  const probeNonceInThinking = probeAssistants.some((message) => message.thinking.includes(nonce))
  const probeReturnedNone = [
    ...probeAssistants.map((message) => message.text.trim()),
    ...probeResults.map((message) => typeof message.result === 'string' ? message.result.trim() : ''),
  ].includes('NONE')

  const transcript = readTranscriptEvidence({ sessionId, injectedMessageUuid, nonce, assistants })
  const transcriptDeliveryTurn = transcript.status === 'available'
    ? transcript.followingAssistant?.sdkTurn ?? null
    : null

  let originalTurnFate = 'undetermined'
  if (originalTurnEndedWhileFirstToolOutstanding) originalTurnFate = 'preempted'
  else if (firstResult && originalToolSequenceCompleted) originalTurnFate = 'completed'
  else if (firstResult) originalTurnFate = 'ended-incomplete'

  // Delivery timing is independent of original turn survival. Transcript ancestry is stronger than model obedience:
  // a delivered instruction may be ignored and therefore never echo its nonce.
  let injectedMessageFate = 'undetermined'
  if (transcriptDeliveryTurn === 1 || nonceInTextTurns.includes(1) || nonceInThinkingTurns.includes(1)) {
    injectedMessageFate = 'joined-in-flight'
  } else if (
    (transcriptDeliveryTurn != null && transcriptDeliveryTurn > 1)
    || nonceInGapText
    || nonceInGapThinking
  ) {
    injectedMessageFate = 'delivered-next-turn'
  } else if (
    transcript.status === 'available'
    && transcript.injectedMessageAppears === false
    && probeTurnObserved
    && probeReturnedNone
    && !probeNonceInText
    && !probeNonceInThinking
    && nonceInTextTurns.length === 0
    && nonceInThinkingTurns.length === 0
  ) {
    injectedMessageFate = 'discarded'
  }

  const turn2ToolUses = assistants
    .filter((message) => message.turn === 2)
    .flatMap((message) => message.toolUses)
    .filter((use) => use.name === TOOL_NAME)
  const turn2ToolResults = terminalToolResults.filter((result) => result.turn === 2)
  const turn2StreamClosedToolResults = turn2ToolResults.filter((result) => (
    result.isError && result.text.includes('Stream closed')
  ))
  const preemptedResultSurface = originalTurnFate === 'preempted' && firstResult
    ? {
        subtype: firstResult.subtype,
        is_error: firstResult.is_error,
        result: firstResult.result,
        num_turns: firstResult.num_turns,
        stop_reason: firstResult.stop_reason,
      }
    : null
  const postPreemptionMcpBridge = {
    applicable: originalTurnFate === 'preempted',
    turn2ToolUseSteps: turn2ToolUses.map((use) => use.input?.step ?? null),
    turn2ToolResultCount: turn2ToolResults.length,
    turn2StreamClosedCount: turn2StreamClosedToolResults.length,
    allObservedTurn2ToolResultsWereStreamClosed: turn2ToolResults.length > 0
      && turn2StreamClosedToolResults.length === turn2ToolResults.length,
    confound:
      'The test held the first in-process MCP body across preemption; Stream closed may be caused by that gate/stream lifecycle, so this is record-only and not a dead-bridge conclusion.',
  }

  const originalTurnFateEvidence = {
    originalToolSequenceCompleted,
    originalTurnEndedWhileFirstToolOutstanding,
    firstInFlightToolSurvived,
    toolSteps,
    successfulSequenceToolResultCount: successfulSequenceToolResults.length,
    firstResult: firstResult
      ? { turn: firstResult.turn, at: firstResult.at, subtype: firstResult.subtype, isError: firstResult.isError }
      : null,
  }
  const injectedMessageFateEvidence = {
    nonceInText: nonceInTextTurns.length > 0,
    nonceInTextTurns,
    nonceInThinking: nonceInThinkingTurns.length > 0,
    nonceInThinkingTurns,
    gapTurnStarted,
    gapActivityObserved,
    nonceInGapText,
    nonceInGapThinking,
    probeNonceInText,
    probeNonceInThinking,
    probeProvesDelivery: probeNonceInText || probeNonceInThinking,
    probeReturnedNone,
    transcriptEvidence: transcript.status,
    transcriptDeliveryTurn,
    transcriptInjectedMessageAppears: transcript.status === 'available'
      ? transcript.injectedMessageAppears
      : null,
    transcriptQueuedCommandAttachment: transcript.status === 'available'
      ? transcript.queuedCommandAttachment
      : null,
  }

  return {
    priority: priority ?? null,
    nonce,
    original,
    followUpToken,
    initialMessageUuid,
    injectedMessageUuid,
    followUpMessageUuid,
    probeMessageUuid,
    sessionId,
    session_id: sessionId,
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
      queuedTurnGapMs: QUEUED_TURN_GAP_MS,
      gapStartedAt,
      gapEndedAt,
      followUpYieldedAt,
      followUpWrittenAt,
      neutralFollowUpResultAt,
      neutralFollowUpResultTurn,
      probeYieldedAt,
      probeWrittenAt,
    },
    injectionOverlappedFirstTool,
    originalTurnFate,
    injectedMessageFate,
    originalTurnFateEvidence,
    injectedMessageFateEvidence,
    gapTurnStarted,
    gapActivityObserved,
    gapTurnOutput,
    probeTurnObserved,
    probeOutput,
    probeNonceInText,
    probeNonceInThinking,
    probeProvesDelivery: probeNonceInText || probeNonceInThinking,
    probeReturnedNone,
    transcriptEvidence: transcript.status,
    transcript,
    nonceInText: nonceInTextTurns.length > 0,
    nonceInTextTurns,
    nonceInThinking: nonceInThinkingTurns.length > 0,
    nonceInThinkingTurns,
    originalTurns,
    followUpRecoveredTurns,
    followUpObserved,
    originalToolSequenceCompleted,
    toolCalls,
    terminalToolResults,
    firstInFlightToolSurvived,
    preemptedResultSurface,
    postPreemptionMcpBridge,
    turnCount: results.length,
    resultCount: results.length,
    resultNumTurns: results.map((result) => ({ turn: result.turn, num_turns: result.num_turns })),
    resultNumTurnValues: results.map((result) => result.num_turns),
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
      expect(observation.timing.firstResultAt, '원래 turn 의 result 경계를 관측하지 못했다').not.toBeNull()
      expect(observation.timing.gapStartedAt, 'queued-message 관측 gap 을 시작하지 못했다').not.toBeNull()
      expect(observation.timing.gapEndedAt, 'queued-message 관측 gap 을 닫지 못했다').not.toBeNull()
      expect(
        observation.timing.gapEndedAt - observation.timing.gapStartedAt,
        'neutral follow-up 전 독립 관측 gap 이 너무 짧았다',
      ).toBeGreaterThanOrEqual(QUEUED_TURN_GAP_MS)
      expect(observation.timing.followUpWrittenAt, '첫 result 뒤 neutral follow-up 을 write 하지 못했다').not.toBeNull()
      expect(observation.followUpObserved, 'neutral follow-up token 을 뒤 turn 에서 회수하지 못했다').toBe(true)
      expect(observation.timing.probeWrittenAt, 'neutral 완료 뒤 독립 probe 를 write 하지 못했다').not.toBeNull()
      expect(observation.probeTurnObserved, '독립 probe 의 result 경계를 관측하지 못했다').toBe(true)
      expect(observation.turnCount, '원래/neutral/probe turn 경계를 모두 관측하지 못했다').toBeGreaterThanOrEqual(3)
      expect(['available', 'unavailable']).toContain(observation.transcriptEvidence)
    }, 8 * 60 * 1000)
  }
})
