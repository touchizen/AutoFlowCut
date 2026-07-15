// @vitest-environment node
//
// M1 slice 9/10/12 — **Tool Core 와 IPC 는 같은 storyCommands 인스턴스를 본다** (스펙 D7).
//
//   const storyCommands = createStoryCommands(deps)
//   registerStoryIPC(ipcMain, storyCommands)
//   toolCore.use(storyCommands)
//
// 🔴 **왜 이게 계약인가:** 지금까지 `machine` 과 `openLock` 은 `registerStoryIPC` 의 **지역 상태**였다
//    (`story-api.js:51-52`). Tool Core 가 자기 machine 을 따로 만들면 **에이전트와 사람이 서로 다른
//    프로젝트를 보게 된다** — 같은 앱 안에서 상태가 갈라진다. machine 은 `story:open` 이 만든 하나뿐이어야 한다.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createStoryCommands, registerStoryIPC } from '../../../electron/ipc/story-api.js'
import { createToolCore, normalizeToolResult } from '../../../electron/agent/toolCore.js'
import { createGrantLedger, hashArgs } from '../../../electron/agent/grantLedger.js'
import { createAgentSessionManager } from '../../../electron/agent/sessionManager.js'
import { defaultStoryState } from '../../../electron/story/storyStore.js'

function fakeIpcMain() {
  const handlers = new Map()
  return { handle: (ch, fn) => handlers.set(ch, fn), invoke: (ch, payload) => handlers.get(ch)(null, payload), handlers }
}

function makeStoryCommands() {
  return createStoryCommands({
    keyStore: { getKey: () => 'k' },
    getWindow: () => ({ webContents: { send: () => {} }, isDestroyed: () => false }),
    llm: {
      generateScript: vi.fn(async () => ({ scriptMd: '#' })),
      splitScenes: vi.fn(async () => ({ scenes: [], speakers: [] })),
      writePrompts: vi.fn(async (s) => ({ scenes: s })),
      generateTitle: vi.fn(async () => ({ title: 't' })),
    },
    listClaudeModels: async () => [],
    listCodexModels: async () => [],
  })
}

let ipc, dir, storyCommands, toolCore, grantLedger
function bindToolCore(projectToken = storyCommands.projectToken) {
  toolCore = createToolCore({
    grantLedger,
    sessionId: 'toolcore-story-test',
    projectToken,
  })
  toolCore.use(storyCommands)
}

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'toolcore-'))
  ipc = fakeIpcMain()
  storyCommands = makeStoryCommands()
  registerStoryIPC(ipc, storyCommands)      // 🔴 같은 인스턴스
  grantLedger = createGrantLedger({ now: () => 0, ttlMs: 60_000 })
  bindToolCore(null)                         // 미오픈 session도 no-project를 값으로 돌려줘야 한다
})

