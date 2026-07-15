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

import path from 'node:path'
import { hashArgs } from './grantLedger.js'
import { invalidParamNames, zodFromJson } from './jsonSchemaToZod.js'
import { STORY_TTS_PROVIDERS } from '../../src/config/storyTtsProviders.js'
import { resolveSceneOrdinals } from '../story/sceneResolver.js'
import { findSceneImageCandidate, resizeSpec } from './sceneImages.js'

// D11: 세로 이미지 긴 변 상한. 값은 스펙 고정(768). 토큰 경제상 하드코딩이 아니라 계약이다.
const IMAGE_MAX_EDGE = 768
// D12: 씬당 추출 프레임 수. 스펙에 값이 없어 제품 정책 기본값(양끝 회피 균등 배치).
const VIDEO_FRAMES_PER_SCENE = 3

/** 프로젝트가 안 열렸을 때의 공통 거부 (스펙 §2.1 `get_project_context`, slice 12). */
const NO_PROJECT = Object.freeze({ error: 'no-project' })

/** `wait_batch` 의 종결 상태 — 여기 도달하면 더 기다릴 이유가 없다. */
const BATCH_TERMINAL = new Set(['complete', 'cancelled-by-user', 'error'])
const BATCH_RESULTS = new Set([...BATCH_TERMINAL, 'timeout'])
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
    options: { type: 'object' },
    review: { type: 'object' },
    reviewOnly: { type: 'boolean' },
    scriptOverride: { type: 'string' },
    continue: { type: 'string' },
    pastedScript: { type: 'string' },
    synopsis: { type: 'string' },
    // pastedScript 재오픈 hydrate에 필요한 제목만 연다. input.type 프로젝트 identity는 UI 소유다.
    title: { type: 'string' },
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

function agentStartStepParams(step, params) {
  if (step !== 'script' || !params || !Object.hasOwn(params, 'title')) return params
  const { title, ...safeParams } = params
  // stepMachine의 pasted 분기는 params.input.title을 보존한다. title만 좁게 어댑트하고 type은 만들지 않는다.
  return params.pastedScript ? { ...safeParams, input: { title } } : safeParams
}

const D8_STATUSES = new Set(['done', 'error', 'aborted', 'rejected'])

