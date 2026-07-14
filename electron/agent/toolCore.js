/**
 * Tool Core — 에이전트가 쓰는 툴 구현 **한 벌** (스펙 §2, D7).
 *
 * 🔴 **핵심 계약: Tool Core 는 자기 상태를 만들지 않는다.** `use(storyCommands)` 로 주입받은
 *    **IPC 와 같은 인스턴스**에 위임한다. 별도 machine 을 만들면 에이전트와 사람이 서로 다른
 *    프로젝트를 보게 된다 (D7).
 *
 *      const storyCommands = createStoryCommands(deps)
 *      registerStoryIPC(ipcMain, storyCommands)
 *      toolCore.use(storyCommands)
 *
 * 지금은 M1 최소 슬라이스 — **read-only 툴만** 있다. permission metadata / app ledger /
 * nativeImage decode / renderer 를 타는 툴(toolBridge)은 뒤 슬라이스다.
 */

import { hashArgs } from './grantLedger.js'

/** 프로젝트가 안 열렸을 때의 공통 거부 (스펙 §2.1 `get_project_context`, slice 12). */
const NO_PROJECT = Object.freeze({ error: 'no-project' })

/** `wait_batch` 의 종결 상태 — 여기 도달하면 더 기다릴 이유가 없다. */
const BATCH_TERMINAL = new Set(['complete', 'cancelled-by-user', 'error'])
const BATCH_TYPES = new Set(['scene', 'ref'])

/**
 * @param {object} [deps]
 * @param {object} [deps.toolBridge] renderer 를 읽는 seam (D14). 없으면 renderer 를 타는 툴은 못 쓴다.
 * @param {() => number} [deps.now] 주입 가능한 시계 — 테스트가 실제로 기다리지 않게.
 * @param {(ms:number) => Promise<void>} [deps.sleep]
 * @param {number} [deps.waitWindowMs] `wait_batch` 의 대기 창 W.
 *   🔴 **하드코딩하지 않는다** — 스펙이 측정 전 확정을 금지한다. legacy 600초는 잠정값일 뿐이다.
 * @param {number} [deps.pollIntervalMs]
 */
export function createToolCore({
  toolBridge = null,
  grantLedger = null,
  sessionId = null,
  now = () => Date.now(),
  sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
  waitWindowMs = 10 * 60 * 1000,     // 잠정 — legacy 폴링 창과 같게 두되, 측정 뒤 정한다
  pollIntervalMs = 5_000,            // 잠정 — legacy 와 같게
} = {}) {
  let storyCommands = null

  /**
   * 배치가 끝나거나 창 W 가 만료될 때까지 renderer 를 폴링한다 (§2.3).
   *
   * 🔴 **두 timeout 을 섞지 않는다.**
   *   - 창 W 만료 → **값** `{status:'timeout', ...}`. 에이전트가 행동할 수 있는 정상 결과다.
   *   - `toolBridge.invoke` 의 reject → **던진다.** 창이 죽었거나 bridge 가 닫힌 것 = 배치 상태를
   *     **모르는** 것이다. 마지막 카운트로 timeout 을 지어내면 에이전트가 **죽은 앱을 계속 기다린다.**
   */
  async function waitBatch({ type } = {}) {
    // fail-closed. 조용히 scene 으로 폴백하면 엉뚱한 배치를 기다리고도 모른다.
    if (!BATCH_TYPES.has(type)) throw new Error(`unknown batch type: ${type}`)
    if (!toolBridge) throw new Error('wait_batch requires toolBridge')

    const deadline = now() + waitWindowMs
    let last = null

    for (;;) {
      const snapshot = await toolBridge.invoke('batch.status', { type })
      // 내부 필드(`type`)는 에이전트에게 새지 않는다 — 스펙 표면은 네 필드뿐이다.
      last = { status: snapshot.status, done: snapshot.done, total: snapshot.total, error: snapshot.error ?? 0 }

      if (BATCH_TERMINAL.has(last.status)) return last
      if (now() >= deadline) return { ...last, status: 'timeout' }

      await sleep(pollIntervalMs)
    }
  }

  /**
   * 툴 표 (스펙 §2). `permission`: **R** = 즉시 실행 / **G** = 사람 승인 필요 / **B** = 과금.
   *
   * 🔴 **등급은 Tool Core 가 소유한다** ((A) 채택 조건 1). adapter 가 request context 에 붙인
   *    `approvalMode` 문자열은 **증거가 아니다** — adapter 가 실수로 조기 부착하거나 공통 RPC 가
   *    기본값으로 붙이면 게이트가 조용히 샌다. 여기서 **스스로 다시 산출한다.**
   */
  const TOOLS = {
    story_get_state: {
      permission: 'R',
      needs: 'storyCommands',
      run: async () => (storyCommands.hasProject()
        ? { projectToken: storyCommands.projectToken, state: await storyCommands.getState() }
        : NO_PROJECT),
    },
    list_scenes: {
      permission: 'R',
      needs: 'storyCommands',
      // 계약: **요약 문자열이 아니라 JSON** (스펙 §2.3).
      run: async () => (storyCommands.hasProject() ? await storyCommands.listScenes() : NO_PROJECT),
    },
    wait_batch: {
      permission: 'R',
      needs: 'toolBridge',          // story 는 안 쓴다 — renderer 의 배치 상태만 읽는다
      run: (args) => waitBatch(args),
    },
    story_confirm_synopsis: {
      permission: 'G',              // 사람이 확정하는 것 — 에이전트가 혼자 못 한다 (D9)
      needs: 'storyCommands',
      run: (args) => storyCommands.confirmSynopsis(args),
    },
  }

  /**
   * 🔴 **G/B 는 grant 를 원자적으로 1회 consume 해야만 실행된다.**
   *    handler 가 `elicitInput()` 을 빠뜨리면 grant 자체가 없다 → 진짜 fail-closed.
   *    거부는 D8 정규화: `{status:'rejected', reason:'unconfirmed'}` — **side effect 0회**.
   */
  function isApproved(name, args, context) {
    if (!grantLedger) return false
    return grantLedger.consume({
      nonce: context?.nonce,
      tool: name,
      argsHash: hashArgs(args),
      sessionId,
    })
  }

  return {
    use(commands) {
      storyCommands = commands
    },

    /** 툴 목록 — adapter 가 MCP inventory 를 만들 때 쓴다 (M2). */
    list() {
      return Object.entries(TOOLS).map(([name, t]) => ({ name, permission: t.permission }))
    },

    /**
     * 🔴 **fail-closed.** 모르는 툴은 던진다 — 조용히 `undefined` 를 돌려주면 에이전트는
     *    "툴이 아무것도 안 했다" 와 "툴이 없다" 를 구분하지 못한다.
     */
    async call(name, args = {}, context = {}) {
      const tool = TOOLS[name]
      if (!tool) throw new Error(`unknown tool: ${name}`)
      // 툴마다 필요한 것이 다르다. 전부에게 storyCommands 를 요구하면 renderer 만 읽는 툴이 못 돈다.
      if (tool.needs === 'storyCommands' && !storyCommands) {
        throw new Error('toolCore.use(storyCommands) 가 호출되지 않았다')
      }
      if (tool.needs === 'toolBridge' && !toolBridge) {
        throw new Error(`${name} requires toolBridge`)
      }
      // adapter 의 주장이 아니라 **main ledger 의 grant** 를 본다.
      if (tool.permission !== 'R' && !isApproved(name, args, context)) {
        return { status: 'rejected', reason: 'unconfirmed' }
      }
      return tool.run(args)
    },
  }
}
