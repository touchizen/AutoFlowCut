// @vitest-environment node
/**
 * M2 — 실제 Codex app-server + 출하 adapter + main approval gate E2E.
 *
 * 이 파일은 정규 suite에서 제외되고 `npm run test:spike`로만 돈다.
 * regex/단위 wiring 테스트는 `open()`이 실제 child와 loopback listener를 만들었다는 사실을
 * 증명하지 못한다. 그래서 이 스파이크는 production session manager가 real factory들을 조립하게
 * 하고, real model이 낸 MCP 호출의 UI·wire·Tool Core·durable disk 결과를 scenario별 fresh session에서 잰다.
 * replay만 같은 thread 안에서 같은 G tool을 두 번 불러 1회용 grant 경계를 확인한다.
 *
 * raw app-server JSON-RPC: /tmp/m2-approval-gate-raw.jsonl
 */
import { EventEmitter } from 'node:events'
import { spawn as nodeSpawn, spawnSync } from 'node:child_process'
import { createConnection } from 'node:net'
import {
  appendFileSync,
  existsSync,
  writeFileSync,
} from 'node:fs'
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { resolveCodexExecutablePath } from '../../electron/api/llm/codexSdk.js'
import { decodeApprovalPayload } from '../../electron/agent/approvalPayload.js'
import { createApprovalPrompt } from '../../electron/agent/approvalPrompt.js'
import { createCodexOrchestrator } from '../../electron/agent/codexOrchestrator.js'
import { AGENT_MCP_SERVER_NAME } from '../../electron/agent/constants.js'
import { createElicitationResponder } from '../../electron/agent/elicitationResponder.js'
import { createGrantLedger, hashArgs } from '../../electron/agent/grantLedger.js'
import { createPrivateRpc } from '../../electron/agent/privateRpc.js'
import { createAgentSessionManager } from '../../electron/agent/sessionManager.js'
import { createToolBridge } from '../../electron/agent/toolBridge.js'
import { createToolCore } from '../../electron/agent/toolCore.js'
import { createStoryCommands } from '../../electron/ipc/story-api.js'
import { defaultStoryState } from '../../electron/story/storyStore.js'

const RAW_PATH = '/tmp/m2-approval-gate-raw.jsonl'
const TURN_TIMEOUT_MS = 6 * 60 * 1000
const TEST_TIMEOUT_MS = 60 * 60 * 1000
const RUN_ID = process.env.SPIKE_RUN_ID ?? `m2-${Date.now()}-${process.pid}`

let rawReady = false
let cleanups = []

function jsonSafe(value) {
  try {
    const serialized = JSON.stringify(value, (_key, item) => {
      if (item instanceof Error) return { name: item.name, message: item.message, stack: item.stack }
      return item
    })
    return serialized === undefined ? String(value) : JSON.parse(serialized)
  } catch {
    return String(value)
  }
}

function record(label, data = {}) {
  if (!rawReady) return
  appendFileSync(RAW_PATH, `${JSON.stringify({ runId: RUN_ID, at: new Date().toISOString(), label, ...jsonSafe(data) })}\n`)
}

/** 모든 assertion 직전에 실제 측정값을 stdout과 raw에 같이 남긴다. */
function measured(label, value) {
  const safe = jsonSafe(value)
  console.log(`\n[M2 측정] ${label}:`, typeof safe === 'string' ? safe : JSON.stringify(safe, null, 2))
  record('assertion', { assertion: label, measured: safe })
  return value
}

afterEach(async (ctx) => {
  const errors = []
  while (cleanups.length) {
    try {
      await cleanups.pop()()
    } catch (error) {
      errors.push(error)
    }
  }
  record('__verdict__', {
    test: ctx?.task?.name ?? '(unknown)',
    verdict: ctx?.task?.result?.state ?? 'unknown',
    cleanupErrors: errors.map((error) => error?.message ?? String(error)),
  })
  rawReady = false
  if (errors.length) throw new AggregateError(errors, 'M2 spike cleanup failed')
})

function createFakeWindow(onSend) {
  const win = new EventEmitter()
  const webContents = new EventEmitter()
  win.isDestroyed = () => false
  webContents.isDestroyed = () => false
  webContents.send = onSend
  win.webContents = webContents
  return win
}

function liveChildren(children) {
  return children
    .filter(({ child }) => child.exitCode == null && child.signalCode == null)
    .map(({ child, command, args }) => ({ pid: child.pid, command, args }))
}

/** 현재 Vitest worker가 실제로 연 127.0.0.1 TCP listener를 센다. */
function loopbackListeners() {
  if (typeof process._getActiveHandles !== 'function') {
    throw new Error('process._getActiveHandles가 없어 loopback listener를 실측할 수 없다 — 공짜 PASS 방지')
  }
  const listeners = []
  for (const handle of process._getActiveHandles()) {
    if (!handle?.listening || typeof handle.address !== 'function') continue
    let address
    try { address = handle.address() } catch { continue }
    if (address && typeof address === 'object' && address.address === '127.0.0.1') {
      listeners.push({ address: address.address, port: address.port, family: address.family })
    }
  }
  return listeners.sort((a, b) => a.port - b.port)
}

async function portIsOpen(host, port, timeoutMs = 2_000) {
  return new Promise((resolve) => {
    const socket = createConnection({ host, port })
    let settled = false
    const finish = (open) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      socket.destroy()
      resolve(open)
    }
    const timer = setTimeout(() => finish(false), timeoutMs)
    socket.once('connect', () => finish(true))
    socket.once('error', () => finish(false))
  })
}

function createRecordingSpawn(children) {
  return (command, args, options) => {
    // stderr를 pipe로 바꾸는 것 외에는 production spawn 인자를 보존한다. 실패 시 app-server/adapter
    // 진단이 /tmp raw에 남아야 실행자가 "왜 turn이 안 왔는지" 확인할 수 있다.
    const child = nodeSpawn(command, args, { ...options, stdio: ['pipe', 'pipe', 'pipe'] })
    children.push({ child, command, args })
    record('codex-child-spawned', { pid: child.pid, command, args })

    // fresh session마다 별도 app-server process다. partial NDJSON buffer도 process별로 갈라야
    // 이전 child의 마지막 조각과 다음 child의 첫 frame이 합쳐져 가짜 traffic이 되지 않는다.
    const buffers = { inbound: '', outbound: '' }
    const capture = (direction, chunk) => {
      buffers[direction] += Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk)
      let newline
      while ((newline = buffers[direction].indexOf('\n')) >= 0) {
        const raw = buffers[direction].slice(0, newline)
        buffers[direction] = buffers[direction].slice(newline + 1)
        if (!raw.trim()) continue
        let message = null
        try { message = JSON.parse(raw) } catch { /* 비 JSON 진단도 raw 그대로 보존한다. */ }
        record('json-rpc', { pid: child.pid, direction, raw, message })
      }
    }

    const originalWrite = child.stdin.write.bind(child.stdin)
    child.stdin.write = (chunk, ...rest) => {
      capture('outbound', chunk)
      return originalWrite(chunk, ...rest)
    }
    child.stdout.on('data', (chunk) => capture('inbound', chunk))
    child.stderr.on('data', (chunk) => record('codex-stderr', { pid: child.pid, raw: chunk.toString('utf8') }))
    child.on('error', (error) => record('codex-child-error', { pid: child.pid, error }))
    child.on('exit', (code, signal) => record('codex-child-exit', { pid: child.pid, code, signal }))
    return child
  }
}

