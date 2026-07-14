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
import { STORY_TTS_PROVIDERS } from '../../src/config/storyTtsProviders.js'

/** 프로젝트가 안 열렸을 때의 공통 거부 (스펙 §2.1 `get_project_context`, slice 12). */
const NO_PROJECT = Object.freeze({ error: 'no-project' })

/** `wait_batch` 의 종결 상태 — 여기 도달하면 더 기다릴 이유가 없다. */
const BATCH_TERMINAL = new Set(['complete', 'cancelled-by-user', 'error'])
const BATCH_TYPES = new Set(['scene', 'ref'])

// 모델이 빈 문자열/공백 문자열을 보내면 setSpeakers의 같은 검증에서 뒤늦게 실패해 승인이 낭비된다.
// required만으로는 값의 존재만 말하므로, 실제 command가 요구하는 non-empty 계약도 함께 광고한다.
const NON_EMPTY_STRING_SCHEMA = Object.freeze({ type: 'string', minLength: 1, pattern: '\\S' })
const GENDER_SCHEMA = Object.freeze({ type: 'string', enum: ['male', 'female', 'unknown'] })
const SFX_SOURCE_SCHEMA = Object.freeze({ type: 'string', enum: ['elevenlabs', 'library'] })

const VOICE_SCHEMA = Object.freeze({
  oneOf: [
    {
      type: 'object',
      properties: {
        provider: { type: 'string', enum: STORY_TTS_PROVIDERS },
        voiceId: NON_EMPTY_STRING_SCHEMA,
      },
      required: ['provider', 'voiceId'],
      additionalProperties: false,
    },
    // `null`은 기본 성우로 되돌리는 실제 UI/Story 계약이다. object만 열면 합법적인 해제가 막힌다.
    { type: 'null' },
  ],
})

const SPEAKER_ITEM_SCHEMA = Object.freeze({
  type: 'object',
  properties: {
    id: NON_EMPTY_STRING_SCHEMA,
    name: NON_EMPTY_STRING_SCHEMA,
    voice: VOICE_SCHEMA,
    role: { type: 'string' },
    gender: GENDER_SCHEMA,
    age: { type: 'string' },
    appearance: { type: 'string' },
  },
  required: ['id', 'name'],
  additionalProperties: false,
})

// confirmSynopsis는 id를 name.trim()에서 파생하므로 name만 필수다. 나머지는
// normalizeStoryCharacter가 실제로 소비하는 필드만 열어 모델이 임의 키를 발명하지 않게 한다.
const CHARACTER_ITEM_SCHEMA = Object.freeze({
  type: 'object',
  properties: {
    id: NON_EMPTY_STRING_SCHEMA,
    name: NON_EMPTY_STRING_SCHEMA,
    gender: GENDER_SCHEMA,
    age: { type: 'string' },
    role: { type: 'string' },
    ethnicity: { type: 'string' },
    appearance: { type: 'string' },
  },
  required: ['name'],
  additionalProperties: false,
})

// `story_start_step.params`는 IPC의 범용 객체를 그대로 노출하면 사실상 임의 명령 채널이 된다.
// Agent가 쓸 수 있는 키를 step별로 고정하고, D16 화자 설정은 story_set_speakers 한 경로만 둔다.
const START_STEP_PARAM_PROPERTIES = Object.freeze({
  script: Object.freeze({
    input: { type: 'object' },
    options: { type: 'object' },
    review: { type: 'object' },
    reviewOnly: { type: 'boolean' },
    scriptOverride: { type: 'string' },
    continue: { type: 'string' },
    pastedScript: { type: 'string' },
    synopsis: { type: 'string' },
  }),
  scenes: Object.freeze({
    options: { type: 'object' },
    review: { type: 'object' },
    reviewOnly: { type: 'boolean' },
    scriptOverride: { type: 'string' },
    title: { type: 'string' },
  }),
  audio: Object.freeze({
    regenerate: { type: 'array', items: { type: 'string' } },
    // key는 segment id라 고정 properties가 아니고, 값만 실제 sfxFor 라우터의 두 provider로 제한한다.
    sfxSources: { type: 'object', additionalProperties: SFX_SOURCE_SCHEMA },
  }),
  prompts: Object.freeze({
    options: { type: 'object' },
    review: { type: 'object' },
    reviewOnly: { type: 'boolean' },
    style: { type: 'string' },
  }),
})

