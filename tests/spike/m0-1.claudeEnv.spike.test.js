/**
 * M0-1 — Claude env / 로컬 자격증명 생존.
 *
 * 스펙: "D23 `buildClaudeSafeEnv(process.env)` + profile별 explicit injection으로 CLI가 뜨고,
 * **overrides-only에서는 PATH/HOME 유실이 재현**되는지 확인한다. ... `api-key`는 두 root가 0개여야
 * 한다. PASS는 이 platform matrix 완주 + overrides-only 실패 원인 기록이며 **full `process.env`
 * spread는 PASS 근거가 아니다.**"
 *
 * D23-1(별건 실물 버그): "**ambient `ANTHROPIC_API_KEY`가 로컬 CLI 자격증명을 조용히 덮어쓴다**
 * (`claudeSdk.js`에 `env` 핀이 0회) — 과금 사고 + 약관 논거 무력화."
 *
 * SDK 타입이 이미 절반을 말해준다:
 *   Options.env — "When set, this value **REPLACES** the subprocess environment entirely —
 *                 it is not merged with `process.env`."
 * 즉 (a) env 를 안 주면 ambient 가 통째로 샌다  (b) 주면 PATH/HOME 을 직접 넣어야 한다.
 * 둘 다 **실측**한다.
 *
 * ⚠️ 유효한 API 키를 쓰지 않는다. 명백히 무효한 sentinel 을 넣어, 그게 **채택되는지**(=구독
 *    자격증명을 이겼는지)를 auth 실패로 관측한다. 과금은 발생하지 않는다.
 *
 * `npm run test:spike` (SPIKE=1) 로만 돈다.
 */
import { describe, it, expect } from 'vitest'
import { appendFileSync, mkdirSync } from 'node:fs'
import { query } from '@anthropic-ai/claude-agent-sdk'

const RESULT_DIR = 'docs/superpowers/specs'
const record = (label, data) => {
  mkdirSync(RESULT_DIR, { recursive: true })
  appendFileSync(`${RESULT_DIR}/m0-1-raw.jsonl`, JSON.stringify({ label, ...data }) + '\n')
}

const INVALID_KEY = 'sk-ant-api03-M0SPIKE-INVALID-DO-NOT-USE'
// 형식은 진짜 키와 같지만 값이 틀린 sentinel. malformed 키는 CLI 가 형식 검증에서 거를 수 있어
// "무시됐다"는 결론이 흔들린다 — 형식이 맞는 키로도 무시되는지 확인해야 D23-1 을 접을 수 있다.
const WELLFORMED_WRONG_KEY = 'sk-ant-api03-' + 'A'.repeat(93) + 'AA'

/** 한 턴짜리 query 를 돌리고 성공/실패와 사유만 관측한다. */
async function probe({ label, ambientKey, envOption }) {
  const prevKey = process.env.ANTHROPIC_API_KEY
  if (ambientKey === undefined) delete process.env.ANTHROPIC_API_KEY
  else process.env.ANTHROPIC_API_KEY = ambientKey

  const startedAt = Date.now()
  let replyText = ''
  let streamError = null
  let systemInit = null

  try {
    const q = query({
      prompt: 'Reply with exactly: ENV_OK',
      options: { maxTurns: 2, ...(envOption ? { env: envOption } : {}) },
    })
    for await (const msg of q) {
      if (msg.type === 'system' && msg.subtype === 'init') {
        systemInit = { apiKeySource: msg.apiKeySource, model: msg.model }
      }
      for (const b of msg?.message?.content ?? []) {
        if (b?.type === 'text') replyText += b.text
      }
    }
  } catch (e) {
    streamError = String(e?.message || e).slice(0, 400)
  } finally {
    if (prevKey === undefined) delete process.env.ANTHROPIC_API_KEY
    else process.env.ANTHROPIC_API_KEY = prevKey
  }

  const r = {
    elapsedMs: Date.now() - startedAt,
    ok: replyText.includes('ENV_OK'),
    replyText: replyText.slice(0, 120),
    systemInit,
    streamError,
  }
  record(label, r)
  console.log(`\n===== M0-1 ${label} =====`)
  console.log('  ok           :', r.ok)
  console.log('  apiKeySource :', r.systemInit?.apiKeySource ?? '(없음)')
  console.log('  reply        :', r.replyText || '(없음)')
  console.log('  error        :', r.streamError || 'none')
  return r
}

