/**
 * Story 스텝 머신 — 스펙 §2/§3/§4. main process 소유, 결정적 순서 제어.
 * LLM 어댑터는 DI(테스트 mock). emit은 모든 payload에 projectToken/operationId 포함.
 */
import { randomUUID } from 'node:crypto'
import path from 'node:path'
import { stat } from 'node:fs/promises'
import { createStoryStore } from './storyStore.js'
import { inheritStoryIds, assertUniqueStoryIds, assignStoryIdsByMembership, inheritSegmentIds } from './sceneIdentity.js'
import { buildFallbackTimeline, buildSegmentTimeline, buildSrt, srtLineId } from './timing.js'
import { regroupScenes } from './regroup.js'
import { buildManifest } from './manifest.js'
import { normalizeStoryLlmOptions } from '../api/llm/storyLlmCatalog.js'
import { validateScenesSegments } from '../api/llm/schemas.js'
import { isNarratorSpeaker as isNarratorTrackSpeaker } from '../../src/utils/storyNarrationTracks.js'

const DOWNSTREAM = { script: ['scenes', 'audio', 'prompts'], scenes: ['audio', 'prompts'], audio: ['prompts'], prompts: [] }

// M3: 검토 루프 최대 라운드 — Claude는 3회, 그 외(Gemini 등)는 1회(스펙 §124-125).
// effective model(opts.model) 기준 — story state.engine엔 model이 없다(Codex-R2).
function reviewRounds(model) {
  return String(model || '').startsWith('claude') ? 3 : 1
}

// C1: LLM splitScenes 출력에는 segment.id가 없다(schemas.js SCENES_SCHEMA에 id 필드 없음) — scenes
// 스텝이 여기서 결정적 id를 발급해야 audio 스텝의 파일명/results 맵/manifest 키가 undefined로
// 붕괴하지 않는다. 이미 id가 있으면(재실행 idempotent) 보존한다.
// IP4(M2a-2b): inheritSegmentIds가 승계한 id는 이전 위치(다른 s{i}-{j})라, 위치기반으로 미매칭
// 세그먼트를 채우면 승계 id와 충돌할 수 있다(예: 앞에 삽입된 새 세그먼트가 s1-1을 받는데 승계된
// 세그먼트도 s1-1). 이미 쓰인 id를 피해 결정적으로 유일한 위치 id를 발급한다.
function assignSegmentIds(scenes) {
  const used = new Set((scenes || []).flatMap((s) => (s.segments || []).map((g) => g.id).filter(Boolean)))
  return scenes.map((s, i) => ({
    ...s,
    segments: (s.segments || []).map((seg, j) => {
      if (seg.id) return seg
      let id = `s${i + 1}-${j + 1}`
      let k = 2
      while (used.has(id)) { id = `s${i + 1}-${j + 1}-${k}`; k++ }
      used.add(id)
      return { ...seg, id }
    }),
  }))
}

// audio 스텝 fail-fast: scenes.json의 내레이션 세그먼트가 id 없이(또는 중복 id로) 넘어오면
// TTS 파일명/results 맵/manifest 키가 조용히 undefined로 붕괴한다 — 여기서 즉시 던진다.
// Codex-2 HIGH: id는 audio/segments/${id}.${format} 파일명에 그대로 쓰이고 storyStore.writeAtomic은
// 경로 포함 검증을 하지 않는다 — `../` 등이 섞인 id(변조된/스키마 밖 필드가 실린 scenes.json)가
// segments 디렉터리 밖에 쓰는 걸 막기 위해 안전한 파일명 토큰만 허용한다(발급 id 패턴 s{i}-{j} 포함).
const SAFE_SEGMENT_ID = /^[A-Za-z0-9_-]+$/
function assertSegmentIdsValid(scenes) {
  // M2b: sfx도 audio/segments/${id}.${format} 파일명에 id를 쓴다 → narration과 함께 검증(traversal 방어).
  const audioBearing = (scenes || []).flatMap((sc) => sc.segments || []).filter((s) => {
    const t = s.type || 'narration'
    return t === 'narration' || t === 'sfx'
  })
  const seen = new Set()
  for (const seg of audioBearing) {
    if (!seg.id || seen.has(seg.id)) throw new Error('segment id missing or duplicate — rerun scenes step')
    if (!SAFE_SEGMENT_ID.test(seg.id)) throw new Error(`unsafe segment id (must match ${SAFE_SEGMENT_ID}): ${seg.id}`)
    seen.add(seg.id)
  }
}

// M2a-4 IP-A2: export(renderer)가 story 나레이션 배치에 쓸 { manifest, lastPushedRevision }.
// machine 인스턴스와 독립 — fresh session(story view 미진입, machine 미생성)에서도 IPC 가
// projectPath 만으로 부를 수 있다. 경로 검증(traversal/workFolder)은 호출측 IPC 책임.
//   - manifest 없으면(audio 미실행) null → 오디오 없이 export.
//   - 손상(파싱 불가)이면 throw → export 차단(fail-fast, Codex finding 3).
export async function readAudioPackage(projectPath) {
  const store = createStoryStore(projectPath)
  const raw = await store.loadText('audio/manifest.json')
  if (!raw) return null
  let manifest
  try { manifest = JSON.parse(raw) } catch (e) {
    throw new Error(`story audio manifest corrupt: ${e.message} — export blocked`)
  }
  const st = await store.load()
  return { manifest, lastPushedRevision: st.lastPushedRevision ?? 0 }
}