const START_STEP_INPUT_SCHEMA = Object.freeze({
  type: 'object',
  properties: {
    step: { type: 'string', enum: Object.keys(START_STEP_PARAM_PROPERTIES) },
    params: {
      // 최상위 union은 MCP SDK가 빈 object로 접는다. params 안의 anyOf는 tools/list에 남고,
      // branch 설명이 discriminator와 허용 키의 대응을 모델에게 직접 보여 준다.
      // 모든 params 키가 optional이라 `{}`가 여러 branch와 매치된다. 그래서 oneOf가 아니라 anyOf다.
      anyOf: Object.entries(START_STEP_PARAM_PROPERTIES).map(([step, properties]) => ({
        type: 'object',
        description: `story_start_step.step="${step}"일 때 허용되는 params.`,
        properties,
        additionalProperties: false,
      })),
    },
  },
  required: ['step'],
  additionalProperties: false,
  // MCP SDK는 최상위 union을 tools/list에서 빈 schema로 광고한다. object shape를 유지한 채 adapter가
  // 이 규칙을 zod refinement로 붙여 실제 호출에서는 step별 whitelist까지 강제한다.
  dependentPropertyWhitelist: {
    discriminator: 'step',
    target: 'params',
    allowed: Object.fromEntries(Object.entries(START_STEP_PARAM_PROPERTIES)
      .map(([step, properties]) => [step, Object.keys(properties)])),
  },
})

function invalidStartStepParams({ step, params } = {}) {
  const properties = START_STEP_PARAM_PROPERTIES[step]
  if (!properties) return ['step']
  if (params === undefined) return []
  if (!params || typeof params !== 'object' || Array.isArray(params)) return ['params']
  return Object.keys(params).filter((key) => !Object.hasOwn(properties, key)).sort()
}

