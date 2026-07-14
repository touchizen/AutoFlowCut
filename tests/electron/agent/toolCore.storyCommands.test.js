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
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createStoryCommands, registerStoryIPC } from '../../../electron/ipc/story-api.js'
import { createToolCore } from '../../../electron/agent/toolCore.js'

function fakeIpcMain() {
  const handlers = new Map()
  return { handle: (ch, fn) => handlers.set(ch, fn), invoke: (ch, payload) => handlers.get(ch)(null, payload), handlers }
}

let ipc, dir, storyCommands, toolCore
beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'toolcore-'))
  ipc = fakeIpcMain()
  storyCommands = createStoryCommands({
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
  registerStoryIPC(ipc, storyCommands)      // 🔴 같은 인스턴스
  toolCore = createToolCore()
  toolCore.use(storyCommands)               // 🔴 같은 인스턴스
})

describe('M1 — Tool Core ↔ IPC 단일 storyCommands (D7)', () => {
  it('slice 9: IPC 로 연 프로젝트를 Tool Core 가 **같은 projectToken/state 로** 본다', async () => {
    const opened = await ipc.invoke('story:open', { projectPath: dir })
    expect(opened.projectToken).toBeTruthy()

    const ctx = await toolCore.call('story_get_state', {})

    expect(ctx.projectToken, 'Tool Core 가 IPC 와 다른 프로젝트를 보고 있다').toBe(opened.projectToken)
    expect(ctx.state.steps.script.status).toBe(opened.state.steps.script.status)
  })

  it('slice 9: machine 은 open 당 **정확히 1개** — Tool Core 가 자기 machine 을 만들지 않는다', async () => {
    await ipc.invoke('story:open', { projectPath: dir })
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
    await ipc.invoke('story:open', { projectPath: dir })
    const r = await toolCore.call('list_scenes', {})

    expect(typeof r, 'JSON 이어야 한다 — 요약 문자열은 계약 위반이다').toBe('object')
    expect(Array.isArray(r.scenes)).toBe(true)
  })

  it('미오픈 `story_get_state` → `{error:\'no-project\'}`', async () => {
    const r = await toolCore.call('story_get_state', {})
    expect(r).toEqual({ error: 'no-project' })
  })

  it('🔴 unknown tool 은 **fail-closed** — 조용히 undefined 를 돌려주지 않는다', async () => {
    await expect(toolCore.call('definitely_not_a_tool', {})).rejects.toThrow(/unknown tool/i)
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