async function seedStoryProject(root, name, speakers) {
  const projectPath = path.join(root, name)
  const storyDir = path.join(projectPath, 'story')
  const storyPath = path.join(storyDir, 'story.json')
  await mkdir(storyDir, { recursive: true })
  const state = { ...defaultStoryState(), speakers }
  await writeFile(storyPath, JSON.stringify(state, null, 2), 'utf8')
  return { projectPath, storyPath }
}

async function readStory(storyPath) {
  const raw = await readFile(storyPath, 'utf8')
  return { raw, value: JSON.parse(raw) }
}

function parseDialogMessage(message) {
  const decoded = decodeApprovalPayload(message)
  if (!decoded) throw new Error(`승인 payload를 디코드할 수 없다: ${JSON.stringify(message)}`)
  return decoded
}

function toolResultFrom(item) {
  const text = item?.result?.content
    ?.filter((part) => part?.type === 'text')
    .map((part) => part.text)
    .join('') ?? ''
  try {
    return { text, value: JSON.parse(text) }
  } catch (error) {
    throw new Error(`MCP tool result가 JSON이 아니다: ${JSON.stringify(text)} (${error.message})`)
  }
}

function createEventCollector() {
  const events = []
  const listeners = new Set()

  const onEvent = (message) => {
    events.push(message)
    for (const listener of [...listeners]) listener(message)
  }

  const waitFor = (predicate, { since = 0, timeoutMs = TURN_TIMEOUT_MS, label } = {}) => {
    const hit = events.slice(since).find(predicate)
    if (hit) return Promise.resolve(hit)
    return new Promise((resolve, reject) => {
      const listener = (message) => {
        if (!predicate(message)) return
        clearTimeout(timer)
        listeners.delete(listener)
        resolve(message)
      }
      const timer = setTimeout(() => {
        listeners.delete(listener)
        reject(new Error(
          `timeout waiting for ${label}; actual events=${JSON.stringify(events.slice(since).map((event) => ({
            method: event.method,
            turnId: event.params?.turnId ?? event.params?.turn?.id ?? null,
            itemType: event.params?.item?.type ?? null,
            tool: event.params?.item?.tool ?? null,
          })))}; raw=${RAW_PATH}`,
        ))
      }, timeoutMs)
      listeners.add(listener)
    })
  }

  return { events, onEvent, waitFor }
}

async function runExpectedToolTurn({
  manager,
  collector,
  elicitationCalls,
  permissionRequests,
  setPolicy,
  label,
  prompt,
  expectedTool,
  expectedPermission,
  expectedArgs,
  action,
  switchToProjectB = false,
}) {
  const eventStart = collector.events.length
  const elicitationStart = elicitationCalls.length
  const permissionStart = permissionRequests.length
  setPolicy({ label, action, switchToProjectB })
  try {
    const ack = await manager.send(prompt, 'codex:gpt-5.5')
    const turnId = ack?.turn?.id ?? ack?.turnId ?? null
    expect(measured(`${label} turn/start id`, turnId),
      `${label}: turn/start가 id를 주지 않았다. 실제 응답=${JSON.stringify(ack)} raw=${RAW_PATH}`).toBeTruthy()

    const completed = await collector.waitFor(
      (event) => event.method === 'turn/completed' && event.params?.turn?.id === turnId,
      { since: eventStart, label: `${label} turn/completed(${turnId})` },
    )
    const turnEvents = collector.events.slice(eventStart)
    const toolCalls = turnEvents
      .filter((event) => event.method === 'item/completed'
        && event.params?.item?.type === 'mcpToolCall'
        && event.params?.turnId === turnId)
      .map((event) => event.params.item)
    const finalMessages = turnEvents
      .filter((event) => event.method === 'item/completed'
        && event.params?.item?.type === 'agentMessage'
        && event.params?.turnId === turnId)
      .map((event) => event.params.item.text ?? '')
    const elicitations = elicitationCalls.slice(elicitationStart)
    const nativeElicitations = elicitations.filter((entry) => entry.kind === 'native')
    const handlerElicitations = elicitations.filter((entry) => entry.kind === 'handler')
    const nativeDiagnostic = nativeElicitations.map((entry) => ({
      tool_title: entry.params?._meta?.tool_title ?? null,
      tool_params: entry.params?._meta?.tool_params ?? null,
      message: entry.params?.message ?? null,
    }))
    const handlerDiagnostic = handlerElicitations.map((entry) => ({
      nonce: entry.params?._meta?.nonce ?? null,
      tool: entry.params?._meta?.tool ?? null,
      argsHash: entry.params?._meta?.argsHash ?? null,
      message: entry.params?.message ?? null,
    }))
    const actual = {
      turnId,
      status: completed.params?.turn?.status ?? null,
      error: completed.params?.turn?.error ?? null,
      toolCalls: toolCalls.map((item) => ({
        server: item.server,
        tool: item.tool,
        status: item.status,
        result: item.result,
      })),
      nativeElicitations: nativeDiagnostic,
      handlerElicitations: handlerDiagnostic,
      finalMessages,
    }
    console.log(`\n===== ${label} 실제 turn =====\n${JSON.stringify(actual, null, 2)}`)
    record('turn-evidence', { label, actual })

    // 모델이 거부하거나 다른 툴을 골랐는데도 다음 disk assertion만 우연히 통과하는 false green을 막는다.
    expect(measured(`${label} turn status`, actual.status),
      `${label}: model turn 실패. 실제=${JSON.stringify(actual)} raw=${RAW_PATH}`).toBe('completed')

    // Codex native 승인은 모든 MCP call 앞에 정확히 하나 온다. 이 응답은 main이 삼켜 renderer로 보내지 않는다.
    expect(measured(`${label} native elicitation count`, nativeDiagnostic),
      `${label}: native elicitation이 정확히 하나가 아니다. 실제=${JSON.stringify(actual)} raw=${RAW_PATH}`)
      .toHaveLength(1)

    if (expectedPermission === 'G') {
      const called = toolCalls.map((item) => item.tool).join(', ') || '(no tool)'
      // 이게 G path의 결정적 증거다. native만 있고 handler가 0이면 gate를 시험한 것이 아니라 다른 R tool을 부른 것이다.
      expect(measured(`${label} handler elicitation count`, handlerDiagnostic),
        `${label}: the G path was never entered — the model called ${called} instead. `
        + `native tool_title/tool_params=${JSON.stringify(nativeDiagnostic)} `
        + `handler=${JSON.stringify(handlerDiagnostic)} raw=${RAW_PATH}`)
        .toHaveLength(1)
      expect(measured(`${label} handler elicitation grant meta`, handlerDiagnostic[0]),
        `${label}: handler가 {nonce,tool,argsHash} identity를 온전히 싣지 않았다. `
        + `native=${JSON.stringify(nativeDiagnostic)}`).toMatchObject({
        nonce: expect.any(String),
        tool: expectedTool,
        argsHash: hashArgs(expectedArgs),
      })
      expect(measured(`${label} native→handler order`, {
        nativeSeq: nativeElicitations[0]?.seq,
        handlerSeq: handlerElicitations[0]?.seq,
        ordered: nativeElicitations[0]?.seq < handlerElicitations[0]?.seq,
      }), `${label}: handler elicitation이 native gate보다 먼저 발화했다`).toMatchObject({ ordered: true })
    } else {
      // R에서 handler가 하나라도 오면 read가 사람 승인에 종속된 것이다.
      expect(measured(`${label} handler elicitation count`, handlerDiagnostic),
        `${label}: R tool이 handler approval을 열었다. 실제=${JSON.stringify(handlerDiagnostic)}`)
        .toHaveLength(0)
    }

    // wrong-tool 진단에는 native가 실제로 승인하려던 이름과 인자를 같이 싣는다. 둘의 불일치가 이번 실패의 핵심 증거였다.
    expect(measured(`${label} native tool_title`, nativeDiagnostic[0]?.tool_title),
      `${label}: model이 다른 tool을 골랐다. native tool_title/tool_params=${JSON.stringify(nativeDiagnostic)}`)
      .toBe(expectedTool)
    expect(measured(`${label} native tool_params`, nativeDiagnostic[0]?.tool_params),
      `${label}: model이 요구한 args를 바꿨다. native tool_title/tool_params=${JSON.stringify(nativeDiagnostic)}`)
      .toEqual(expectedArgs)
    expect(measured(`${label} completed MCP tool calls`, actual.toolCalls),
      `${label}: 정확히 한 툴을 요구했지만 실제=${JSON.stringify(actual.toolCalls)} final=${JSON.stringify(finalMessages)}`)
      .toHaveLength(1)
    expect(measured(`${label} actual tool`, toolCalls[0]?.tool),
      `${label}: model이 다른 tool을 호출했다. 실제=${JSON.stringify(actual.toolCalls)}`).toBe(expectedTool)
    expect(measured(`${label} actual server`, toolCalls[0]?.server),
      `${label}: 출하 adapter가 아닌 다른 MCP server를 불렀다`).toBe(AGENT_MCP_SERVER_NAME)
    expect(measured(`${label} tool item status`, toolCalls[0]?.status),
      `${label}: item/completed는 왔지만 tool이 완주하지 않았다`).toBe('completed')

    const result = toolResultFrom(toolCalls[0])
    console.log(`\n[M2 측정] ${label} tool result object:`, JSON.stringify(result.value, null, 2))
    record('tool-result', { label, result: result.value, resultText: result.text })
    return {
      ...actual,
      item: toolCalls[0],
      result: result.value,
      dialogs: permissionRequests.slice(permissionStart),
      elicitations,
      nativeElicitations,
      handlerElicitations,
    }
  } finally {
    setPolicy(null)
  }
}

