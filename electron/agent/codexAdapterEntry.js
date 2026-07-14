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
import { z } from 'zod'
import { createAdapterHandlers } from './codexMcpAdapter.js'

/** env 하나라도 없으면 **뜨지 않는다.** 반쯤 설정된 채 뜨면 게이트가 어디서 새는지 알 수 없다. */
function requiredEnv(name) {
  const v = process.env[name]
  if (!v) throw new Error(`${name} is required — adapter 는 반쯤 설정된 채로 뜨지 않는다`)
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

/** 툴 표의 JSON-Schema → zod. union/중첩 strict object를 보존해야 step별 경계가 adapter에서 안 풀린다. */
export function zodFromJson(schema) {
  const describe = (converted, node) => typeof node?.description === 'string'
    ? converted.describe(node.description)
    : converted

  const convert = (node = {}) => {
    if (Array.isArray(node.oneOf) && node.oneOf.length) return describe(z.union(node.oneOf.map(convert)), node)
    if (Array.isArray(node.anyOf) && node.anyOf.length) return describe(z.union(node.anyOf.map(convert)), node)
    if (Object.hasOwn(node, 'const')) return describe(z.literal(node.const), node)
    if (Array.isArray(node.enum) && node.enum.length) return describe(z.enum(node.enum), node)
    if (node.type === 'number') return describe(z.number(), node)
    if (node.type === 'boolean') return describe(z.boolean(), node)
    if (node.type === 'null') return describe(z.null(), node)
    if (node.type === 'array') return describe(z.array(node.items ? convert(node.items) : z.any()), node)
    if (node.type !== 'object') {
      let string = z.string()
      if (Number.isInteger(node.minLength) && node.minLength >= 0) string = string.min(node.minLength)
      // 툴 표는 우리가 소유한다. pattern을 Zod까지 옮겨야 공백 id/name이 승인 handler에 못 들어간다.
      if (typeof node.pattern === 'string') string = string.regex(new RegExp(node.pattern))
      return describe(string, node)
    }

    const shape = {}
    for (const [key, prop] of Object.entries(node.properties ?? {})) {
      let child = convert(prop)
      if (!(node.required ?? []).includes(key)) child = child.optional()
      shape[key] = child
    }
    // segment id 같은 동적 key도 값 schema는 잃으면 안 된다. z.record(valueSchema)로 옮겨야
    // `sfxSources:{id:'guessed'}`가 승인 handler 전에 거부된다.
    if (!Object.keys(node.properties ?? {}).length && node.additionalProperties !== false) {
      const value = node.additionalProperties && typeof node.additionalProperties === 'object'
        ? convert(node.additionalProperties)
        : z.any()
      return describe(z.record(z.string(), value), node)
    }
    const object = node.additionalProperties === false
      ? z.object(shape).strict()
      : node.additionalProperties && typeof node.additionalProperties === 'object'
        ? z.object(shape).catchall(convert(node.additionalProperties))
        : z.object(shape).passthrough()
    const rule = node.dependentPropertyWhitelist
    if (!rule) return describe(object, node)
    // 최상위 union은 MCP SDK tools/list에서 `{properties:{}}`로 소실된다. ZodObject를 유지하는
    // refinement로 discriminator와 params의 상관관계를 검증하면 광고 schema와 실행 경계를 둘 다 살린다.
    return describe(object.superRefine((value, ctx) => {
      const allowed = rule.allowed?.[value?.[rule.discriminator]]
      const target = value?.[rule.target]
      if (!Array.isArray(allowed) || target === undefined) return
      for (const key of Object.keys(target)) {
        if (allowed.includes(key)) continue
        ctx.addIssue({
          code: 'custom',
          path: [rule.target, key],
          message: `${key} is not allowed for ${value[rule.discriminator]}`,
        })
      }
    }), node)
  }
  return convert(schema)
}