describe('M1 — Tool Core ↔ IPC 단일 storyCommands (D7)', () => {
  it('slice 9: IPC 로 연 프로젝트를 Tool Core 가 **같은 projectToken/state 로** 본다', async () => {
    const opened = await ipc.invoke('story:open', { projectPath: dir })
    expect(opened.projectToken).toBeTruthy()
    bindToolCore(opened.projectToken)

    const ctx = await toolCore.call('story_get_state', {})

    expect(ctx.projectToken, 'Tool Core 가 IPC 와 다른 프로젝트를 보고 있다').toBe(opened.projectToken)
    expect(ctx.state.steps.script.status).toBe(opened.state.steps.script.status)
  })

  it('slice 9: machine 은 open 당 **정확히 1개** — Tool Core 가 자기 machine 을 만들지 않는다', async () => {
    const opened = await ipc.invoke('story:open', { projectPath: dir })
    bindToolCore(opened.projectToken)
    const a = await toolCore.call('story_get_state', {})
    const b = await toolCore.call('story_get_state', {})

    expect(a.projectToken).toBe(b.projectToken)

    // 🔴 **Tool Core 가 본 토큰으로 IPC guard 를 통과하는 것** 자체가 단일 machine 의 증명이다.
    //    ⚠️ 예전엔 `viaIpc.projectToken ?? a.projectToken` 로 비교했는데, `story:get-state` 는
    //    애초에 `projectToken` 을 **안 돌려준다** → fallback 이 **항상** 발동해서 첫 토큰을 자기 자신과
    //    비교하고 있었다. 두 번째 machine 을 주입해도 통과하던 vacuous 단언이었다 (실측).
    const viaIpc = await ipc.invoke('story:get-state', { projectToken: a.projectToken })
    expect(viaIpc.error, 'Tool Core 의 토큰이 IPC guard 를 못 통과했다 = machine 이 둘이다').toBeUndefined()
    expect(viaIpc.steps.script.status).toBe(a.state.steps.script.status)
  })

  it('slice 12: 미오픈 `list_scenes` → rejected/no-project (throw 하지 않는다)', async () => {
    const r = await toolCore.call('list_scenes', {})
    expect(r).toEqual({ status: 'rejected', reason: 'no-project' })
  })

  it('slice 12: 오픈 뒤 `list_scenes` 는 **요약 문자열이 아니라 JSON** 이다', async () => {
    const opened = await ipc.invoke('story:open', { projectPath: dir })
    bindToolCore(opened.projectToken)
    const r = await toolCore.call('list_scenes', {})

    expect(typeof r, 'JSON 이어야 한다 — 요약 문자열은 계약 위반이다').toBe('object')
    expect(Array.isArray(r.scenes)).toBe(true)
  })

  it('`story_set_speakers`는 실제 shared commands에 화자/음성 설정을 durable 저장한다', async () => {
    const opened = await ipc.invoke('story:open', { projectPath: dir })
    bindToolCore(opened.projectToken)
    const args = {
      speakers: [{ id: 'narrator', name: '나레이션', voice: { provider: 'typecast', voiceId: 'tc_n' } }],
    }
    grantLedger.grant({
      nonce: 'set-speakers-1',
      tool: 'story_set_speakers',
      argsHash: hashArgs(args),
      sessionId: 'toolcore-story-test',
      projectToken: opened.projectToken,
    })

    await expect(toolCore.call('story_set_speakers', args, { nonce: 'set-speakers-1' }))
      .resolves.toMatchObject({ status: 'done', operationId: expect.any(String) })

    // 같은 machine의 메모리를 다시 읽으면 flush가 빠져도 통과한다. 새 machine으로 reopen해 디스크를 검증한다.
    const reopened = await makeStoryCommands().open(dir)
    expect(reopened.projectToken).not.toBe(opened.projectToken)
    expect(reopened.state.speakers).toEqual(args.speakers)
  })

  it('미오픈 `story_get_state` → rejected/no-project', async () => {
    const r = await toolCore.call('story_get_state', {})
    expect(r).toEqual({ status: 'rejected', reason: 'no-project' })
  })

  it('🔴 unknown tool 은 **fail-closed** — 조용히 undefined 를 돌려주지 않는다', async () => {
    await expect(toolCore.call('definitely_not_a_tool', {})).rejects.toThrow(/unknown tool/i)
  })
})

