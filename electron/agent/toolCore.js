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

/** 프로젝트가 안 열렸을 때의 공통 거부 (스펙 §2.1 `get_project_context`, slice 12). */
const NO_PROJECT = Object.freeze({ error: 'no-project' })

export function createToolCore() {
  let storyCommands = null

  /**
   * 툴 표 (스펙 §2). `permission` 은 R/G/B — 지금은 R 만 있고 게이트는 아직 없다.
   * 게이트(canUseTool / MCP elicitation)는 M2 다. 여기서 미리 지어내지 않는다.
   */
  const TOOLS = {
    story_get_state: {
      permission: 'R',
      run: async () => (storyCommands.hasProject()
        ? { projectToken: storyCommands.projectToken, state: await storyCommands.getState() }
        : NO_PROJECT),
    },
    list_scenes: {
      permission: 'R',
      // 계약: **요약 문자열이 아니라 JSON** (스펙 §2.3).
      run: async () => (storyCommands.hasProject() ? await storyCommands.listScenes() : NO_PROJECT),
    },
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
    async call(name, args = {}) {
      const tool = TOOLS[name]
      if (!tool) throw new Error(`unknown tool: ${name}`)
      if (!storyCommands) throw new Error('toolCore.use(storyCommands) 가 호출되지 않았다')
      return tool.run(args)
    },
  }
}
