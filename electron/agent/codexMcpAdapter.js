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
// 사람의 명시적 거절은 grant 누락(`unconfirmed`)과 다르다. 재시도 신호로 읽히지 않는 이름을 쓴다.
const REJECT_REASON = { decline: 'declined-by-user', cancel: 'cancelled' }

/**
 * 승인 창에 띄울 사람용 문장. 인자를 **보여준다** — 안 보여주면 사람은 이름만 보고 누른다.
 *
 * 🔴 **transport에서 자르지 않는다.** main이 이미 잘린 문자열만 받으면 renderer는 나머지를 펼치거나
 *    스크롤할 방법이 없다. grant와 같은 인자 전체를 보내고, 화면 크기 제한은 renderer scroll이 맡는다.
 *
 * 🔴 **여러 줄로 들여쓴다.** 한 줄로 뭉친 JSON 은 "보여줬다"는 알리바이지 읽으라는 게 아니다.
 */
export function describe(name, args) {
  const argText = JSON.stringify(args ?? {}, null, 2)
  return `${name}\n\n${argText}`
}

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
          // 🔴 **사람은 툴 *이름* 이 아니라 *무엇을 하는지* 를 보고 승인해야 한다.**
          //    `"Approve generate_videos?"` 로는 영상이 2개인지 8개인지 모른 채 누르게 된다.
          //    argsHash 가 "승인한 것"과 "실행되는 것"을 묶어주지만, **사람이 본 적 없는 값에 묶는 건
          //    동의가 아니다.** 인자를 실어 보낸다 — `message` 는 verbatim 도착이 실측됐다.
          message: describe(name, args),
          requestedSchema: { type: 'object', properties: {} },
          // 🔴 **실측(2026-07-14)**: 서버가 설정한 `_meta` 는 Codex 를 거쳐 **verbatim 도착한다.**
          //    (반면 `requestedSchema` 의 최상위 커스텀 키는 **삭제된다** — 그쪽에 실었으면 게이트가 죽었다.)
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