describe('D15 — agent session의 프로젝트 경계', () => {
  it('A에서 받은 승인은 B로 전환된 뒤 stale-token이고 B story.json과 grant를 건드리지 않는다', async () => {
    const projectA = await mkdtemp(path.join(tmpdir(), 'agent-project-a-'))
    const projectB = await mkdtemp(path.join(tmpdir(), 'agent-project-b-'))
    const realCommands = makeStoryCommands()
    const realIpc = fakeIpcMain()
    registerStoryIPC(realIpc, realCommands)
    const ledger = createGrantLedger({ now: () => 0, ttlMs: 60_000 })
    let sessionToolCore

    const openedA = await realIpc.invoke('story:open', { projectPath: projectA })
    await realCommands.setSpeakers({
      speakers: [{ id: 'narrator', name: 'A 나레이터', voice: { provider: 'typecast', voiceId: 'v-pA' } }],
    })
    const beforeA = await readFile(path.join(projectA, 'story', 'story.json'), 'utf8')

    const manager = createAgentSessionManager({
      grantLedger: ledger,
      approvalPrompt: {
        ask: vi.fn(async () => ({ action: 'decline' })),
        closeSession: vi.fn(),
      },
      toolBridge: {},
      storyCommands: realCommands,
      createPrivateRpcImpl: ({ toolCore: core }) => {
        sessionToolCore = core
        return { close: vi.fn(async () => {}) }
      },
      createCodexOrchestratorImpl: () => ({
        open: vi.fn(async () => ({ threadId: 'd15-thread' })),
        send: vi.fn(),
        steer: vi.fn(),
        abort: vi.fn(),
        close: vi.fn(async () => {}),
      }),
      randomUUIDImpl: () => 'd15-session',
    })

    try {
      await manager.open()
      const pinnedState = await sessionToolCore.call('story_get_state')
      expect(pinnedState.projectToken, 'sessionManager.open이 A token을 Tool Core에 pin하지 않았다')
        .toBe(openedA.projectToken)
      const args = {
        speakers: [{ id: 'narrator', name: '에이전트', voice: { provider: 'typecast', voiceId: 'AGENT-WROTE-THIS' } }],
      }
      const grantIdentity = {
        nonce: 'approved-in-a',
        tool: 'story_set_speakers',
        argsHash: hashArgs(args),
        sessionId: 'd15-session',
        projectToken: openedA.projectToken,
      }
      ledger.grant(grantIdentity)

      const openedB = await realIpc.invoke('story:open', { projectPath: projectB })
      expect(openedB.projectToken).not.toBe(openedA.projectToken)
      await realCommands.setSpeakers({
        speakers: [{ id: 'narrator', name: 'B 나레이터', voice: { provider: 'typecast', voiceId: 'v-pB' } }],
      })
      const storyBPath = path.join(projectB, 'story', 'story.json')
      const beforeB = await readFile(storyBPath, 'utf8')

      const result = await sessionToolCore.call('story_set_speakers', args, { nonce: 'approved-in-a' })

      expect(result).toEqual({ status: 'rejected', reason: 'stale-token' })
      expect(await readFile(storyBPath, 'utf8'), 'B 프로젝트 durable state가 바뀌었다').toBe(beforeB)
      expect(await readFile(path.join(projectA, 'story', 'story.json'), 'utf8')).toBe(beforeA)
      // stale 사전조건은 승인 consume보다 앞이어야 한다. 프로젝트 전환만으로 사람 승인을 태우지 않는다.
      expect(ledger.consume(grantIdentity), 'stale 호출이 A의 승인을 소비했다').toBe(true)
    } finally {
      await manager.close()
    }
  })
})

