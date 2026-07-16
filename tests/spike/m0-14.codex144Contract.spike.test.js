/**
 * M0-14 — Codex **0.144.5** 계약 스모크 (HANDOFF §1).
 *
 * 왜: per-turn model / persistent thread / granular 승인 계약은 전부 **0.142.5 로만** 스파이크
 * 검증했다. 0.144.5 로 bump(af4c0cc)했는데 계약 재검증을 안 했다. 통합 테스트는 **fake app-server**
 * 라 실버전 RPC 변화를 원리적으로 못 잡는다.
 *
 * 🔴 이 스파이크가 **제품 코드를 통해서만** 말하게 한다:
 *    - 바이너리: `resolveCodexExecutablePath()` (제품 resolver). bare `codex` 가 아니다.
 *      ⚠️ 실측된 함정: **로그인 셸의 `codex` 는 0.144.1**(전역 nvm 설치), 제품 resolver 는
 *      `node_modules` 의 **0.144.5** 다. m0-12 는 bare `codex` 를 spawn 하지만 `npm run` 이
 *      `node_modules/.bin` 을 PATH 앞에 꽂아주는 **덕분에** 지금은 0.144.5 를 잡는다
 *      (실측: npm script 안에서 `which codex` → `node_modules/.bin/codex`).
 *      즉 **틀린 게 아니라 우연히 맞는 상태**다 — npm 의 PATH 주입에 의존하므로, 러너를 바꾸거나
 *      셸에서 직접 돌리면 조용히 **전역 0.144.1** 을 재게 된다. 여기서는 그 우연에 기대지 않는다.
 *    - thread 파라미터: `buildOrchestratorThreadParams()` (제품). 여기서 파라미터를 재구현하면
 *      스파이크는 제품이 아니라 **스파이크 자신을 측정**한다.
 *
 * 🔴 negative control 이 이 스파이크의 핵심이다. "요청이 성공했다" 는 **파라미터가 읽혔다는 증거가
 *    아니다** — 서버가 모르는 필드를 조용히 무시해도 200 이 온다. 그래서:
 *    - 존재하지 않는 model 을 주면 **에러가 나야** 한다 (= model 이 읽힌다는 증거)
 *    - experimentalApi 없이 granular 를 주면 **거부돼야** 한다 (= 우리 capability 가 load-bearing)
 *    두 tripwire 가 죽으면 나머지 green 은 전부 무의미하다.
 *
 * `npm run test:spike -- tests/spike/m0-14.codex144Contract.spike.test.js` 로만 돈다.
 * 실제 Codex 자격증명(ChatGPT 구독)을 쓰고 실호출이 나간다.
 */
import { describe, it, expect, afterEach } from 'vitest'
import { execFileSync } from 'node:child_process'
import { appendFileSync, mkdirSync, readFileSync } from 'node:fs'
import { openAppServer, buildOrchestratorThreadParams } from '../../electron/api/llm/codexAppServer.js'
import {
  resolveCodexExecutablePath,
  prepareCodexRuntimeHome,
  prepareCodexWorkingDirectory,
  buildCodexClientOptions,
} from '../../electron/api/llm/codexSdk.js'

const RESULT_DIR = 'docs/superpowers/specs'
const RAW = `${RESULT_DIR}/m0-14-raw.jsonl`

/**
 * 🔴 **provenance 스탬프.** 없으면 raw 가 "어떤 코드가 낸 결과인지" 를 말하지 못한다.
 *
 * 실제로 물렸다 (적대 리뷰가 잡음): 이 파일의 raw 에 `granular-tripwire rejected:false` 인 run 이
 * 하나 있는데, 그건 **내가 일부러 돌린 뮤테이션 run**(experimentalApi 를 강제로 켠)이다. 그런데
 * 기록만 봐서는 **뮤턴트 run 과 진짜 run 을 구분할 수 없다** — 감사자에겐 "계약이 깨진 증거" 로 보인다.
 * 커밋 SHA + dirty 여부 + `SPIKE_MUTANT` 마커를 박아 그 구분을 raw 안에서 닫는다.
 * (이 repo 는 이미 `*-PRE-RUNID-CONTAMINATED.jsonl` 로 같은 병을 한 번 앓았다.)
 */