function assertGDialog(turn, label, expectedArgs) {
  expect(measured(`${label} agent:permission-request count`, turn.dialogs.length),
    `${label}: G 승인 UI는 정확히 1회여야 한다. 0=G path 미진입/fail-open, 2=native 이중 승인. `
    + `실제=${JSON.stringify(turn.dialogs)}`).toBe(1)
  const dialog = turn.dialogs[0]
  expect(measured(`${label} dialog tool`, dialog?.tool),
    `${label}: 승인 dialog가 실제 G tool identity를 잃었다`).toBe('story_set_speakers')
  const shown = parseDialogMessage(turn.handlerElicitations[0]?.params?.message)
  expect(measured(`${label} decoded handler args`, shown),
    `${label}: adapter의 canonical payload가 모델 요청 args를 잃었다`).toEqual({
    tool: 'story_set_speakers',
    args: expectedArgs,
  })
  expect(measured(`${label} structured dialog args`, dialog?.args),
    `${label}: main이 검증한 args가 renderer까지 그대로 도착하지 않았다`).toEqual(expectedArgs)
  expect(measured(`${label} dialog argsHash == grant argsHash`, {
    shown: hashArgs(dialog.args),
    grant: turn.handlerElicitations[0]?.params?._meta?.argsHash,
  }), `${label}: 사람이 본 args와 grant의 argsHash가 다르다`).toMatchObject({
    shown: hashArgs(expectedArgs),
    grant: hashArgs(expectedArgs),
  })
  expect(dialog).not.toHaveProperty('message')
  return dialog
}

function listScenesPrompt() {
  return [
    `Call the ${AGENT_MCP_SERVER_NAME} MCP tool "list_scenes" exactly once.`,
    'Arguments: {}',
    'Return the raw tool result after the call.',
  ].join('\n')
}

function setSpeakersPrompt(args) {
  return [
    `Call the ${AGENT_MCP_SERVER_NAME} MCP tool "story_set_speakers" exactly once.`,
    `Arguments: ${JSON.stringify(args)}`,
    'Return the raw tool result after the call.',
  ].join('\n')
}