describe('M1 slice 10 — 핸들러 계수 불변식 (D7)', () => {
  // D7 은 M1 기준 20 = 17 guarded + 3 custom 이라고 쓰지만, **M1a 의 `story:stage-image-first` 가
  // 먼저 착지해서** 현재는 21 = 18 guarded + 3 custom 이다. 궤적은 20 → (D24a) 21 → (D24b) 22 다.
  // 🔴 숫자를 맞추려고 D24b `story:commit-image-first-script` 를 **조기 구현하지 마라** —
  //    스펙은 그걸 blind gate 통과 뒤 M3 로 미뤄뒀다. 계수는 현실을 적고, 궤적을 주석으로 남긴다.
  // custom 3개 = token guard 를 안 타는 것들.
  //   list-llm-options: 프로젝트와 무관 / open: 토큰을 **발급하는** 쪽 / load-audio-package: 경로 직독 허용
  const CUSTOM = ['story:list-llm-options', 'story:open', 'story:load-audio-package']

  it('IPC 핸들러는 21개 = 18 guarded + 3 custom', async () => {
    expect(ipc.handlers.size).toBe(21)
    for (const ch of CUSTOM) expect(ipc.handlers.has(ch), `custom 핸들러 ${ch} 가 없다`).toBe(true)
    expect(ipc.handlers.size - CUSTOM.length).toBe(18)
  })

  // 🔴 위 테스트는 **산수 항등식**이다 — `size===21` 을 단언한 뒤 `21-3===18` 을 확인할 뿐,
  //    그 18개가 **정말 guarded 인지**는 하나도 안 본다. 실측: `story:abort` 와 `story:tts-preview` 의
  //    `guarded()` 를 벗겨도 electron 테스트 1,920개가 전부 초록이었다.
  //    → **숫자가 아니라 계약을 잰다: custom 이 아닌 모든 채널은 틀린 토큰을 거부해야 한다.**
  it('🔴 custom 3개를 뺀 **모든** 채널이 틀린 토큰을 `stale-token` 으로 거부한다', async () => {
    await ipc.invoke('story:open', { projectPath: dir })

    const guardedChannels = [...ipc.handlers.keys()].filter((ch) => !CUSTOM.includes(ch))
    expect(guardedChannels).toHaveLength(18)

    for (const ch of guardedChannels) {
      const r = await ipc.invoke(ch, { projectToken: 'wrong-token' })
      expect(r, `🔴 ${ch} 가 틀린 토큰을 통과시켰다 — guard 가 없다`).toEqual({ error: 'stale-token' })
    }
  })
})

function makeNormalizationHarness({
  raw = {},
  hasProject = true,
  commandProjectToken = 'normalize-project',
  sessionProjectToken = commandProjectToken,
  admitToolCall = null,
  toolBridge = null,
} = {}) {
  const ledger = createGrantLedger({ now: () => 0, ttlMs: 60_000 })
  const commands = {
    hasProject: () => hasProject,
    projectToken: commandProjectToken,
    projectPath: '/normalize-proj',
    getState: vi.fn(async () => raw.getState ?? { steps: {} }),
    listScenes: vi.fn(async () => raw.listScenes ?? { scenes: [] }),
    confirmSynopsis: vi.fn(async () => raw.confirmSynopsis ?? { ok: true, operationId: 'confirm-op' }),
    setSpeakers: vi.fn(async () => raw.setSpeakers ?? { ok: true, operationId: 'speakers-op' }),
    start: vi.fn(async () => raw.start ?? { operationId: 'start-op', outcome: { status: 'done' } }),
  }
  const core = createToolCore({
    grantLedger: ledger,
    sessionId: 'normalize-session',
    projectToken: sessionProjectToken,
    admitToolCall,
    toolBridge,
    imageReader: { exists: vi.fn(async () => false), decodeFile: vi.fn() },
    visualReviewStore: { read: vi.fn(async () => ({ version: 1, reviews: {} })), update: vi.fn(async () => []) },
  })
  core.use(commands)

  const call = async (name, args = {}) => {
    const tool = core.list().find((item) => item.name === name)
    const context = {}
    if (tool?.permission !== 'R') {
      context.nonce = `grant-${name}`
      ledger.grant({
        nonce: context.nonce,
        tool: name,
        argsHash: hashArgs(args),
        sessionId: 'normalize-session',
        projectToken: commandProjectToken,
      })
    }
    return core.call(name, args, context)
  }

  return { core, commands, call }
}