const gitSha = (() => {
  try { return execFileSync('git', ['rev-parse', '--short', 'HEAD'], { encoding: 'utf-8' }).trim() } catch { return null }
})()
const gitDirty = (() => {
  try { return execFileSync('git', ['status', '--porcelain'], { encoding: 'utf-8' }).trim().length > 0 } catch { return null }
})()

const record = (label, data) => {
  mkdirSync(RESULT_DIR, { recursive: true })
  appendFileSync(RAW, JSON.stringify({
    runId: process.env.SPIKE_RUN_ID ?? null,
    gitSha,
    gitDirty,
    // 뮤테이션 검증 중이면 `SPIKE_MUTANT=<설명>` 을 주고 돌린다 → raw 가 스스로 밝힌다.
    mutant: process.env.SPIKE_MUTANT ?? null,
    label,
    ...data,
  }) + '\n')
}

/**
 * ⚠️ record() 는 assertion **전에** 찍힌다 → raw 행만으로는 그 run 이 PASS 였는지 알 수 없다.
 * m0-8-9 가 이미 쓰는 규율을 그대로 따른다(안 따랐다가 교차 리뷰에 잡혔다).
 */
afterEach((ctx) => {
  record('__verdict__', { test: ctx?.task?.name ?? '(?)', verdict: ctx?.task?.result?.state ?? 'unknown' })
})

const CLIENT_INFO = { name: 'autoflowcut', title: 'AutoFlowCut', version: '0.0.0' }
const PINNED = '0.144.5'
const CODEX_BIN = resolveCodexExecutablePath()

const MODEL_A = 'gpt-5.5'
const MODEL_B = 'gpt-5.6-sol'
const TURN_TIMEOUT_MS = 3 * 60 * 1000

/**
 * 제품 경로 그대로 orchestrator 세션을 연다.
 * `experimentalApi:false` 는 tripwire 전용 — 제품은 항상 true 를 보낸다.
 */
async function openOrchestratorSession({ experimentalApi = true, model } = {}) {
  const work = await prepareCodexWorkingDirectory()
  const runtime = await prepareCodexRuntimeHome({ env: process.env })
  const clientOptions = buildCodexClientOptions({
    env: runtime.env,
    config: {},
    runtimeProfile: 'orchestrator',
    mcpServers: {},
  })

  const events = []
  const listeners = new Set()
  // rollout jsonl = **서버가 실제로 무엇을 돌렸는지에 대한 서버 자신의 기록**.
  // turn/completed 는 model 을 안 돌려주므로, per-turn model 의 **양성 증거는 여기밖에 없다.**
  const ref = { rolloutPath: null }
  const session = openAppServer({
    codexPath: resolveCodexExecutablePath,
    env: clientOptions.env,
    onNotification: (message) => {
      if (message.method === 'thread/started') ref.rolloutPath = message.params?.thread?.path ?? null
      events.push({ kind: 'notification', method: message.method, params: message.params })
      for (const l of [...listeners]) l(message)
    },
    onServerRequest: (req) => {
      events.push({ kind: 'serverRequest', method: req.method, params: req.params })
    },
  })

  const cleanup = async () => {
    await session.close()
    await runtime?.cleanup?.()
    await work?.cleanup?.()
  }

  try {
    await session.client.request('initialize', {
      clientInfo: CLIENT_INFO,
      ...(experimentalApi ? { capabilities: { experimentalApi: true } } : {}),
    })
    const started = await session.client.request('thread/start', buildOrchestratorThreadParams({
      model,
      workingDirectory: work.workingDirectory,
      config: clientOptions.config,
    }))
    const threadId = started?.threadId ?? started?.thread?.id
    return { session, threadId, started, events, listeners, cleanup, ref }
  } catch (error) {
    await cleanup()
    throw error
  }
}

/**
 * 한 턴을 돌리고 **turn/completed 까지** 기다린다.
 * 텍스트는 제품과 같은 규칙으로 모은다(delta 누적 + item/completed 확정).
 */