/**
 * @param {object} [deps]
 * @param {object} [deps.toolBridge] renderer 를 읽는 seam (D14). 없으면 renderer 를 타는 툴은 못 쓴다.
 * @param {string|null} [deps.projectToken] sessionManager.open 순간 고정한 Story 프로젝트 identity.
 * @param {(call:{name:string,args:object,context:object}) => object|null} [deps.admitToolCall]
 *   실제 Tool Core 호출을 세는 동기 admission seam (D10).
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
  projectToken = null,
  admitToolCall = null,
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
   *
   * 🔴 **M4 전에는 B 툴이 의도적으로 0개다.** `generate_videos`의 정직한 구현은 renderer의
   *    구독/크레딧 admission이 만든 batchId·consumeGate context를 실제 Veo pipeline 끝까지 같은
   *    identity로 운반해야 한다. 지금 `video.admit` transport만 보고 툴을 선언하면 사람은 유료 작업을
   *    승인하고 grant까지 소비하지만 renderer handler가 없어 실패한다. 그래서 M4가 실제 billing
   *    admission을 구현하기 전까지 inventory에서 완전히 제거한다. main-side `video.*` seam은 M4용으로
   *    남아 있어도 이 표와 `call()`에서 도달할 수 없다.
   */
  const TOOLS = {
    story_get_state: {
      permission: 'R',
      description: '현재 열린 Story 프로젝트의 전체 상태를 조회한다.',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      needs: 'storyCommands',
      run: async () => (storyCommands.hasProject()
        ? { projectToken: storyCommands.projectToken, state: await storyCommands.getState() }
        : NO_PROJECT),
    },
    list_scenes: {
      permission: 'R',
      description: '현재 Story 프로젝트의 씬 목록을 JSON으로 조회한다.',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      needs: 'storyCommands',
      // 계약: **요약 문자열이 아니라 JSON** (스펙 §2.3).
      run: async () => (storyCommands.hasProject() ? await storyCommands.listScenes() : NO_PROJECT),
    },
    wait_batch: {
      permission: 'R',
      description: '씬 또는 레퍼런스 이미지 배치가 끝나거나 대기 창이 만료될 때까지 기다린다.',
      inputSchema: {
        type: 'object',
        properties: { type: { type: 'string', enum: ['scene', 'ref'] } },
        required: ['type'],
        additionalProperties: false,
      },
      needs: 'toolBridge',          // story 는 안 쓴다 — renderer 의 배치 상태만 읽는다
      run: (args) => waitBatch(args),
    },
    story_confirm_synopsis: {
      permission: 'G',              // 사람이 확정하는 것 — 에이전트가 혼자 못 한다 (D9)
      description: '시놉시스와 등장인물 명단을 사람 승인 뒤 Story 프로젝트에 확정한다.',
      inputSchema: {
        type: 'object',
        properties: {
          synopsisMd: { type: 'string' },
          characters: { type: 'array', items: CHARACTER_ITEM_SCHEMA },
          // audio-first에서는 세 필드를 생략한다. image-first 프로젝트에서는 셋을 함께 보내고,
          // revision의 현재 프로젝트 일치 여부만 상태 의존 검증으로 confirmSynopsis에 남긴다.
          sceneMode: { type: 'string', enum: ['image-first'] },
          imageFirstVariant: { type: 'string', enum: ['storyboard', 'image-only'] },
          fixedSceneRevision: NON_EMPTY_STRING_SCHEMA,
        },
        additionalProperties: false,
      },
      needs: 'storyCommands',
      run: (args) => storyCommands.confirmSynopsis(args),
    },
    story_set_speakers: {
      permission: 'G',              // D9.3
      description: 'Story 프로젝트의 화자 목록과 음성 설정을 저장한다.',
      inputSchema: {
        type: 'object',
        properties: { speakers: { type: 'array', items: SPEAKER_ITEM_SCHEMA } },
        required: ['speakers'],
        additionalProperties: false,
      },
      needs: 'storyCommands',
      run: (args) => storyCommands.setSpeakers(args),
    },
    story_start_step: {
      permission: 'G',              // D9.3 — 모든 `*_start` 는 G
      description: '사람 승인 뒤 지정한 Story 파이프라인 단계를 시작한다.',
      inputSchema: START_STEP_INPUT_SCHEMA,
      needs: 'storyCommands',
      run: ({ step, params }) => storyCommands.start(step, params),
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
      // 현재 token을 대조해야 주 stale guard가 빠져도 A grant가 B에서 승인으로 인정되지 않는다.
      projectToken: storyCommands?.projectToken ?? null,
    })
  }

  return {
    use(commands) {
      // 프로젝트 가드가 빠진 설정을 "가드 통과"로 해석하면 모든 story side effect가 fail-open한다.
      // RPC/child를 열기 전인 주입 경계에서 필수 계약을 확정한다.
      if (typeof commands?.hasProject !== 'function') {
        throw new TypeError('storyCommands.hasProject must be a function')
      }
      storyCommands = commands
    },

    /** 툴 목록 — adapter 가 MCP inventory 를 만들 때 쓴다 (M2). */
    list() {
      return Object.entries(TOOLS).map(([name, t]) => ({
        name,
        permission: t.permission,
        description: t.description,
        inputSchema: t.inputSchema,
      }))
    },

    /**
     * 🔴 **fail-closed.** 모르는 툴은 던진다 — 조용히 `undefined` 를 돌려주면 에이전트는
     *    "툴이 아무것도 안 했다" 와 "툴이 없다" 를 구분하지 못한다.
     */
    async call(name, args = {}, context = {}) {
      // Codex는 병렬 호출을 request id로 나눠 동시에 보낸다. 이벤트/batch를 추측하지 않고 실제
      // 호출 진입마다 동기로 admission해야 각 호출이 1회고, limit 뒤 side effect도 시작되지 않는다.
      const refusal = admitToolCall?.({ name, args, context })
      if (refusal) return refusal

      const tool = TOOLS[name]
      if (!tool) throw new Error(`unknown tool: ${name}`)
      // 툴마다 필요한 것이 다르다. 전부에게 storyCommands 를 요구하면 renderer 만 읽는 툴이 못 돈다.
      if (tool.needs === 'storyCommands' && !storyCommands) {
        throw new Error('toolCore.use(storyCommands) 가 호출되지 않았다')
      }
      if (tool.needs === 'toolBridge' && !toolBridge) {
        throw new Error(`${name} requires toolBridge`)
      }
      // 프로젝트가 없다는 사실은 승인과 무관하다. grant를 먼저 consume하면 사람이 프로젝트를
      // 연 뒤 같은 승인으로 재시도할 수 없으므로, 모든 story 도구의 공통 사전조건을 앞에서 막는다.
      if (tool.needs === 'storyCommands'
        && typeof storyCommands.hasProject === 'function'
        && !storyCommands.hasProject()) return NO_PROJECT
      // renderer guarded()와 같은 계약이다. 프로젝트 전환은 renderer session close보다 먼저 일어날 수
      // 있으므로 agent 경로도 세션이 pin한 token을 직접 확인하고, 승인 consume 전에 닫혀야 한다.
      if (tool.needs === 'storyCommands'
        && storyCommands.projectToken !== projectToken) return { error: 'stale-token' }
      if (name === 'story_start_step') {
        const invalid = invalidStartStepParams(args)
        // schema 밖 private RPC 호출도 같은 경계에서 막는다. 승인 grant를 태우기 전에 닫아야 한다.
        if (invalid.length) return { error: 'invalid-params', params: invalid }
      }
      // adapter 의 주장이 아니라 **main ledger 의 grant** 를 본다.
      if (tool.permission !== 'R' && !isApproved(name, args, context)) {
        return { status: 'rejected', reason: 'unconfirmed' }
      }
      return tool.run(args)
    },
  }
}