export function createStepMachine({ projectPath, llm, emit, getApiKey, loadMetaPrompt, tts, ttsFor, probe, defaultVoice = null, sfxFor = null }) {
  const store = createStoryStore(projectPath)
  // 화자별 엔진(슬라이스2): voice.provider별로 어댑터 선택. ttsFor 미주입(기존 단일 tts)이면 tts 사용.
  const resolveTts = (provider) => (ttsFor ? ttsFor(provider) : tts)
  // 세그먼트 오디오의 합성 지문 — provider/voiceId/emotion. 재사용 시 현재 배정과 일치해야 함
  // (Codex-TTS HIGH: 화자 voice/엔진을 바꿔도 옛 오디오가 재사용되던 버그 방지).
  const ttsVoiceKey = (voice, emotion) => (voice?.voiceId ? `${voice.provider || 'typecast'}:${voice.voiceId}:${emotion || 'normal'}` : '')
  // 감정은 화자(대사)만 — narrator는 normal로 고정(나레이션에 감정 안 실림). TTS·reuse 지문에 공통.
  const effectiveEmotion = (seg) => (isNarratorTrackSpeaker(seg?.speaker) ? 'normal' : seg?.emotion)
  const projectToken = randomUUID()
  let state = null
  let controller = null
  let previewing = false // synthPreview 진행 중 — 배치/다른 preview와의 경쟁 직렬화(Codex-TTS HIGH2)

  const send = (ch, payload, operationId) =>
    emit(ch, { projectToken, operationId: operationId || randomUUID(), ...payload })

  async function flush() { await store.save(state) }

  function normalizeLlmOptions(options = {}) {
    return normalizeStoryLlmOptions({ model: state?.engine?.model, ...(options || {}) })
  }

  function buildLlmOptions(options = {}, extras = {}) {
    return { apiKey: getApiKey(), ...normalizeLlmOptions({ ...(options || {}), ...(extras || {}) }) }
  }

  function effectiveOptions(params = {}) {
    return normalizeLlmOptions({
      ...(state?.input?.options || {}),
      ...(params.options || {}),
      ...(params.review ? { review: params.review } : {}),
    })
  }

  function reviewConfig(options = {}, target) {
    if (options?.review && typeof options.review === 'object') {
      const explicit = options.review[target]
      if (!explicit || typeof explicit !== 'object') return { enabled: false, rounds: 0 }
      const rounds = Number.isFinite(Number(explicit.rounds)) ? Math.max(0, Math.floor(Number(explicit.rounds))) : 1
      return { enabled: explicit.enabled !== false && rounds > 0, rounds }
    }
    if (target === 'script' && options?.reviewLoop) {
      const rounds = reviewRounds(options.model || state?.engine?.model)
      return { enabled: rounds > 0, rounds }
    }
    return { enabled: false, rounds: 0 }
  }

  function reviewLlmOptions(options = {}) {
    const { metaPrompt, ...rest } = options || {}
    return rest
  }

  function sendReviewProgress(target, payload, operationId) {
    send('story:progress', { kind: 'review', target, ...payload }, operationId)
    // 기존 renderer/tests가 script-review를 소비한다. 새 generic event와 병행 송신한다.
    if (target === 'script') send('story:progress', { kind: 'script-review', ...payload }, operationId)
  }

  function sendStepLog(step, phase, message, operationId, extra = {}) {
    send('story:progress', {
      kind: 'step-log',
      step,
      phase,
      message,
      level: extra.level || 'info',
      at: new Date().toISOString(),
      ...extra,
    }, operationId)
  }

  function normalizeScenes(prev, scenes) {
    validateScenesSegments(scenes)
    const { scenes: withIds } = inheritStoryIds(prev, scenes)
    assertUniqueStoryIds(withIds)
    const { scenes: withInheritedSegs } = inheritSegmentIds(prev, withIds)
    return assignSegmentIds(withInheritedSegs)
  }

  const speakerKey = (v) => String(v || '').replace(/\s/g, '').toLowerCase()
  const referencedSpeakerKey = (v) => isNarratorTrackSpeaker(v) ? 'narrator' : speakerKey(v)
  const speakerReferenceKeys = (sp) => [sp?.id, sp?.name].filter(Boolean).map(referencedSpeakerKey)
  const findSpeakerByRef = (speakers = [], ref) => {
    const key = referencedSpeakerKey(ref)
    if (!key) return null
    return (speakers || []).find((sp) => speakerReferenceKeys(sp).includes(key)) || null
  }
  const nonEmptyString = (v) => (typeof v === 'string' && v.trim()) ? v : undefined
  function mergeSpeakers(nextSpeakers = [], { preferNewAppearance = false } = {}) {
    const prevSpeakers = new Map()
    for (const sp of state.speakers || []) {
      if (sp.id) prevSpeakers.set(`id:${speakerKey(sp.id)}`, sp)
      if (sp.name) prevSpeakers.set(`name:${speakerKey(sp.name)}`, sp)
    }
    return (nextSpeakers || []).map((sp) => {
      const prev = prevSpeakers.get(`id:${speakerKey(sp.id)}`) || prevSpeakers.get(`name:${speakerKey(sp.name)}`)
      const appearance = preferNewAppearance
        ? (nonEmptyString(sp.appearance) ?? nonEmptyString(prev?.appearance) ?? sp.appearance ?? prev?.appearance)
        : (nonEmptyString(prev?.appearance) ?? nonEmptyString(sp.appearance) ?? prev?.appearance ?? sp.appearance)
      return { ...sp, appearance, voice: prev?.voice ?? null }
    })
  }

  function ensureReferencedSpeakers(nextSpeakers = [], scenes = [], fallbackSpeakers = []) {
    const out = [...(nextSpeakers || [])]
    const seen = new Set(out.flatMap(speakerReferenceKeys))
    const fallbackByKey = new Map()
    for (const sp of fallbackSpeakers || []) {
      for (const key of speakerReferenceKeys(sp)) fallbackByKey.set(key, sp)
    }
    for (const seg of (scenes || []).flatMap((s) => s.segments || [])) {
      if ((seg.type || 'narration') !== 'narration') continue
      const key = referencedSpeakerKey(seg.speaker)
      if (!key || seen.has(key)) continue
      const prev = fallbackByKey.get(key)
      if (prev) out.push(prev)
      else if (key === 'narrator') out.push({ id: 'narrator', name: '나레이션' })
      else out.push({ id: String(seg.speaker).trim(), name: String(seg.speaker).trim() })
      seen.add(key)
    }
    return out
  }

  async function reviewScriptCandidate(scriptMd, opts, rounds, opId, signal) {
    if (!llm.reviewScript || !llm.reviseScript || rounds <= 0) return { scriptMd, changed: false }
    const reviewOpts = reviewLlmOptions(opts)
    let current = scriptMd
    let changed = false
    try {
      for (let round = 1; round <= rounds; round++) {
        sendReviewProgress('script', { round, of: rounds, phase: 'reviewing' }, opId)
        const { verdict, critique } = await llm.reviewScript(current, reviewOpts, { signal })
        if (signal?.aborted) return { scriptMd: current, changed }
        if (verdict !== 'revise' || !critique?.trim()) break
        sendReviewProgress('script', { round, of: rounds, phase: 'revising' }, opId)
        const r = await llm.reviseScript(current, critique, reviewOpts, { signal })
        if (signal?.aborted) return { scriptMd: current, changed }
        if (!r?.scriptMd?.trim()) throw new Error('reviseScript returned empty script')
        changed = changed || r.scriptMd !== current
        current = r.scriptMd
      }
    } catch (e) {
      if (signal?.aborted) return { scriptMd: current, changed }
      sendReviewProgress('script', { phase: 'error', error: String(e?.message || e) }, opId)
    }
    return { scriptMd: current, changed }
  }

  async function reviewScenesCandidate(scriptMd, scenes, speakers, opts, rounds, opId, signal) {
    if (!llm.reviewScenes || !llm.reviseScenes || rounds <= 0) return { scenes, speakers, changed: false }
    const reviewOpts = reviewLlmOptions(opts)
    let currentScenes = scenes
    let currentSpeakers = speakers
    let changed = false
    try {
      for (let round = 1; round <= rounds; round++) {
        sendReviewProgress('scenes', { round, of: rounds, phase: 'reviewing' }, opId)
        const { verdict, critique } = await llm.reviewScenes(scriptMd, currentScenes, currentSpeakers, reviewOpts, { signal })
        if (signal?.aborted) return { scenes: currentScenes, speakers: currentSpeakers, changed }
        if (verdict !== 'revise' || !critique?.trim()) break
        sendReviewProgress('scenes', { round, of: rounds, phase: 'revising' }, opId)
        const r = await llm.reviseScenes(scriptMd, currentScenes, currentSpeakers, critique, reviewOpts, { signal })
        if (signal?.aborted) return { scenes: currentScenes, speakers: currentSpeakers, changed }
        const nextScenes = normalizeScenes(currentScenes, r?.scenes || [])
        const nextSpeakers = mergeSpeakers(ensureReferencedSpeakers(r?.speakers || [], nextScenes, currentSpeakers), { preferNewAppearance: true })
        changed = changed ||
          !sameJson(sceneReviewSignature(nextScenes), sceneReviewSignature(currentScenes)) ||
          !sameJson(speakerReviewSignature(nextSpeakers), speakerReviewSignature(currentSpeakers))
        currentScenes = nextScenes
        currentSpeakers = nextSpeakers
      }
    } catch (e) {
      if (signal?.aborted) return { scenes: currentScenes, speakers: currentSpeakers, changed }
      sendReviewProgress('scenes', { phase: 'error', error: String(e?.message || e) }, opId)
    }
    return { scenes: currentScenes, speakers: currentSpeakers, changed }
  }

  async function reviewPromptsCandidate(scenes, context, opts, rounds, opId, signal) {
    if (!llm.reviewPrompts || !llm.revisePrompts || rounds <= 0) return { scenes, changed: false }
    const reviewOpts = reviewLlmOptions(opts)
    let currentScenes = scenes
    let changed = false
    try {
      for (let round = 1; round <= rounds; round++) {
        sendReviewProgress('prompts', { round, of: rounds, phase: 'reviewing' }, opId)
        const { verdict, critique } = await llm.reviewPrompts(currentScenes, context, reviewOpts, { signal })
        if (signal?.aborted) return { scenes: currentScenes, changed }
        if (verdict !== 'revise' || !critique?.trim()) break
        sendReviewProgress('prompts', { round, of: rounds, phase: 'revising' }, opId)
        const r = await llm.revisePrompts(currentScenes, context, critique, reviewOpts, { signal })
        if (signal?.aborted) return { scenes: currentScenes, changed }
        const nextScenes = r?.scenes || []
        changed = changed || !sameJson(promptSignature(nextScenes), promptSignature(currentScenes))
        currentScenes = nextScenes
      }
    } catch (e) {
      if (signal?.aborted) return { scenes: currentScenes, changed }
      sendReviewProgress('prompts', { phase: 'error', error: String(e?.message || e) }, opId)
    }
    return { scenes: currentScenes, changed }
  }

  async function restampManifestRevision(signal) {
    if (signal?.aborted) return
    const manifestRaw = await store.loadText('audio/manifest.json')
    if (manifestRaw && !signal?.aborted) {
      const m = JSON.parse(manifestRaw)
      m.pushRevision = state.pendingPushRevision
      await store.saveText('audio/manifest.json', JSON.stringify(m, null, 2))
    }
  }

  const sameJson = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null)
  const sceneReviewSignature = (scenes = []) => scenes.map((s) => ({
    storyId: s.storyId || null,
    sceneNo: s.sceneNo ?? null,
    summary: s.summary || '',
    segments: (s.segments || []).map((g) => ({
      id: g.id || null,
      type: g.type || 'narration',
      speaker: g.speaker || '',
      text: g.text || '',
      emotion: g.emotion || '',
      description: g.description || '',
    })),
  }))
  const speakerReviewSignature = (speakers = []) => speakers.map((sp) => ({
    id: sp.id || '',
    name: sp.name || '',
    appearance: sp.appearance || '',
  }))
  const promptSignature = (scenes = []) => scenes.map((s) => ({
    sceneNo: s.sceneNo,
    imagePrompt: s.imagePrompt || '',
    videoPrompt: s.videoPrompt || '',
  }))

  // V2: narrator/비가시 화자 판정(정규화 id/name). 이 화자는 캐릭터 카드/태그에서 제외.
  const isNarratorSpeaker = (sp) => {
    const t = (v) => String(v || '').replace(/\s/g, '').toLowerCase()
    return t(sp?.id) === 'narrator' || t(sp?.name) === 'narrator' || t(sp?.name) === '내레이터'
  }
  // V2: non-narrator speaker를 캐릭터 후보로 취급한다. appearance가 없어도 Ref 탭에 pending
  // 카드가 먼저 생겨야 사용자가 외형/이미지를 보강할 수 있다.
  const characterSpeakers = () => (state.speakers || [])
    .filter((sp) => !isNarratorSpeaker(sp) && (sp?.name || sp?.id))
    .map((sp) => ({ ...sp, name: sp.name || sp.id, appearance: sp.appearance || '' }))

  // V2: 그 씬에 등장하는 캐릭터 이름 배열(speaker id→name, 캐릭터만, 유일, 등장순).
  function sceneCharacterNames(s) {
    const chars = new Map(characterSpeakers().map((sp) => [sp.id, sp.name]))
    const names = []
    for (const g of s.segments || []) {
      const name = chars.get(g.speaker)
      if (name && !names.includes(name)) names.push(name)
    }
    return names
  }
  // V2: 멘션 문법(mentionParser.MENTION_RE)에 맞는 이름만 @멘션 가능 — 공백 포함 이름은 불가.
  const MENTION_SAFE = /^[A-Za-z0-9_\-가-힣]+$/
  // V2: 프롬프트에 @이름 멘션 주입(Flow·API 공통 레퍼런스 지정). 멘션-불가 이름은 생략(태그 폴백).
  function withMentions(prompt, names) {
    const mentions = names.filter((n) => MENTION_SAFE.test(n)).map((n) => `@${n}`)
    if (!mentions.length) return prompt || ''
    return prompt ? `${mentions.join(' ')} ${prompt}` : mentions.join(' ')
  }

  function mapScene(s, timing) {
    // 스펙 §4-④: project.json 씬 확장 필드는 storyId/stalePrompt/stalePromptAt/staleVideo/
    // staleVideoAt 5개로 제한 — sceneNo(scenes.json 전용 표시용 순번)는 push payload에 넣지 않는다.
    const measured = typeof s.startSec === 'number' && typeof s.endSec === 'number'
    const charNames = sceneCharacterNames(s)
    return {
      storyId: s.storyId,
      // V2: 등장 캐릭터 @멘션 주입 → Flow/API 둘 다 캐릭터 레퍼런스 이미지를 conditioning으로 붙인다.
      prompt: withMentions(s.imagePrompt || '', charNames),
      videoT2VPrompt: withMentions(s.videoPrompt || '', charNames),
      // IP1: audio 실측(finalScenes startSec/endSec)이 있으면 timing의 유일 소스. 없으면(대략 모드)
      // buildFallbackTimeline 글자수 추정으로 폴백(스펙 §3 대략 모드 / §7 흐름A).
      startTime: measured ? s.startSec : timing.startTime,
      endTime: measured ? s.endSec : timing.endTime,
      duration: measured ? s.endSec - s.startSec : timing.duration,
      // IP2: 실측이면 그룹 내 narration 세그먼트 라인 id(sub_<segId>, 순서 보존), 아니면 폴백은 오디오 없음.
      srtLineIds: measured ? narrationLineIds(s) : [],
      subtitle: (s.segments || []).map((g) => g.text).join(' '),
      // V2: 캐릭터 레퍼런스 매칭용 태그(speaker.name 콤마조인) — 멘션 매칭의 폴백. getMatchingReferences 소비.
      characters: charNames.join(', '),
    }
  }

  // IP2: 씬 그룹 내 narration 세그먼트의 SRT 라인 id 배열(순서 보존, sfx 제외).
  function narrationLineIds(s) {
    return (s.segments || [])
      .filter((g) => (g.type || 'narration') === 'narration')
      .map((g) => srtLineId(g.id))
  }

  // IP2: 세그먼트 실측 타임라인 → srtTrack payload(초 단위, 스펙 §7 흐름A wholesale 교체용).
  // startMs 없는(대략 모드) 세그먼트는 제외 → 라인 0개면 sendPush가 srtTrack을 안 실어 폴백 보존.
  function buildSrtTrackPayload(scenes) {
    const lines = []
    for (const s of scenes) {
      for (const g of s.segments || []) {
        if ((g.type || 'narration') !== 'narration') continue
        if (typeof g.startMs !== 'number') continue
        lines.push({
          id: srtLineId(g.id),
          startTime: g.startMs / 1000,
          endTime: (g.startMs + (g.durationMs || 0)) / 1000,
          text: g.text || '',
        })
      }
    }
    return lines
  }

  function sendPush(scenes, operationId) {
    assertUniqueStoryIds(scenes)
    const timeline = buildFallbackTimeline(scenes, state.input?.options?.language || 'ko')
    const byId = new Map(timeline.map((t) => [t.storyId, t]))
    const srtTrack = buildSrtTrackPayload(scenes)
    const payload = {
      pushRevision: state.pendingPushRevision,
      scenes: scenes.map((s) => mapScene(s, byId.get(s.storyId))),
      // V2: 캐릭터 레퍼런스 카드 등록용 — appearance 있는 non-narrator speaker(이름+외형).
      storyCharacters: characterSpeakers().map((sp) => ({ name: sp.name, appearance: sp.appearance })),
    }
    // 실측 라인이 있을 때만 srtTrack 전송 — renderer가 wholesale 교체(대략 모드는 미전송→기존 유지).
    if (srtTrack.length) payload.srtTrack = srtTrack
    send('story:pushScenes', payload, operationId)
  }

  function sendCharacters(operationId) {
    const storyCharacters = characterSpeakers().map((sp) => ({ name: sp.name, appearance: sp.appearance || '' }))
    if (storyCharacters.length) send('story:pushCharacters', { storyCharacters }, operationId)
  }

  function maybeSendCharacters(operationId) {
    if (state?.steps?.scenes?.status === 'done') sendCharacters(operationId)
  }

  // Important: Story 뷰 ②/④ 패널(씬 세그먼트·프롬프트)이 실데이터를 그리려면 scenes.json
  // 내용이 필요하다. story.json에는 저장하지 않는 파생 데이터 — open/getState/스텝 완료 시
  // payload에만 실어 보낸다.
  // 세그먼트가 참조하는 화자(특히 narrator)가 state.speakers에 없으면 오디오 탭 성우 매핑에서
  // 누락된다(voice map은 state.speakers만 렌더). open 시 scenes.json 기준으로 self-heal —
  // 스플릿 당시 누락(LLM이 narrator를 speakers에서 빠뜨림 등)된 stale 프로젝트를 재분리 없이 복구.
  async function healReferencedSpeakers() {
    if (!state) return
    const scenes = await loadScenesForPayload()
    if (!scenes.length) return
    const healed = ensureReferencedSpeakers(state.speakers || [], scenes, state.speakers || [])
    if (healed.length !== (state.speakers || []).length) {
      state.speakers = healed
      await flush()
    }
  }

  async function loadScenesForPayload() {
    const raw = await store.loadText('scenes.json')
    if (!raw) return []
    try { return JSON.parse(raw).scenes || [] } catch { return [] }
  }

  async function maybeResendPush(operationId) {
    if (!state) state = await store.load()
    if (state.steps.prompts.status === 'done' && state.pendingPushRevision > state.lastPushedRevision) {
      const scenesJson = JSON.parse((await store.loadText('scenes.json')) || '{"scenes":[]}')
      sendPush(scenesJson.scenes, operationId)
    }
  }

  const steps = {
    async script(params, opId, signal) {
      if (params.reviewOnly) {
        const storedScript = await store.loadText('script.md')
        const scriptMd = typeof params.scriptOverride === 'string' ? params.scriptOverride : storedScript
        if (!scriptMd?.trim()) throw new Error('script.md not found — run script step first')
        const opts = buildLlmOptions(effectiveOptions(params))
        const cfg = reviewConfig(opts, 'script')
        if (!cfg.enabled) return { changed: false }
        const reviewed = await reviewScriptCandidate(scriptMd, opts, cfg.rounds, opId, signal)
        if (signal?.aborted) return
        const finalScript = reviewed.scriptMd
        const changed = reviewed.changed || finalScript !== storedScript
        if (changed) await store.saveText('script.md', finalScript)
        return { changed }
      }

      // 대본 재설계: 이어쓰기 — 편집 중 대본을 받아 LLM이 이어서 완성한 전체 대본을 저장한다.
      if (params.continue) {
        const opts = buildLlmOptions(params.options)
        const { scriptMd } = await llm.continueScript(params.continue, opts, {
          onDelta: (text) => send('story:delta', { text }, opId), signal,
        })
        if (signal?.aborted) return
        await store.saveText('script.md', scriptMd)
        return
      }
      // M1 스펙 §1 2번 경로: 대본을 직접 붙여넣은 경우 LLM 호출 없이 그대로 저장한다.
      if (params.pastedScript) {
        // title 보존 — 재오픈 hydrate가 제목/옵션을 복원하려면 main source of truth에 남겨야 한다.
        state.input = { type: 'pasted', title: params.input?.title, options: normalizeLlmOptions(params.options) }
        // HIGH: abort 직후 파일 쓰기 자체를 막는 방어 가드 — start() 래퍼의 결과 처리 가드와
        // 별개로, 취소된 스텝이 디스크에 흔적을 남기지 않도록 saveText 직전에 한 번 더 확인한다.
        if (signal?.aborted) return
        await store.saveText('script.md', params.pastedScript)
        return
      }
      const inputOptions = normalizeLlmOptions(params.options)
      state.input = params.input ? { ...params.input, options: inputOptions } : state.input
      const language = inputOptions.language || state.input?.options?.language || 'ko'
      const metaPrompt = loadMetaPrompt
        ? await loadMetaPrompt({ genre: inputOptions.genre, wave: 'script', language })
        : ''
      const opts = buildLlmOptions(inputOptions, { metaPrompt })
      const gen = await llm.generateScript(state.input, opts, {
        onDelta: (text) => send('story:delta', { text }, opId), signal,
      })
      if (signal?.aborted) return
      let scriptMd = gen.scriptMd
      await store.saveText('script.md', scriptMd)

      // M3: 대본 자동 검토·수정 루프(옵션). 검토는 non-streaming — 진행은 progress로 표시.
      // 실패해도 마지막 저장본을 유지하고 스텝은 정상(done)으로 둔다(품질 옵션이 본 생성을 깨지 않음).
      const cfg = reviewConfig(opts, 'script')
      if (cfg.enabled && !signal?.aborted) {
        const reviewed = await reviewScriptCandidate(scriptMd, opts, cfg.rounds, opId, signal)
        if (signal?.aborted) return
        if (reviewed.changed) await store.saveText('script.md', reviewed.scriptMd)
      }
    },
    async scenes(params, opId, signal) {
      if (params.reviewOnly) {
        sendStepLog('scenes', 'review-load', '기존 씬 검수 준비', opId)
        const scriptMd = await store.loadText('script.md')
        if (!scriptMd) throw new Error('script.md not found — run script step first')
        const scenesJson = JSON.parse((await store.loadText('scenes.json')) || 'null')
        if (!scenesJson) throw new Error('scenes.json not found — run scenes step first')
        const opts = buildLlmOptions(effectiveOptions(params))
        const cfg = reviewConfig(opts, 'scenes')
        if (!cfg.enabled) return { changed: false }
        sendStepLog('scenes', 'review-start', '씬 분리 검수 시작', opId)
        const reviewed = await reviewScenesCandidate(scriptMd, scenesJson.scenes || [], state.speakers || [], opts, cfg.rounds, opId, signal)
        if (signal?.aborted) return
        if (reviewed.changed) {
          sendStepLog('scenes', 'review-save', '검수 반영 씬 저장', opId)
          await store.saveText('scenes.json', JSON.stringify({ scenes: reviewed.scenes }, null, 2))
          state.speakers = reviewed.speakers
        }
        sendStepLog('scenes', 'review-complete', reviewed.changed ? '씬 검수 반영 완료' : '씬 검수 변경 없음', opId)
        return { changed: reviewed.changed }
      }

      // 대본 재설계: 편집된 대본으로 씬 분리 — 공백이면 기존 script.md를 보존하고 실패시킨다.
      if (typeof params.scriptOverride === 'string') {
        if (!params.scriptOverride.trim()) throw new Error('빈 대본으로 씬 분리할 수 없습니다')
        sendStepLog('scenes', 'script-save', '편집 대본 저장', opId)
        await store.saveText('script.md', params.scriptOverride)
        const inputOptions = normalizeLlmOptions(params.options || state.input?.options)
        state.input = state.input
          ? { ...state.input, options: inputOptions }
          : { type: 'manual', options: inputOptions }
        // 분리시작이 넘긴 title(자동생성 포함)을 보존 — 재오픈 hydrate가 제목을 복원하려면 필요.
        if (params.title) state.input.title = params.title
      }
      const scriptMd = await store.loadText('script.md')
      if (!scriptMd) throw new Error('script.md not found — run script step first')
      const opts = buildLlmOptions(effectiveOptions(params))
      sendStepLog('scenes', 'split-request', 'LLM 씬 분리 요청', opId)
      const { scenes, speakers } = await llm.splitScenes(scriptMd, opts, { signal })
      if (signal?.aborted) return
      sendStepLog('scenes', 'split-response', `씬 ${scenes?.length || 0}개 응답 수신`, opId, { count: scenes?.length || 0 })
      const prev = JSON.parse((await store.loadText('scenes.json')) || '{"scenes":[]}').scenes
      let nextScenes = normalizeScenes(prev, scenes)
      sendStepLog('scenes', 'normalize', '씬/세그먼트 ID 정리', opId, { count: nextScenes.length })
      let nextSpeakers = mergeSpeakers(ensureReferencedSpeakers(speakers, nextScenes, state.speakers || []))
      sendStepLog('scenes', 'speakers', `화자 ${nextSpeakers.length}명 정리`, opId, { count: nextSpeakers.length })
      const cfg = reviewConfig(opts, 'scenes')
      if (cfg.enabled && !signal?.aborted) {
        sendStepLog('scenes', 'review-start', '씬 분리 검수 시작', opId)
        const reviewed = await reviewScenesCandidate(scriptMd, nextScenes, nextSpeakers, opts, cfg.rounds, opId, signal)
        if (signal?.aborted) return
        nextScenes = reviewed.scenes
        nextSpeakers = reviewed.speakers
        sendStepLog('scenes', 'review-complete', '씬 분리 검수 완료', opId)
      }
      sendStepLog('scenes', 'save', 'scenes.json 저장', opId)
      await store.saveText('scenes.json', JSON.stringify({ scenes: nextScenes }, null, 2))
      state.speakers = nextSpeakers
      sendStepLog('scenes', 'complete', '씬 분리 완료', opId)
    },
    async audio(params, opId, signal) {
      const scenesJson = JSON.parse((await store.loadText('scenes.json')) || 'null')
      if (!scenesJson) throw new Error('scenes.json not found — run scenes step first')
      assertSegmentIdsValid(scenesJson.scenes)
      // 화자 voice 배정 (params.speakers 우선, 없으면 state.speakers)
      const speakers = params.speakers || state.speakers || []
      // C1-a: 화자 매핑 UI(M2a-3) 전에는 미배정 화자를 주입된 기본 voice로 폴백해 audio가 앱에서
      // 돌게 한다. defaultVoice 미주입(정식 흐름)이면 null → 아래 미배정 검증이 그대로 실행 차단(스펙 §6).
      const voiceOf = (spk) => findSpeakerByRef(speakers, spk)?.voice || defaultVoice || null
      // 모든 씬의 세그먼트를 순서대로 평탄화
      const segments = scenesJson.scenes.flatMap((sc) => sc.segments || [])
      const narration = segments.filter((s) => (s.type || 'narration') === 'narration')
      // M2b: sfx 세그먼트(효과음) — narration과 같은 시퀀스 자리를 차지, sfxFor로 생성.
      const sfxSegs = sfxFor ? segments.filter((s) => s.type === 'sfx') : []

      // 0) 사전 검증: 배치 루프를 시작하기 전에 모든 narration 세그먼트의 화자에 voice가
      // 배정돼 있는지 먼저 확인한다 — 루프 중간에 던지면 이미 앞선 세그먼트들의 TTS 비용을
      // 지불한 뒤라 낭비된다(스펙 §6 "미배정 화자 있으면 실행 불가").
      // Codex-3 LOW: voice 객체가 존재해도 voiceId가 없으면(또는 빈 문자열이면) 사전 검증이
      // 통과해 루프 중간에 tts.synthesize(voiceId:undefined)로 낭비된다 — voiceId가
      // non-empty string인지 확인해야 한다.
      const missingSpeakers = [...new Set(narration.map((s) => s.speaker))].filter((spk) => {
        const voice = voiceOf(spk)
        return !voice || typeof voice.voiceId !== 'string' || voice.voiceId === ''
      })
      if (missingSpeakers.length) throw new Error(`voice not assigned for speaker: ${missingSpeakers[0]}`)

      // 1) 세그먼트별 TTS 생성 + 실측 (동시성 제한)
      // IP5-a: 이미 status:'done'이고 오디오 파일이 현 프로젝트에 실재하면 재합성하지 않는다
      // (resume/부분재시도). params.regenerate에 든 id는 강제 재합성(re-TTS 트리거).
      // Codex-M2a-2b MED: audioPath는 절대경로라 프로젝트 이동/복사·파일 삭제 시 stale/타프로젝트를
      // 가리킬 수 있다 — basename을 현 프로젝트 segments 디렉터리 기준으로 재구성 + 실재(stat) 확인.
      const forceRegen = new Set(params.regenerate || [])
      const segmentsDir = path.join(projectPath, 'story', 'audio', 'segments')
      const reusePathOf = (seg) => path.join(segmentsDir, path.basename(seg.audioPath))
      const canReuse = async (seg) => {
        if (forceRegen.has(seg.id) || seg.status !== 'done' || !seg.audioPath || (seg.durationMs || 0) <= 0) return false
        // Codex-TTS HIGH: 화자 voice/provider/emotion이 바뀌면(또는 지문 없는 옛 오디오면) 재사용 금지.
        const intended = voiceOf(seg.speaker)
        if (!intended?.voiceId || seg.voiceKey !== ttsVoiceKey(intended, effectiveEmotion(seg))) return false
        try { return (await stat(reusePathOf(seg))).isFile() } catch { return false }
      }
      // M2b sfx reuse: 지문 sfxKey(source:description:durationHint) 일치 + 파일 실재.
      // source는 UI 오버라이드(params.sfxSources[segId]) > 세그먼트 영속값 > 기본 elevenlabs.
      const sfxSourceOf = (seg) => params.sfxSources?.[seg.id] || seg.sourceMode || 'elevenlabs'
      const sfxKeyOf = (seg) => `${sfxSourceOf(seg)}:${seg.description || ''}:${seg.durationHint ?? 'auto'}`
      const canReuseSfx = async (seg) => {
        if (forceRegen.has(seg.id) || seg.status !== 'done' || !seg.audioPath || (seg.durationMs || 0) <= 0) return false
        if (seg.sfxKey !== sfxKeyOf(seg)) return false
        try { return (await stat(reusePathOf(seg))).isFile() } catch { return false }
      }
      // 동시성: 기본 tts(단일) 또는 첫 세그먼트 화자 어댑터에서. 없으면 2.
      const conc = (tts?.capabilities?.()?.maxConcurrency) || (resolveTts(voiceOf(narration[0]?.speaker)?.provider)?.capabilities?.()?.maxConcurrency) || 2
      const results = new Map()
      const errored = new Set()
      const errorMsgs = new Map() // 세그먼트별 실패 사유(인증/설정 등) — generic retry로 묻지 않기 위함
      const toSynth = []
      for (const seg of narration) {
        if (await canReuse(seg)) results.set(seg.id, { audioPath: reusePathOf(seg), durationMs: seg.durationMs, voiceKey: seg.voiceKey })
        else toSynth.push(seg)
      }
      for (let i = 0; i < toSynth.length; i += conc) {
        const batch = toSynth.slice(i, i + conc)
        await Promise.all(batch.map(async (seg) => {
          const voice = voiceOf(seg.speaker)
          if (!voice) throw new Error(`voice not assigned for speaker: ${seg.speaker}`) // safety net — 사전 검증이 이미 막지만 방어적으로 유지
          // D: 세그먼트별 실시간 진행 — 시작/완료/실패마다 progress emit(목록 실시간 표시용).
          send('story:progress', { kind: 'audio-segment', segId: seg.id, status: 'running' }, opId)
          try {
            const { audio, format } = await resolveTts(voice.provider).synthesize({ text: seg.text, voiceId: voice.voiceId, emotion: effectiveEmotion(seg), signal })
            if (signal?.aborted) return
            const rel = `audio/segments/${seg.id}.${format}`
            await store.saveBinary(rel, audio)
            const durationMs = await probe(path.join(projectPath, 'story', rel))
            // I2: probe 실패(0)면 SRT 0ms·클립 겹침으로 조용히 붕괴 → 실패로 취급(재시도 유도).
            if (durationMs <= 0) { errored.add(seg.id); send('story:progress', { kind: 'audio-segment', segId: seg.id, status: 'error' }, opId); return }
            results.set(seg.id, { audioPath: path.join(projectPath, 'story', rel), durationMs, voiceKey: ttsVoiceKey(voice, effectiveEmotion(seg)) })
            send('story:progress', { kind: 'audio-segment', segId: seg.id, status: 'done' }, opId)
          } catch (e) {
            if (!signal?.aborted) { errored.add(seg.id); errorMsgs.set(seg.id, e?.message || String(e)); send('story:progress', { kind: 'audio-segment', segId: seg.id, status: 'error' }, opId) } // 개별 실패 — 사유 보존(부분재시도)
          }
        }))
        if (signal?.aborted) return
      }
      if (signal?.aborted) return

      // M2b: sfx 세그먼트 생성 — narration과 같은 results/errored를 공유해 measured/timeline에 함께
      // 자리잡는다(sfx도 startMs 실측). sourceMode별 어댑터(sfxFor), 지문 sfxKey로 재사용.
      for (const seg of sfxSegs) {
        if (await canReuseSfx(seg)) results.set(seg.id, { audioPath: reusePathOf(seg), durationMs: seg.durationMs, sfxKey: seg.sfxKey })
      }
      const sfxToSynth = sfxSegs.filter((seg) => !results.has(seg.id))
      for (let i = 0; i < sfxToSynth.length; i += conc) {
        const batch = sfxToSynth.slice(i, i + conc)
        await Promise.all(batch.map(async (seg) => {
          send('story:progress', { kind: 'audio-segment', segId: seg.id, status: 'running' }, opId)
          try {
            const source = sfxSourceOf(seg)
            const { audio, format } = await sfxFor(source).generate({ description: seg.description, durationSeconds: seg.durationHint ?? null, signal })
            if (signal?.aborted) return
            const rel = `audio/segments/${seg.id}.${format}`
            await store.saveBinary(rel, audio)
            const durationMs = await probe(path.join(projectPath, 'story', rel))
            if (durationMs <= 0) { errored.add(seg.id); send('story:progress', { kind: 'audio-segment', segId: seg.id, status: 'error' }, opId); return }
            // sourceMode를 함께 영속 → 다음 실행의 sfxKeyOf(seg)가 오버라이드 없이도 일치(reuse 안정).
            results.set(seg.id, { audioPath: path.join(projectPath, 'story', rel), durationMs, sfxKey: sfxKeyOf(seg), sourceMode: source })
            send('story:progress', { kind: 'audio-segment', segId: seg.id, status: 'done' }, opId)
          } catch (e) {
            if (!signal?.aborted) { errored.add(seg.id); errorMsgs.set(seg.id, e?.message || String(e)); send('story:progress', { kind: 'audio-segment', segId: seg.id, status: 'error' }, opId) }
          }
        }))
        if (signal?.aborted) return
      }
      if (signal?.aborted) return

      // Codex-M2a-2b MED/스펙 §5 부분재시도: 일부 세그먼트가 실패해도 M2a-1처럼 전체를 버리지
      // 않는다 — 성공분은 status:'done', 실패분은 status:'error'로 원 씬 구조에 영속(재그룹 없이)한
      // 뒤 실패시킨다. 다음 실행이 done을 재사용하고 error/pending만 재합성한다.
      // 오디오 보유 세그먼트(narration+sfx) 중 하나라도 실패면 부분재시도(성공분 done 영속 후 실패).
      const audioBearing = [...narration, ...sfxSegs]
      const anyFailed = audioBearing.some((seg) => !results.has(seg.id))
      if (anyFailed) {
        const updated = (scenesJson.scenes || []).map((sc) => ({
          ...sc,
          segments: (sc.segments || []).map((g) => {
            const r = results.get(g.id)
            if (r) return { ...g, status: 'done', audioPath: r.audioPath, durationMs: r.durationMs, ...(r.voiceKey != null ? { voiceKey: r.voiceKey } : {}), ...(r.sfxKey != null ? { sfxKey: r.sfxKey } : {}), ...(r.sourceMode != null ? { sourceMode: r.sourceMode } : {}) }
            if (errored.has(g.id)) return { ...g, status: 'error' }
            return g
          }),
        }))
        if (!signal?.aborted) await store.saveText('scenes.json', JSON.stringify({ scenes: updated }, null, 2))
        const firstFail = audioBearing.find((seg) => !results.has(seg.id))
        // 인증/설정 등 실제 예외 사유가 있으면 보존(예: "No Typecast API key" → UI가 키 설정 안내).
        // probe=0(측정 실패)은 예외가 아니라 사유 없음 → generic retry.
        const detail = errorMsgs.get(firstFail.id)
        throw new Error(detail ? `audio failed for segment ${firstFail.id}: ${detail}` : `audio failed for segment ${firstFail.id} — retry`)
      }

      // 2) 세그먼트에 실측 durationMs·audioPath 병합 (원 순서 보존). IP5-a: narration은 status:'done'
      // 기록(재실행 재사용 기준). sfx 등 results에 없는 세그먼트는 기존 상태 유지.
      const measured = segments.map((s) => {
        const r = results.get(s.id)
        return { ...s, durationMs: r?.durationMs || 0, audioPath: r?.audioPath || null, status: r ? 'done' : s.status, voiceKey: r ? (r.voiceKey ?? s.voiceKey) : s.voiceKey, sfxKey: r ? (r.sfxKey ?? s.sfxKey) : s.sfxKey, sourceMode: r ? (r.sourceMode ?? s.sourceMode) : s.sourceMode }
      })
      // 3) 타임라인(startMs) + 4) SRT
      const timed = buildSegmentTimeline(measured)
      const srt = buildSrt(timed)
      // 5) 재그룹 + 6) storyId 발급 (이전 확정 씬은 scenes.json에 segmentIds 있으면 사용)
      const prevScenes = (scenesJson.scenes || []).filter((s) => s.storyId).map((s) => ({ storyId: s.storyId, segmentIds: (s.segments || []).map((g) => g.id) }))
      const groups = regroupScenes(timed, { minMs: 6000, maxMs: 10000 })
      const withIds = assignStoryIdsByMembership(prevScenes, groups)
      // 7) 확정 씬 재구성 (그룹의 segmentIds로 timed 세그먼트를 묶음)
      // C2: 재그룹 경계는 원래 scenes.json 씬 경계와 다를 수 있어 옛 sceneNo/summary를 그대로
      // 옮길 수 없다 — prompts 스텝(prompts.js/llmClaude.js/llmGemini.js)이 sceneNo로 프롬프트를
      // 병합하므로(byNo.get(s.sceneNo)) 여기서 1-based 순번 sceneNo를 새로 발급하고, summary는
      // 그룹 내 narration 세그먼트 텍스트에서 파생한다(스펙 §7 프롬프트 컨텍스트 제공 취지).
      const byId = new Map(timed.map((s) => [s.id, s]))
      const finalScenes = withIds.map((g, i) => {
        const groupSegments = g.segmentIds.map((id) => byId.get(id))
        const summaryText = groupSegments
          .filter((s) => (s.type || 'narration') === 'narration')
          .map((s) => (s.text || '').trim())
          .filter(Boolean)
          .join(' ')
        const summary = summaryText.length > 200 ? `${summaryText.slice(0, 200)}…` : summaryText
        return {
          storyId: g.storyId,
          sceneNo: i + 1,
          summary,
          startSec: g.startMs / 1000,
          endSec: g.endMs / 1000,
          segments: groupSegments,
          // 프롬프트는 audio 단계에서 건드리지 않음 (M2a-2/prompts 소유)
        }
      })
      if (signal?.aborted) return
      if (params.speakers) state.speakers = params.speakers

      // IP5-b/c(스펙 §4 재TTS 정책): prompts가 이미 있었고(=re-TTS) 재그룹 멤버십이 불변이면
      // audio가 push를 소유해 timing-only로 갱신하고 프롬프트를 보존한다. 멤버십이 변했거나 최초
      // 정밀 실행이면 audio는 push하지 않는다(전자=no-push 대기 전이[prompts는 wrapper가 pending으로
      // 리셋], 후자=prompts가 첫 push 소유). 멤버십 = 확정 씬 storyId 집합(= 세그먼트 id 집합에서 파생).
      const hadPrompts = (scenesJson.scenes || []).some((s) => s.imagePrompt)
      const prevStoryIds = new Set(prevScenes.map((s) => s.storyId))
      const newStoryIds = new Set(finalScenes.map((s) => s.storyId))
      const membershipUnchanged = prevStoryIds.size === newStoryIds.size && [...newStoryIds].every((id) => prevStoryIds.has(id))
      const timingOnly = hadPrompts && membershipUnchanged

      // 최초 정밀/멤버십 변화: manifestRevision null (export 차단 → prompts 재실행이 소유/재스탬프).
      // timing-only: audio가 다음 revision 소유. Codex-M2a-2b HIGH: state(pendingPushRevision/prompts)
      // 변경은 write 커밋이 모두 성공한 뒤로 미룬다 — 커밋 사이 abort 시 abort()가 변경된 state를
      // flush하고 maybeResendPush가 커밋 안 된 revision을 재발신하는 것을 막는다. nextRevision은 로컬.
      let manifestRevision = null
      let scenesToSave = finalScenes
      let nextRevision = null
      if (timingOnly) {
        // 프롬프트/이미지 보존: 확정 씬에 이전 프롬프트를 storyId로 병합(빈값으로 덮어써 renderer가
        // 프롬프트를 날리는 것 방지 — 멤버십 불변이라 모든 씬이 이전 프롬프트를 가짐).
        const prevByStory = new Map((scenesJson.scenes || []).map((s) => [s.storyId, s]))
        scenesToSave = finalScenes.map((s) => {
          const p = prevByStory.get(s.storyId)
          return { ...s, imagePrompt: p?.imagePrompt, videoPrompt: p?.videoPrompt }
        })
        nextRevision = state.pendingPushRevision + 1
        manifestRevision = nextRevision
      }

      // 8) 산출 저장: 세그먼트 파일은 이미 저장됨 → SRT → manifest → scenes.json 순서 원자 쓰기.
      // I1/스펙 §5: manifest가 scenes.json보다 먼저 확정돼야 스텝 중간 크래시가 "새 씬 +
      // 옛 manifest" 조합(export가 씬-오디오 불일치를 감지 못하는 상태)을 남기지 않는다.
      // Codex-2 MED: abort는 이 세 커밋 사이 어디서든 도착할 수 있다 — 시퀀스 진입 전 한 번만
      // 체크하면 그 뒤 커밋들이 그대로 진행돼 "abort 이후 쓰기"가 남는다. 각 커밋 직전에 재체크한다
      // (첫 커밋 직전 체크는 위 line의 signal?.aborted 가드가 이미 겸함).
      await store.saveText('audio/final.srt', srt)
      if (signal?.aborted) return
      const manifest = buildManifest(timed, { pushRevision: manifestRevision })
      await store.saveText('audio/manifest.json', JSON.stringify(manifest, null, 2))
      if (signal?.aborted) return
      await store.saveText('scenes.json', JSON.stringify({ scenes: scenesToSave }, null, 2))
      if (signal?.aborted) return
      // 커밋 성공 + 미-abort 확인 후에만 state 변경(중간 await 없이) → push emit.
      if (timingOnly) {
        state.pendingPushRevision = nextRevision
        state.steps.prompts = { status: 'done' } // wrapper DOWNSTREAM 리셋 복원 — 프롬프트 유효(재실행 강제 안 함)
        return { pushScenes: scenesToSave } // wrapper가 flush 후 sendPush — 프롬프트 보존 + 새 timing/srt
      }
    },
    async prompts(params, opId, signal) {
      const scenesJson = JSON.parse((await store.loadText('scenes.json')) || 'null')
      if (!scenesJson) throw new Error('scenes.json not found — run scenes step first')
      const scriptMd = await store.loadText('script.md')
      const opts = buildLlmOptions(effectiveOptions(params))
      const context = { scriptMd, style: params.style || null, speakers: characterSpeakers() }
      if (params.reviewOnly) {
        const cfg = reviewConfig(opts, 'prompts')
        if (!cfg.enabled) return { changed: false }
        const reviewed = await reviewPromptsCandidate(scenesJson.scenes || [], context, opts, cfg.rounds, opId, signal)
        if (signal?.aborted) return
        if (!reviewed.changed) return { changed: false }
        await store.saveText('scenes.json', JSON.stringify({ scenes: reviewed.scenes }, null, 2))
        state.pendingPushRevision += 1
        await restampManifestRevision(signal)
        return { changed: true, pushScenes: reviewed.scenes }
      }

      // V2: 프롬프트 컨텍스트엔 캐릭터(non-narrator·appearance 보유)만 전달 — narrator 외형 누수 방지(Codex-Low).
      let { scenes } = await llm.writePrompts(scenesJson.scenes, context, opts, { signal })
      const cfg = reviewConfig(opts, 'prompts')
      if (cfg.enabled && !signal?.aborted) {
        const reviewed = await reviewPromptsCandidate(scenes, context, opts, cfg.rounds, opId, signal)
        if (signal?.aborted) return
        scenes = reviewed.scenes
      }
      if (signal?.aborted) return
      await store.saveText('scenes.json', JSON.stringify({ scenes }, null, 2))
      state.pendingPushRevision += 1
      // IP3/스펙 §7 revision 소유: 최초 정밀 실행의 push는 prompts가 소유한다 — audio가 null로 둔
      // manifest.pushRevision을 이 revision으로 재스탬프해야 export 정합 검사
      // (manifest.pushRevision === lastPushedRevision)가 ack 후 성립한다. 대략 모드(manifest 없음)면 skip.
      // Codex Medium/스펙 §5: 재스탬프도 하나의 커밋 — abort가 이 사이에 도착하면 push는 wrapper
      // isStale로 막히므로 manifest도 스탬프하지 않아 "manifest만 앞선" 불일치를 만들지 않는다.
      await restampManifestRevision(signal)
      // HIGH/Codex: push emit은 여기서 하지 않는다 — flush(story.json 저장) 전에 크래시하면
      // 재발신 조건(pendingPushRevision > lastPushedRevision)이 디스크에 없어 복구 불가.
      // start() 래퍼가 status=done 설정 + flush 완료 후에 pushScenes를 emit한다.
      return { pushScenes: scenes }
    },
  }

  return {
    projectToken,
    async open() {
      state = await store.load()
      await healReferencedSpeakers()
      await maybeResendPush()
      maybeSendCharacters()
      const scenes = await loadScenesForPayload()
      const scriptText = (await store.loadText('script.md')) || ''
      send('story:state', { state, scenes, scriptText })
      return { projectToken, state, scenes, scriptText }
    },
    // M2a-4 IP-A2: export(renderer)가 story 나레이션 배치에 쓸 { manifest, lastPushedRevision }.
    // renderer 엔 둘 다 없어 main 이 실어 준다. 정합 판단(pushRevision 일치)은 renderer 몫 — 여기선
    // raw 값만. manifest 없으면(audio 미실행) null → 오디오 없이 export.
    // 요청된 projectPath(기본=자기) 의 디스크를 직접 읽는다. machine 이 다른 프로젝트로 열려
    // 있어도 요청 경로 것만 반환하므로 교차 주입/누락이 없다(Codex finding 1). 실제 읽기는
    // 모듈 함수 readAudioPackage 에 위임 — IPC 가 machine 없이도(fresh session) 부를 수 있게.
    async loadAudioPackage(requestedProjectPath = null) {
      return readAudioPackage(requestedProjectPath || projectPath)
    },
    async getState() {
      if (!state) state = await store.load()
      await healReferencedSpeakers()
      await maybeResendPush()
      maybeSendCharacters()
      const scenes = await loadScenesForPayload()
      const scriptText = (await store.loadText('script.md')) || ''
      // 기존 top-level 필드(steps/speakers/...)는 그대로 접근 가능하도록 spread — story.json에는
      // scenes를 쓰지 않으므로(flush 시 이 반환값이 아니라 내부 state 변수를 저장) 안전하다.
      return { ...state, scenes, scriptText }
    },
    // 슬라이스1(세그먼트 단건 테스트): 지정 세그먼트만 합성·저장하고 스텝 상태·push·regroup은
    // 건드리지 않는다. 배치(start('audio'))와 분리된 미리듣기/테스트 경로. 저장 오디오는 배치가 재사용.
    async synthPreview({ segmentIds = [], speakers, sfxSources } = {}) {
      // Codex-TTS HIGH2: preview는 스텝 밖 mutation이라 배치/다른 preview와 경쟁하면 scenes.json을
      // 옛 스냅샷으로 덮어쓸 수 있다 — 진행 중 스텝/preview가 있으면 거부하고, 커밋 직전 최신
      // scenes.json에 세그먼트 단위로 병합한다.
      if (previewing || (state && Object.values(state.steps || {}).some((s) => s.status === 'running'))) return { busy: true }
      previewing = true
      try {
        const scenesJson = JSON.parse((await store.loadText('scenes.json')) || 'null')
        if (!scenesJson) throw new Error('scenes.json not found — run scenes step first')
        assertSegmentIdsValid(scenesJson.scenes) // Codex-TTS MED4: 파일명에 seg.id 사용 → path traversal 방어
        const ids = new Set(segmentIds)
        const spks = speakers || state?.speakers || []
        const voiceOf = (spk) => findSpeakerByRef(spks, spk)?.voice || defaultVoice || null
        const allTargets = scenesJson.scenes.flatMap((sc) => sc.segments || []).filter((s) => ids.has(s.id))
        const targets = allTargets.filter((s) => (s.type || 'narration') === 'narration')
        // M2b: sfx 세그먼트도 단건 테스트(배치 audio와 동일 계약 — sfxFor로 생성, sfxKey/sourceMode 영속).
        const sfxTargets = sfxFor ? allTargets.filter((s) => s.type === 'sfx') : []
        const results = new Map()
        for (const seg of targets) {
          const voice = voiceOf(seg.speaker)
          if (!voice || typeof voice.voiceId !== 'string' || !voice.voiceId) throw new Error(`voice not assigned for speaker: ${seg.speaker}`)
          const { audio, format } = await resolveTts(voice.provider).synthesize({ text: seg.text, voiceId: voice.voiceId, emotion: effectiveEmotion(seg) })
          const rel = `audio/segments/${seg.id}.${format}`
          await store.saveBinary(rel, audio)
          const durationMs = await probe(path.join(projectPath, 'story', rel))
          if (durationMs <= 0) throw new Error(`audio measurement failed for segment ${seg.id}`)
          results.set(seg.id, { audioPath: path.join(projectPath, 'story', rel), durationMs, voiceKey: ttsVoiceKey(voice, effectiveEmotion(seg)) })
        }
        for (const seg of sfxTargets) {
          // 배치 audio 스텝과 동일한 소스 해석/지문(reuse가 배치와 호환되도록).
          const source = sfxSources?.[seg.id] || seg.sourceMode || 'elevenlabs'
          const sfxKey = `${source}:${seg.description || ''}:${seg.durationHint ?? 'auto'}`
          const { audio, format } = await sfxFor(source).generate({ description: seg.description, durationSeconds: seg.durationHint ?? null })
          const rel = `audio/segments/${seg.id}.${format}`
          await store.saveBinary(rel, audio)
          const durationMs = await probe(path.join(projectPath, 'story', rel))
          if (durationMs <= 0) throw new Error(`audio measurement failed for segment ${seg.id}`)
          results.set(seg.id, { audioPath: path.join(projectPath, 'story', rel), durationMs, sfxKey, sourceMode: source })
        }
        // 커밋 직전 최신 scenes.json 재로드 후 세그먼트 단위 병합(동시 변경 클로버 방지, 재그룹 없음).
        const latest = JSON.parse((await store.loadText('scenes.json')) || 'null') || scenesJson
        const updated = latest.scenes.map((sc) => ({
          ...sc,
          segments: (sc.segments || []).map((g) => {
            const r = results.get(g.id)
            if (!r) return g
            return {
              ...g, status: 'done', audioPath: r.audioPath, durationMs: r.durationMs,
              ...(r.voiceKey != null ? { voiceKey: r.voiceKey } : {}),
              ...(r.sfxKey != null ? { sfxKey: r.sfxKey } : {}),
              ...(r.sourceMode != null ? { sourceMode: r.sourceMode } : {}),
            }
          }),
        }))
        await store.saveText('scenes.json', JSON.stringify({ scenes: updated }, null, 2))
        if (!state) state = await store.load()
        send('story:state', { state, scenes: updated, scriptText: (await store.loadText('script.md')) || '' })
        return { ok: true, segments: [...results.entries()].map(([id, r]) => ({ id, ...r })) }
      } finally {
        previewing = false
      }
    },
    async generateTitle(scriptMd, options = {}) {
      const opts = buildLlmOptions({ ...(state?.input?.options || {}), ...(options || {}) })
      return llm.generateTitle(scriptMd, opts, {})
    },
    async start(step, params = {}) {
      if (!steps[step]) throw new Error(`unknown step: ${step}`)
      // HIGH: 어떤 스텝이든 running이면 새 start()는 실행하지 않는다 — 동시 실행이 같은
      // story.json/scenes.json에 경쟁적으로 쓰는 것을 막는다. abort()는 running을 동기적으로
      // error로 마킹하므로, abort 후에는 이 가드에 걸리지 않고 정상 재시작할 수 있다.
      if (previewing || Object.values(state.steps).some((s) => s.status === 'running')) return { error: 'busy' }
      const operationId = randomUUID()
      const myController = new AbortController()
      controller = myController
      const deferDownstreamReset = params.reviewOnly === true
      // 하류 리셋 — revision은 스펙대로 단조 증가 유지(빈 push 재발신은 maybeResendPush의 prompts-done 가드가 차단)
      if (!deferDownstreamReset) {
        for (const d of DOWNSTREAM[step]) state.steps[d] = { status: 'pending' }
      }
      state.steps[step] = { status: 'running', updatedAt: new Date().toISOString() }
      await flush(); send('story:state', { state }, operationId)
      let pushScenes = null
      // HIGH: abort()는 controller를 교체하지 않고(같은 controller에 abort 신호만 보냄) running
      // 스텝을 동기적으로 error 마킹한다. 스텝 fn이 signal을 무시하고 뒤늦게 resolve/reject하면
      // `controller === myController`만으로는 늦은 결과가 통과해 abort의 error 마킹을 done/다른
      // error로 덮어쓴다 — signal.aborted를 함께 검사해 abort의 동기 마킹을 정본으로 지킨다.
      const isStale = () => controller !== myController || myController.signal.aborted
      try {
        const result = await steps[step](params, operationId, myController.signal)
        if (!isStale()) {
          if (deferDownstreamReset && result?.changed) {
            for (const d of DOWNSTREAM[step]) state.steps[d] = { status: 'pending' }
          }
          state.steps[step] = { status: 'done', updatedAt: new Date().toISOString() }
          pushScenes = result?.pushScenes || null
        }
      } catch (e) {
        if (!isStale()) {
          state.steps[step] = { status: 'error', error: String(e.message || e), updatedAt: new Date().toISOString() }
        }
      }
      if (!isStale()) {
        // flush(store.save) 완료 후에만 pushScenes를 emit — 재발신 조건이 디스크에 먼저 반영되게.
        await flush()
        if (step === 'scenes' && state.steps[step]?.status === 'done') sendCharacters(operationId)
        if (pushScenes) sendPush(pushScenes, operationId)
        send('story:state', { state, scenes: await loadScenesForPayload(), scriptText: (await store.loadText('script.md')) || '' }, operationId)
      }
      return { operationId }
    },
    async abort() {
      controller?.abort()
      // 중단 시점에 running인 스텝은 동기적으로 terminal 마킹 — 이후 다른 스텝 시작으로
      // controller가 교체돼도 running 잔류가 없도록. stale settle의 상태 쓰기는 캡처 가드가 차단.
      for (const [name, s] of Object.entries(state?.steps || {})) {
        if (s.status === 'running') {
          state.steps[name] = { status: 'error', error: 'aborted', updatedAt: new Date().toISOString() }
        }
      }
      if (state) {
        await flush()
        // 상태 변화(running → error)를 renderer에 통지 — 없으면 isRunning이 true로 갇혀
        // 중단 버튼이 사라지지 않고 "생성 중"이 유지된다(작업 자체는 controller.abort로 멈춤).
        send('story:state', { state })
      }
    },
    async ackPush({ pushRevision, ok, reason }) {
      if (ok) {
        // MED: renderer가 잘못되거나 지연된 ack를 보낼 수 있다 — 정수이면서 이미 확인된
        // revision보다 크고, 아직 발신조차 안 된(pendingPushRevision 초과) future revision은
        // 아님이 확인될 때만 성공 처리한다. 그 외에는 조용히 무시(상태 변경 없음).
        const valid = Number.isInteger(pushRevision) &&
          pushRevision > state.lastPushedRevision &&
          pushRevision <= state.pendingPushRevision
        if (!valid) return
        state.lastPushedRevision = pushRevision
        state.pushedAt = new Date().toISOString()
        state.lastPushError = null
        await flush()
      } else {
        // revision 조건은 그대로라 open()/getState()의 maybeResendPush가 재발신한다
        state.lastPushError = { pushRevision, reason, at: new Date().toISOString() }
        await flush()
      }
    },
  }
}
