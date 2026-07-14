import { randomUUID } from 'node:crypto'
import { hashArgs } from './grantLedger.js'

/**
 * Codex 가 spawn 하는 **MCP stdio adapter** 의 두뇌 (스펙 D9 결정 2, (A) 채택 조건 2·5).
 *
 * adapter 는 **별도 프로세스**다 (패키징 Electron + `ELECTRON_RUN_AS_NODE=1` — 스펙 D19).
 * 그래서 main 의 Tool Core 를 직접 못 부르고, private RPC 로 부른다.
 *
 * 🔴 **adapter 는 승인을 주장하지 않는다** (조건 2). elicitation payload 에 `{nonce, tool, argsHash}` 를
 *    싣고, **main 이 accept 순간 자기 ledger 에 기록**한다. adapter 는 그 nonce 를 **제시**만 한다.
 *    → handler 가 `elicitInput()` 을 빠뜨리면 grant 자체가 없어 **진짜 fail-closed** 다.
 *    (`approvalMode:'승인됨'` 같은 문자열을 붙이는 설계였다면, adapter 버그 하나로 게이트가 샌다.)
 *
 * 🔴 이 파일은 **MCP 서버 배선과 분리**돼 있다. 승인 로직이 stdio transport 안에 묻혀 있으면
 *    프로세스를 띄우지 않고는 못 잰다.
 */
const ACCEPT = 'accept'
const REJECT_REASON = { decline: 'declined', cancel: 'cancelled' }

export function createAdapterHandlers({ tools, rpc, elicitInput, approvalTimeoutMs, newNonce = randomUUID }) {
  // 🔴 **조건 5**: MCP SDK 의 요청 timeout 기본값은 **60초** (`DEFAULT_REQUEST_TIMEOUT_MSEC`).
  //    명시적으로 안 넘기면 **우리 MCP 서버가** 10분 승인 창을 60초에 죽인다
  //    (실측: 60,013ms 에 `-32001 Request timed out`). Codex 가 죽인 게 아니다.
  //    → 기본값에 기대지 않는다. 안 주면 여기서 터진다.
  if (!Number.isFinite(approvalTimeoutMs) || approvalTimeoutMs <= 0) {
    throw new Error('approvalTimeoutMs is required — MCP SDK 기본 60초가 승인 창을 죽인다')
  }

  const permissionByName = new Map(tools.map((t) => [t.name, t.permission]))

  async function callTool(name, args = {}) {
    const permission = permissionByName.get(name)
    // 툴 표에 없으면 승인도 실행도 하지 않는다. 모르는 것을 R 로 취급하면 fail-open 이다.
    if (!permission) throw new Error(`unknown tool: ${name}`)

    if (permission === 'R') {
      return rpc.call({ tool: name, args, nonce: undefined })
    }

    // G/B — 사람의 승인 없이는 아무것도 하지 않는다.
    const nonce = newNonce()
    let outcome
    try {
      outcome = await elicitInput(
        {
          message: `Approve ${name}?`,
          requestedSchema: { type: 'object', properties: {} },
          // main 은 이 payload 를 verbatim 으로 받는다 (M0-8 실측) → accept 순간 ledger 에 기록한다.
          _meta: { nonce, tool: name, argsHash: hashArgs(args) },
        },
        { timeout: approvalTimeoutMs },
      )
    } catch (err) {
      // timeout / transport 오류 = **승인이 없었다**. 실행하면 안 된다.
      return { status: 'rejected', reason: 'approval-failed', error: err?.message ?? String(err) }
    }

    if (outcome?.action !== ACCEPT) {
      // 🔴 모르는 action 도 거부다. "accept 가 아니면 뭔지 모르겠지만 실행" 은 fail-open 이다 —
      //    미래 MCP 가 action 을 추가하면 그대로 뚫린다.
      return { status: 'rejected', reason: REJECT_REASON[outcome?.action] ?? 'not-accepted' }
    }

    // accept 일 때만, **그 nonce 를 제시하며** 한 번 부른다. main 이 원자적으로 1회 consume 한다.
    return rpc.call({ tool: name, args, nonce })
  }

  return { callTool }
}