describe('D8 — Tool Core 결과 정규화 매핑표', () => {
  it('normalizeToolResult를 producer 밖의 이상 shape로 직접 검증할 수 있다', () => {
    expect(normalizeToolResult).toBeTypeOf('function')
  })

  it.each([
    [{ status: 'running', progress: 0.5 }, 'status'],
    [{ operationId: 'future-op', outcome: { status: 'unknown-future' } }, 'outcome'],
    [{ success: true }, 'shape'],
  ])('알 수 없는 결과 표식 %#은 done을 지어내지 않고 throw한다', (raw, message) => {
    expect(() => normalizeToolResult('story_start_step', raw)).toThrow(message)
  })

  it.each([
    [{ status: 'failed', error: 'x' }, { status: 'rejected', reason: 'x' }],
    [{ ok: false }, { status: 'rejected', reason: 'unknown' }],
    [{ success: false }, { status: 'rejected', reason: 'unknown' }],
    [{ error: '' }, { status: 'rejected', reason: 'unknown' }],
  ])('명시적 거부 shape %#은 reason이 있는 rejected로 닫는다', (raw, expected) => {
    expect(normalizeToolResult('story_set_speakers', raw)).toEqual(expected)
  })

  it('이미 rejected인 결과도 reason 없는 shape를 허용하지 않는다', () => {
    expect(normalizeToolResult('story_set_speakers', { status: 'rejected' }))
      .toEqual({ status: 'rejected', reason: 'unknown' })
  })

  it('ok:true의 도메인 extras는 보존하고 내부 성공 표식은 제거한다', () => {
    expect(normalizeToolResult('story_set_speakers', {
      ok: true,
      success: true,
      operationId: 'speakers-op',
      persisted: 3,
    })).toEqual({ status: 'done', operationId: 'speakers-op', persisted: 3 })
  })

  it.each([
    ['busy', 'busy'],
    ['fixed-scenes-stale', 'fixed-scenes-stale'],
    ['fixed-scenes-immutable', 'fixed-scenes-immutable'],
    ['fixed-audio-required', 'fixed-audio-required'],
    // 같은 legacy 단어라도 start의 roster gate만 별도 어휘로 바뀐다.
    ['unconfirmed', 'characters-unconfirmed'],
  ])('story_start_step 선행 거부 %s → rejected/%s', async (legacy, reason) => {
    const { call } = makeNormalizationHarness({ raw: { start: { error: legacy } } })
    await expect(call('story_start_step', { step: 'script', params: {} }))
      .resolves.toEqual({ status: 'rejected', reason })
  })

  it.each([
    [{ operationId: 'op-done', outcome: { status: 'done' } }, { status: 'done', operationId: 'op-done' }],
    [{ operationId: 'op-error', outcome: { status: 'error', error: 'boom' } }, { status: 'error', operationId: 'op-error', error: 'boom' }],
    [{ operationId: 'op-aborted', outcome: { status: 'aborted' } }, { status: 'aborted', operationId: 'op-aborted' }],
  ])('story_start_step nested outcome을 D8 terminal shape로 평탄화한다', async (legacy, expected) => {
    const { call } = makeNormalizationHarness({ raw: { start: legacy } })
    await expect(call('story_start_step', { step: 'script', params: {} })).resolves.toEqual(expected)
  })

  it.each([
    ['story_confirm_synopsis', { synopsisMd: '#' }, 'confirmSynopsis'],
    ['story_set_speakers', { speakers: [] }, 'setSpeakers'],
  ])('%s의 {ok:true,operationId} → done', async (name, args, method) => {
    const operationId = `${method}-op`
    const { call } = makeNormalizationHarness({ raw: { [method]: { ok: true, operationId } } })
    await expect(call(name, args)).resolves.toEqual({ status: 'done', operationId })
  })

  it.each([
    [
      'story_confirm_synopsis',
      { synopsisMd: '#' },
      { confirmSynopsis: { success: false, error: 'storyboard-scene-invalid', violations: ['row-2'] } },
      { status: 'rejected', reason: 'storyboard-scene-invalid', violations: ['row-2'] },
    ],
    [
      'story_set_speakers',
      { speakers: [] },
      { setSpeakers: { error: 'roster-incomplete', speakers: ['Bob'] } },
      { status: 'rejected', reason: 'roster-incomplete', speakers: ['Bob'] },
    ],
  ])('%s의 도메인 거부 extras를 보존한다', async (name, args, raw, expected) => {
    const { call } = makeNormalizationHarness({ raw })
    await expect(call(name, args)).resolves.toEqual(expected)
  })

  it('R 툴 도메인 payload를 done으로 감싼다', async () => {
    const { call } = makeNormalizationHarness({
      raw: {
        getState: { steps: { script: { status: 'done' } } },
        listScenes: { scenes: [{ id: 's1' }] },
      },
    })

    await expect(call('story_get_state')).resolves.toEqual({
      status: 'done',
      projectToken: 'normalize-project',
      state: { steps: { script: { status: 'done' } } },
    })
    await expect(call('list_scenes')).resolves.toEqual({ status: 'done', scenes: [{ id: 's1' }] })
  })

  it.each(['complete', 'cancelled-by-user', 'error'])('wait_batch %s는 done.batch로 충돌 키를 격리한다', async (status) => {
    const snapshot = { status, done: 2, total: 3, error: status === 'error' ? 1 : 0 }
    const toolBridge = { invoke: vi.fn(async () => snapshot) }
    const { call } = makeNormalizationHarness({ toolBridge })

    await expect(call('wait_batch', { type: 'scene' })).resolves.toEqual({
      status: 'done',
      batch: snapshot,
    })
  })

  it('wait_batch timeout도 예외나 rejected가 아니라 done.batch 값이다', async () => {
    let time = 0
    const toolBridge = { invoke: vi.fn(async () => ({ status: 'running', done: 1, total: 3, error: 0 })) }
    const core = createToolCore({
      toolBridge,
      now: () => time,
      sleep: async (ms) => { time += ms },
      waitWindowMs: 5,
      pollIntervalMs: 5,
    })

    await expect(core.call('wait_batch', { type: 'scene' })).resolves.toEqual({
      status: 'done',
      batch: { status: 'timeout', done: 1, total: 3, error: 0 },
    })
  })

  it.each([
    [
      'agent-limit',
      () => makeNormalizationHarness({ admitToolCall: () => ({ error: 'agent-limit', limit: 2, used: 2 }) }).core.call('list_scenes'),
      { status: 'rejected', reason: 'agent-limit', limit: 2, used: 2 },
    ],
    [
      'invalid-params',
      () => makeNormalizationHarness().core.call('list_scenes', { invented: true }),
      { status: 'rejected', reason: 'invalid-params', params: ['invented'] },
    ],
    [
      'no-project',
      () => makeNormalizationHarness({ hasProject: false }).core.call('list_scenes'),
      { status: 'rejected', reason: 'no-project' },
    ],
    [
      'stale-token',
      () => makeNormalizationHarness({ sessionProjectToken: 'old-project' }).core.call('list_scenes'),
      { status: 'rejected', reason: 'stale-token' },
    ],
  ])('%s 사전 거부를 rejected로 정규화한다', async (_label, invoke, expected) => {
    await expect(invoke()).resolves.toEqual(expected)
  })

  it('grant 없는 unconfirmed는 characters 어휘로 바꾸지 않는다', async () => {
    const { core } = makeNormalizationHarness()
    await expect(core.call('story_confirm_synopsis', { synopsisMd: '#' }))
      .resolves.toEqual({ status: 'rejected', reason: 'unconfirmed' })
  })
})