async function runTurn({ session, threadId, events, listeners }, { text, model }) {
  let settle
  const done = new Promise((resolve, reject) => { settle = { resolve, reject } })
  done.catch(() => {})

  let delta = ''
  let completed = ''
  let completedTurn = null
  const listener = (message) => {
    const { method, params } = message
    if (method === 'item/agentMessage/delta' && params?.delta) delta += params.delta
    else if (method === 'item/completed' && params?.item?.type === 'agentMessage') completed += params.item.text ?? ''
    else if (method === 'turn/completed') {
      completedTurn = params?.turn ?? null
      if (params?.turn?.status === 'failed') settle.reject(new Error(params.turn.error?.message || 'turn failed'))
      else settle.resolve()
    }
  }
  listeners.add(listener)

  const timer = setTimeout(() => settle.reject(new Error('turn timeout')), TURN_TIMEOUT_MS)
  try {
    const result = await session.client.request('turn/start', {
      threadId,
      ...(model ? { model } : {}),
      input: [{ type: 'text', text }],
    })
    await done
    return { result, completedTurn, text: completed || delta, events }
  } finally {
    clearTimeout(timer)
    listeners.delete(listener)
  }
}

/** rollout jsonl 에서 턴별 turn_context.model 을 순서대로 뽑는다. */
function turnContextModels(rolloutPath) {
  const out = []
  for (const line of readFileSync(rolloutPath, 'utf8').trim().split('\n')) {
    let o
    try { o = JSON.parse(line) } catch { continue }
    const type = o?.type ?? o?.payload?.type
    if (type !== 'turn_context') continue
    const model = o?.payload?.model ?? o?.model ?? null
    if (model) out.push(model)
  }
  return out
}