describe('M0-1 — Claude env / 로컬 자격증명 생존', () => {
  // 기준선: ambient 키 없음 = 구독 로그인. 이게 지금 개발 환경의 상태다.
  it('A: ambient 키 없음 → 로컬 CLI 구독 자격증명으로 완주한다', async () => {
    const r = await probe({ label: 'A (no ambient key)', ambientKey: undefined })
    expect(r.ok).toBe(true)
  }, 3 * 60 * 1000)

  // D23-1 실측: ambient 에 **무효한** 키를 심으면, env 핀이 없는 현행 호출은 그걸 상속한다.
  //   무효 키가 채택되면 → auth 실패. 그게 곧 "구독 자격증명을 덮어썼다"는 증거다.
  //   구독으로 완주하면 → 키가 무시된 것이고 D23-1 은 (적어도 이 SDK 버전에선) 재현되지 않는다.
  it('B: ambient 무효 키 + env 핀 없음 → 그 키가 로컬 자격증명을 이기는가 (D23-1)', async () => {
    const r = await probe({ label: 'B (ambient invalid key, no env pin)', ambientKey: INVALID_KEY })
    const keyWon = !r.ok || /auth|api key|401|invalid/i.test(r.streamError || '')
    console.log('  >>> ambient 키가 로컬 자격증명을 이겼는가?', keyWon ? 'YES — D23-1 재현' : 'NO — 무시됨')
    expect(r).toBeTruthy()   // 판정이 아니라 기록이다
  }, 3 * 60 * 1000)

  // D23-1 의 마지막 구멍: 형식이 **맞는** 키로도 무시되는가. 여기서도 무시되면 D23-1 은 접는다.
  it('B2: ambient well-formed 오답 키 + env 핀 없음 → 그래도 무시되는가', async () => {
    const r = await probe({ label: 'B2 (ambient well-formed wrong key, no env pin)', ambientKey: WELLFORMED_WRONG_KEY })
    const keyWon = !r.ok || /auth|api key|401|invalid|credit/i.test(r.streamError || '')
    console.log('  >>> well-formed 오답 키가 로컬 자격증명을 이겼는가?', keyWon ? 'YES — D23-1 재현' : 'NO — 무시됨')
    expect(r).toBeTruthy()
  }, 3 * 60 * 1000)

  // 방어책 검증: env 를 명시 핀하면 ambient 무효 키를 **차단**할 수 있는가.
  //   Options.env 는 process.env 를 REPLACE 하므로 PATH/HOME 을 직접 넣어야 한다.
  it('C: env 를 allowlist 로 핀 → ambient 무효 키를 차단하고 완주한다 (buildClaudeSafeEnv 의 근거)', async () => {
    const safe = {
      PATH: process.env.PATH,
      HOME: process.env.HOME,
      SHELL: process.env.SHELL,
      USER: process.env.USER,
      TMPDIR: process.env.TMPDIR,
      // ANTHROPIC_API_KEY 를 **일부러 넣지 않는다** — 이게 핀의 요점이다.
    }
    const r = await probe({ label: 'C (env allowlist pin, ambient invalid key)', ambientKey: INVALID_KEY, envOption: safe })
    expect(r.ok).toBe(true)   // 구독 자격증명으로 완주해야 한다
  }, 3 * 60 * 1000)

  // 스펙이 명시적으로 요구한 실패 재현: overrides-only 면 PATH/HOME 이 유실된다.
  it('D: overrides-only env (PATH/HOME 없음) → 실패가 재현되고 그 사유를 기록한다', async () => {
    const r = await probe({ label: 'D (overrides-only, no PATH/HOME)', ambientKey: undefined, envOption: { FOO: 'bar' } })
    console.log('  >>> overrides-only 실패 재현?', r.ok ? 'NO — 예상과 달리 완주' : 'YES')
    expect(r).toBeTruthy()   // 기록이 목적이다
  }, 3 * 60 * 1000)
})