describe('D8 — 실제 stepMachine 반환을 Tool Core가 정규화한다', () => {
  async function realCoreWithLlm(realLlm, { project, story } = {}) {
    if (project !== undefined) await writeFile(path.join(dir, 'project.json'), JSON.stringify(project, null, 2))
    if (story !== undefined) {
      await mkdir(path.join(dir, 'story'), { recursive: true })
      await writeFile(path.join(dir, 'story', 'story.json'), JSON.stringify(story, null, 2))
    }
    const commands = createStoryCommands({
      keyStore: { getKey: () => 'k' },
      getWindow: () => ({ webContents: { send: () => {} }, isDestroyed: () => false }),
      llm: realLlm,
      listClaudeModels: async () => [],
      listCodexModels: async () => [],
    })
    const opened = await commands.open(dir)
    const ledger = createGrantLedger({ now: () => 0, ttlMs: 60_000 })
    const core = createToolCore({
      grantLedger: ledger,
      sessionId: 'real-step-session',
      projectToken: opened.projectToken,
    })
    core.use(commands)
    const callStart = (args, nonce) => {
      ledger.grant({
        nonce,
        tool: 'story_start_step',
        argsHash: hashArgs(args),
        sessionId: 'real-step-session',
        projectToken: opened.projectToken,
      })
      return core.call('story_start_step', args, { nonce })
    }
    return { commands, callStart }
  }

  const fixedScenes = [{ ordinal: 1, storyId: 'story-1', rendererSceneId: 'scene-1' }]
  const fixedState = {
    sceneMode: 'image-first',
    imageFirstVariant: 'image-only',
    fixedSceneRevision: 'fixed-r-1',
    fixedScenes,
  }
  const imageFirstStory = (audio = { status: 'pending' }) => ({
    ...defaultStoryState(),
    ...fixedState,
    input: { type: 'storyboard', variant: 'image-only', fixedSceneRevision: 'fixed-r-1' },
    charactersConfirmed: true,
    steps: {
      ...defaultStoryState().steps,
      audio,
    },
  })

  it.each([
    [
      'fixed-scenes-stale',
      { project: fixedState, story: defaultStoryState() },
      { step: 'script', params: {} },
    ],
    [
      'fixed-scenes-immutable',
      { project: fixedState, story: imageFirstStory() },
      { step: 'script', params: {} },
    ],
    [
      'fixed-audio-required',
      { project: fixedState, story: imageFirstStory({ status: 'pending' }) },
      { step: 'prompts', params: {} },
    ],
  ])('실제 stepMachine 선행 거부 %s를 같은 reason으로 보존한다', async (reason, fixture, args) => {
    const { callStart } = await realCoreWithLlm({
      generateScript: vi.fn(async () => ({ scriptMd: '#' })),
      splitScenes: vi.fn(async () => ({ scenes: [], speakers: [] })),
      writePrompts: vi.fn(async (scenes) => ({ scenes })),
    }, fixture)

    await expect(callStart(args, `real-${reason}`)).resolves.toEqual({ status: 'rejected', reason })
  })

  it('실제 running step의 busy를 선행 거부로 보존한다', async () => {
    let resolveScript
    const { commands, callStart } = await realCoreWithLlm({
      generateScript: vi.fn(() => new Promise((resolve) => { resolveScript = resolve })),
      splitScenes: vi.fn(async () => ({ scenes: [], speakers: [] })),
      writePrompts: vi.fn(async (scenes) => ({ scenes })),
    })
    const running = commands.start('script', { input: { type: 'title', title: 'T' }, options: {} })
    await vi.waitFor(() => expect(resolveScript).toBeTypeOf('function'))

    await expect(callStart({ step: 'script', params: {} }, 'real-busy'))
      .resolves.toEqual({ status: 'rejected', reason: 'busy' })

    resolveScript({ scriptMd: '#' })
    await running
  })

  it('실제 완료와 실행 오류를 done/error로 구분한다', async () => {
    const generateScript = vi.fn()
      .mockResolvedValueOnce({ scriptMd: '# 성공' })
      .mockRejectedValueOnce(new Error('fixed-scenes-stale'))
    const { callStart } = await realCoreWithLlm({
      generateScript,
      splitScenes: vi.fn(async () => ({ scenes: [], speakers: [] })),
      writePrompts: vi.fn(async (scenes) => ({ scenes })),
    })
    const args = (title) => ({ step: 'script', params: { options: {}, synopsis: title } })

    await expect(callStart(args('성공'), 'real-done')).resolves.toMatchObject({ status: 'done', operationId: expect.any(String) })
    // throw 문구가 renderer 거부 토큰과 같아도 nested outcome이라 작업 실패로 남아야 한다.
    await expect(callStart(args('오류'), 'real-error')).resolves.toMatchObject({
      status: 'error', operationId: expect.any(String), error: 'fixed-scenes-stale',
    })
  })

  it('signal을 무시한 실제 step이 abort 뒤 늦게 끝나도 aborted다', async () => {
    let resolveScript
    const { commands, callStart } = await realCoreWithLlm({
      generateScript: vi.fn(() => new Promise((resolve) => { resolveScript = resolve })),
      splitScenes: vi.fn(async () => ({ scenes: [], speakers: [] })),
      writePrompts: vi.fn(async (scenes) => ({ scenes })),
    })
    const args = { step: 'script', params: { options: {}, synopsis: '중단' } }
    const running = callStart(args, 'real-abort')
    await vi.waitFor(() => expect(resolveScript).toBeTypeOf('function'))

    await commands.abort()
    resolveScript({ scriptMd: '# 늦은 결과' })

    await expect(running).resolves.toMatchObject({ status: 'aborted', operationId: expect.any(String) })
  })

  it('실제 roster gate의 unconfirmed만 characters-unconfirmed로 바꾼다', async () => {
    const { commands, callStart } = await realCoreWithLlm({
      generateScript: vi.fn(async () => ({ scriptMd: '#' })),
      splitScenes: vi.fn(async () => ({ scenes: [], speakers: [] })),
      writePrompts: vi.fn(async (scenes) => ({ scenes })),
    })
    await commands.start('script', { pastedScript: '# 붙여넣기', options: {} })

    await expect(callStart({ step: 'scenes', params: {} }, 'real-roster-gate'))
      .resolves.toEqual({ status: 'rejected', reason: 'characters-unconfirmed' })
  })
})