/** 에이전트 툴 결과만 D8 한 어휘로 바꾼다. renderer IPC는 이 경로를 타지 않는다. */
export function normalizeToolResult(name, result) {
  // wait_batch의 status/error는 작업 결과가 아니라 배치 도메인 값이다. 일반 거부/오류 규칙보다
  // 먼저 격리하지 않으면 batch status='error'와 실패 개수가 D8 작업 오류로 오해된다.
  if (name === 'wait_batch' && BATCH_RESULTS.has(result?.status)) {
    return { status: 'done', batch: result }
  }

  if (result === null || typeof result !== 'object' || Array.isArray(result)) {
    throw new Error('unknown tool result shape')
  }

  // grant 부재처럼 이미 D8인 결과는 어휘를 다시 해석하지 않는다. 특히 이 unconfirmed는
  // 등장인물 미확정이 아니라 사람 승인 부재라 characters-unconfirmed로 바꾸면 안 된다.
  if (D8_STATUSES.has(result.status)) {
    return result.status === 'rejected'
      ? { ...result, status: 'rejected', reason: result.reason || 'unknown' }
      : result
  }

  if (Object.hasOwn(result, 'outcome')) {
    if (!result.outcome || !D8_STATUSES.has(result.outcome.status)) {
      throw new Error(`unknown tool result outcome: ${String(result.outcome?.status)}`)
    }
    const normalized = { status: result.outcome.status }
    if (result.operationId !== undefined) normalized.operationId = result.operationId
    if (result.outcome.status === 'error' && result.outcome.error !== undefined) {
      normalized.error = result.outcome.error
    }
    if (result.outcome.status === 'rejected') {
      normalized.reason = result.outcome.reason || 'unknown'
    }
    return normalized
  }

  if (result.ok === false || result.success === false || Object.hasOwn(result, 'error')) {
    const { error, success: _success, ok: _ok, ...extras } = result
    // start의 unconfirmed만 roster gate다. grant 미확정과 같은 단어를 에이전트에게 노출하면
    // "사람에게 승인 요청"과 "등장인물 확정" 중 어느 복구를 해야 하는지 구분할 수 없다.
    const mappedReason = name === 'story_start_step' && error === 'unconfirmed'
      ? 'characters-unconfirmed'
      : error
    return { ...extras, status: 'rejected', reason: mappedReason || 'unknown' }
  }

  if (Object.hasOwn(result, 'status')) {
    throw new Error(`unknown tool result status: ${String(result.status)}`)
  }

  if (result.ok === true) {
    const { ok: _ok, success: _success, ...extras } = result
    return { ...extras, status: 'done' }
  }

  if (Object.hasOwn(result, 'ok') || Object.hasOwn(result, 'success')) {
    throw new Error('unknown tool result shape')
  }

  // R 툴의 순수 JSON 도메인 payload만 done으로 감싼다. 결과 표식이 있는 미지 shape는 위에서 닫는다.
  return { ...result, status: 'done' }
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
  // D11 이미지 decode seam. main 에서만 nativeImage 를 감싸 주입한다 (electron/main.js).
  //   imageReader.exists(path) => Promise<boolean>
  //   imageReader.decodeFile(path) => Promise<{ isEmpty, width, height, toBlock({resize}) => {data, mimeType} }>
  // 주입 안 하면 get_scene_images 는 못 돈다 (createToolCore 는 electron 을 import 하지 않는 순수 노드로 남는다).
  imageReader = null,
  // visual review 영속 store(main durable dotfile). update/list_visual_reviews/list_problem_scenes 가 쓴다.
  //   visualReviewStore.read() / .update(entries)
  visualReviewStore = null,
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
   * ordinal 선택을 resolve 하는 공통 경로 (D11/D12 scene 툴이 공유).
   *
   * 🔴 **이중 권위 일관성.** `scenes` 는 renderer snapshot, `fixedScenes` 는 story state 다. 두 소스의
   *    mode 가 어긋나면(committed-but-unstaged 크래시) ordinal 을 엉뚱한 씬으로 매핑해 **다른 씬을
   *    리뷰**하게 된다. mode 불일치는 먼저 stale 로 닫는다. 가드를 한 곳에 둬 scene 툴마다 재발명하지 않는다.
   */
  async function resolveSceneSelection(sceneNumbers) {
    const snapshot = await toolBridge.invoke('scene.snapshot', {})
    const state = await storyCommands.getState()
    // 🔴 mode 비교만으로는 set-replacement 크래시(양쪽 image-first, 슬롯 revision 드리프트)를 못 닫는다.
    //    getState 가 이미 deriveFixedSceneError 로 정확한 신호를 실어 주므로 그걸 먼저 존중한다.
    if (state?.fixedSceneError === 'fixed-scenes-stale') return { stale: true }
    const storyImageFirst = state?.sceneMode === 'image-first'
    const snapImageFirst = snapshot?.sceneMode === 'image-first'
    if (storyImageFirst !== snapImageFirst) return { stale: true }
    const fixedScenes = storyImageFirst ? state.fixedScenes : null
    return { stale: false, ...resolveSceneOrdinals({ sceneNumbers, scenes: snapshot?.scenes || [], fixedScenes }) }
  }

  /**
   * D11 — 씬 이미지 읽기 (에이전트의 눈). resolve 된 rendererSceneId 로 projectPath 아래 scene
   * directory 에서 후보를 찾아 주입 codec 으로 decode/resize 한다.
   */
  async function getSceneImages({ sceneNumbers } = {}) {
    if (!imageReader) throw new Error('get_scene_images requires imageReader')
    const sel = await resolveSceneSelection(sceneNumbers)
    if (sel.stale) return { error: 'fixed-scenes-stale' }
    const { resolved, errors } = sel
    const sceneDir = path.join(storyCommands.projectPath, 'scenes')

    const images = []
    const content = []
    for (const { ordinal, rendererSceneId, scene } of resolved) {
      // 🔴 렌더러가 이 씬에 이미지가 없다고 하면(hasImage:false) 디스크를 보지 않는다. 안 그러면
      //    삭제된 씬의 유령 파일(id 재사용 + 잔존 .png)을 그 씬의 이미지로 오인해 'ok' 로 준다.
      if (!scene?.hasImage) {
        images.push({ ordinal, rendererSceneId, status: 'image-not-found' })
        continue
      }
      const candidate = await findSceneImageCandidate({ sceneDir, rendererSceneId, exists: imageReader.exists })
      if (!candidate) {
        images.push({ ordinal, rendererSceneId, status: 'image-not-found' })
        continue
      }
      const img = await imageReader.decodeFile(candidate)
      // Electron 36 nativeImage 는 유효 WebP/GIF 를 결정적으로 empty 로 준다 — missing 과 분리 (D11).
      if (img.isEmpty) {
        images.push({ ordinal, rendererSceneId, status: 'unsupported-image-format' })
        continue
      }
      const block = img.toBlock({ resize: resizeSpec(img.width, img.height, IMAGE_MAX_EDGE) })
      images.push({ ordinal, rendererSceneId, status: 'ok', mimeType: block.mimeType })
      content.push({ type: 'image', data: block.data, mimeType: block.mimeType })
    }
    // resolve 실패 ordinal 도 per-scene 결과로 섞는다 — 에이전트가 어느 씬이 없는지 안다.
    for (const e of errors) images.push({ ordinal: e.ordinal, status: e.error })
    return { images, content }
  }

  /**
   * D12 — 씬 영상 프레임 읽기. resolve 된 씬의 videoI2VPath/videoT2VPath 를 renderer 로 넘겨
   * 다중 프레임을 뽑는다. decode 는 Chromium 이라 renderer(`video.frames`)가 한다.
   * i2v(image-to-video)를 t2v 보다 우선한다 — 보통 더 정제된 최종 렌더다.
   */
  async function getSceneVideoFrames({ sceneNumbers } = {}) {
    const sel = await resolveSceneSelection(sceneNumbers)
    if (sel.stale) return { error: 'fixed-scenes-stale' }
    const { resolved, errors } = sel

    const frames = []
    const content = []
    for (const { ordinal, rendererSceneId, scene } of resolved) {
      const videoPath = scene.videoI2VPath || scene.videoT2VPath
      const source = scene.videoI2VPath ? 'i2v' : (scene.videoT2VPath ? 't2v' : null)
      if (!videoPath) {
        frames.push({ ordinal, rendererSceneId, status: 'video-not-found' })
        continue
      }
      const res = await toolBridge.invoke('video.frames', {
        rendererSceneId, videoPath, n: VIDEO_FRAMES_PER_SCENE, maxEdge: IMAGE_MAX_EDGE,
      })
      const got = res?.frames || []
      for (const f of got) content.push({ type: 'image', data: f.data, mimeType: f.mimeType })
      frames.push({ ordinal, rendererSceneId, source, status: 'ok', count: got.length })
    }
    for (const e of errors) frames.push({ ordinal: e.ordinal, status: e.error })
    return { frames, content }
  }

  /**
   * slice 33 — visual review 기록 (G). ordinal 을 **write 시점에 재resolve** 한다 (TOCTOU: snapshot 후
   * 사용자가 씬을 지웠을 수 있다). rendererSceneId 로 저장하고 현재 ordinal 은 metadata(ordinalAtReview).
   */
  async function updateVisualReview({ sceneNumbers, status = 'rejected', reason } = {}) {
    const sel = await resolveSceneSelection(sceneNumbers)
    if (sel.stale) return { error: 'fixed-scenes-stale' }
    const entries = sel.resolved.map(({ ordinal, rendererSceneId, storyId }) => ({
      rendererSceneId,
      storyId,
      status,
      ...(reason !== undefined ? { reason } : {}),
      ordinalAtReview: ordinal,
    }))
    const updated = await visualReviewStore.update(entries)
    return { updated, errors: sel.errors }
  }

  /** 저장된 review 에 현재 ordinal 을 재부착한 목록 (R). 사라진 씬은 버리지 않고 ordinal:null,stale. */
  async function listVisualReviews() {
    const sel = await resolveSceneSelection()
    if (sel.stale) return { error: 'fixed-scenes-stale' }
    const ordinalById = new Map(sel.resolved.map((r) => [r.rendererSceneId, r.ordinal]))
    const { reviews } = await visualReviewStore.read()
    const list = Object.entries(reviews).map(([rendererSceneId, rec]) => {
      const ordinal = ordinalById.has(rendererSceneId) ? ordinalById.get(rendererSceneId) : null
      return ordinal === null
        ? { rendererSceneId, ordinal: null, stale: true, ...rec }
        : { rendererSceneId, ordinal, ...rec }
    })
    return { reviews: list }
  }

  /** 문제 씬(rejected)만 ordinal+rendererSceneId+reason 으로 (R). sceneNumbers 주면 그 ordinal 로 필터. */
  async function listProblemScenes({ sceneNumbers } = {}) {
    const sel = await resolveSceneSelection()
    if (sel.stale) return { error: 'fixed-scenes-stale' }
    const ordinalById = new Map(sel.resolved.map((r) => [r.rendererSceneId, r.ordinal]))
    const filter = Array.isArray(sceneNumbers) && sceneNumbers.length > 0 ? new Set(sceneNumbers) : null
    const { reviews } = await visualReviewStore.read()
    const scenes = []
    for (const [rendererSceneId, rec] of Object.entries(reviews)) {
      if (rec.status !== 'rejected') continue
      const ordinal = ordinalById.has(rendererSceneId) ? ordinalById.get(rendererSceneId) : null
      if (filter && !filter.has(ordinal)) continue
      scenes.push({ ordinal, rendererSceneId, ...(rec.reason !== undefined ? { reason: rec.reason } : {}) })
    }
    return { scenes }
  }

  /**
   * D13 — CapCut/Premiere export. renderer 가 실제 export·배치 게이트·fixed-slot completeness·요약을
   * 소유하고, tool 은 force 를 전달하고 결과를 D8 로 reshape 만 한다.
   *
   * 🔴 성공은 `{success:true}` 로 오는데 normalizeToolResult 는 그 shape 를 **throw** 한다. 반드시
   *    명시적으로 `{status:'done', ...}` 로 바꾼다. 거부 `{success:false,error}` 는 그대로 흘려
   *    `{status:'rejected', reason}` 로 정규화한다(ordinals 등 extras 보존).
   */
  async function exportVia(bridgeName, { force } = {}) {
    const result = await toolBridge.invoke(bridgeName, { force: !!force })
    if (result?.success === false) return result
    return { status: 'done', targetPath: result?.targetPath, sceneSummary: result?.sceneSummary, audioSummary: result?.audioSummary }
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
    get_scene_images: {
      permission: 'R',              // 읽기 — 에이전트가 자기가 만든 씬 이미지를 본다 (D11)
      description: '지정한 씬(1-based ordinal)의 생성 이미지를 읽어 리사이즈한 이미지 블록으로 반환한다. 생략 시 전체 씬.',
      inputSchema: {
        type: 'object',
        properties: { sceneNumbers: { type: 'array', items: { type: 'number' } } },
        additionalProperties: false,
      },
      // story state(fixedScenes/projectPath) + renderer snapshot 을 함께 읽는다.
      needs: ['storyCommands', 'toolBridge'],
      run: (args) => getSceneImages(args),
    },
    get_scene_video_frames: {
      permission: 'R',              // 읽기 — 에이전트가 생성 영상의 프레임을 본다 (D12)
      description: '지정한 씬(1-based ordinal)의 생성 영상에서 여러 프레임을 뽑아 이미지 블록으로 반환한다. 생략 시 전체 씬.',
      inputSchema: {
        type: 'object',
        properties: { sceneNumbers: { type: 'array', items: { type: 'number' } } },
        additionalProperties: false,
      },
      needs: ['storyCommands', 'toolBridge'],
      run: (args) => getSceneVideoFrames(args),
    },
    update_visual_review: {
      permission: 'G',              // 사람 승인 — 에이전트가 프로젝트에 지속 상태를 남긴다
      description: '지정한 씬(1-based ordinal)의 시각 리뷰 결과를 프로젝트에 기록한다. status 생략 시 reject.',
      inputSchema: {
        type: 'object',
        properties: {
          sceneNumbers: { type: 'array', items: { type: 'number' } },
          status: { type: 'string', enum: ['rejected', 'ok'] },
          reason: { type: 'string' },
        },
        required: ['sceneNumbers'],
        additionalProperties: false,
      },
      needs: ['storyCommands', 'toolBridge'],
      run: (args) => updateVisualReview(args),
    },
    list_visual_reviews: {
      permission: 'R',
      description: '기록된 시각 리뷰를 현재 씬 ordinal 과 함께 조회한다.',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      needs: ['storyCommands', 'toolBridge'],
      run: () => listVisualReviews(),
    },
    list_problem_scenes: {
      permission: 'R',
      description: '시각 리뷰에서 reject 된 문제 씬을 ordinal 과 이유로 조회한다. sceneNumbers 로 범위 제한 가능.',
      inputSchema: {
        type: 'object',
        properties: { sceneNumbers: { type: 'array', items: { type: 'number' } } },
        additionalProperties: false,
      },
      needs: ['storyCommands', 'toolBridge'],
      run: (args) => listProblemScenes(args),
    },
    export_capcut: {
      permission: 'G',              // 사람 승인 — 프로젝트를 외부 도구로 내보낸다
      description: 'CapCut 프로젝트로 내보낸다. 배치 실행 중이면 거부되며 force:true 로만 우회한다(고정 이미지 완결성은 우회 불가). 미완성은 요약으로 보고한다.',
      inputSchema: {
        type: 'object',
        properties: { force: { type: 'boolean' } },
        additionalProperties: false,
      },
      needs: ['storyCommands', 'toolBridge'],
      run: (args) => exportVia('export.capcut', args),
    },
    export_premiere: {
      permission: 'G',
      description: 'Premiere(.prproj) 로 내보낸다. 배치 실행 중이면 거부되며 force:true 로만 우회한다(고정 이미지 완결성은 우회 불가). 미완성은 요약으로 보고한다.',
      inputSchema: {
        type: 'object',
        properties: { force: { type: 'boolean' } },
        additionalProperties: false,
      },
      needs: ['storyCommands', 'toolBridge'],
      run: (args) => exportVia('export.premiere', args),
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
      description: '사람 승인 뒤 지정한 Story 파이프라인 단계를 시작한다. 프로젝트 입력 유형/제목 identity는 앱 UI가 소유하며, 주제는 synopsis로 전달한다.',
      inputSchema: START_STEP_INPUT_SCHEMA,
      needs: 'storyCommands',
      run: ({ step, params }) => storyCommands.start(step, agentStartStepParams(step, params)),
    },
  }
  const INPUT_VALIDATORS = new Map(Object.entries(TOOLS)
    .map(([name, tool]) => [name, zodFromJson(tool.inputSchema)]))

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
      const result = await (async () => {
        // Codex는 병렬 호출을 request id로 나눠 동시에 보낸다. 이벤트/batch를 추측하지 않고 실제
        // 호출 진입마다 동기로 admission해야 각 호출이 1회고, limit 뒤 side effect도 시작되지 않는다.
        const refusal = admitToolCall?.({ name, args, context })
        if (refusal) return refusal

        const tool = TOOLS[name]
        if (!tool) throw new Error(`unknown tool: ${name}`)
        // adapter는 신뢰 경계 밖 프로세스다. main도 같은 schema 변환기로 원본 args를 검증하되,
        // hash에 묶인 원본을 parse 결과로 대체하지 않는다. 실패는 grant consume 전에 끝낸다.
        const validation = INPUT_VALIDATORS.get(name).safeParse(args)
        if (!validation.success) {
          return { error: 'invalid-params', params: invalidParamNames(validation.error) }
        }
        // 툴마다 필요한 것이 다르다. M3 이미지/영상 툴은 두 seam(storyCommands+toolBridge)을 함께
        // 요구하므로 needs 는 문자열 또는 배열이다. 각 seam 게이트는 membership 으로 판단한다.
        const needs = Array.isArray(tool.needs) ? tool.needs : (tool.needs ? [tool.needs] : [])
        const needsStory = needs.includes('storyCommands')
        const needsBridge = needs.includes('toolBridge')
        if (needsStory && !storyCommands) {
          throw new Error('toolCore.use(storyCommands) was not called')
        }
        if (needsBridge && !toolBridge) {
          throw new Error(`${name} requires toolBridge`)
        }
        // 프로젝트가 없다는 사실은 승인과 무관하다. grant를 먼저 consume하면 사람이 프로젝트를
        // 연 뒤 같은 승인으로 재시도할 수 없으므로, 모든 story 도구의 공통 사전조건을 앞에서 막는다.
        if (needsStory
          && typeof storyCommands.hasProject === 'function'
          && !storyCommands.hasProject()) return NO_PROJECT
        // renderer guarded()와 같은 계약이다. 프로젝트 전환은 renderer session close보다 먼저 일어날 수
        // 있으므로 agent 경로도 세션이 pin한 token을 직접 확인하고, 승인 consume 전에 닫혀야 한다.
        if (needsStory
          && storyCommands.projectToken !== projectToken) return { error: 'stale-token' }
        // adapter 의 주장이 아니라 **main ledger 의 grant** 를 본다.
        if (tool.permission !== 'R' && !isApproved(name, args, context)) {
          return { status: 'rejected', reason: 'unconfirmed' }
        }
        return tool.run(args)
      })()

      // 모든 정상 반환은 이 한 지점만 지난다. 위 블록의 throw는 catch하지 않아 MCP isError로 남긴다.
      return normalizeToolResult(name, result)
    },
  }
}