describe('M2 — 실제 Codex approval gate E2E', () => {
  it('open lifecycle + R/G UI cardinality + durable approve/decline/replay + D15', async () => {
    writeFileSync(RAW_PATH, '')
    rawReady = true
    record('__run_started__', { pid: process.pid, rawPath: RAW_PATH })
    console.log(`\n===== M2 approval gate raw =====\n${RAW_PATH}`)

    let codexBin
    try {
      codexBin = resolveCodexExecutablePath()
    } catch (error) {
      throw new Error(
        `실제 Codex binary를 찾지 못했다. npm dependencies/platform binary를 설치한 뒤 다시 실행해. 원인: ${error.message}`,
      )
    }
    const adapterPath = path.resolve(process.cwd(), 'dist-adapter/codex-adapter.mjs')

    // 전제 누락을 skip하면 이 긴 스파이크가 초록으로 끝난다. binary/bundle/login은 모두 명시적 FAIL이다.
    expect(measured('real Codex binary', { path: codexBin, exists: existsSync(codexBin) }),
      `Codex binary가 없다: ${codexBin}`).toMatchObject({ exists: true })
    expect(measured('bundled adapter', { path: adapterPath, exists: existsSync(adapterPath) }),
      `출하 adapter bundle이 없다: ${adapterPath}\n먼저 npm run build:agent-adapter 를 실행해.`)
      .toMatchObject({ exists: true })

    const version = spawnSync(codexBin, ['--version'], { env: process.env, encoding: 'utf8' })
    expect(measured('real Codex version', {
      version: `${version.stdout ?? ''}${version.stderr ?? ''}`.trim(),
      exitCode: version.status,
      error: version.error?.message ?? null,
    }), 'resolve된 Codex binary가 --version조차 실행되지 않는다').toMatchObject({
      version: expect.stringMatching(/codex/i),
      exitCode: 0,
      error: null,
    })

    const auth = spawnSync(codexBin, ['login', 'status'], { env: process.env, encoding: 'utf8' })
    const authText = `${auth.stdout ?? ''}${auth.stderr ?? ''}`.trim()
    const loggedIn = !/not logged in/i.test(authText)
      && /logged in/i.test(authText)
      && /chatgpt/i.test(authText)
      && !/api key/i.test(authText)
    expect(measured('codex login status 실행 오류', auth.error?.message ?? null),
      `codex login status 자체를 실행하지 못했다: ${auth.error?.message ?? 'unknown error'}`).toBeNull()
    expect(measured('Codex ChatGPT login', { loggedIn, exitCode: auth.status, output: authText }),
      `Codex ChatGPT 로그인이 없다. 이 스파이크는 skip하지 않는다. 먼저 다음을 실행해:\n  ${codexBin} login`)
      .toMatchObject({ loggedIn: true, exitCode: 0 })

    const tempRoot = await mkdtemp('/tmp/autoflowcut-m2-approval-')
    cleanups.push(() => rm(tempRoot, { recursive: true, force: true }))
    const INITIAL_A = [{
      id: 'narrator',
      name: 'A 초기 화자',
      voice: { provider: 'typecast', voiceId: 'm2-a-initial' },
    }]
    const INITIAL_B = [{
      id: 'narrator',
      name: 'B 원본 화자',
      voice: { provider: 'typecast', voiceId: 'm2-b-original' },
    }]
    const HAPPY_ARGS = { speakers: [{
      id: 'narrator',
      name: 'M2 승인 화자',
      voice: { provider: 'typecast', voiceId: 'm2-approved-voice' },
    }] }
    const DECLINE_ARGS = { speakers: [{
      id: 'narrator',
      name: '절대 저장되면 안 되는 화자',
      voice: { provider: 'typecast', voiceId: 'm2-declined-voice' },
    }] }
    const D15_ARGS = { speakers: [{
      id: 'narrator',
      name: 'D15가 새면 B에 기록되는 화자',
      voice: { provider: 'typecast', voiceId: 'D15-REGRESSION-WROTE-B' },
    }] }
    const projectA = await seedStoryProject(tempRoot, 'project-a', INITIAL_A)
    const projectB = await seedStoryProject(tempRoot, 'project-b', INITIAL_B)

    let sequence = 0
    let activePolicy = null
    let storyCommands = null
    let approvalPrompt = null
    let d15Switch = null
    let toolBridge = null
    const permissionRequests = []
    const approvalAsks = []
    const elicitationCalls = []
    const toolCoreCalls = []
    const children = []
    const endpoints = []
    const factoryCounts = { toolCore: 0, privateRpc: 0, elicitationResponder: 0, codexOrchestrator: 0 }
    let privateRpcStartCalls = 0
    let orchestratorOpenCalls = 0

    const fakeWindow = createFakeWindow((channel, payload) => {
      if (channel === 'agent:bridge-request') {
        // R/list_scenes 는 scene.snapshot 으로 renderer 씬을 읽는다. 이 스파이크는 story-only 라
        // renderer 씬이 없으므로 빈 audio-first 스냅샷으로 답한다 (permission-request 아님 → dialog 0 유지).
        if (payload?.name === 'scene.snapshot') {
          queueMicrotask(() => toolBridge?.handleResponse({
            requestId: payload.requestId,
            result: { sceneMode: 'audio-first', scenes: [] },
          }))
        }
        return
      }
      if (channel !== 'agent:permission-request') return
      const action = activePolicy?.action ?? 'decline'
      const entry = {
        seq: ++sequence,
        channel,
        ...jsonSafe(payload),
        action,
        scenario: activePolicy?.label ?? 'UNEXPECTED',
        projectTokenAtDialog: storyCommands?.projectToken ?? null,
      }
      permissionRequests.push(entry)
      console.log(`\n[M2 측정] agent:permission-request #${permissionRequests.length}:\n${JSON.stringify(entry, null, 2)}`)
      record('agent:permission-request', entry)

      // renderer 대역은 payload를 기록한 뒤 반드시 real approvalPrompt.respond로 답한다.
      queueMicrotask(() => {
        entry.responseSeq = ++sequence
        entry.responded = approvalPrompt.respond({ requestId: payload.requestId, action })
        record('agent:permission-response', {
          requestId: payload.requestId,
          action,
          responded: entry.responded,
          seq: entry.responseSeq,
        })
      })
    })

    storyCommands = createStoryCommands({
      keyStore: { getKey: () => 'm2-spike-unused-key' },
      getWindow: () => fakeWindow,
      // 이 스파이크는 open/list/setSpeakers만 쓴다. 모델이 다른 pipeline tool을 고르면 아래
      // actual-tool assertion이 실패하며, 외부 Story LLM까지 호출하지 않게 빈 구현을 둔다.
      llm: {},
      tts: {},
      listClaudeModels: async () => [],
      listCodexModels: async () => [],
    })
    const openedA = await storyCommands.open(projectA.projectPath)
    expect(measured('story:open(A)', {
      projectToken: openedA.projectToken,
      speakers: openedA.state?.speakers,
      storyPath: projectA.storyPath,
    }), '실제 temp story project A를 열지 못했다').toMatchObject({ projectToken: expect.any(String) })
    const projectTokenA = openedA.projectToken

    const grantLedger = createGrantLedger()
    approvalPrompt = createApprovalPrompt({ getWindow: () => fakeWindow, timeoutMs: 2 * 60 * 1000 })
    cleanups.push(() => approvalPrompt.close())
    const realAsk = approvalPrompt.ask.bind(approvalPrompt)
    approvalPrompt.ask = async (params, ctx) => {
      const trace = {
        seq: ++sequence,
        scenario: activePolicy?.label ?? 'UNEXPECTED',
        projectTokenBeforeDialog: storyCommands.projectToken,
        params: jsonSafe(params),
        ctx: jsonSafe(ctx),
      }
      approvalAsks.push(trace)
      const answer = await realAsk(params, ctx)
      trace.answer = answer
      trace.answerSeq = ++sequence

      // D15의 결정적 race: 사람은 A 문맥에서 accept했다. responder가 accept를 Codex/adapter에
      // 돌려주기 전에 B open을 끝낸다. 따라서 다음 private RPC가 B를 보지 않는다면 스파이크 배선이 틀렸다.
      if (activePolicy?.switchToProjectB && answer.action === 'accept' && !d15Switch) {
        trace.tokenBeforeSwitch = storyCommands.projectToken
        trace.switchStartedSeq = ++sequence
        const switched = await storyCommands.open(projectB.projectPath)
        const storyBBefore = await readStory(projectB.storyPath)
        trace.switchCompletedSeq = ++sequence
        trace.switched = jsonSafe(switched)
        trace.tokenAfterSwitch = storyCommands.projectToken
        trace.storyBBeforeRaw = storyBBefore.raw
        trace.storyBBeforeSpeakers = storyBBefore.value.speakers
        d15Switch = trace
        console.log(`\n[M2 측정] D15 승인 뒤 tool 착지 전 project switch:\n${JSON.stringify({
          tokenBeforeSwitch: trace.tokenBeforeSwitch,
          tokenAfterSwitch: trace.tokenAfterSwitch,
          storyBBeforeSpeakers: trace.storyBBeforeSpeakers,
          switchCompletedSeq: trace.switchCompletedSeq,
        }, null, 2)}`)
        record('d15-project-switched-before-responder-return', {
          tokenBeforeSwitch: trace.tokenBeforeSwitch,
          tokenAfterSwitch: trace.tokenAfterSwitch,
          storyBBeforeSpeakers: trace.storyBBeforeSpeakers,
          switchCompletedSeq: trace.switchCompletedSeq,
        })
      }
      return answer
    }

    toolBridge = createToolBridge({ getWindow: () => fakeWindow })
    cleanups.push(() => toolBridge.close())
    const collector = createEventCollector()
    const recordingSpawn = createRecordingSpawn(children)
    // manager cleanup이 실패해도 실제 Codex child를 고아로 남기지 않는다.
    cleanups.push(async () => {
      for (const { child } of children) {
        if (child.exitCode == null && child.signalCode == null) child.kill('SIGTERM')
      }
    })

    const manager = createAgentSessionManager({
      grantLedger,
      approvalPrompt,
      toolBridge,
      storyCommands,
      modelCatalog: {
        list: vi.fn(async () => [{
          id: 'codex:gpt-5.5',
          provider: 'codex',
          sdkModel: 'gpt-5.5',
          isDefault: true,
          defaultFallbackFrom: 'claude-opus-4-8',
        }]),
        snapshot: vi.fn(() => ({
          cacheReady: false,
          rows: [{
            id: 'codex:gpt-5.5',
            provider: 'codex',
            sdkModel: 'gpt-5.5',
            isDefault: true,
            defaultFallbackFrom: 'claude-opus-4-8',
          }],
          defaultId: 'codex:gpt-5.5',
        })),
      },
      onEvent: collector.onEvent,
      createToolCoreImpl: (options) => {
        factoryCounts.toolCore += 1
        const core = createToolCore(options)
        const realCall = core.call.bind(core)
        core.call = async (name, args, context) => {
          const trace = {
            startSeq: ++sequence,
            name,
            args: jsonSafe(args),
            nonce: context?.nonce ?? null,
            projectTokenAtCall: storyCommands.projectToken,
          }
          toolCoreCalls.push(trace)
          try {
            const result = await realCall(name, args, context)
            trace.result = jsonSafe(result)
            return result
          } catch (error) {
            trace.error = error?.message ?? String(error)
            throw error
          } finally {
            trace.endSeq = ++sequence
            record('tool-core-call', trace)
          }
        }
        return core
      },
      createPrivateRpcImpl: (options) => {
        factoryCounts.privateRpc += 1
        const rpc = createPrivateRpc(options)
        const realStart = rpc.start.bind(rpc)
        rpc.start = async () => {
          privateRpcStartCalls += 1
          const endpoint = await realStart()
          endpoints.push(endpoint)
          record('private-rpc-started', {
            host: endpoint.host,
            port: endpoint.port,
            tokenLength: endpoint.token.length,
          })
          return endpoint
        }
        return rpc
      },
      createElicitationResponderImpl: (options) => {
        factoryCounts.elicitationResponder += 1
        const responder = createElicitationResponder(options)
        const realHandle = responder.handle.bind(responder)
        responder.handle = async (params, ctx) => {
          const meta = params?._meta ?? {}
          const trace = {
            seq: ++sequence,
            scenario: activePolicy?.label ?? 'UNEXPECTED',
            kind: meta.codex_approval_kind !== undefined
              ? 'native'
              : (meta.nonce && meta.tool && meta.argsHash ? 'handler' : 'unknown'),
            params: jsonSafe(params),
            ctx: jsonSafe(ctx),
          }
          elicitationCalls.push(trace)
          try {
            const result = await realHandle(params, ctx)
            trace.result = jsonSafe(result)
            return result
          } catch (error) {
            trace.error = error?.message ?? String(error)
            throw error
          } finally {
            trace.endSeq = ++sequence
            record('elicitation-responder-handle', trace)
          }
        }
        return responder
      },
      createCodexOrchestratorImpl: (options) => {
        factoryCounts.codexOrchestrator += 1
        const orchestrator = createCodexOrchestrator(options)
        const realOpen = orchestrator.open.bind(orchestrator)
        orchestrator.open = async () => {
          orchestratorOpenCalls += 1
          record('orchestrator-open-called', { count: orchestratorOpenCalls })
          return realOpen()
        }
        return orchestrator
      },
      orchestratorOptions: {
        adapterPath,
        codexPath: codexBin,
        spawnImpl: recordingSpawn,
      },
    })
    cleanups.push(() => manager.close())

    const openedSessions = []

    async function openScenario(label) {
      const sessionNumber = openedSessions.length + 1
      const permissionStart = permissionRequests.length
      const beforeChildren = liveChildren(children)
      const beforePorts = loopbackListeners()
      const expectedBeforeCounts = Object.fromEntries(Object.keys(factoryCounts).map((key) => [key, sessionNumber - 1]))

      // 매 scenario가 0 resources에서 시작해야 close→open 재사용과 thread 격리가 실제로 증명된다.
      expect(measured(`${label} open 전 Codex child count`, { count: beforeChildren.length, children: beforeChildren }),
        `${label}: 이전 session의 Codex child가 남았다`).toMatchObject({ count: 0 })
      expect(measured(`${label} open 전 loopback port count`, { count: beforePorts.length, listeners: beforePorts }),
        `${label}: 이전 session의 private RPC listener가 남았다`).toMatchObject({ count: 0 })
      expect(measured(`${label} open 전 factory counts`, factoryCounts),
        `${label}: session factory가 예상보다 일찍/많이 실행됐다`).toEqual(expectedBeforeCounts)

      const opened = await manager.open()
      const endpoint = endpoints.at(-1)
      const afterChildren = liveChildren(children)
      const afterPorts = loopbackListeners()
      const expectedAfterCounts = Object.fromEntries(Object.keys(factoryCounts).map((key) => [key, sessionNumber]))
      expect(measured(`${label} manager.open result`, opened),
        `${label}: 실제 app-server thread가 열리지 않았다`).toMatchObject({
        sessionId: expect.any(String),
        threadId: expect.any(String),
      })
      expect(measured(`${label} open 후 factory counts`, factoryCounts),
        `${label}: real factory 네 개가 이 session에서 정확히 한 번씩 조립되지 않았다`).toEqual(expectedAfterCounts)
      expect(measured(`${label} orchestrator.open cumulative calls`, orchestratorOpenCalls),
        `${label}: manager.open이 real orchestrator.open을 정확히 한 번 호출하지 않았다`).toBe(sessionNumber)
      expect(measured(`${label} privateRpc.start cumulative calls`, privateRpcStartCalls),
        `${label}: real private RPC가 session당 정확히 한 번 start되지 않았다`).toBe(sessionNumber)
      expect(measured(`${label} open 후 Codex child`, { count: afterChildren.length, children: afterChildren }),
        `${label}: 실제 codex app-server child가 정확히 하나여야 한다`).toMatchObject({ count: 1 })
      expect(measured(`${label} Codex executable`, afterChildren[0]?.command),
        `${label}: resolveCodexExecutablePath()의 binary가 아니다`).toBe(codexBin)
      expect(measured(`${label} Codex argv`, afterChildren[0]?.args),
        `${label}: spawn된 child가 app-server가 아니다`).toEqual(['app-server'])
      expect(measured(`${label} open 후 loopback listener`, { count: afterPorts.length, listeners: afterPorts }),
        `${label}: real loopback listener가 정확히 하나여야 한다`).toMatchObject({ count: 1 })
      expect(measured(`${label} private RPC endpoint`, {
        host: endpoint?.host,
        port: endpoint?.port,
        tokenLength: endpoint?.token?.length ?? 0,
      }), `${label}: real loopback + token endpoint가 없다`).toMatchObject({
        host: '127.0.0.1',
        port: expect.any(Number),
        tokenLength: expect.any(Number),
      })
      expect(measured(`${label} private RPC token strength`, endpoint?.token?.length ?? 0),
        `${label}: private RPC token이 비었거나 너무 짧다`).toBeGreaterThan(20)
      expect(measured(`${label} listener port == endpoint port`, afterPorts[0]?.port),
        `${label}: 실제 listener와 endpoint가 다르다`).toBe(endpoint.port)
      expect(measured(`${label} private RPC TCP connect`, await portIsOpen(endpoint.host, endpoint.port)),
        `${label}: endpoint 객체만 있고 실제 port는 listen하지 않는다`).toBe(true)
      expect(measured(`${label} fresh session identity`, {
        sessionId: opened.sessionId,
        threadId: opened.threadId,
        sessionIsNew: !openedSessions.some((entry) => entry.opened.sessionId === opened.sessionId),
        threadIsNew: !openedSessions.some((entry) => entry.opened.threadId === opened.threadId),
        tokenIsNew: !openedSessions.some((entry) => entry.endpoint.token === endpoint.token),
      }), `${label}: close→open이 이전 session/thread/token identity를 재사용했다`).toMatchObject({
        sessionIsNew: true,
        threadIsNew: true,
        tokenIsNew: true,
      })
      expect(measured(`${label} handshake renderer dialogs`, permissionRequests.slice(permissionStart)),
        `${label}: tool call 전 handshake만으로 사람 dialog가 떴다`).toHaveLength(0)

      const scenario = { label, opened, endpoint }
      openedSessions.push(scenario)
      return scenario
    }

    async function closeScenario(scenario) {
      const closed = await manager.close()
      const afterChildren = liveChildren(children)
      const afterPorts = loopbackListeners()
      expect(measured(`${scenario.label} manager.close result`, closed),
        `${scenario.label}: 닫은 session identity가 다르다`).toMatchObject({ sessionId: scenario.opened.sessionId })
      expect(measured(`${scenario.label} close 후 Codex child count`, {
        count: afterChildren.length,
        children: afterChildren,
      }), `${scenario.label}: close 뒤 Codex child가 남았다`).toMatchObject({ count: 0 })
      expect(measured(`${scenario.label} close 후 loopback port count`, {
        count: afterPorts.length,
        listeners: afterPorts,
      }), `${scenario.label}: close 뒤 private RPC listener가 남았다`).toMatchObject({ count: 0 })
      expect(measured(`${scenario.label} close 후 former port state`,
        await portIsOpen(scenario.endpoint.host, scenario.endpoint.port)),
      `${scenario.label}: 닫힌 session의 private RPC port가 아직 열린다`).toBe(false)
      expect(measured(`${scenario.label} close 후 manager status`, manager.status()),
        `${scenario.label}: manager가 idle로 돌아오지 않았다`).toEqual({ state: 'idle', sessionId: null })
      expect(measured(`${scenario.label} close 후 approval pending`, approvalPrompt.pendingCount()),
        `${scenario.label}: approval pending이 다음 session을 오염시킨다`).toBe(0)
    }

    // R은 자기 fresh thread에서만 실행한다. native 1/handler 0/renderer 0이 실 binary read 계약이다.
    const readScenario = await openScenario('R/list_scenes session')
    const readTurn = await runExpectedToolTurn({
      manager,
      collector,
      elicitationCalls,
      permissionRequests,
      setPolicy: (policy) => { activePolicy = policy },
      label: 'R/list_scenes',
      prompt: listScenesPrompt(),
      expectedTool: 'list_scenes',
      expectedPermission: 'R',
      expectedArgs: {},
      action: 'decline',
    })
    expect(measured('R/list_scenes agent:permission-request count', readTurn.dialogs.length),
      `read tool에 renderer dialog가 도착했다: ${JSON.stringify(readTurn.dialogs)}`).toBe(0)
    expect(measured('R/list_scenes tool result object', readTurn.result),
      'renderer scene 목록 DTO가 돌아오지 않았다').toEqual({
        status: 'done', source: 'renderer', sceneMode: 'audio-first', scenes: [], errors: [],
      })
    await closeScenario(readScenario)

    // approve는 새 thread에서 G native→handler→human→Tool Core→disk를 완주한다.
    const approveScenario = await openScenario('G/approve session')
    const beforeHappy = await readStory(projectA.storyPath)
    console.log('\n[M2 측정] approve 전 story.json speakers:', JSON.stringify(beforeHappy.value.speakers, null, 2))
    const happyTurn = await runExpectedToolTurn({
      manager,
      collector,
      elicitationCalls,
      permissionRequests,
      setPolicy: (policy) => { activePolicy = policy },
      label: 'G/approve',
      prompt: setSpeakersPrompt(HAPPY_ARGS),
      expectedTool: 'story_set_speakers',
      expectedPermission: 'G',
      expectedArgs: HAPPY_ARGS,
      action: 'accept',
    })
    assertGDialog(happyTurn, 'G/approve', HAPPY_ARGS)
    expect(measured('G/approve tool result object', happyTurn.result),
      '승인 뒤 Tool Core/durable command가 성공하지 않았다').toMatchObject({ status: 'done' })
    const afterHappy = await readStory(projectA.storyPath)
    console.log('\n[M2 측정] approve 후 story.json speakers:', JSON.stringify(afterHappy.value.speakers, null, 2))
    expect(measured('G/approve story.json bytes changed', afterHappy.raw !== beforeHappy.raw),
      'chat/tool 결과만 성공했고 durable story.json은 바뀌지 않았다').toBe(true)
    expect(measured('G/approve durable speakers', {
      before: beforeHappy.value.speakers,
      after: afterHappy.value.speakers,
    }), 'disk speakers가 승인한 값으로 바뀌지 않았다').toMatchObject({ after: HAPPY_ARGS.speakers })
    await closeScenario(approveScenario)

    // decline도 별도 fresh thread다. byte-identical disk만 0 side effect의 증거로 인정한다.
    const declineScenario = await openScenario('G/decline session')
    const beforeDecline = await readStory(projectA.storyPath)
    console.log('\n[M2 측정] decline 전 story.json speakers:', JSON.stringify(beforeDecline.value.speakers, null, 2))
    const declineTurn = await runExpectedToolTurn({
      manager,
      collector,
      elicitationCalls,
      permissionRequests,
      setPolicy: (policy) => { activePolicy = policy },
      label: 'G/decline',
      prompt: setSpeakersPrompt(DECLINE_ARGS),
      expectedTool: 'story_set_speakers',
      expectedPermission: 'G',
      expectedArgs: DECLINE_ARGS,
      action: 'decline',
    })
    assertGDialog(declineTurn, 'G/decline', DECLINE_ARGS)
    expect(measured('G/decline tool result object', declineTurn.result),
      'decline이 adapter에서 명시적 거부값으로 닫히지 않았다').toEqual({
      status: 'rejected',
      reason: 'declined-by-user',
    })
    const afterDecline = await readStory(projectA.storyPath)
    console.log('\n[M2 측정] decline 후 story.json speakers:', JSON.stringify(afterDecline.value.speakers, null, 2))
    expect(measured('G/decline story.json byte-identical', {
      identical: afterDecline.raw === beforeDecline.raw,
      beforeSpeakers: beforeDecline.value.speakers,
      afterSpeakers: afterDecline.value.speakers,
    }), 'decline 뒤 story.json에 side effect가 생겼다').toMatchObject({ identical: true })
    await closeScenario(declineScenario)

    // replay만 의도적으로 한 thread를 공유한다. 첫 호출 accept로 grant를 소비하고 같은 호출을 다시 보낸다.
    const replayScenario = await openScenario('G/replay session')
    const replayFirst = await runExpectedToolTurn({
      manager,
      collector,
      elicitationCalls,
      permissionRequests,
      setPolicy: (policy) => { activePolicy = policy },
      label: 'G/replay first',
      prompt: setSpeakersPrompt(HAPPY_ARGS),
      expectedTool: 'story_set_speakers',
      expectedPermission: 'G',
      expectedArgs: HAPPY_ARGS,
      action: 'accept',
    })
    const replayFirstDialog = assertGDialog(replayFirst, 'G/replay first', HAPPY_ARGS)
    expect(measured('G/replay first tool result object', replayFirst.result),
      'replay의 첫 승인 호출이 실행되지 않았다').toMatchObject({ status: 'done' })
    const replayFirstMeta = replayFirst.handlerElicitations[0].params._meta
    const replayFirstGrantStillAvailable = grantLedger.consume({
      nonce: replayFirstMeta.nonce,
      tool: 'story_set_speakers',
      argsHash: hashArgs(HAPPY_ARGS),
      sessionId: replayScenario.opened.sessionId,
      projectToken: projectTokenA,
    })
    expect(measured('G/replay first grant already consumed', {
      consumeAgainSucceeded: replayFirstGrantStillAvailable,
      nonce: replayFirstMeta.nonce,
      sessionId: replayScenario.opened.sessionId,
    }), '첫 G 실행 뒤 같은 grant가 ledger에 남아 replay 가능하다').toMatchObject({ consumeAgainSucceeded: false })
    const beforeReplaySecond = await readStory(projectA.storyPath)
    const replaySecond = await runExpectedToolTurn({
      manager,
      collector,
      elicitationCalls,
      permissionRequests,
      setPolicy: (policy) => { activePolicy = policy },
      label: 'G/replay second',
      prompt: setSpeakersPrompt(HAPPY_ARGS),
      expectedTool: 'story_set_speakers',
      expectedPermission: 'G',
      expectedArgs: HAPPY_ARGS,
      action: 'decline',
    })
    const replaySecondDialog = assertGDialog(replaySecond, 'G/replay second', HAPPY_ARGS)
    expect(measured('G/replay request identity', {
      firstRequestId: replayFirstDialog.requestId,
      secondRequestId: replaySecondDialog.requestId,
      isNew: replaySecondDialog.requestId !== replayFirstDialog.requestId,
      sameSessionId: replayFirstDialog.sessionId === replaySecondDialog.sessionId,
    }), '같은 session의 두 번째 G 호출이 새 approval identity를 만들지 않았다').toMatchObject({
      isNew: true,
      sameSessionId: true,
    })
    expect(measured('G/replay second tool result object', replaySecond.result),
      '두 번째 새 dialog를 decline했는데 replay가 실행됐다').toEqual({ status: 'rejected', reason: 'declined-by-user' })
    const afterReplaySecond = await readStory(projectA.storyPath)
    expect(measured('G/replay second decline disk bytes', {
      identical: afterReplaySecond.raw === beforeReplaySecond.raw,
      beforeSpeakers: beforeReplaySecond.value.speakers,
      afterSpeakers: afterReplaySecond.value.speakers,
    }), '두 번째 replay decline 뒤 durable side effect가 생겼다').toMatchObject({ identical: true })
    await closeScenario(replayScenario)

    // D15도 fresh A session에서 시작한다. accept 뒤 responder return 전에 B open을 끝내고 RPC를 착지시킨다.
    const d15Scenario = await openScenario('D15 session')
    expect(measured('D15 turn 전 active project token', storyCommands.projectToken),
      'D15 승인 dialog를 열기 전에 A가 active여야 한다').toBe(projectTokenA)
    const d15Turn = await runExpectedToolTurn({
      manager,
      collector,
      elicitationCalls,
      permissionRequests,
      setPolicy: (policy) => { activePolicy = policy },
      label: 'D15/A-approve-then-B-open',
      prompt: setSpeakersPrompt(D15_ARGS),
      expectedTool: 'story_set_speakers',
      expectedPermission: 'G',
      expectedArgs: D15_ARGS,
      action: 'accept',
      switchToProjectB: true,
    })
    const d15Dialog = assertGDialog(d15Turn, 'D15/A-approve-then-B-open', D15_ARGS)
    expect(measured('D15 dialog project token', d15Dialog.projectTokenAtDialog),
      '사람이 dialog를 볼 때 project A가 active가 아니었다').toBe(projectTokenA)
    expect(measured('D15 project switch evidence', {
      tokenBeforeSwitch: d15Switch?.tokenBeforeSwitch,
      tokenAfterSwitch: d15Switch?.tokenAfterSwitch,
      switchCompletedSeq: d15Switch?.switchCompletedSeq,
      beforeBSpeakers: d15Switch?.storyBBeforeSpeakers,
    }), 'accept 뒤 tool call 전에 실제 story:open(B)가 끝나지 않았다').toMatchObject({
      tokenBeforeSwitch: projectTokenA,
      tokenAfterSwitch: expect.any(String),
      switchCompletedSeq: expect.any(Number),
      beforeBSpeakers: INITIAL_B,
    })
    expect(measured('D15 new projectToken', d15Switch?.tokenAfterSwitch),
      'story:open(B)가 새 projectToken을 발급하지 않았다').not.toBe(projectTokenA)
    const d15CoreCall = toolCoreCalls.findLast((call) => call.name === 'story_set_speakers')
    expect(measured('D15 Tool Core landing order', {
      switchCompletedSeq: d15Switch?.switchCompletedSeq,
      toolCoreStartSeq: d15CoreCall?.startSeq,
      projectTokenAtCall: d15CoreCall?.projectTokenAtCall,
      result: d15CoreCall?.result,
    }), 'D15 tool이 B open보다 먼저 착지해 race를 실제로 재지 못했다').toMatchObject({
      projectTokenAtCall: d15Switch.tokenAfterSwitch,
      result: { status: 'rejected', reason: 'stale-token' },
    })
    expect(measured('D15 switch completed before Tool Core call',
      d15Switch.switchCompletedSeq < d15CoreCall.startSeq),
    'D15 project switch가 tool call 착지보다 늦었다').toBe(true)
    expect(measured('D15 tool result object', d15Turn.result),
      'A에 pin된 session이 B의 story_set_speakers를 거부하지 않았다').toEqual({ status: 'rejected', reason: 'stale-token' })

    const afterD15B = await readStory(projectB.storyPath)
    console.log('\n[M2 측정] D15 B story.json speakers before:', JSON.stringify(d15Switch.storyBBeforeSpeakers, null, 2))
    console.log('[M2 측정] D15 B story.json speakers after :', JSON.stringify(afterD15B.value.speakers, null, 2))
    expect(measured('D15 B story.json byte-identical', {
      identical: afterD15B.raw === d15Switch.storyBBeforeRaw,
      beforeSpeakers: d15Switch.storyBBeforeSpeakers,
      afterSpeakers: afterD15B.value.speakers,
    }), '🔴 D15 회귀: A에서 승인한 call이 project B story.json을 썼다').toMatchObject({ identical: true })

    const d15Ask = approvalAsks.findLast((ask) => ask.scenario === 'D15/A-approve-then-B-open')
    expect(measured('D15 grant meta identity', {
      nonce: d15Ask?.params?._meta?.nonce,
      tool: d15Ask?.params?._meta?.tool,
      argsHash: d15Ask?.params?._meta?.argsHash,
      expectedArgsHash: hashArgs(D15_ARGS),
      sessionId: d15Ask?.ctx?.sessionId,
    }), 'D15 승인 grant identity가 실제 args/session과 묶이지 않았다').toMatchObject({
      nonce: expect.any(String),
      tool: 'story_set_speakers',
      argsHash: hashArgs(D15_ARGS),
      expectedArgsHash: hashArgs(D15_ARGS),
      sessionId: d15Scenario.opened.sessionId,
    })
    const grantStillPresent = grantLedger.consume({
      nonce: d15Ask.params._meta.nonce,
      tool: 'story_set_speakers',
      argsHash: hashArgs(D15_ARGS),
      sessionId: d15Scenario.opened.sessionId,
      projectToken: projectTokenA,
    })
    expect(measured('D15 grant NOT consumed by stale call', grantStillPresent),
      'project switch가 사람의 A 승인 grant를 태웠다').toBe(true)
    await closeScenario(d15Scenario)

    const nativeAll = elicitationCalls.filter((entry) => entry.kind === 'native')
    const handlerAll = elicitationCalls.filter((entry) => entry.kind === 'handler')
    const unknownAll = elicitationCalls.filter((entry) => entry.kind === 'unknown')
    expect(measured('전체 renderer permission-request cardinality', {
      count: permissionRequests.length,
      scenarios: permissionRequests.map((request) => request.scenario),
    }), 'R=0, approve=1, decline=1, replay=2, D15=1의 합은 정확히 5여야 한다').toMatchObject({ count: 5 })
    expect(measured('전체 native/handler elicitation cardinality', {
      native: nativeAll.length,
      handler: handlerAll.length,
      unknown: unknownAll.length,
      nativeTools: nativeAll.map((entry) => ({
        title: entry.params?._meta?.tool_title,
        params: entry.params?._meta?.tool_params,
      })),
      handlerTools: handlerAll.map((entry) => entry.params?._meta?.tool),
    }), '6 tool calls은 native 6, G calls은 handler 5, unknown은 0이어야 한다').toMatchObject({
      native: 6,
      handler: 5,
      unknown: 0,
    })
    expect(measured('5회 fresh session factory totals', factoryCounts),
      'R/approve/decline/replay/D15가 각각 새 real session을 열지 않았다').toEqual({
      toolCore: 5,
      privateRpc: 5,
      elicitationResponder: 5,
      codexOrchestrator: 5,
    })
    expect(measured('모든 approvalPrompt 응답 정산 후 pending count', approvalPrompt.pendingCount()),
      '응답한 approval이 pending으로 남아 다음 run을 오염시킨다').toBe(0)
    console.log(`\n===== M2 approval gate evidence complete =====\nraw: ${RAW_PATH}`)
  }, TEST_TIMEOUT_MS)
})
