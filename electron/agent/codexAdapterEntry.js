/**
 * **Codex 가 spawn 하는 실제 adapter 프로세스의 진입점** (스펙 D19 + M0-13).
 *
 *   codex app-server ──spawn──▶ [패키징 Electron 실행파일] + ELECTRON_RUN_AS_NODE=1 + 이 파일의 절대경로
 *
 * 🔴 **문자열 `node` 를 쓰지 않는다** (D19). 개발 머신엔 `node` 가 PATH 에 있어서 `command:'node'` 로 짜도
 *    dev 에선 멀쩡히 돌고 **사용자 머신에서만 죽는다.** (이 프로젝트는 같은 부류를 이미 밟았다 —
 *    minify 가 함수명을 뭉개서 dev 는 되고 패키징만 깨지던 Flow DOM 주입.)
 *
 * 🔴 **이 파일은 `app.asar` **밖**에서 돌아야 한다** (M0-13 실측):
 *    Electron 의 asar 지원은 `require()`(CJS)만 덮고 **ESM 로더는 안 덮는다.** 우리 adapter 도 그 의존성
 *    (`@modelcontextprotocol/sdk`, `zod`)도 전부 ESM 이라, asar 안에 있으면 `Cannot find module` 로 죽는다.
 *    → 빌드가 이 파일을 **의존성까지 단일 ESM 번들**로 말아 `extraResources` 로 내보낸다.
 *      번들이면 node_modules 해석 자체가 없어져서 함정이 사라진다.
 *
 * 설정은 **env 로만** 받는다 (인자는 Codex 가 통제한다):
 *   AUTOFLOWCUT_RPC_URL     private RPC 주소 (loopback)
 *   AUTOFLOWCUT_RPC_TOKEN   세션 토큰
 *   AUTOFLOWCUT_TOOLS       툴 표 JSON — `[{name, permission, description?, inputSchema?}]`
 *   AUTOFLOWCUT_APPROVAL_TIMEOUT_MS  승인 창 timeout (조건 5 — SDK 기본 60초에 기대지 않는다)
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { createAdapterHandlers } from './codexMcpAdapter.js'
import { zodFromJson } from './jsonSchemaToZod.js'

export { zodFromJson } from './jsonSchemaToZod.js'

/** env 하나라도 없으면 **뜨지 않는다.** 반쯤 설정된 채 뜨면 게이트가 어디서 새는지 알 수 없다. */
function requiredEnv(name) {
  const v = process.env[name]
  // 영어로 둔다 — electron 에러는 IPC 로 renderer 에 새면 영어 사용자가 한글을 본다. (adapter 는 반쯤 설정된 채로 뜨지 않는다.)
  if (!v) throw new Error(`${name} is required — the adapter must not start half-configured`)
  return v
}

export function createRpcClient({ url, token, fetchImpl = fetch }) {
  return {
    async call({ tool, args, nonce }) {
      const res = await fetchImpl(`${url}/call`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
        body: JSON.stringify({ tool, args, nonce }),
      })
      if (!res.ok) throw new Error(`private RPC ${res.status}`)
      const body = await res.json()
      if (body.error) throw new Error(body.error)
      return body.result
    },
  }
}

export async function main() {
  const tools = JSON.parse(requiredEnv('AUTOFLOWCUT_TOOLS'))
  const approvalTimeoutMs = Number(requiredEnv('AUTOFLOWCUT_APPROVAL_TIMEOUT_MS'))

  const rpc = createRpcClient({
    url: requiredEnv('AUTOFLOWCUT_RPC_URL'),
    token: requiredEnv('AUTOFLOWCUT_RPC_TOKEN'),
  })

  const server = new McpServer({ name: 'autoflowcut', version: '1.0.0' })

  const handlers = createAdapterHandlers({
    tools,
    rpc,
    // 🔴 handler 안에서 여는 elicitation 이다 — G/B 가 private RPC 를 부르기 **전에** 사람에게 묻는다.
    //    `server.server.elicitInput` 이 MCP `elicitation/create` 를 클라이언트(=Codex)로 보낸다.
    elicitInput: (params, options) => server.server.elicitInput(params, options),
    approvalTimeoutMs,
  })

  for (const tool of tools) {
    server.registerTool(
      tool.name,
      {
        title: tool.title ?? tool.name,
        description: tool.description ?? tool.name,
        // 스키마 없는 툴도 있다. 있으면 그대로, 없으면 빈 객체 — **임의 인자를 만들어내지 않는다.**
        inputSchema: tool.inputSchema ? zodFromJson(tool.inputSchema) : {},
      },
      async (args) => {
        const result = await handlers.callTool(tool.name, args ?? {})
        return { content: [{ type: 'text', text: JSON.stringify(result) }] }
      },
    )
  }

  await server.connect(new StdioServerTransport())
}
