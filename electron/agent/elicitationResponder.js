import { decodeApprovalPayload } from './approvalPayload.js'
import { hashArgs } from './grantLedger.js'

/**
 * Codex 의 `mcpServer/elicitation/request` 를 **main 이** 받아 분류한다 ((A) 채택 조건 3·4).
 *
 * 두 종류가 같은 채널로 온다:
 *
 *   1. **native 승인** — Codex 가 *모든* MCP tool call 에 띄운다 (**plain read 에도** — M0-8 실측).
 *      `_meta.codex_approval_kind === 'mcp_tool_call'`. 우리가 안 삼키면 G/B 가 **이중 승인**되고,
 *      *"read 는 UI 0회"* 계약도 깨진다. → **UI 없이 auto-accept.**
 *
 *   2. **handler elicitation** — 우리 adapter 가 G/B tool handler 안에서 연 것.
 *      `_meta` 에 `{nonce, tool, argsHash}` 가 실려 있다. → **사람에게 묻는다.**
 *
 * 🔴 **왜 renderer 가 아니라 main 인가 (조건 4).** native 는 모든 호출에 뜨고 Codex 는 **병렬로 쏜다.**
 *    ChatPanel 이 바쁘거나 죽어 있으면 **R 툴까지 전부 막힌다.** *"R 은 UI 0회"* 는 곧
 *    *"renderer 생존과 무관하게 통과"* 다. 그래서 분류는 main 이 하고, renderer 로는 사람이 답할 것만 올린다.
 *
 * 🔴 **auto-accept 는 *양성 매칭* 일 때만 (조건 3).** *"우리 것 아니면 accept"* 는 **fail-open** 이다 —
 *    미래 Codex 가 새 elicitation 종류를 추가하면 그대로 뚫린다. 모르는 건 **거부**한다.
 *    (native 식별이 비계약 `_meta` 에 의존한다는 약점은 남는다. 그래서 깨졌을 때 **닫히는 쪽**으로 눕힌다.
 *     실질 방어막은 vendored 바이너리 pin + 버전 범프 시 스파이크 재실행이다.)
 */
const NATIVE_KIND = 'mcp_tool_call'

export function createElicitationResponder({
  grantLedger,
  sessionId,
  projectToken = null,
  adapterServerName,
  askUser,
}) {
  // 🔴 **설정 하나가 빠지면 게이트가 fail-open 한다.** `adapterServerName` 이 undefined 면
  //    `params.serverName === undefined` 가 **남의 elicitation 에도 true** 가 되어(둘 다 undefined),
  //    아무 서버의 승인 창이나 auto-accept 되고 grant 까지 발급된다. 여기서 터뜨린다.
  if (typeof adapterServerName !== 'string' || !adapterServerName) throw new Error('adapterServerName is required')
  if (!grantLedger?.grant) throw new Error('grantLedger is required')
  if (typeof askUser !== 'function') throw new Error('askUser is required')
  if (!sessionId) throw new Error('sessionId is required')
  /**
   * @param params Codex 가 준 elicitation params (`serverName`, `message`, `_meta`, …)
   * @param ctx    `{ requestId, turnId }` — 🔴 **pending 은 `requestId` 로 잡는다. `turnId` 로 잡지 마라** —
   *               out-of-band elicitation 은 실제로 `turnId: null` 로 온다 (실측).
   */
  async function handle(params, ctx = {}) {
    const meta = params?._meta
    // 🔴 `serverName` 이 문자열이 아니면 **우리 것이 아니다.** undefined 끼리 같다고 통과시키면 안 된다.
    const ours = typeof params?.serverName === 'string' && params.serverName === adapterServerName

    // ── 1. native 승인: 우리 서버 + 아는 kind 일 때만 즉답 accept ──
    if (meta?.codex_approval_kind !== undefined) {
      if (ours && meta.codex_approval_kind === NATIVE_KIND) {
        // 사람의 승인이 **아니다.** grant 를 만들지 않는다 — 이건 Codex 의 중복 승인일 뿐이다.
        return { action: 'accept', content: {}, _meta: null }
      }
      // 모르는 kind / 남의 서버 → 절대 auto-accept 하지 않는다.
      return { action: 'decline', content: {}, _meta: null }
    }

    // ── 2. handler elicitation: 우리 adapter 가 연 승인 창 ──
    const { nonce, tool, argsHash } = meta ?? {}
    if (!ours || !nonce || !tool || !argsHash) {
      // 무엇을 승인하는지 모르면 **사람에게 묻지도 않는다.** 물어봤자 사용자가 뭘 허락하는지 모른다.
      return { action: 'decline', content: {}, _meta: null }
    }

    // 🔴 사람이 볼 args와 grant가 묶일 hash는 반드시 같은 값이어야 한다. adapter는 별도 프로세스이자
    // 신뢰 경계 밖이므로 message나 _meta 어느 한쪽도 단독으로 믿지 않고 main에서 둘을 대조한다.
    const decoded = decodeApprovalPayload(params?.message)
    if (!decoded || decoded.tool !== tool || hashArgs(decoded.args) !== argsHash) {
      return { action: 'decline', content: {}, _meta: null }
    }

    const answer = await askUser(params, {
      requestId: ctx.requestId,
      sessionId,
      tool,
      argsHash,
      args: decoded.args,
    })

    if (answer?.action !== 'accept') {
      return { action: answer?.action === 'cancel' ? 'cancel' : 'decline', content: {}, _meta: null }
    }

    // 🔴 **grant 를 기록한 뒤에 accept 를 응답한다.** 순서가 뒤집히면 adapter 의 private RPC 가
    //    ledger 보다 먼저 도착해서, 사용자가 승인했는데도 거부당한다.
    // 세션만 묶으면 A에서 본 승인 문구가 같은 세션의 B 프로젝트 실행을 허용한다. 사람이 승인한
    // project identity까지 기록해 Tool Core의 stale guard가 실수로 빠져도 grant 자체가 맞지 않게 한다.
    grantLedger.grant({ nonce, tool, argsHash, sessionId, projectToken })

    return { action: 'accept', content: {}, _meta: null }
  }

  return { handle }
}