describe('D8 — 전 툴 결과 어휘 불변식과 throw 경계', () => {
  it('toolCore.list()의 모든 툴은 D8 status를 내고 reason은 rejected에만 있다', async () => {
    const toolBridge = { invoke: vi.fn(async () => ({ status: 'complete', done: 1, total: 1, error: 0 })) }
    const { core, call } = makeNormalizationHarness({
      toolBridge,
      raw: {
        confirmSynopsis: { success: false, error: 'validator-refusal', violations: ['v1'] },
        setSpeakers: { error: 'roster-incomplete', speakers: ['Alice'] },
        start: { operationId: 'failed-op', outcome: { status: 'error', error: 'step failed' } },
      },
    })
    const args = {
      story_get_state: {},
      list_scenes: {},
      wait_batch: { type: 'scene' },
      story_confirm_synopsis: { synopsisMd: '#' },
      story_set_speakers: { speakers: [] },
      story_start_step: { step: 'script', params: {} },
      get_scene_images: {},
      get_scene_video_frames: {},
      update_visual_review: { sceneNumbers: [] },
      list_visual_reviews: {},
      list_problem_scenes: {},
      export_capcut: {},
      export_premiere: {},
    }

    for (const tool of core.list()) {
      const result = await call(tool.name, args[tool.name])
      expect(['done', 'error', 'aborted', 'rejected'], tool.name).toContain(result.status)
      if (result.status === 'rejected') expect(result.reason, tool.name).toBeTypeOf('string')
      else expect(result, tool.name).not.toHaveProperty('reason')
    }
  })

  it('unknown tool/의존성 누락/command throw/bridge throw는 정규화하지 않고 그대로 던진다', async () => {
    await expect(createToolCore().call('unknown-tool')).rejects.toThrow(/unknown tool/)
    await expect(createToolCore().call('story_get_state')).rejects.toThrow(/use\(storyCommands\)/)

    const commandError = makeNormalizationHarness()
    commandError.commands.listScenes.mockRejectedValueOnce(new Error('story bridge died'))
    await expect(commandError.core.call('list_scenes')).rejects.toThrow('story bridge died')

    const bridgeError = makeNormalizationHarness({
      toolBridge: { invoke: vi.fn(async () => { throw new Error('renderer bridge died') }) },
    })
    await expect(bridgeError.core.call('wait_batch', { type: 'scene' })).rejects.toThrow('renderer bridge died')
  })
})
