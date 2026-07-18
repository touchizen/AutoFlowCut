/**
 * M0-18 — Claude Agent SDK abort/result correlation + context-preserving admission 계약.
 *
 * **코드 저작이 아니라 측정이다.** 결과가 D3 "Stop = 조용한 중단, 대화 맥락 유지"를 그대로
 * 구현할 수 있는지, 아니면 fail-safe session close가 필요한지를 정한다. 제품 코드(`src/`,
 * `electron/`)는 import하거나 변경하지 않는다.
 *
 * 이미 clean run으로 닫힌 전제(재협상하지 않는다):
 *   - m0-16: priority:'now' A는 T를 preempt하고 자기 다음 turn을 돈다. plain S는 in-flight T에
 *     합쳐진다. priority:'now' 뒤 in-process MCP bridge는 살아 있었다.
 *   - m0-17: direct interrupt()는 T를 자르지만 그 session의 in-process MCP bridge를 영구히 죽인다.
 *     resume + 새 SDK MCP server로도 복구되지 않았다. 따라서 interrupt arm은 정보 획득 전용이다.
 *
 * 이 파일이 재는 명제:
 *   H1 result identity — A 뒤 모든 result의 전체 surface/key path를 보존하고 input uuid/priority/kind/
 *      turn target과 연결되는 top-level signal이 있는지 기록한다.
 *   H2 cancel timing — 실제 tool body가 열린 동안 A/S를 write한 직후의 early cancel과, A/S 지시로
 *      delivery_probe tool body에 실제 진입한 뒤의 late cancel을 분리해 cancelled boolean을 기록한다.
 *   H3 interrupt receipt — 버릴 별도 session에서 S와 A를 write한 뒤 interrupt() receipt의
 *      still_queued가 어느 uuid를 담는지 기록한다. 이 arm은 제품 abort 경로 후보가 아니다.
 *   H4 context + next send — A의 독립 turn을 test-only ordinal barrier로 완전히 관측한 뒤, A nonce를
 *      언급하지 않는 fresh input이 초기 memory token을 회수하는지 잰다.
 *   H5 admission — A early cancel 반환 + 첫 result 경계가 제품에서 쓸 수 있는 barrier인지 별도 arm에서
 *      잰다. result ordinal이나 transcript ancestry는 사후 측정 장치일 뿐 제품 barrier로 승격하지 않는다.
 *
 * 🔴 negative control / mutant:
 *   - 첫 live arm은 A를 전혀 넣지 않는다. 같은 detector가 abort write/nonce/ancestry 부재를 보고하는지
 *     먼저 확인해 "신호 없음"과 "장치 고장"을 구분한다.
 *   - SPIKE_MUTANT=m0-18-omit-abort이면 H1/H4 treatment에서도 A만 생략한다. clean treatment의
 *     abortTransportWriteSeen:true가 mutant에서 false로 뒤집혀야 한다. provenance stamp가 둘을 구분한다.
 *
 * 🔴 confound 방지:
 *   - early/late cancel fate arm에는 후속 input을 전혀 쓰지 않는다.
 *   - H4 arm은 A가 낸 것으로 추정하는 두 번째 result를 받은 뒤 5초 동안 input을 쓰지 않고, event-index
 *     경계도 함께 보존한다. 그 뒤의 follow-up은 A fate/result surface를 판정하는 입력으로 쓰지 않는다.
 *   - H5 admission arm은 의도적으로 첫 result 뒤 다음 input을 admission한다. 이 arm의 output은 A fate를
 *     판정하지 않으며, fate는 독립 arm이 담당한다. 같은-ms는 timestamp가 아니라 event/result ordinal로
 *     구분한다.
 *   - originalTurnFate / injectedFate / cancelResult / contextFate / admissionSafe를 독립 필드로 남긴다.
 *     어느 축도 다른 축의 계산을 short-circuit하지 않는다.
 *
 * 🔴 assertion 규율:
 *   - cancelled 값, fate, memory survived/lost, admission yes/no는 절대 요구하지 않는다.
 *   - tool body 진입, injection transport write, cancel/interrupt settle, 필요한 result 경계, transcript
 *     available|unavailable 분류처럼 관측 장치가 닫힌 것만 assert한다.
 *   - arm당 n=1이다. transcript 파일 부재/parse 실패는 unavailable이지 discarded가 아니다.
 *
 * ⚠️ 개인 ~/.claude와 SessionStart hook은 격리되지 않은 통제 불능 변수다. 실제 Claude CLI 구독
 * 자격증명과 네트워크를 쓴다. 컨트롤러는 반드시 host에서 아래처럼 실행한다.
 *
 * clean:
 *   cd /Users/tuxxon/workspace/AutoFlowCut && npm run test:spike -- tests/spike/m0-18.claudeAbortCorrelation.spike.test.js
 * negative mutant:
 *   cd /Users/tuxxon/workspace/AutoFlowCut && SPIKE_MUTANT=m0-18-omit-abort npm run test:spike -- tests/spike/m0-18.claudeAbortCorrelation.spike.test.js
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
const RAW = `${RESULT_DIR}/m0-18-raw.jsonl`
const SERVER_NAME = 'm0-18-abort'
const SEQUENCE_TOOL_NAME = `mcp__${SERVER_NAME}__sequence_step`
const DELIVERY_TOOL_NAME = `mcp__${SERVER_NAME}__delivery_probe`
const IN_FLIGHT_HOLD_AFTER_WRITE_MS = 750
const CONTEXT_FATE_GAP_MS = 5_000
const TRANSCRIPT_SETTLE_MS = 500
// 반드시 it()의 11분 timeout보다 작아야 deadline 관측이 raw에 먼저 남는다.
const MEASUREMENT_DEADLINE_MS = 10 * 60 * 1000
const MUTANT_OMIT_ABORT = process.env.SPIKE_MUTANT === 'm0-18-omit-abort'

const SDK_DTS = readFileSync(
  new URL('../../node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts', import.meta.url),
  'utf-8',
)
const SDK_MJS = readFileSync(
  new URL('../../node_modules/@anthropic-ai/claude-agent-sdk/sdk.mjs', import.meta.url),
  'utf-8',
)
const SDK_VERSION = JSON.parse(readFileSync(
  new URL('../../node_modules/@anthropic-ai/claude-agent-sdk/package.json', import.meta.url),
  'utf-8',
)).version

const gitSha = (() => {
  try { return execFileSync('git', ['rev-parse', '--short', 'HEAD'], { encoding: 'utf-8' }).trim() } catch { return null }
})()
const gitDirty = (() => {
  try { return execFileSync('git', ['status', '--porcelain'], { encoding: 'utf-8' }).trim().length > 0 } catch { return null }
})()

const environment = {
  n: 1,
  claudeState: 'personal ~/.claude (not isolated)',
  sessionStartHook: 'uncontrolled variable',
  credentials: 'host Claude CLI subscription credentials',
  network: 'live',
}

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

function allKeyPaths(value, prefix = '', seen = new Set()) {
  if (value == null || typeof value !== 'object' || seen.has(value)) return []
  seen.add(value)
  const paths = []
  for (const [key, child] of Object.entries(value)) {
    const path = prefix ? `${prefix}.${key}` : key
    paths.push(path)
    paths.push(...allKeyPaths(child, path, seen))
  }
  return paths
}

function readTranscriptEvidence({ sessionId, trackedMessages, assistants }) {
  if (!sessionId) {
    return { status: 'unavailable', reason: 'SDK stream exposed no session_id', path: null, messages: {} }
  }

  const projectSlug = process.cwd().replace(/[^A-Za-z0-9]/g, '-')
  const path = join(homedir(), '.claude', 'projects', projectSlug, `${sessionId}.jsonl`)
  if (!existsSync(path)) {
    return { status: 'unavailable', reason: 'session transcript file not found', path, messages: {} }
  }

  try {
    const rows = readFileSync(path, 'utf-8')
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line))
    const byUuid = new Map(rows.filter((row) => row.uuid).map((row) => [row.uuid, row]))
    const assistantTurnByUuid = new Map(assistants.map((message) => [message.uuid, message.turn]))

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

    const messages = Object.fromEntries(trackedMessages.map((tracked) => {
      const directMessageIndices = rows
        .map((row, index) => row.uuid === tracked.uuid ? index : -1)
        .filter((index) => index >= 0)
      const queuedCommandAttachmentIndices = rows
        .map((row, index) => (
          row.type === 'attachment'
          && row.attachment?.type === 'queued_command'
          && row.attachment?.source_uuid === tracked.uuid
        ) ? index : -1)
        .filter((index) => index >= 0)
      const rootIndices = [...new Set([
        ...directMessageIndices,
        ...queuedCommandAttachmentIndices,
      ])].sort((a, b) => a - b)
      const deliveryRoots = rootIndices.map((index) => ({
        index,
        kind: queuedCommandAttachmentIndices.includes(index) ? 'queued_command' : 'direct-user-message',
        uuid: rows[index]?.uuid ?? null,
        parentUuid: rows[index]?.parentUuid ?? null,
        sourceUuid: rows[index]?.attachment?.source_uuid ?? tracked.uuid,
      }))
      const followingAssistants = []
      for (const root of deliveryRoots) {
        if (!root.uuid) continue
        for (let index = root.index + 1; index < rows.length; index += 1) {
          const row = rows[index]
          if (row.type !== 'assistant' || !row.uuid) continue
          const ancestry = ancestryFrom(row, root.uuid)
          if (!ancestry) continue
          followingAssistants.push({
            index,
            uuid: row.uuid,
            parentUuid: row.parentUuid ?? null,
            sdkTurn: assistantTurnByUuid.get(row.uuid) ?? null,
            rootUuid: root.uuid,
            directChild: row.parentUuid === root.uuid,
            ancestry,
          })
        }
      }
      const uniqueFollowingAssistants = [...new Map(
        followingAssistants.map((assistant) => [assistant.uuid, assistant]),
      ).values()].sort((a, b) => a.index - b.index)

      return [tracked.label, {
        uuid: tracked.uuid,
        nonce: tracked.nonce ?? null,
        appears: rootIndices.length > 0,
        directMessageIndices,
        queuedCommandAttachmentIndices,
        deliveryRoots,
        followingAssistants: uniqueFollowingAssistants,
        firstFollowingAssistant: uniqueFollowingAssistants[0] ?? null,
        assistantTurns: [...new Set(uniqueFollowingAssistants
          .map((assistant) => assistant.sdkTurn)
          .filter((turn) => turn != null))],
        transcriptContainsNonce: tracked.nonce
          ? rows.some((row) => JSON.stringify(row).includes(tracked.nonce))
          : null,
      }]
    }))

    return {
      status: 'available',
      path,
      parsedRowCount: rows.length,
      messages,
    }
  } catch (error) {
    return {
      status: 'unavailable',
      reason: String(error?.message || error),
      path,
      messages: {},
    }
  }
}

const makeToken = (prefix) => `${prefix}_${randomUUID().replaceAll('-', '').slice(0, 12).toUpperCase()}`

function injectionPrompt({ kind, nonce, cancelTiming }) {
  if (cancelTiming === 'late') {
    const lead = kind === 'A'
      ? 'Stop the prior task now. This message must run as its own current task.'
      : 'Live correction for the in-flight task. Keep the existing sequence alive.'
    return `${lead} Call ${DELIVERY_TOOL_NAME} exactly once with `
      + `{"kind":"${kind}","nonce":"${nonce}"}. Wait for its result, then reply with exactly ${nonce}.`
  }
  if (kind === 'A') {
    return `Stop the prior task now. Reply with exactly ${nonce} and nothing else.`
  }
  return `Live correction. Keep the in-flight sequence alive, but change only its final reply to exactly ${nonce}.`
}

async function measureInjectionArm({
  arm,
  injectionKind,
  cancelTiming = 'none',
  sendFollowUp = false,
  followUpBarrierOrdinal = null,
  followUpGapMs = 0,
  omitInjection = false,
  negativeControl = false,
}) {
  const startedAt = Date.now()
  const at = () => Date.now() - startedAt
  const effectiveInjectionKind = omitInjection ? null : injectionKind
  const initialMessageUuid = randomUUID()
  const injectedMessageUuid = randomUUID()
  const followUpMessageUuid = randomUUID()
  const memoryToken = makeToken('M0_18_MEMORY')
  const originalToken = makeToken('M0_18_ORIGINAL')
  const injectedNonce = makeToken(`M0_18_${injectionKind ?? 'NO_ABORT'}`)
  const followUpToken = makeToken('M0_18_NEXT')
  const toolCalls = []
  const terminalToolResults = []
  const assistants = []
  const results = []
  const events = []

  let sessionId = null
  let firstToolStartedAt = null
  let firstToolReleasedAt = null
  let injectionYieldedAt = null
  let injectionWrittenAt = null
  let deliveryProbeStartedAt = null
  let deliveryProbeReleasedAt = null
  let followUpBarrierReachedAt = null
  let followUpBarrierEventIndex = null
  let followUpYieldedAt = null
  let followUpWrittenAt = null
  let followUpWriteEventIndex = null
  let contextGapStartedAt = null
  let contextGapEndedAt = null
  let contextGapStartEventIndex = null
  let contextGapEndEventIndex = null
  let streamError = null
  let timedOut = false
  let querySurface = null
  let cancelResult = {
    timing: cancelTiming,
    calledAt: null,
    settledAt: null,
    settledAs: 'not-called',
    cancelled: null,
    error: null,
  }

  let signalFirstToolStarted
  const firstToolStarted = new Promise((resolve) => { signalFirstToolStarted = resolve })
  let releaseFirstTool
  const firstToolGate = new Promise((resolve) => { releaseFirstTool = resolve })
  let signalDeliveryProbeStarted
  const deliveryProbeStarted = new Promise((resolve) => { signalDeliveryProbeStarted = resolve })
  let releaseDeliveryProbe
  const deliveryProbeGate = new Promise((resolve) => { releaseDeliveryProbe = resolve })
  let stopPromptInput
  const promptInputStopped = new Promise((resolve) => { stopPromptInput = resolve })
  const resultWaiters = []
  const waitForResultCount = (count) => {
    if (results.length >= count) return Promise.resolve('result-reached')
    return new Promise((resolve) => { resultWaiters.push({ count, resolve }) })
  }
  const settleResultWaiters = () => {
    for (const waiter of resultWaiters) {
      if (results.length >= waiter.count) waiter.resolve('result-reached')
    }
  }

  const server = createSdkMcpServer({
    name: SERVER_NAME,
    version: '0.0.1',
    tools: [
      tool(
        'sequence_step',
        'Returns a marker for one numbered step. Call it once for each requested step, in order.',
        { step: z.number().int().min(1).max(3) },
        async ({ step }, extra) => {
          const signal = extra && typeof extra === 'object' && 'signal' in extra ? extra.signal : null
          const call = {
            tool: 'sequence_step',
            ordinal: toolCalls.filter((item) => item.tool === 'sequence_step').length + 1,
            step,
            startedAt: at(),
            endedAt: null,
            signalPresent: Boolean(signal && typeof signal.addEventListener === 'function'),
            signalAbortedAtStart: signal?.aborted === true,
            signalAbortedAt: null,
            signalAbortReason: null,
          }
          toolCalls.push(call)
          const onAbort = () => {
            call.signalAbortedAt ??= at()
            call.signalAbortReason ??= errorSurface(signal?.reason)
          }
          signal?.addEventListener?.('abort', onAbort, { once: true })
          try {
            if (call.ordinal === 1) {
              firstToolStartedAt = call.startedAt
              signalFirstToolStarted()
              await firstToolGate
            }
            return { content: [{ type: 'text', text: `M0_18_SEQUENCE_OK:${step}:CALL_${call.ordinal}` }] }
          } finally {
            if (signal?.aborted === true) onAbort()
            signal?.removeEventListener?.('abort', onAbort)
            call.endedAt = at()
          }
        },
        { alwaysLoad: true },
      ),
      tool(
        'delivery_probe',
        'Returns the exact nonce after the message carrying that nonce has actually reached tool execution.',
        { kind: z.enum(['A', 'S']), nonce: z.string().min(1) },
        async ({ kind, nonce }, extra) => {
          const signal = extra && typeof extra === 'object' && 'signal' in extra ? extra.signal : null
          const call = {
            tool: 'delivery_probe',
            ordinal: toolCalls.filter((item) => item.tool === 'delivery_probe').length + 1,
            kind,
            nonce,
            startedAt: at(),
            endedAt: null,
            signalPresent: Boolean(signal && typeof signal.addEventListener === 'function'),
            signalAbortedAtStart: signal?.aborted === true,
            signalAbortedAt: null,
            signalAbortReason: null,
          }
          toolCalls.push(call)
          const onAbort = () => {
            call.signalAbortedAt ??= at()
            call.signalAbortReason ??= errorSurface(signal?.reason)
          }
          signal?.addEventListener?.('abort', onAbort, { once: true })
          try {
            deliveryProbeStartedAt = call.startedAt
            signalDeliveryProbeStarted()
            await deliveryProbeGate
            return { content: [{ type: 'text', text: `M0_18_DELIVERY_OK:${kind}:${nonce}` }] }
          } finally {
            if (signal?.aborted === true) onAbort()
            signal?.removeEventListener?.('abort', onAbort)
            call.endedAt = at()
          }
        },
        { alwaysLoad: true },
      ),
    ],
  })

  let q = null
  const performCancel = async () => {
    cancelResult = {
      timing: cancelTiming,
      calledAt: at(),
      settledAt: null,
      settledAs: 'pending',
      cancelled: null,
      error: null,
      resultCountAtCall: results.length,
      eventCountAtCall: events.length,
    }
    try {
      cancelResult.cancelled = await q.cancelAsyncMessage(injectedMessageUuid)
      cancelResult.settledAs = 'returned'
    } catch (error) {
      cancelResult.settledAs = 'threw'
      cancelResult.error = errorSurface(error)
    } finally {
      cancelResult.settledAt = at()
      cancelResult.resultCountAtSettle = results.length
      cancelResult.eventCountAtSettle = events.length
    }
  }

  async function* prompts() {
    yield {
      type: 'user',
      uuid: initialMessageUuid,
      message: {
        role: 'user',
        content:
          `Remember this unique token for a later user turn: ${memoryToken}. Do not repeat it now. `
          + `Call ${SEQUENCE_TOOL_NAME} exactly three times sequentially with step 1, then 2, then 3. `
          + `Wait for each tool result. After all three results reply with exactly ${originalToken}.`,
      },
    }

    const startOutcome = await Promise.race([
      firstToolStarted.then(() => 'tool-started'),
      promptInputStopped.then(() => 'input-stopped'),
    ])
    if (startOutcome === 'input-stopped') return

    if (effectiveInjectionKind) {
      injectionYieldedAt = at()
      yield {
        type: 'user',
        uuid: injectedMessageUuid,
        ...(effectiveInjectionKind === 'A' ? { priority: 'now' } : {}),
        message: {
          role: 'user',
          content: injectionPrompt({
            kind: effectiveInjectionKind,
            nonce: injectedNonce,
            cancelTiming,
          }),
        },
      }
      // generator resume = streamInput transport.write 완료. 실제 body는 아래 hold 동안 계속 gate되어 있다.
      injectionWrittenAt = at()

      if (cancelTiming === 'early') await performCancel()

      const holdOutcome = await Promise.race([
        sleep(IN_FLIGHT_HOLD_AFTER_WRITE_MS).then(() => 'hold-elapsed'),
        promptInputStopped.then(() => 'input-stopped'),
      ])
      if (holdOutcome === 'input-stopped') return
    }

    firstToolReleasedAt = at()
    releaseFirstTool()

    if (effectiveInjectionKind && cancelTiming === 'late') {
      const deliveryOutcome = await Promise.race([
        deliveryProbeStarted.then(() => 'delivery-probe-started'),
        promptInputStopped.then(() => 'input-stopped'),
      ])
      if (deliveryOutcome === 'input-stopped') return
      await performCancel()
      deliveryProbeReleasedAt = at()
      releaseDeliveryProbe()
    }

    if (!sendFollowUp) return

    const barrierOrdinal = effectiveInjectionKind
      ? followUpBarrierOrdinal
      : 1
    const barrierOutcome = await Promise.race([
      waitForResultCount(barrierOrdinal),
      promptInputStopped.then(() => 'input-stopped'),
    ])
    if (barrierOutcome === 'input-stopped') return
    followUpBarrierReachedAt = at()
    followUpBarrierEventIndex = events.length

    if (followUpGapMs > 0) {
      contextGapStartedAt = at()
      contextGapStartEventIndex = events.length
      const gapOutcome = await Promise.race([
        sleep(followUpGapMs).then(() => 'gap-elapsed'),
        promptInputStopped.then(() => 'input-stopped'),
      ])
      if (gapOutcome === 'input-stopped') return
      contextGapEndedAt = at()
      contextGapEndEventIndex = events.length
    }

    followUpYieldedAt = at()
    yield {
      type: 'user',
      uuid: followUpMessageUuid,
      message: {
        role: 'user',
        // memoryToken/injectedNonce를 다시 써서 양성 증거를 prompt가 만들어내지 않는다.
        content:
          `This is a new user turn. Reply on one line as NEXT:${followUpToken}|MEMORY:<the exact unique token `
          + 'from the earliest user turn, or NOT_FOUND if unavailable>. Do not use tools.',
      },
    }
    followUpWrittenAt = at()
    followUpWriteEventIndex = events.length
  }

  q = query({
    prompt: prompts(),
    options: {
      mcpServers: { [SERVER_NAME]: server },
      tools: [SEQUENCE_TOOL_NAME, DELIVERY_TOOL_NAME],
      allowedTools: [SEQUENCE_TOOL_NAME, DELIVERY_TOOL_NAME],
      permissionMode: 'bypassPermissions',
      allowDangerouslySkipPermissions: true,
      maxTurns: 20,
      model: 'sonnet',
    },
  })
  querySurface = {
    streamInput: typeof q.streamInput,
    steer: typeof q.steer,
    interrupt: typeof q.interrupt,
    // runtime에는 있지만 public sdk.d.ts Query에는 선언되지 않은 표면이다.
    cancelAsyncMessage: typeof q.cancelAsyncMessage,
  }

  const deadline = setTimeout(() => {
    timedOut = true
    stopPromptInput()
    releaseFirstTool()
    releaseDeliveryProbe()
    q.close()
  }, MEASUREMENT_DEADLINE_MS)

  let turn = 1
  try {
    for await (const msg of q) {
      sessionId ??= msg.session_id ?? null
      const event = {
        index: events.length,
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
          sessionId: msg.session_id ?? null,
          text: textOf(blocks),
          thinking: thinkingOf(blocks),
          toolUses: blocks
            .filter((block) => block?.type === 'tool_use')
            .map((block) => ({ id: block.id, name: block.name, input: snapshot(block.input) })),
          fullSurface: snapshot(msg),
        }
        assistants.push(assistant)
        event.text = assistant.text
        event.thinking = assistant.thinking
        event.toolUses = assistant.toolUses
      }

      const blocks = msg?.message?.content
      if (Array.isArray(blocks)) {
        event.toolResults = []
        for (const block of blocks) {
          if (block?.type !== 'tool_result') continue
          const terminal = {
            at: event.at,
            turn,
            toolUseId: block.tool_use_id ?? null,
            isError: block.is_error === true,
            text: JSON.stringify(block.content) ?? '',
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
          keys: Object.keys(msg),
          allKeyPaths: allKeyPaths(msg),
          fullSurface: snapshot(msg),
        }
        results.push(result)
        event.result = result.fullSurface
        events.push(event)
        settleResultWaiters()

        // tool/auth/model failure가 generator gate를 영원히 붙들지 않게 한다.
        if (firstToolStartedAt == null) stopPromptInput()
        if (
          cancelTiming === 'late'
          && deliveryProbeStartedAt == null
          && results.length >= (effectiveInjectionKind === 'A' ? 2 : 1)
        ) {
          stopPromptInput()
        }

        turn += 1
        continue
      }

      events.push(event)
    }
  } catch (error) {
    streamError = errorSurface(error)
    stopPromptInput()
  } finally {
    clearTimeout(deadline)
    stopPromptInput()
    releaseFirstTool()
    releaseDeliveryProbe()
    q.close()
  }

  await sleep(TRANSCRIPT_SETTLE_MS)

  const firstSequenceCall = toolCalls.find((call) => call.tool === 'sequence_step') ?? null
  const sequenceCalls = toolCalls.filter((call) => call.tool === 'sequence_step')
  const deliveryProbeCalls = toolCalls.filter((call) => call.tool === 'delivery_probe')
  const firstResult = results[0] ?? null
  const originalSequenceCompleted = (
    JSON.stringify(sequenceCalls.map((call) => call.step)) === JSON.stringify([1, 2, 3])
    && sequenceCalls.every((call) => call.endedAt != null)
    && terminalToolResults.filter((result) => (
      !result.isError && result.text.includes('M0_18_SEQUENCE_OK:')
    )).length >= 3
  )
  const injectionOverlappedOriginalTool = Boolean(
    firstSequenceCall
    && injectionWrittenAt != null
    && firstSequenceCall.startedAt <= injectionWrittenAt
    && (firstSequenceCall.endedAt == null || firstSequenceCall.endedAt >= injectionWrittenAt),
  )
  const cancelOverlappedOriginalTool = Boolean(
    firstSequenceCall
    && cancelTiming === 'early'
    && cancelResult.calledAt != null
    && firstSequenceCall.startedAt <= cancelResult.calledAt
    && (firstSequenceCall.endedAt == null || firstSequenceCall.endedAt >= cancelResult.calledAt),
  )
  const firstDeliveryProbeCall = deliveryProbeCalls[0] ?? null
  const cancelOverlappedDeliveryProbe = Boolean(
    firstDeliveryProbeCall
    && cancelTiming === 'late'
    && cancelResult.calledAt != null
    && firstDeliveryProbeCall.startedAt <= cancelResult.calledAt
    && (firstDeliveryProbeCall.endedAt == null || firstDeliveryProbeCall.endedAt >= cancelResult.calledAt),
  )

  let originalTurnFate = 'undetermined'
  const originalEndedWithFirstBodyOutstanding = Boolean(
    firstResult
    && firstSequenceCall
    && firstResult.at >= firstSequenceCall.startedAt
    && firstResult.at < firstSequenceCall.endedAt,
  )
  const originalToolSignalAborted = firstSequenceCall?.signalAbortedAt != null
  if (firstResult && originalSequenceCompleted) originalTurnFate = 'completed'
  else if (firstResult && (originalEndedWithFirstBodyOutstanding || originalToolSignalAborted)) {
    originalTurnFate = 'preempted'
  } else if (firstResult) originalTurnFate = 'ended-incomplete'

  const trackedMessages = [
    ...(effectiveInjectionKind ? [{
      label: effectiveInjectionKind,
      uuid: injectedMessageUuid,
      nonce: injectedNonce,
    }] : []),
    ...(sendFollowUp ? [{ label: 'followUp', uuid: followUpMessageUuid, nonce: followUpToken }] : []),
  ]
  const transcript = readTranscriptEvidence({ sessionId, trackedMessages, assistants })

  const turnsContaining = (token, { beforeFollowUp = false } = {}) => [...new Set([
    ...assistants
      .filter((message) => (!beforeFollowUp || followUpWrittenAt == null || message.at < followUpWrittenAt))
      .filter((message) => message.text.includes(token) || message.thinking.includes(token))
      .map((message) => message.turn),
    ...results
      .filter((message) => (!beforeFollowUp || followUpWrittenAt == null || message.at < followUpWrittenAt))
      .filter((message) => JSON.stringify(message.fullSurface).includes(token))
      .map((message) => message.turn),
  ])]
  const injectedNonceTurnsBeforeFollowUp = effectiveInjectionKind
    ? turnsContaining(injectedNonce, { beforeFollowUp: true })
    : []
  const transcriptInjected = effectiveInjectionKind && transcript.status === 'available'
    ? transcript.messages[effectiveInjectionKind] ?? null
    : null
  const transcriptInjectedTurns = transcriptInjected?.assistantTurns ?? []

  let injectedFate = effectiveInjectionKind ? 'undetermined' : 'not-injected'
  if (effectiveInjectionKind && cancelResult.cancelled === true) {
    injectedFate = 'cancelled-while-queued'
  } else if (
    effectiveInjectionKind
    && (transcriptInjectedTurns.includes(1) || injectedNonceTurnsBeforeFollowUp.includes(1))
  ) {
    injectedFate = 'joined-in-flight'
  } else if (
    effectiveInjectionKind
    && (
      transcriptInjectedTurns.some((injectedTurn) => injectedTurn > 1)
      || injectedNonceTurnsBeforeFollowUp.some((injectedTurn) => injectedTurn > 1)
    )
  ) {
    injectedFate = 'delivered-next-turn'
  }

  const inputUuids = [initialMessageUuid, ...(effectiveInjectionKind ? [injectedMessageUuid] : []),
    ...(sendFollowUp ? [followUpMessageUuid] : [])]
  const resultIdentity = results.map((result) => {
    const full = result.fullSurface
    const topLevelEntries = Object.entries(full && typeof full === 'object' ? full : {})
    return {
      turn: result.turn,
      at: result.at,
      resultUuid: typeof full?.uuid === 'string' ? full.uuid : null,
      keys: result.keys,
      allKeyPaths: result.allKeyPaths,
      fullSurface: full,
      resultUuidMatchesInputUuid: inputUuids.includes(full?.uuid),
      topLevelValuesMatchingInputUuid: topLevelEntries
        .filter(([, value]) => typeof value === 'string' && inputUuids.includes(value))
        .map(([key, value]) => ({ key, value })),
      topLevelCandidateCorrelationFields: topLevelEntries
        .filter(([key]) => /(?:input.*uuid|message.*uuid|priority|turn.*target|target.*turn|input.*kind)/i.test(key))
        .map(([key, value]) => ({ key, value: snapshot(value) })),
    }
  })
  const resultCorrelationSignalPresent = resultIdentity.some((identity) => (
    identity.resultUuidMatchesInputUuid
    || identity.topLevelValuesMatchingInputUuid.length > 0
    || identity.topLevelCandidateCorrelationFields.length > 0
  ))

  const barrierOrdinal = sendFollowUp
    ? (effectiveInjectionKind ? followUpBarrierOrdinal : 1)
    : null
  const postFollowUpAssistants = barrierOrdinal == null
    ? []
    : assistants.filter((assistant) => assistant.turn > barrierOrdinal)
  const postFollowUpResults = barrierOrdinal == null
    ? []
    : results.filter((result) => result.turn > barrierOrdinal)
  const followUpResponseObserved = postFollowUpResults.length > 0
  const followUpTokenRecovered = postFollowUpAssistants.some((message) => message.text.includes(followUpToken))
    || postFollowUpResults.some((message) => JSON.stringify(message.fullSurface).includes(followUpToken))
  const memoryRecoveredAfterFollowUp = postFollowUpAssistants.some((message) => message.text.includes(memoryToken))
    || postFollowUpResults.some((message) => JSON.stringify(message.fullSurface).includes(memoryToken))
  const memoryExplicitlyNotFound = postFollowUpAssistants.some((message) => /MEMORY:NOT_FOUND/.test(message.text))
    || postFollowUpResults.some((message) => /MEMORY:NOT_FOUND/.test(JSON.stringify(message.fullSurface)))

  let contextFate = 'not-measured'
  if (sendFollowUp && followUpResponseObserved && memoryRecoveredAfterFollowUp) contextFate = 'preserved'
  else if (sendFollowUp && followUpResponseObserved && memoryExplicitlyNotFound) contextFate = 'lost'
  else if (sendFollowUp) contextFate = 'undetermined'

  const injectionFirstAssistantUuid = transcriptInjected?.firstFollowingAssistant?.uuid ?? null
  const followUpFirstAssistantUuid = transcript.status === 'available'
    ? transcript.messages.followUp?.firstFollowingAssistant?.uuid ?? null
    : null
  const transcriptShowsSameFirstAssistantForInjectionAndFollowUp = Boolean(
    injectionFirstAssistantUuid
    && followUpFirstAssistantUuid
    && injectionFirstAssistantUuid === followUpFirstAssistantUuid,
  )
  const contextGapEvents = Number.isInteger(contextGapStartEventIndex)
    && Number.isInteger(contextGapEndEventIndex)
    ? events.slice(contextGapStartEventIndex, contextGapEndEventIndex)
    : []

  const correlatedInjectedResultBeforeFollowUp = barrierOrdinal != null
    ? resultIdentity.slice(0, barrierOrdinal).some((identity) => (
        identity.resultUuidMatchesInputUuid
        && identity.resultUuid === injectedMessageUuid
      ))
    : false
  let productBarrierSignal = null
  if (
    effectiveInjectionKind === 'A'
    && cancelTiming === 'early'
    && cancelResult.cancelled === true
    && barrierOrdinal === 1
    && followUpBarrierReachedAt != null
  ) {
    productBarrierSignal = 'cancelAsyncMessage(A_uuid)===true + first result boundary'
  } else if (correlatedInjectedResultBeforeFollowUp) {
    productBarrierSignal = 'result explicitly correlated to A input uuid'
  }

  const knownSafeBeforeWrite = Boolean(productBarrierSignal)
  let admissionSafe = 'not-measured'
  if (sendFollowUp) {
    if (
      knownSafeBeforeWrite
      && originalTurnFate === 'preempted'
      && contextFate === 'preserved'
      && followUpResponseObserved
      && !transcriptShowsSameFirstAssistantForInjectionAndFollowUp
    ) admissionSafe = 'candidate-observed-safe'
    else if (knownSafeBeforeWrite && followUpResponseObserved) {
      admissionSafe = 'barrier-observed-but-H5-components-incomplete'
    }
    else if (!knownSafeBeforeWrite && followUpResponseObserved) admissionSafe = 'unproven-no-product-barrier'
    else admissionSafe = 'undetermined'
  }

  const sameSessionAcrossResults = results.length > 0
    && [...new Set(results.map((result) => result.fullSurface?.session_id).filter(Boolean))].length === 1
  const detectorCalibration = {
    negativeControl,
    configuredInjectionAbsent: effectiveInjectionKind == null,
    abortTransportWriteSeen: effectiveInjectionKind === 'A' && injectionWrittenAt != null,
    abortNonceSeenBeforeFollowUp: injectedNonceTurnsBeforeFollowUp.length > 0,
    abortTranscriptNodeSeen: transcript.status === 'available'
      ? transcript.messages.A?.appears ?? false
      : null,
  }
  detectorCalibration.apparatusRespondedToConfiguredAbsence = negativeControl
    ? detectorCalibration.configuredInjectionAbsent
      && detectorCalibration.abortTransportWriteSeen === false
      && detectorCalibration.abortNonceSeenBeforeFollowUp === false
    : null

  return {
    n: 1,
    arm,
    environment,
    configuredInjectionKind: injectionKind,
    effectiveInjectionKind,
    omitInjection,
    negativeControl,
    cancelTiming,
    initialMessageUuid,
    injectedMessageUuid: effectiveInjectionKind ? injectedMessageUuid : null,
    followUpMessageUuid: sendFollowUp ? followUpMessageUuid : null,
    memoryToken,
    originalToken,
    injectedNonce: effectiveInjectionKind ? injectedNonce : null,
    followUpToken: sendFollowUp ? followUpToken : null,
    sessionId,
    session_id: sessionId,
    querySurface,
    timing: {
      firstToolStartedAt,
      injectionYieldedAt,
      injectionWrittenAt,
      firstToolReleasedAt,
      firstToolEndedAt: firstSequenceCall?.endedAt ?? null,
      firstResultAt: firstResult?.at ?? null,
      deliveryProbeStartedAt,
      deliveryProbeReleasedAt,
      followUpBarrierOrdinal: barrierOrdinal,
      followUpBarrierReachedAt,
      followUpBarrierEventIndex,
      contextGapMs: followUpGapMs,
      contextGapStartedAt,
      contextGapEndedAt,
      contextGapStartEventIndex,
      contextGapEndEventIndex,
      followUpYieldedAt,
      followUpWrittenAt,
      followUpWriteEventIndex,
    },
    injectionOverlappedOriginalTool,
    cancelOverlappedOriginalTool,
    cancelOverlappedDeliveryProbe,
    cancelResult,
    originalTurnFate,
    originalTurnFateEvidence: {
      originalSequenceCompleted,
      originalEndedWithFirstBodyOutstanding,
      originalToolSignalAborted,
      sequenceSteps: sequenceCalls.map((call) => call.step),
      firstResult: firstResult ? { turn: firstResult.turn, at: firstResult.at } : null,
    },
    injectedFate,
    injectedFateEvidence: {
      injectedNonceTurnsBeforeFollowUp,
      transcriptStatus: transcript.status,
      transcriptInjectedAppears: transcriptInjected?.appears ?? null,
      transcriptInjectedAssistantTurns: transcriptInjectedTurns,
      deliveryProbeCallCount: deliveryProbeCalls.length,
    },
    contextFate,
    contextEvidence: {
      sameSessionAcrossResults,
      followUpResponseObserved,
      followUpTokenRecovered,
      memoryRecoveredAfterFollowUp,
      memoryExplicitlyNotFound,
      contextGapEventCount: contextGapEvents.length,
      contextGapEvents,
    },
    admissionSafe,
    admissionEvidence: {
      productBarrierSignal,
      knownSafeBeforeWrite,
      resultOrdinalBarrierIsTestOnly: barrierOrdinal != null && !productBarrierSignal,
      transcriptIsAfterTheFactOnly: true,
      correlatedInjectedResultBeforeFollowUp,
      resultCorrelationSignalPresent,
      transcriptShowsSameFirstAssistantForInjectionAndFollowUp,
      interruptReceiptEligibleForProductAbort: false,
      h5Components: {
        originalTurnPreempted: originalTurnFate === 'preempted',
        contextPreserved: contextFate === 'preserved',
        nextSendResponded: followUpResponseObserved,
        admissionKnownBeforeWrite: knownSafeBeforeWrite,
      },
    },
    detectorCalibration,
    resultIdentity,
    resultCount: results.length,
    results,
    assistants,
    toolCalls,
    terminalToolResults,
    transcriptEvidence: transcript.status,
    transcript,
    timedOut,
    streamError,
    events,
  }
}

async function measureInterruptReceiptArm() {
  const startedAt = Date.now()
  const at = () => Date.now() - startedAt
  const initialMessageUuid = randomUUID()
  const steerMessageUuid = randomUUID()
  const abortMessageUuid = randomUUID()
  const steerNonce = makeToken('M0_18_RECEIPT_S')
  const abortNonce = makeToken('M0_18_RECEIPT_A')
  const assistants = []
  const results = []
  const events = []
  const toolCalls = []

  let q = null
  let sessionId = null
  let firstToolStartedAt = null
  let firstToolReleasedAt = null
  let steerWrittenAt = null
  let abortWrittenAt = null
  let interruptCalledAt = null
  let interruptSettledAt = null
  let interruptReceipt = null
  let interruptError = null
  let streamError = null
  let timedOut = false

  let signalFirstToolStarted
  const firstToolStarted = new Promise((resolve) => { signalFirstToolStarted = resolve })
  let releaseFirstTool
  const firstToolGate = new Promise((resolve) => { releaseFirstTool = resolve })
  let signalBothInjected
  const bothInjected = new Promise((resolve) => { signalBothInjected = resolve })
  let stopPromptInput
  const promptInputStopped = new Promise((resolve) => { stopPromptInput = resolve })

  const server = createSdkMcpServer({
    name: SERVER_NAME,
    version: '0.0.1',
    tools: [
      tool(
        'sequence_step',
        'Returns one marker for a numbered step.',
        { step: z.number().int().min(1).max(3) },
        async ({ step }) => {
          const call = { step, startedAt: at(), endedAt: null }
          toolCalls.push(call)
          if (toolCalls.length === 1) {
            firstToolStartedAt = call.startedAt
            signalFirstToolStarted()
            await firstToolGate
          }
          call.endedAt = at()
          return { content: [{ type: 'text', text: `M0_18_RECEIPT_TOOL_OK:${step}` }] }
        },
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
          `Call ${SEQUENCE_TOOL_NAME} exactly three times sequentially with step 1, 2, and 3. `
          + 'Wait for each result, then reply DONE.',
      },
    }
    const startOutcome = await Promise.race([
      firstToolStarted.then(() => 'tool-started'),
      promptInputStopped.then(() => 'input-stopped'),
    ])
    if (startOutcome === 'input-stopped') return

    yield {
      type: 'user',
      uuid: steerMessageUuid,
      message: {
        role: 'user',
        content: `S receipt probe. Keep the current task alive and remember ${steerNonce}.`,
      },
    }
    steerWrittenAt = at()
    yield {
      type: 'user',
      uuid: abortMessageUuid,
      priority: 'now',
      message: {
        role: 'user',
        content: `A receipt probe. Stop the prior task and reply exactly ${abortNonce}.`,
      },
    }
    abortWrittenAt = at()
    signalBothInjected()

    // interrupt receipt/result를 소비하는 동안 input stream을 열린 채 둔다. deadline/result 탈출구가 있다.
    await promptInputStopped
  }

  q = query({
    prompt: prompts(),
    options: {
      mcpServers: { [SERVER_NAME]: server },
      tools: [SEQUENCE_TOOL_NAME],
      allowedTools: [SEQUENCE_TOOL_NAME],
      permissionMode: 'bypassPermissions',
      allowDangerouslySkipPermissions: true,
      maxTurns: 12,
      model: 'sonnet',
    },
  })

  const interruptTask = (async () => {
    const injectionOutcome = await Promise.race([
      bothInjected.then(() => 'both-injected'),
      promptInputStopped.then(() => 'input-stopped'),
    ])
    if (injectionOutcome === 'input-stopped') return
    interruptCalledAt = at()
    try {
      interruptReceipt = snapshot(await q.interrupt())
    } catch (error) {
      interruptError = errorSurface(error)
    } finally {
      interruptSettledAt = at()
      firstToolReleasedAt = at()
      releaseFirstTool()
      // crash ordering에서는 error result가 receipt보다 먼저 올 수 있다. 그 경우 result consumer가 이미
      // 지나갔으므로 여기서 generator 탈출구를 다시 닫아 deadline까지 매달리지 않게 한다.
      if (results.length > 0) stopPromptInput()
    }
  })()

  const deadline = setTimeout(() => {
    timedOut = true
    stopPromptInput()
    releaseFirstTool()
    q.close()
  }, MEASUREMENT_DEADLINE_MS)

  let turn = 1
  try {
    for await (const msg of q) {
      sessionId ??= msg.session_id ?? null
      const event = {
        index: events.length,
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
          text: textOf(blocks),
          thinking: thinkingOf(blocks),
          fullSurface: snapshot(msg),
        }
        assistants.push(assistant)
        event.text = assistant.text
        event.thinking = assistant.thinking
      }
      if (msg.type === 'result') {
        const result = {
          at: event.at,
          turn,
          keys: Object.keys(msg),
          allKeyPaths: allKeyPaths(msg),
          fullSurface: snapshot(msg),
        }
        results.push(result)
        event.result = result.fullSurface
        events.push(event)
        turn += 1
        if (interruptSettledAt != null) stopPromptInput()
        continue
      }
      events.push(event)
    }
  } catch (error) {
    streamError = errorSurface(error)
    stopPromptInput()
  } finally {
    clearTimeout(deadline)
    stopPromptInput()
    releaseFirstTool()
    q.close()
    await Promise.race([interruptTask, sleep(1_000)])
  }

  await sleep(TRANSCRIPT_SETTLE_MS)
  const transcript = readTranscriptEvidence({
    sessionId,
    trackedMessages: [
      { label: 'S', uuid: steerMessageUuid, nonce: steerNonce },
      { label: 'A', uuid: abortMessageUuid, nonce: abortNonce },
    ],
    assistants,
  })
  const stillQueued = Array.isArray(interruptReceipt?.still_queued)
    ? interruptReceipt.still_queued
    : null
  const firstCall = toolCalls[0] ?? null

  return {
    n: 1,
    arm: 'interrupt-receipt-information-only',
    environment,
    disposition: 'discard-session-after-arm',
    productAbortCandidate: false,
    reasonExcludedFromProduct: 'm0-17 measured permanent in-process MCP bridge death after interrupt()',
    initialMessageUuid,
    steerMessageUuid,
    abortMessageUuid,
    steerNonce,
    abortNonce,
    sessionId,
    timing: {
      firstToolStartedAt,
      steerWrittenAt,
      abortWrittenAt,
      interruptCalledAt,
      interruptSettledAt,
      firstToolReleasedAt,
      firstToolEndedAt: firstCall?.endedAt ?? null,
      firstResultAt: results[0]?.at ?? null,
    },
    interrupt: {
      receipt: interruptReceipt,
      error: interruptError,
      stillQueued,
      receiptBeforeFirstResult: interruptSettledAt != null && results[0]?.at != null
        ? interruptSettledAt <= results[0].at
        : null,
      containsSteerUuid: stillQueued == null ? null : stillQueued.includes(steerMessageUuid),
      containsAbortUuid: stillQueued == null ? null : stillQueued.includes(abortMessageUuid),
      unknownUuids: stillQueued == null
        ? null
        : stillQueued.filter((uuid) => ![steerMessageUuid, abortMessageUuid].includes(uuid)),
      emptyDoesNotMeanNothingWillRun: true,
      receiptOrderingContract:
        'clean receipt precedes interrupted result; crash error result may precede receipt',
      cancellationGranularityContract:
        'queued uuid individually cancellable; dequeued coalesced representative/non-representative both return cancelled:false',
    },
    results,
    assistants,
    toolCalls,
    transcriptEvidence: transcript.status,
    transcript,
    timedOut,
    streamError,
    events,
  }
}

describe('M0-18 — Claude abort correlation / context-preserving admission', () => {
  it('H1/H2 type+runtime surface: result identity, cancel runtime-only, interrupt receipt contract', () => {
    async function* noPrompts() {}
    const q = query({ prompt: noPrompts(), options: { maxTurns: 1 } })
    const queryStart = SDK_DTS.indexOf('export declare interface Query extends')
    const queryEnd = SDK_DTS.indexOf('export declare function query(')
    const resultStart = SDK_DTS.indexOf('export declare type SDKResultError =')
    const resultEnd = SDK_DTS.indexOf('export declare type SDKSessionInfo =')
    const interruptReceiptStart = SDK_DTS.indexOf('export declare type SDKControlInterruptResponse =')
    const interruptReceiptEnd = SDK_DTS.indexOf('declare type SDKControlListModelsRequest =')
    const queryDeclaration = SDK_DTS.slice(queryStart, queryEnd)
    const resultDeclaration = SDK_DTS.slice(resultStart, resultEnd)
    const interruptReceiptDeclaration = SDK_DTS.slice(interruptReceiptStart, interruptReceiptEnd)
    const resultDeclaredFields = [...resultDeclaration.matchAll(/^\s{4}([A-Za-z_][A-Za-z0-9_]*)\??:/gm)]
      .map((match) => match[1])
    const runtimeCancelMatch = SDK_MJS.match(
      /async cancelAsyncMessage\(e\)\{return\(await this\.request\(\{subtype:"cancel_async_message",message_uuid:e\}\)\)\.response\.cancelled\}/,
    )
    const observation = {
      n: 1,
      environment,
      anchors: { queryStart, queryEnd, resultStart, resultEnd, interruptReceiptStart, interruptReceiptEnd },
      querySurface: {
        streamInput: typeof q.streamInput,
        interrupt: typeof q.interrupt,
        cancelAsyncMessage: typeof q.cancelAsyncMessage,
      },
      queryDeclarationHasCancelAsyncMessage: /\bcancelAsyncMessage\s*\(/.test(queryDeclaration),
      runtimeHasCancelAsyncMessageImplementation: Boolean(runtimeCancelMatch),
      runtimeCancelAsyncMessageSource: runtimeCancelMatch?.[0] ?? null,
      resultDeclaredFields: [...new Set(resultDeclaredFields)],
      resultDeclarationHasInputUuid: /\b(?:input_uuid|inputUuid|message_uuid|messageUuid)\b/.test(resultDeclaration),
      resultDeclarationHasPriority: /^\s{4}priority\??:/m.test(resultDeclaration),
      resultDeclarationHasInputKind: /^\s{4}(?:input_?kind|kind)\??:/m.test(resultDeclaration),
      resultDeclarationHasTurnTarget: /\b(?:expectedTurnId|expected_turn_id|targetTurnId|target_turn_id)\b/.test(resultDeclaration),
      resultDeclaration,
      interruptReceiptDeclaration,
      interruptReceiptDocumentsStillQueued: /still_queued/.test(interruptReceiptDeclaration),
      interruptReceiptDocumentsDequeuedCancelledFalse:
        /NON-representative[\s\S]*cancel response reports cancelled:false/.test(interruptReceiptDeclaration),
      interruptReceiptDocumentsEmptyCoverageCaveat:
        /\[\] does not mean "nothing will run"/.test(interruptReceiptDeclaration),
      publicTypeFact:
        'Query.cancelAsyncMessage is absent from public sdk.d.ts but exists on the runtime Query object in this SDK build',
    }
    q.close()
    record('H1/H2 SDK type + runtime surface', observation)

    // 의미론을 assert하지 않고, 실물 문서/런타임을 겨냥한 관측기가 anchor를 찾았는지만 닫는다.
    expect(queryStart).toBeGreaterThanOrEqual(0)
    expect(queryEnd).toBeGreaterThan(queryStart)
    expect(resultStart).toBeGreaterThanOrEqual(0)
    expect(resultEnd).toBeGreaterThan(resultStart)
    expect(interruptReceiptStart).toBeGreaterThanOrEqual(0)
    expect(interruptReceiptEnd).toBeGreaterThan(interruptReceiptStart)
    expect(runtimeCancelMatch, 'sdk.mjs cancelAsyncMessage 구현을 찾지 못했다').not.toBeNull()
  })

  it('negative control first: A를 넣지 않으면 같은 detector가 A 신호 부재를 감지하는가', async () => {
    const observation = await measureInjectionArm({
      arm: 'negative-control-no-A',
      injectionKind: 'A',
      omitInjection: true,
      negativeControl: true,
      sendFollowUp: true,
      followUpBarrierOrdinal: 1,
      followUpGapMs: CONTEXT_FATE_GAP_MS,
    })
    record('negative control — A omitted', observation)

    expect(observation.timedOut, 'negative control 장치가 timeout으로 닫혔다').toBe(false)
    expect(observation.timing.firstToolStartedAt, 'negative control의 실제 tool body가 시작되지 않았다').not.toBeNull()
    expect(observation.timing.firstResultAt, 'negative control의 첫 result가 오지 않았다').not.toBeNull()
    expect(observation.timing.followUpWrittenAt, 'negative control의 후속 input write를 관측하지 못했다').not.toBeNull()
    expect(observation.contextEvidence.followUpResponseObserved, 'negative control 후속 result가 오지 않았다').toBe(true)
    expect(observation.detectorCalibration.apparatusRespondedToConfiguredAbsence).toBe(true)
    expect(['available', 'unavailable']).toContain(observation.transcriptEvidence)
  }, 11 * 60 * 1000)

  for (const kind of ['A', 'S']) {
    it(`H2 early cancel ${kind}: original tool body hold 중 cancelAsyncMessage 반환`, async () => {
      const observation = await measureInjectionArm({
        arm: `early-cancel-${kind}`,
        injectionKind: kind,
        cancelTiming: 'early',
      })
      record(`H2 early cancel ${kind}`, observation)

      expect(observation.timedOut, `${kind} early cancel 장치가 timeout으로 닫혔다`).toBe(false)
      expect(observation.timing.firstToolStartedAt, '실제 original tool body가 시작되지 않았다').not.toBeNull()
      expect(observation.timing.injectionWrittenAt, `${kind} transport.write 완료를 관측하지 못했다`).not.toBeNull()
      expect(observation.injectionOverlappedOriginalTool, `${kind} write가 original tool body와 겹치지 않았다`).toBe(true)
      expect(observation.cancelOverlappedOriginalTool, `${kind} early cancel이 original tool body와 겹치지 않았다`).toBe(true)
      expect(observation.cancelResult.resultCountAtCall, `${kind} cancel 전에 result가 이미 도착했다`).toBe(0)
      expect(observation.cancelResult.settledAs, `${kind} cancelAsyncMessage가 반환하지 않았다`).toBe('returned')
      expect(observation.timing.firstResultAt, `${kind} arm의 첫 result가 오지 않았다`).not.toBeNull()
      expect(['available', 'unavailable']).toContain(observation.transcriptEvidence)
    }, 11 * 60 * 1000)
  }

  for (const kind of ['A', 'S']) {
    it(`H2 late cancel ${kind}: injected message의 delivery_probe body 진입 뒤 cancelAsyncMessage 반환`, async () => {
      const observation = await measureInjectionArm({
        arm: `late-cancel-${kind}`,
        injectionKind: kind,
        cancelTiming: 'late',
      })
      record(`H2 late cancel ${kind}`, observation)

      expect(observation.timedOut, `${kind} late cancel 장치가 timeout으로 닫혔다`).toBe(false)
      expect(observation.timing.firstToolStartedAt, '실제 original tool body가 시작되지 않았다').not.toBeNull()
      expect(observation.timing.injectionWrittenAt, `${kind} transport.write 완료를 관측하지 못했다`).not.toBeNull()
      expect(observation.timing.deliveryProbeStartedAt, `${kind}가 실제 delivery_probe body에 도달하지 않았다`).not.toBeNull()
      expect(observation.cancelOverlappedDeliveryProbe, `${kind} late cancel이 delivery_probe body와 겹치지 않았다`).toBe(true)
      expect(observation.cancelResult.settledAs, `${kind} cancelAsyncMessage가 반환하지 않았다`).toBe('returned')
      expect(observation.timing.firstResultAt, `${kind} arm의 첫 result가 오지 않았다`).not.toBeNull()
      expect(['available', 'unavailable']).toContain(observation.transcriptEvidence)
    }, 11 * 60 * 1000)
  }

  it('H1/H4 treatment: A result surface를 덤프하고 격리된 다음 send가 초기 context를 회수하는가', async () => {
    const observation = await measureInjectionArm({
      arm: MUTANT_OMIT_ABORT ? 'H1-H4-treatment-mutant-A-omitted' : 'H1-H4-treatment-A',
      injectionKind: 'A',
      cancelTiming: 'none',
      omitInjection: MUTANT_OMIT_ABORT,
      sendFollowUp: true,
      // clean: result #1=T, result #2=A. mutant: helper가 자동으로 #1을 쓴다.
      followUpBarrierOrdinal: 2,
      followUpGapMs: CONTEXT_FATE_GAP_MS,
    })
    record('H1/H4 A correlation + context', observation)

    expect(observation.timedOut, 'H1/H4 장치가 timeout으로 닫혔다').toBe(false)
    expect(observation.timing.firstToolStartedAt, '실제 original tool body가 시작되지 않았다').not.toBeNull()
    if (MUTANT_OMIT_ABORT) {
      expect(observation.detectorCalibration.abortTransportWriteSeen).toBe(false)
    } else {
      expect(observation.timing.injectionWrittenAt, 'A transport.write 완료를 관측하지 못했다').not.toBeNull()
      expect(observation.injectionOverlappedOriginalTool, 'A write가 original tool body와 겹치지 않았다').toBe(true)
      expect(observation.resultCount, 'T/A/후속 result 경계를 모두 관측하지 못했다').toBeGreaterThanOrEqual(3)
    }
    expect(observation.timing.followUpBarrierReachedAt, '격리 전 result ordinal barrier를 닫지 못했다').not.toBeNull()
    expect(observation.timing.contextGapEndedAt, '후속 write 전 5초 격리를 닫지 못했다').not.toBeNull()
    expect(
      observation.timing.contextGapEndedAt - observation.timing.contextGapStartedAt,
      '후속 write 전 격리가 설정값보다 짧았다',
    ).toBeGreaterThanOrEqual(CONTEXT_FATE_GAP_MS)
    expect(observation.timing.followUpWrittenAt, 'fresh next input의 transport.write를 관측하지 못했다').not.toBeNull()
    expect(observation.contextEvidence.followUpResponseObserved, 'fresh next input 뒤 result가 오지 않았다').toBe(true)
    expect(['available', 'unavailable']).toContain(observation.transcriptEvidence)
  }, 11 * 60 * 1000)

  it('H5 candidate: A early cancel 반환 + 첫 result를 admission barrier로 쓸 수 있는가', async () => {
    const observation = await measureInjectionArm({
      arm: 'H5-early-cancel-admission-candidate',
      injectionKind: 'A',
      cancelTiming: 'early',
      sendFollowUp: true,
      followUpBarrierOrdinal: 1,
      // 정확히 first-result barrier를 시험한다. fate는 별도 early arm이 재므로 여기서 quiet gap을 넣지 않는다.
      followUpGapMs: 0,
    })
    record('H5 A early-cancel admission candidate', observation)

    expect(observation.timedOut, 'H5 admission 장치가 timeout으로 닫혔다').toBe(false)
    expect(observation.timing.firstToolStartedAt, '실제 original tool body가 시작되지 않았다').not.toBeNull()
    expect(observation.timing.injectionWrittenAt, 'A transport.write 완료를 관측하지 못했다').not.toBeNull()
    expect(observation.cancelOverlappedOriginalTool, 'A early cancel이 original tool body와 겹치지 않았다').toBe(true)
    expect(observation.cancelResult.resultCountAtCall, 'A cancel 전에 result가 이미 도착했다').toBe(0)
    expect(observation.cancelResult.settledAs, 'A cancelAsyncMessage가 반환하지 않았다').toBe('returned')
    expect(observation.timing.firstResultAt, 'candidate barrier의 첫 result가 오지 않았다').not.toBeNull()
    expect(observation.timing.followUpWrittenAt, 'candidate barrier 뒤 next input write를 관측하지 못했다').not.toBeNull()
    expect(observation.contextEvidence.followUpResponseObserved, 'candidate barrier 뒤 next result가 오지 않았다').toBe(true)
    expect(['available', 'unavailable']).toContain(observation.transcriptEvidence)
  }, 11 * 60 * 1000)

  it('H3 information-only: S/A write 뒤 interrupt receipt의 still_queued uuid snapshot', async () => {
    const observation = await measureInterruptReceiptArm()
    record('H3 interrupt receipt S+A (discard session)', observation)

    expect(observation.timedOut, 'interrupt receipt 장치가 timeout으로 닫혔다').toBe(false)
    expect(observation.timing.firstToolStartedAt, 'receipt arm의 실제 tool body가 시작되지 않았다').not.toBeNull()
    expect(observation.timing.steerWrittenAt, 'S transport.write 완료를 관측하지 못했다').not.toBeNull()
    expect(observation.timing.abortWrittenAt, 'A transport.write 완료를 관측하지 못했다').not.toBeNull()
    expect(observation.timing.interruptCalledAt, 'interrupt()를 호출하지 못했다').not.toBeNull()
    expect(observation.timing.interruptSettledAt, 'interrupt() receipt/error가 settle하지 않았다').not.toBeNull()
    expect(observation.interrupt.error, 'interrupt()가 receipt 대신 throw했다').toBeNull()
    expect(observation.timing.firstResultAt, 'interrupt 뒤 result 경계를 관측하지 못했다').not.toBeNull()
    expect(['available', 'unavailable']).toContain(observation.transcriptEvidence)
  }, 11 * 60 * 1000)
})
