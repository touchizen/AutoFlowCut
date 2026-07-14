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
import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createStoryCommands, registerStoryIPC } from '../../../electron/ipc/story-api.js'
import { createToolCore } from '../../../electron/agent/toolCore.js'
import { createGrantLedger, hashArgs } from '../../../electron/agent/grantLedger.js'
import { createAgentSessionManager } from '../../../electron/agent/sessionManager.js'

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

  it('slice 12: 미오픈 `list_scenes` → `{error:\'no-project\'}` (throw 하지 않는다)', async () => {
    const r = await toolCore.call('list_scenes', {})
    expect(r).toEqual({ error: 'no-project' })
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
      .resolves.toMatchObject({ ok: true })

    // 같은 machine의 메모리를 다시 읽으면 flush가 빠져도 통과한다. 새 machine으로 reopen해 디스크를 검증한다.
    const reopened = await makeStoryCommands().open(dir)
    expect(reopened.projectToken).not.toBe(opened.projectToken)
    expect(reopened.state.speakers).toEqual(args.speakers)
  })

  it('미오픈 `story_get_state` → `{error:\'no-project\'}`', async () => {
    const r = await toolCore.call('story_get_state', {})
    expect(r).toEqual({ error: 'no-project' })
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

      expect(result).toEqual({ error: 'stale-token' })
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