describe('M0-14 — Codex 0.144.5 계약 스모크', () => {
  it('전제: 제품 resolver 가 가리키는 바이너리가 **핀된 0.144.5** 다 (PATH 의 codex 가 아니다)', () => {
    const resolved = execFileSync(CODEX_BIN, ['--version']).toString().trim()
    let onPath = null
    try { onPath = execFileSync('codex', ['--version']).toString().trim() } catch { onPath = null }
    record('version', { bin: CODEX_BIN, resolvedVersion: resolved, pathVersion: onPath })
    expect(resolved).toContain(PINNED)
  })

  it('🎯 model/list 가 gpt-5.6 계열을 준다 (bump 의 목적)', async () => {
    const s = await openOrchestratorSession({})
    try {
      const result = await s.session.client.request('model/list', {})
      const models = Array.isArray(result?.data) ? result.data : []
      const ids = models.map((m) => m?.id ?? m?.model ?? null)
      record('model/list', { count: models.length, ids, raw: models })
      expect(ids).toContain(MODEL_B)
    } finally {
      await s.cleanup()
    }
  })

  it('🔴 tripwire: experimentalApi 없이 granular 승인은 **거부**된다 (우리 capability 가 load-bearing)', async () => {
    let error = null
    let opened = null
    try {
      opened = await openOrchestratorSession({ experimentalApi: false })
    } catch (err) {
      error = err
    } finally {
      await opened?.cleanup?.()
    }
    record('granular-tripwire', { rejected: Boolean(error), message: error?.message ?? null })
    // 🔴 toBeTruthy() 로는 부족하다 — auth 실패/네트워크 오류**어떤 에러든** green 이 된다
    //    (= tripwire 가 아니라 false-green 발생기). 거부 **사유**를 봐야 계약을 잰 것이다.
    //    0.142.5 실측: -32600 askForApproval.granular requires experimentalApi capability
    expect(error?.message ?? '', 'experimentalApi 없이도 granular 가 통과했다면 승인 게이트 전제가 무너진 것이다')
      .toMatch(/granular requires experimentalApi/i)
  })

  it('🔴 tripwire: 존재하지 않는 model 은 **에러**다 (= turn/start.model 이 읽힌다는 증거)', async () => {
    const s = await openOrchestratorSession({ model: MODEL_A })
    let error = null
    try {
      await runTurn(s, { text: 'hi', model: 'definitely-not-a-real-model-m0-14' })
    } catch (err) {
      error = err
    } finally {
      await s.cleanup()
    }
    record('bogus-model-tripwire', { rejected: Boolean(error), message: error?.message ?? null })
    // 🔴 사유를 본다. 아무 에러나 green 이면 tripwire 가 아니다(위 granular tripwire 와 같은 이유).
    //    **에러가 bogus 이름을 지목해야** 그 문자열이 backend 까지 갔다는 증거다.
    //    실측: 400 invalid_request_error — "The '<bogus>' model is not supported when using Codex
    //    with a ChatGPT account." → thread 는 유효 모델(A)로 열렸으므로, 이 400 은 **turn/start.model
    //    이 thread 모델을 override 했다**는 뜻이다.
    expect(error?.message ?? '', 'bogus model 이 통과했다면 turn/start.model 은 조용히 무시되는 것이다 — per-turn model UX 전제가 무너진다')
      .toContain('definitely-not-a-real-model-m0-14')
  })

  it('🎯 thread/start 응답이 granular 승인 정책을 **되돌려준다** (= 0.144.5 가 받아 적용했다는 양성 증거)', async () => {
    const s = await openOrchestratorSession({ model: MODEL_A })
    try {
      record('thread/start-echo', {
        approvalPolicy: s.started?.approvalPolicy ?? null,
        model: s.started?.model ?? null,
        sandbox: s.started?.sandbox ?? null,
        cliVersion: s.started?.thread?.cliVersion ?? null,
      })
      // "에러가 안 났다" 는 약한 증거다 — 서버가 모르는 필드를 무시해도 조용하다.
      // 서버가 우리 정책을 반사하면 **파싱하고 보존했다**는 증거가 된다.
      // ⚠️ 다만 이건 **'적용'의 증거는 아니다** (적대 리뷰 지적, 수용). 응답은 verbatim echo 도 아니다 —
      //    `sandbox:'read-only'` 가 `{type:'readOnly'}` 로 정규화돼 돌아온다.
      //    granular 하위 플래그 중 **행동으로 확인된 건 `mcp_elicitations:true` 뿐**이고,
      //    그 증거는 여기가 아니라 **m0-8-9** 에 있다(5s/10분 hold 에서 실제 elicitation 발화).
      //    나머지 false 4종은 0.144.5 에서 행동 재검증 안 됨 — shell 이 config 로 죽어 표면이 작다.
      expect(s.started?.approvalPolicy).toEqual({
        granular: {
          sandbox_approval: false,
          rules: false,
          skill_approval: false,
          request_permissions: false,
          mcp_elicitations: true,
        },
      })
      expect(s.started?.thread?.cliVersion).toBe(PINNED)
    } finally {
      await s.cleanup()
    }
  })

  /**
   * 🔴 이 스파이크의 최대 수확.
   *
   * `turn/completed` 는 model 을 안 돌려준다 → per-turn model 은 **서버의 rollout 기록**으로만
   * 양성 확인이 된다. 그리고 확인해 보니 계약이 우리 가정과 **다르다**:
   *
   *   turn/start.model 은 per-turn 스코프가 아니라 **sticky inheritance** 다 —
   *   → model 을 **생략하면 app-server 기본으로 안 돌아가고 직전에 명시한 모델을 상속한다.**
   *
   * 메커니즘(실측): 다른 모델로 turn/start 를 하면 서버가 **`thread/settings/updated`** 를 쏜다
   * (raw `all-events`: turn1 completed → **thread/settings/updated** → turn2 started).
   * 즉 turn 파라미터가 **thread 설정을 갱신**하고, 이후 턴이 그걸 물려받는다.
   * (교차 리뷰 2건이 여기서 갈렸다 — "상속만 관측됐다" vs "thread 변이가 메커니즘". raw 를 열어보니
   *  후자가 맞다. 이름만 읽지 말고 이벤트를 열어볼 것.)
   *
   * 제품 영향: `AgentModelSelector` 의 '기본'(DEFAULT_OPTION `value:null`)은 model 키를 **생략**한다
   * (`ChatPanel.jsx` snapshot → `codexOrchestrator.send` 의 `...(model ? {model} : {})`).
   * 즉 사용자가 gpt-5.6-sol 을 쓰다가 '기본'으로 되돌리면 **기본으로 안 돌아온다** — 라벨이 거짓말이 된다.
   */
  it('🔴 model 생략은 기본으로 복귀가 아니다 — **직전 모델이 sticky** 하게 남는다', async () => {
    const s = await openOrchestratorSession({ model: MODEL_A })
    try {
      await runTurn(s, { text: 'Reply with exactly: ONE', model: MODEL_A })
      await runTurn(s, { text: 'Reply with exactly: TWO', model: MODEL_B })
      await runTurn(s, { text: 'Reply with exactly: THREE' }) // model 생략 = 제품의 '기본' 선택
      await s.session.close() // rollout flush 를 확정한 뒤 읽는다

      const models = turnContextModels(s.ref.rolloutPath)
      record('sticky-model', { rolloutPath: s.ref.rolloutPath, turnContextModels: models })

      expect(models[0], 'turn1 은 명시한 A 로 돌아야 한다').toBe(MODEL_A)
      expect(models[1], 'turn2 는 명시한 B 로 돌아야 한다 = per-turn override 는 실제로 된다').toBe(MODEL_B)
      // 측정된 사실을 그대로 핀한다. 미래 버전이 이걸 바꾸면 red 로 알려준다.
      expect(models[2], 'model 생략 시 직전 모델(B)이 sticky 하게 유지된다 (기본 복귀가 아니다)').toBe(MODEL_B)
    } finally {
      await s.cleanup()
    }
  })

  /**
   * 🔴 이 테스트는 **적대 리뷰가 앵커 드리프트를 잡아서** 생겼다.
   *
   * 나는 "thread/start 에서 model 생략은 안전하다 — 새 thread 는 서버 기본으로 시작한다,
   * m0-14 turn1 이 그 증거" 라고 주석·테스트·커밋 메시지 **세 군데**에 적었다. **거짓 인용이었다.**
   * 이 파일의 세션은 전부 `openOrchestratorSession({ model: MODEL_A })` 로 열려서
   * **thread/start 에 model 이 늘 명시돼 있었다.** turn1 도 명시 gpt-5.5 였다.
   * 즉 "생략한 thread/start" 는 **한 번도 측정된 적이 없다.**
   *
   * 제품이 그 위에 서 있다: `agent:session-open` 은 생략을 그대로 통과시킨다(agent-api.js).
   * 그러니 추론("앞선 모델이 없으니 기본일 수밖에")으로 때우지 말고 **잰다.**
   */
  it('🎯 thread/start 에서 model 을 **생략**하면 새 thread 는 서버 기본으로 시작한다 (인용만 하던 것을 실측)', async () => {
    const s = await openOrchestratorSession({})   // ← model 생략 = 제품의 open 경로
    try {
      const models = await s.session.client.request('model/list', {})
      const serverDefault = (Array.isArray(models?.data) ? models.data : [])
        .find((m) => m?.isDefault === true && m?.hidden !== true)?.id ?? null

      await runTurn(s, { text: 'Reply with exactly: OK' })   // turn 도 생략
      await s.session.close()

      const used = turnContextModels(s.ref.rolloutPath)
      record('omitted-thread-start', { serverDefault, turnContextModels: used, threadStartModel: s.started?.model ?? null })

      expect(serverDefault, 'model/list 가 isDefault 를 줘야 이 테스트가 의미를 갖는다').toBeTruthy()
      // 🎯 생략한 thread + 생략한 turn → 서버 기본. (제품의 '카탈로그 없음' 폴백이 안전한 이유가 여기 있다.)
      expect(used[0], `생략 시 서버 기본(${serverDefault})으로 시작해야 한다`).toBe(serverDefault)
      // thread/start 응답도 같은 것을 반사해야 한다 (두 경로가 어긋나면 뭔가 잘못된 것).
      expect(s.started?.model).toBe(serverDefault)
    } finally {
      await s.cleanup()
    }
  })

  it('🎯 persistent thread + per-turn model: 같은 thread 에서 A→B 로 바꿔도 맥락이 유지된다', async () => {
    const token = 'ACK-7731'
    const s = await openOrchestratorSession({ model: MODEL_A })
    try {
      const t1 = await runTurn(s, {
        text: `Remember this token: ${token}. Reply with exactly the token and nothing else.`,
        model: MODEL_A,
      })
      record('turn1', {
        model: MODEL_A,
        text: t1.text,
        turn: t1.completedTurn,
        startResult: t1.result,
      })
      expect(t1.text).toContain(token)

      const t2 = await runTurn(s, {
        text: 'What token did I ask you to remember in my previous message? Reply with exactly that token and nothing else.',
        model: MODEL_B,
      })
      record('turn2', {
        model: MODEL_B,
        text: t2.text,
        turn: t2.completedTurn,
        startResult: t2.result,
      })
      // 맥락 유지: turn2 는 turn1 의 토큰을 알아야 한다
      expect(t2.text, 'thread 맥락이 끊겼다 = persistent thread 계약 붕괴').toContain(token)
    } finally {
      record('all-events', { events: s.events.map((e) => ({ kind: e.kind, method: e.method })) })
      await s.cleanup()
    }
  })
})
