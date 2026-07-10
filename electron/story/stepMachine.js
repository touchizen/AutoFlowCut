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
import { normalizeStoryCharacter, characterVisualPrompt } from '../../src/services/storyCharacter.js'

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

export function createStepMachine({ projectPath, llm, emit, getApiKey, loadMetaPrompt, tts, ttsFor, probe, defaultVoice = null, sfxFor = null, youtube = null, factCheck = null }) {
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
  // §3.3/§v2.8 M4: generateSynopsis side action 전용 controller — step/preview/synopsis 상호배제 +
  // abort 대칭(machine.abort()가 synopsis도 중단)의 기준.
  let synopsisController = null
  // 리서치 §3.1/§5: research side action 전용 controller — step/preview/synopsis/confirm과
  // 상호배제(MINOR 5), abort 대칭. generateSynopsis 패턴 미러.
  let researchController = null

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
  // §v2.8 B3: 확정 명단(state.speakers)이 base인 superset 병합 — scenes 스텝이 speakers를
  // 전체 교체하지 않는다. ①확정 gender/age/role(및 name/id) 보존, ②LLM 참조 인물 voice 승계,
  // ③씬에서 미참조된 확정 인물도 삭제 금지. rosterEnforced(FIX-1) 상태에선 명단 밖 LLM 신규
  // 인물을 추가하지 않는다(§v2.2 "명단에 없는 새 인물 금지" — narrator 시딩만 예외).
  function mergeSpeakers(nextSpeakers = [], { preferNewAppearance = false } = {}) {
    const enforced = rosterEnforced()
    const nextByKey = new Map()
    for (const sp of nextSpeakers || []) {
      if (sp.id && !nextByKey.has(`id:${speakerKey(sp.id)}`)) nextByKey.set(`id:${speakerKey(sp.id)}`, sp)
      if (sp.name && !nextByKey.has(`name:${speakerKey(sp.name)}`)) nextByKey.set(`name:${speakerKey(sp.name)}`, sp)
    }
    const pickAppearance = (prev, next) => preferNewAppearance
      ? (nonEmptyString(next?.appearance) ?? nonEmptyString(prev?.appearance) ?? next?.appearance ?? prev?.appearance)
      : (nonEmptyString(prev?.appearance) ?? nonEmptyString(next?.appearance) ?? prev?.appearance ?? next?.appearance)
    const matched = new Set()
    const out = (state.speakers || []).map((prev) => {
      const next = (prev.id && nextByKey.get(`id:${speakerKey(prev.id)}`)) ||
        (prev.name && nextByKey.get(`name:${speakerKey(prev.name)}`)) || null
      if (!next) return prev // ③ 미참조 확정 인물 보존 (voice/필드 그대로)
      matched.add(next)
      // FIX-3: rosterEnforced면 확정 id/name/gender/age/role을 그대로 보존하고 LLM 출력에서는
      // appearance 보강만 받는다(§v2.9 id=name.trim() 고정 — React key/voice/roster id 안정).
      if (enforced) {
        return { ...prev, appearance: pickAppearance(prev, next), voice: prev.voice ?? null }
      }
      return {
        ...next, // id/name은 LLM 출력 우선(미확정 기존 rename 동작 유지 — ①은 구조화 필드 한정)
        // ① 확정 구조화 필드(gender/age/role/ethnicity/appearance) 보존 — LLM 출력이 덮어쓰지 못한다
        ...((prev.gender === 'male' || prev.gender === 'female') ? { gender: prev.gender } : {}),
        ...(nonEmptyString(prev.age) ? { age: prev.age } : {}),
        ...(nonEmptyString(prev.role) ? { role: prev.role } : {}),
        ...(nonEmptyString(prev.ethnicity) ? { ethnicity: prev.ethnicity } : {}), // §v2.12

        appearance: pickAppearance(prev, next),
        voice: prev.voice ?? null, // ② voice 승계
      }
    })
    const seen = new Set(out.flatMap(speakerReferenceKeys))
    const allowNew = !enforced // FIX-1: 확정 마커 단독이 아니라 roster 강제 기준
    for (const sp of nextSpeakers || []) {
      if (matched.has(sp)) continue
      const keys = speakerReferenceKeys(sp)
      if (keys.some((k) => seen.has(k))) continue
      if (!allowNew && !keys.includes('narrator')) continue // 확정 명단 밖 신규 금지(narrator 예외)
      out.push({ ...sp, voice: sp.voice ?? null })
      for (const k of keys) seen.add(k)
    }
    return out
  }

  // §v2.8 B2 + FIX-5: rosterEnforced(확정 명단)일 때만 명단 밖 speaker의 *새 speaker 생성*을
  // 폐지(검증화) — 명단 밖 seg.speaker는 scenes 스텝 최종 정규화(rewriteUnknownSegmentSpeakers)가
  // narrator로 재기록해 흡수한다. 미확정/legacy(자유 모드)는 base HEAD처럼 referenced speaker를
  // auto-add해 scenes와 speakers를 일치시킨다(audio voice 조회/voice 매핑 UI/Ref 후보 정합).
  function ensureReferencedSpeakers(nextSpeakers = [], scenes = [], fallbackSpeakers = []) {
    const enforced = rosterEnforced()
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
      else if (!enforced) out.push({ id: String(seg.speaker).trim(), name: String(seg.speaker).trim() }) // FIX-5: 자유 모드 auto-add 복원
      else continue // 확정 명단 밖 — 생성하지 않음(검증화). 최종 정규화가 narrator로 재기록.
      seen.add(key)
    }
    return out
  }

  // §v2.9 MAJOR②: scenes 최종 정규화 — 명단 밖 seg.speaker를 'narrator'로 재기록(fuzzy 금지,
  // findSpeakerByRef의 공백/대소문자 정규화 매칭만) + story:progress warn. scenes.json의 데이터
  // 자체를 고쳐 audio 사전검증(voice not assigned) 하드실패를 막는다.
  function rewriteUnknownSegmentSpeakers(scenes = [], speakers = [], opId) {
    const unknown = new Set()
    const out = (scenes || []).map((s) => ({
      ...s,
      segments: (s.segments || []).map((g) => {
        if ((g.type || 'narration') !== 'narration') return g
        if (findSpeakerByRef(speakers, g.speaker)) return g
        unknown.add(String(g.speaker ?? '').trim())
        return { ...g, speaker: 'narrator' }
      }),
    }))
    if (unknown.size) {
      sendStepLog('scenes', 'speaker-fallback',
        `명단 밖 화자 → narrator 재기록: ${[...unknown].join(', ')}`, opId,
        { level: 'warn', speakers: [...unknown] })
    }
    return { scenes: out, changed: unknown.size > 0 }
  }

  // FIX-1 + FIX-7: roster 강제(신규 speaker 금지 + 명단 밖 seg.speaker → narrator 재기록)의 단일 기준.
  // charactersConfirmed는 phase 판정 마커일 뿐 — 강제는 "확정 + title/pasted 경로"가 성립할 때다.
  // 확정된 빈 명단(나레이션-only)도 강제 대상(FIX-7 — 명단 밖 non-narrator는 narrator로 흡수).
  // legacy(undefined)·미확정(false)·imported/manual은 자유 모드(FIX-5 auto-add 포함, 현행 유지).
  function rosterEnforced() {
    return state?.charactersConfirmed === true
      && ['title', 'pasted'].includes(state?.input?.type)
  }

  // §v2.8 B2/§v2.9 MINOR②: splitScenes/reviseScenes에 주입할 확정 명단(id/name/role).
  // rosterEnforced가 아니면(legacy 포함) null — 현행 프롬프트 무변경(회귀 고정).
  // FIX-7: 확정 빈 명단은 null이 아닌 []를 반환 — buildRosterBlock이 "등장인물 없음, narrator만"을 주입.
  function confirmedRoster() {
    if (!rosterEnforced()) return null
    return characterSpeakers().map((sp) => ({ id: sp.id || sp.name, name: sp.name, role: sp.role || '' }))
  }

  // characters[] → state.speakers 반영(§v2.2/§v2.8 B3/M2): 정규화(normalizeStoryCharacter) +
  // 기존 speaker의 voice 승계(id/name 매칭) + narrator 시딩(기존 narrator는 voice째 보존).
  function speakersFromCharacters(characters = []) {
    const prev = state?.speakers || []
    const out = []
    const seen = new Set()
    for (const raw of characters || []) {
      const c = normalizeStoryCharacter(raw)
      if (!c.id || isNarratorSpeaker(c)) continue
      const key = referencedSpeakerKey(c.id)
      if (seen.has(key)) continue
      seen.add(key)
      const p = findSpeakerByRef(prev, c.id) || findSpeakerByRef(prev, c.name)
      out.push({ ...c, voice: p?.voice ?? null })
    }
    const prevNarrator = (prev || []).find((sp) => isNarratorSpeaker(sp))
    out.push(prevNarrator || { id: 'narrator', name: '나레이션' })
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
        const { verdict, critique, score } = await llm.reviewScript(current, reviewOpts, { signal })
        if (signal?.aborted) return { scriptMd: current, changed }
        // 몰입감 점수는 verdict와 독립 — pass로 끝나는 라운드도 채점 결과를 흘린다.
        if (score != null) sendReviewProgress('script', { round, of: rounds, phase: 'scored', score }, opId)
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
  // storyNarrationTracks.isNarratorSpeaker(별칭 narration/nar/na/나레이션/해설/화자 포함)에 위임 —
  // 로컬에서 'narrator'/'내레이터'만 판정하면 별칭 화자가 캐릭터 후보로 잘못 새어나간다.
  const isNarratorSpeaker = (sp) => {
    const id = String(sp?.id || '').trim()
    const name = String(sp?.name || '').trim()
    return (id !== '' && isNarratorTrackSpeaker(id)) || (name !== '' && isNarratorTrackSpeaker(name))
  }
  // V2: non-narrator speaker를 캐릭터 후보로 취급한다. appearance가 없어도 Ref 탭에 pending
  // 카드가 먼저 생겨야 사용자가 외형/이미지를 보강할 수 있다.
  const characterSpeakers = () => (state.speakers || [])
    .filter((sp) => !isNarratorSpeaker(sp) && (String(sp?.name || '').trim() || String(sp?.id || '').trim()))
    .map((sp) => ({ ...sp, name: sp.name || sp.id, appearance: sp.appearance || '' }))

  // §v2.2/§v2.12: push payload용 구조화 캐릭터 — {name, gender, age, role, ethnicity, appearance}.
  // characterSpeakers 소스. ethnicity는 renderer Ref upsert의 prompt 조합(인종 반영)에 쓰인다.
  const structuredCharacter = (sp) => {
    const c = normalizeStoryCharacter(sp)
    return { name: c.name, gender: c.gender, age: c.age, role: c.role, ethnicity: c.ethnicity, appearance: c.appearance }
  }

  // V2: 그 씬에 등장하는 캐릭터 이름 배열(speaker id→name, 캐릭터만, 유일, 등장순).
  function sceneCharacterNames(s) {
    // @멘션은 레퍼런스 이미지에 바인딩되므로 시각 정보(ethnicity/appearance 중 하나라도)가 있는
    // 캐릭터만 대상으로 한다 — Ref 카드 prompt(characterVisualPrompt)와 동일 기준(§v2.12 FIX MAJOR:
    // ethnicity-only 캐릭터가 카드엔 있는데 멘션에서 빠지는 불일치 방지). 둘 다 빈(Ref 탭 pending)
    // 캐릭터는 characterSpeakers()엔 남아있지만 멘션 대상에서 제외.
    const chars = new Map(
      characterSpeakers()
        .filter((sp) => characterVisualPrompt(sp))
        .map((sp) => [sp.id, sp.name])
    )
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
      // V2/§v2.2: 캐릭터 레퍼런스 카드 등록용 — 확정 speakers 파생 구조화 필드(name/gender/age/role/appearance).
      storyCharacters: characterSpeakers().map(structuredCharacter),
    }
    // 실측 라인이 있을 때만 srtTrack 전송 — renderer가 wholesale 교체(대략 모드는 미전송→기존 유지).
    if (srtTrack.length) payload.srtTrack = srtTrack
    send('story:pushScenes', payload, operationId)
  }

  function sendCharacters(operationId) {
    const storyCharacters = characterSpeakers().map(structuredCharacter)
    if (storyCharacters.length) send('story:pushCharacters', { storyCharacters }, operationId)
  }

  // §v2.8 M1: 게이트를 "characters 확정됨"으로 앞당김 — 확정 시점부터 Ref 카드가 생긴다.
  // legacy(미확정)는 기존 scenes-done 게이트 유지.
  function maybeSendCharacters(operationId) {
    if (state?.charactersConfirmed === true || state?.steps?.scenes?.status === 'done') sendCharacters(operationId)
  }

  // Important: Story 뷰 ②/④ 패널(씬 세그먼트·프롬프트)이 실데이터를 그리려면 scenes.json
  // 내용이 필요하다. story.json에는 저장하지 않는 파생 데이터 — open/getState/스텝 완료 시
  // payload에만 실어 보낸다.
  // 세그먼트가 참조하는 화자(특히 narrator)가 state.speakers에 없으면 오디오 탭 성우 매핑에서
  // 누락된다(voice map은 state.speakers만 렌더). open 시 scenes.json 기준으로 self-heal —
  // 스플릿 당시 누락(LLM이 narrator를 speakers에서 빠뜨림 등)된 stale 프로젝트를 재분리 없이 복구.
  // 진행 상황의 유일한 근거가 state.steps라, 산출물이 사라져도(폴더 정리·부분 복사 등) done이
  // 그대로 남는다. 그러면 computeCurrentStep이 하류로 건너뛰고, audio/prompts가 제일 먼저
  // scenes.json을 열다가 "scenes.json not found"로 터진다 — 원인에서 두 스텝 떨어진 곳에서.
  // open()에서 done 스텝의 산출물을 확인해, 없으면 그 스텝과 하류를 pending으로 되돌린다.
  // 확실히 없을(또는 비어 있을) 때만 true. 읽기가 실패하면(권한·IO 오류) 판단하지 않는다 —
  // 잠깐 못 읽은 산출물을 없다고 보면 done을 pending으로 내려 굳혀서, 원인이 사라져도 진행은 안 돌아온다.
  async function artifactMissing(relPath) {
    try { return !(await store.loadTextStrict(relPath))?.trim() } catch { return false }
  }

  async function healMissingStepArtifacts() {
    if (!state?.steps) return
    const missing = {
      script: await artifactMissing('script.md'),
      scenes: await artifactMissing('scenes.json'),
    }

    let changed = false
    for (const step of ['script', 'scenes']) {
      if (state.steps[step]?.status !== 'done' || !missing[step]) continue
      // 되살린 스텝은 stale error도 함께 버린다 — {status:'pending'}로 통째 교체.
      state.steps[step] = { status: 'pending' }
      for (const d of DOWNSTREAM[step]) state.steps[d] = { status: 'pending' }
      changed = true
    }
    if (changed) await flush()
  }

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

  // ---------- 리서치 영속 (§3.8 M6) ----------
  // machine은 story:open마다 재생성되므로(story-api.js) 진행 중 리서치는 research.draft.json,
  // 확정본은 research.json으로 durable 저장한다. 자막 원문은 research/transcripts/<id>.srt(로컬
  // 참고·검증용 — export 미포함, §4/§7).
  const RESEARCH_DRAFT = 'research.draft.json'
  const RESEARCH_FILE = 'research.json'

  async function loadResearchDraft() {
    const raw = await store.loadText(RESEARCH_DRAFT)
    if (!raw) return {}
    try { return JSON.parse(raw) || {} } catch { return {} }
  }
  async function saveResearchDraft(draft) {
    await store.saveText(RESEARCH_DRAFT, JSON.stringify(draft, null, 2))
  }
  async function loadResearchFinal() {
    const raw = await store.loadText(RESEARCH_FILE)
    if (!raw) return null
    try { return JSON.parse(raw) } catch { return null }
  }

  // hydrate용 research 상태 — 자막 원문(plainText)은 대용량이라 페이로드에서 제외(메타만).
  // 리서치 흔적이 전혀 없으면(legacy/미사용) null — renderer가 현행 흐름을 유지한다(§D14).
  // m6: draftRaw 재파싱 중복 제거 — loadResearchDraft() 단일 경로.
  async function researchHydrate() {
    const draft = await loadResearchDraft()
    const committed = await loadResearchFinal()
    const confirmed = state?.research?.hasResearch === true
    if (!Object.keys(draft).length && !committed && !confirmed) return null
    const transcripts = Object.fromEntries(Object.entries(draft.transcripts || {}).map(([id, t]) => {
      const { plainText, ...meta } = t || {}
      return [id, meta]
    }))
    // m5: 수동 URL 카드(draft.manualVideos)를 검색 결과에 병합 — 재오픈 시 "카드 없는 유령 선택" 방지.
    const searchVideos = draft.videos || []
    const manualVideos = (draft.manualVideos || [])
      .filter((m) => m?.videoId && !searchVideos.some((v) => v.videoId === m.videoId))
    // m7-잔여: 재검색 세션(draft.dirty)이면 committed analysis/verifiedClaims 폴백을 무효화한다 —
    // 새 keyword 위에 옛 committed analysis가 되살아나 불일치 commit되는 것을 막는다.
    const dirty = draft.dirty === true
    return {
      confirmed,
      keyword: draft.keyword || committed?.keyword || '',
      videos: [...searchVideos, ...manualVideos],
      selectedVideoIds: draft.selectedVideoIds || committed?.sources || [],
      transcripts,
      analysis: draft.analysis || (dirty ? null : committed?.analysis) || null,
      verifiedClaims: draft.verifiedClaims || (dirty ? [] : committed?.verifiedClaims) || [],
    }
  }

  async function sendResearchState(operationId) {
    send('story:research-state', { research: await researchHydrate() }, operationId)
  }

  // 리서치 side action 공통 busy 판정 — step/preview/synopsis/research 상호배제(§5).
  function researchBusy() {
    return previewing || synopsisController || researchController ||
      Object.values(state?.steps || {}).some((s) => s.status === 'running')
  }

  // §3.3 + §v2.10: hydrate payload — renderer가 synopsis phase/게이트 복원을 판단할 재료.
  // characters는 state.speakers 단일 저장에서 파생(m3). charactersConfirmed는 3-state 그대로
  // 노출(undefined=legacy) — phase 판정 로직은 renderer(S5) 소관.
  async function hydrateExtras() {
    const synopsisText = (await store.loadText('synopsis.md')) || ''
    return {
      synopsisText,
      hasSynopsis: !!synopsisText.trim(),
      characters: characterSpeakers().map((sp) => normalizeStoryCharacter(sp)),
      charactersConfirmed: state?.charactersConfirmed,
      // 리서치 §3.8: 재오픈 복원용 research 상태(검색결과·선택·자막 메타·분석·팩트체크·confirmed).
      research: await researchHydrate(),
    }
  }

  // FIX-1: (§v2.10 legacy migrate 폐기) legacy(charactersConfirmed=undefined)는 undefined
  // 그대로 둔다 — true를 durable 기록하면 rosterEnforced가 legacy를 roster 강제로 오해석해
  // scenes 재실행 시 LLM speaker를 narrator로 뭉갠다(회귀). "undefined + script done → editor"
  // phase 판정은 renderer(StoryView hydrate ④분기)가 직접 수행한다.

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
        // §v2.11: 신규 pasted는 등장인물 미확정 마커를 durable로 남긴다 — script done이 되어도
        // 재오픈 시 역추출 게이트(synopsis phase)가 유지된다. undefined(legacy)와 구분되는 false.
        state.charactersConfirmed = false
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
      // §3.3 (Codex #5/R2 #4): synopsis 결정 — params.synopsis의 present 여부로 분기.
      // present면 그 값만 신뢰(trim, blank면 폴백 없이 미주입), absent면 effective type이
      // 'title'일 때만 synopsis.md 폴백(pasted/manual/continue에 stale 누출 금지).
      let synopsis
      if ('synopsis' in params) {
        const eff = typeof params.synopsis === 'string' ? params.synopsis.trim() : ''
        if (eff) {
          await store.saveText('synopsis.md', eff)
          synopsis = eff
        }
      } else if ((params.input?.type ?? state.input?.type) === 'title') {
        synopsis = ((await store.loadText('synopsis.md')) || '').trim() || undefined
      }
      // §v2.8 M3: 확정 등장인물 명단(state.speakers 파생)을 대본 프롬프트에 주입 —
      // 대본 첫 소비자부터 이름 어긋남 차단. 미확정(legacy)은 현행 그대로.
      const characters = state.charactersConfirmed === true
        ? characterSpeakers().map((sp) => normalizeStoryCharacter(sp))
        : []
      const opts = buildLlmOptions(inputOptions, {
        metaPrompt,
        ...(synopsis ? { synopsis } : {}),
        ...(characters.length ? { characters } : {}),
      })
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
        const roster = confirmedRoster()
        const opts = buildLlmOptions(effectiveOptions(params), roster ? { roster } : {})
        const cfg = reviewConfig(opts, 'scenes')
        if (!cfg.enabled) return { changed: false }
        sendStepLog('scenes', 'review-start', '씬 분리 검수 시작', opId)
        const reviewed = await reviewScenesCandidate(scriptMd, scenesJson.scenes || [], state.speakers || [], opts, cfg.rounds, opId, signal)
        if (signal?.aborted) return
        // §v2.9 MAJOR② + FIX-1: 최종 정규화(명단 밖 → narrator)는 rosterEnforced일 때만 —
        // legacy(미확정)는 자유 speaker를 유지한다(재기록 없음).
        let reviewedSpeakers = reviewed.speakers
        let reviewedScenes = reviewed.scenes
        let rewriteChanged = false
        if (rosterEnforced()) {
          const rewritten = rewriteUnknownSegmentSpeakers(reviewedScenes, reviewedSpeakers, opId)
          reviewedScenes = rewritten.scenes
          rewriteChanged = rewritten.changed
          if (rewritten.changed) reviewedSpeakers = ensureReferencedSpeakers(reviewedSpeakers, reviewedScenes, state.speakers || [])
        }
        const changed = reviewed.changed || rewriteChanged
        if (changed) {
          sendStepLog('scenes', 'review-save', '검수 반영 씬 저장', opId)
          await store.saveText('scenes.json', JSON.stringify({ scenes: reviewedScenes }, null, 2))
          state.speakers = reviewedSpeakers
        }
        sendStepLog('scenes', 'review-complete', changed ? '씬 검수 반영 완료' : '씬 검수 변경 없음', opId)
        return { changed }
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
      // §v2.8 B2: 확정 명단을 분리/검토 프롬프트에 주입 — 배정을 명단에 묶는다(새 인물 생성 금지).
      const roster = confirmedRoster()
      const opts = buildLlmOptions(effectiveOptions(params), roster ? { roster } : {})
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
      // §v2.9 MAJOR② + FIX-1: 최종 정규화(검토루프 이후, 저장/sendPush 전) — 명단 밖
      // seg.speaker의 narrator 재기록은 rosterEnforced(확정 명단)일 때만. legacy(미확정)는
      // 자유 speaker 유지. 재기록이 있었으면 narrator 시딩을 재보장한다(§v2.8 B2 예외 유지).
      if (rosterEnforced()) {
        const rewritten = rewriteUnknownSegmentSpeakers(nextScenes, nextSpeakers, opId)
        nextScenes = rewritten.scenes
        if (rewritten.changed) nextSpeakers = ensureReferencedSpeakers(nextSpeakers, nextScenes, state.speakers || [])
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
      await healMissingStepArtifacts()
      await healReferencedSpeakers()
      await maybeResendPush()
      maybeSendCharacters()
      const scenes = await loadScenesForPayload()
      const scriptText = (await store.loadText('script.md')) || ''
      const extras = await hydrateExtras()
      send('story:state', { state, scenes, scriptText, ...extras })
      return { projectToken, state, scenes, scriptText, ...extras }
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
      return { ...state, scenes, scriptText, ...(await hydrateExtras()) }
    },
    // 슬라이스1(세그먼트 단건 테스트): 지정 세그먼트만 합성·저장하고 스텝 상태·push·regroup은
    // 건드리지 않는다. 배치(start('audio'))와 분리된 미리듣기/테스트 경로. 저장 오디오는 배치가 재사용.
    async synthPreview({ segmentIds = [], speakers, sfxSources } = {}) {
      // Codex-TTS HIGH2: preview는 스텝 밖 mutation이라 배치/다른 preview와 경쟁하면 scenes.json을
      // 옛 스냅샷으로 덮어쓸 수 있다 — 진행 중 스텝/preview가 있으면 거부하고, 커밋 직전 최신
      // scenes.json에 세그먼트 단위로 병합한다.
      if (previewing || synopsisController || researchController || (state && Object.values(state.steps || {}).some((s) => s.status === 'running'))) return { busy: true }
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
    // 시놉시스 검수 side action (spec 2026-07-10) — generateSynopsis 미러.
    // 시놉시스는 실행 스텝이 아닌 게이트라 reviewOnly 스텝 경로를 못 쓴다. steps.* 불변.
    // draft-only: 결과를 renderer에 돌려줄 뿐 디스크에 쓰지 않는다(확정은 confirmSynopsis 담당).
    async reviewSynopsis(params = {}) {
      if (!state) state = await store.load()
      if (previewing || synopsisController || researchController || Object.values(state.steps || {}).some((s) => s.status === 'running')) {
        return { error: 'busy' }
      }
      const operationId = randomUUID()
      const myController = new AbortController()
      synopsisController = myController
      try {
        // started 신호가 renderer의 synopsisActiveOpRef를 세팅한다 — 이게 없으면 이어지는
        // review progress가 step 기반 op 필터에 전부 버려진다.
        send('story:synopsis-delta', { phase: 'started', text: '' }, operationId)
        const opts = buildLlmOptions(effectiveOptions(params))
        const cfg = reviewConfig(opts, 'synopsis')
        if (!cfg.enabled) return { changed: false }
        // reviewConfig는 Math.max(0, ...)만 한다 — 상한은 renderer의 clampReviewRounds뿐이라
        // IPC 직접 호출로 우회된다. 여기서 다시 5로 막는다.
        const rounds = Math.min(5, cfg.rounds)
        const reviewOpts = reviewLlmOptions(opts)
        let synopsisMd = typeof params.synopsisMd === 'string' && params.synopsisMd.trim()
          ? params.synopsisMd
          : ((await store.loadText('synopsis.md')) || '')
        if (!synopsisMd.trim()) throw new Error('synopsis not found — generate a synopsis first')
        let characters = Array.isArray(params.characters) ? params.characters : []
        let changed = false
        for (let round = 1; round <= rounds; round++) {
          sendReviewProgress('synopsis', { round, of: rounds, phase: 'reviewing' }, operationId)
          const { verdict, critique, score } = await llm.reviewSynopsis(synopsisMd, characters, reviewOpts, { signal: myController.signal })
          if (myController.signal.aborted) throw new Error('aborted')
          // 몰입감 점수는 verdict와 독립 — pass로 끝나는 라운드도 채점 결과를 흘린다.
          if (score != null) sendReviewProgress('synopsis', { round, of: rounds, phase: 'scored', score }, operationId)
          if (verdict !== 'revise' || !critique?.trim()) break
          sendReviewProgress('synopsis', { round, of: rounds, phase: 'revising' }, operationId)
          const r = await llm.reviseSynopsis(synopsisMd, characters, critique, reviewOpts, { signal: myController.signal })
          if (myController.signal.aborted) throw new Error('aborted')
          if (!r?.synopsisMd?.trim()) throw new Error('reviseSynopsis returned empty synopsis')
          // 본문이 동일해도 characters만 바뀔 수 있다 — 텍스트 비교로 정의하지 않는다.
          changed = true
          synopsisMd = r.synopsisMd
          // charactersParsed=false는 "캐스트를 읽지 못했다"(마커 누락/JSON 깨짐)이지 "캐스트가
          // 없다"가 아니다. 그 []를 채택하면 기존 등장인물이 사라지고, 그대로 확정하면
          // speakersFromCharacters([])가 roster를 narrator만 남긴다. 명시적 빈 배열(파싱 성공)은
          // 정당한 결과이므로 그대로 반영한다.
          if (r.charactersParsed !== false) characters = r.characters || []
        }
        return { synopsisMd, characters, changed }
      } catch (e) {
        // 취소 판정은 컨트롤러 상태로 한다 — 메시지에 'abort'가 든 진짜 SDK 에러
        // (예: "Claude SDK failed: request aborted")를 취소로 오인해 조용히 삼키면 안 된다.
        if (myController.signal.aborted) return { aborted: true }
        const msg = String(e?.message || e)
        sendReviewProgress('synopsis', { phase: 'error', error: msg }, operationId)
        throw e
      } finally {
        if (synopsisController === myController) synopsisController = null
      }
    },
    // §3.3 + §v2.8 M4 + §v2.11: 시놉시스 생성 side action — 실행 스텝이 아니다(step status 불변).
    // 전용 operationId 라이프사이클: delta 전에 started 신호를 같은 채널(story:synopsis-delta)로
    // 단일 계약 송신 → renderer가 synopsisActiveOpRef를 세팅한다. busy/abort는 step/preview와 대칭.
    async generateSynopsis(params = {}) {
      if (!state) state = await store.load()
      if (previewing || synopsisController || researchController || Object.values(state.steps || {}).some((s) => s.status === 'running')) {
        return { error: 'busy' }
      }
      const type = params.type === 'pasted' ? 'pasted' : 'title'
      const operationId = randomUUID()
      const myController = new AbortController()
      synopsisController = myController
      try {
        send('story:synopsis-delta', { phase: 'started', text: '' }, operationId)
        const inputOptions = normalizeLlmOptions(params.options)
        if (type === 'title') {
          // §v2.11: title 경로 진입 시점에 미확정 마커를 durable 기록 — undefined(legacy)와 구분.
          state.charactersConfirmed = false
          await flush()
        }
        // 옵션 빌드는 script 스텝 미러 — metaPrompt는 wave:'script' 재사용(Codex R2 #3, 신규 wave 없음).
        const language = inputOptions.language || state.input?.options?.language || 'ko'
        const metaPrompt = loadMetaPrompt
          ? await loadMetaPrompt({ genre: inputOptions.genre, wave: 'script', language })
          : ''
        // 리서치 §3.8 (M2/Q5 수동): params.useResearch === true일 때만 research.json 로드·주입.
        // falsy면 research.json이 있어도 미주입 — 시놉시스 게이트의 토글이 유일한 스위치.
        // `research` 키는 normalize denylist(STORY_LLM_RUNTIME_CONTROL_KEYS)에 없어 통과한다.
        const research = params.useResearch === true ? await loadResearchFinal() : null
        const opts = buildLlmOptions(inputOptions, { metaPrompt, ...(research ? { research } : {}) })
        const input = type === 'pasted'
          ? { type: 'pasted', pastedScript: params.pastedScript } // B1: state.input은 script 분기가 이미 저장 — 덮어쓰지 않음
          : { type: 'title', title: params.title }
        const { synopsisMd, characters, charactersParsed } = await llm.generateSynopsis(input, opts, {
          onDelta: (text) => send('story:synopsis-delta', { text }, operationId),
          signal: myController.signal,
        })
        if (myController.signal.aborted) return { aborted: true }
        // charactersParsed=false → 캐스트를 읽지 못했다(마커 누락/JSON 깨짐). 재생성에서 그 []를
        // 채택하면 사용자가 편집해둔 등장인물 카드와 speakers가 통째로 날아간다.
        const castReadable = charactersParsed !== false
        // title·pasted 모두 뽑은 시놉시스를 durable 저장 — pasted도 대본에서 역추출한 시놉시스를
        // 리뷰용으로 보여준다(재오픈 hasSynopsis 복원). 게이트 후 script 전 종료에도 유실 방지(Codex #2).
        await store.saveText('synopsis.md', synopsisMd || '')
        if (type === 'title') {
          state.input = { type: 'title', title: params.title, options: inputOptions }
        }
        // characters는 state.speakers 단일 저장(m3 — characters.json 없음). 재오픈 hydrate가
        // 여기서 파생하고, 기존 voice 배정은 승계된다. step status는 안 건드림.
        if (castReadable) state.speakers = speakersFromCharacters(characters)
        await flush()
        // 렌더러 state 미러 동기화 — generateSynopsis 는 state.input(type)·charactersConfirmed 를
        // 바꾸므로 story:state 를 보낸다. 없으면 재오픈 전 세션에서 설정 탭으로 돌아갔을 때
        // synopsisEnabled 판정이 stale(input.type=undefined)이라 시놉시스 탭이 비활성됐다.
        send('story:state', {
          state,
          scenes: await loadScenesForPayload(),
          scriptText: (await store.loadText('script.md')) || '',
          ...(await hydrateExtras()),
        }, operationId)
        // 못 읽었으면 characters를 빼고 돌려준다 — 이 반환값이 권위 있는 캐스트로 쓰이지 않게
        // (runGenerateSynopsis의 Array.isArray 가드). 다만 카드가 편집 상태 그대로 남지는
        // 않는다: 위 story:state가 durable speakers에서 파생한 캐스트를 실어 보내므로 카드는
        // '마지막 저장본'으로 되돌아간다. 성공한 재생성이 카드를 새 캐스트로 갈아끼우는 것과
        // 같은 semantics이고, 수정 전처럼 통째로 비워지는 것보다 낫다.
        return castReadable ? { synopsisMd, characters } : { synopsisMd }
      } catch (e) {
        // 취소 판정은 컨트롤러 상태로. 메시지에 'abort'가 든 진짜 SDK 실패
        // ("Claude SDK failed: request aborted")를 취소로 오인해 삼키면 안 된다 —
        // 취소는 resolve, 실패는 reject로 갈라서 renderer가 문자열 매칭에 기대지 않게 한다.
        if (myController.signal.aborted) return { aborted: true }
        throw e
      } finally {
        if (synopsisController === myController) synopsisController = null
      }
    },
    // §v2.8 M1 + §v2.9(title·pasted 공통 커밋 채널) + §v2.10(동시성 가드): 시놉시스 확정.
    // characters→state.speakers 반영(정규화 + narrator 시딩 + voice 보존) + charactersConfirmed=true
    // + flush + story:pushCharacters emit(Ref 카드 생성 시점을 확정으로 앞당김). script는 건드리지
    // 않는다 — title 경로의 재생성은 renderer가 confirm 완료 후 start('script')를 순차 호출(§v2.10).
    async confirmSynopsis({ synopsisMd, characters = [] } = {}) {
      if (!state) state = await store.load()
      if (previewing || synopsisController || researchController || Object.values(state.steps || {}).some((s) => s.status === 'running')) {
        return { error: 'busy' }
      }
      const operationId = randomUUID()
      state.speakers = speakersFromCharacters(characters)
      state.charactersConfirmed = true
      if (typeof synopsisMd === 'string' && synopsisMd.trim()) await store.saveText('synopsis.md', synopsisMd)
      await flush()
      sendCharacters(operationId)
      // 렌더러 state 미러 동기화 — charactersConfirmed=true 를 반영해야 미확정 게이트가 풀려 대본
      // 탭/화면 라우팅이 editor 로 간다(안 그러면 확정 후에도 synopsis 로 되돌아가 "반응 없음").
      send('story:state', {
        state,
        scenes: await loadScenesForPayload(),
        scriptText: (await store.loadText('script.md')) || '',
        ...(await hydrateExtras()),
      }, operationId)
      return { ok: true, operationId }
    },
    // ---------- 리서치 side actions (spec §3.1/§3.8/§5) ----------
    // generateSynopsis 미러: 실행 스텝이 아니다(step status 불변). 전용 researchController로
    // step/preview/synopsis/confirm과 상호배제(§5), abort 대칭. 백엔드(yt-dlp)·factCheck는
    // DI(youtube/factCheck deps — N4 seam, 라우터 우회). 각 단계 산출은 research.draft.json에
    // durable 저장해 재오픈(machine 재생성) 시 유실을 막는다(M6).
    async researchSearch({ keyword, maxResults = 10, dateFilter } = {}) {
      if (!state) state = await store.load()
      if (researchBusy()) return { error: 'busy' }
      const operationId = randomUUID()
      const myController = new AbortController()
      researchController = myController
      try {
        // 개선2: dateFilter(none|week|month)는 지정 시에만 실어 기존 계약을 유지한다.
        const r = await youtube.searchVideos({ query: keyword, maxResults, ...(dateFilter ? { dateFilter } : {}) })
        if (r?.error) return { error: r.error }
        if (myController.signal.aborted) return { error: 'aborted' }
        const draft = await loadResearchDraft()
        draft.keyword = keyword
        draft.videos = r.videos || []
        // m7: 새 검색은 이전 분석/팩트체크/선택과 짝이 안 맞는다 — 함께 클리어해
        // "새 keyword + 옛 analysis" commit으로 research.json이 불일치하는 것을 막는다.
        // (transcripts는 videoId 키라 새 결과에 같은 영상이 있으면 재사용 가능 — 유지.)
        draft.selectedVideoIds = []
        delete draft.analysis
        delete draft.verifiedClaims
        // m7-잔여(R2): 이미 commit된 프로젝트가 재검색하면 draft.analysis는 지웠지만 hydrate가
        // committed.analysis로 폴백해 옛 analysis가 되살아난다 — dirty 마커로 "재검색 세션"임을
        // 표시해 hydrate가 committed analysis/verifiedClaims 폴백을 무효화하게 한다(재분석 전까지 null 유지).
        draft.dirty = true
        await saveResearchDraft(draft)
        await sendResearchState(operationId)
        // R2 MINOR: 일자필터 상세조회 실패로 flat 폴백했으면 UI 안내용 플래그를 전달(비영속 — 검색 반환에만).
        return { videos: draft.videos, ...(r.dateFilterFallback ? { dateFilterFallback: true } : {}) }
      } finally {
        if (researchController === myController) researchController = null
      }
    },
    // 상세 모달(2026-07-08): 영상 카드 더블클릭 시 단일 영상 상세 조회. 파이프라인 상태 불변
    // (mutex/draft 미사용) — 온디맨드 읽기 전용이라 진행 중 검색/분석과 무관하게 항상 응답한다.
    async researchVideoDetails({ videoId } = {}) {
      if (!youtube?.getVideoDetails) return { error: 'unsupported' }
      return youtube.getVideoDetails({ videoId })
    },
    // §3.1: videoId별 순차 fetch(YAGNI — 병렬 다중 프로세스 비목표) + videoId별 progress emit.
    // 각 videoId 완료 즉시 draft durable 저장(§3.8 — 부분 진행도 재오픈 복원). 개별 실패는
    // 나머지 진행(부분 성공 허용, §6). 자막 원문 srt는 research/transcripts/<id>.srt 로컬 저장.
    async researchFetchTranscripts({ videoIds = [], options } = {}) {
      if (!state) state = await store.load()
      if (researchBusy()) return { error: 'busy' }
      const operationId = randomUUID()
      const myController = new AbortController()
      researchController = myController
      try {
        const draft = await loadResearchDraft()
        draft.selectedVideoIds = [...videoIds]
        draft.transcripts = draft.transcripts || {}
        // M4(R1): 프로젝트 언어를 자막 1순위로 — 안 주면 ko 고정이라 en 프로젝트에서 ko 자막이
        // 잡혀 "언어 자막 없음" 거짓 배지 + 분석이 다른 언어 자막으로 진행된다. ko/en 폴백을 뒤에 붙인다.
        const language = options?.language || state?.input?.options?.language || 'ko'
        const langs = [...new Set([language, 'ko', 'en'])]
        const out = []
        for (const videoId of videoIds) {
          if (myController.signal.aborted) break
          // srt 파일명에 videoId를 그대로 쓴다 — segment id와 동일한 traversal 방어(Codex-2 패턴).
          if (!SAFE_SEGMENT_ID.test(String(videoId || ''))) {
            draft.transcripts[videoId] = { ok: false, error: 'invalid-video-id' }
            out.push({ videoId, ok: false, error: 'invalid-video-id' })
            send('story:progress', { kind: 'research-fetch', videoId, status: 'error', error: 'invalid-video-id' }, operationId)
            await saveResearchDraft(draft)
            continue
          }
          send('story:progress', { kind: 'research-fetch', videoId, status: 'running' }, operationId)
          let t
          try { t = await youtube.fetchTranscript(videoId, { langs }) } catch (e) {
            t = { videoId, ok: false, error: String(e?.message || e) }
          }
          if (myController.signal.aborted) {
            // m3: in-flight videoId가 running 배지로 잔류하지 않게 abort 시 error(aborted)로
            // terminal 마킹 — 결과는 무시(§6)하고 draft에도 기록하지 않는다(재시도 가능).
            send('story:progress', { kind: 'research-fetch', videoId, status: 'error', error: 'aborted' }, operationId)
            break
          }
          if (t?.ok) {
            draft.transcripts[videoId] = { ok: true, lang: t.lang, isAuto: t.isAuto, plainText: t.plainText || '' }
            await store.saveText(`research/transcripts/${videoId}.srt`, t.srt || '')
            send('story:progress', { kind: 'research-fetch', videoId, status: 'done', lang: t.lang, isAuto: t.isAuto }, operationId)
            out.push({ videoId, ok: true, lang: t.lang, isAuto: t.isAuto })
          } else {
            const error = t?.error || 'fetch-failed'
            draft.transcripts[videoId] = { ok: false, error }
            send('story:progress', { kind: 'research-fetch', videoId, status: 'error', error }, operationId)
            out.push({ videoId, ok: false, error })
          }
          // §3.8 M6: videoId 단위 즉시 durable — 중간 크래시/재오픈에도 취득분 유실 방지.
          await saveResearchDraft(draft)
        }
        await sendResearchState(operationId)
        // M2(R1): abort로 중단되면 aborted:true를 실어 [한꺼번에 분석] 오케스트레이션이 다음
        // 단계를 멈출 수 있게 한다(수동 흐름의 부분성공 배열 반환은 그대로 유지).
        return { transcripts: out, ...(myController.signal.aborted ? { aborted: true } : {}) }
      } finally {
        if (researchController === myController) researchController = null
      }
    },
    // §3.4: 선택 자막들의 plainText를 라우터(llm.analyzeResearch — 선택 엔진)로 종합 분석.
    async researchAnalyze(params = {}) {
      if (!state) state = await store.load()
      if (researchBusy()) return { error: 'busy' }
      const operationId = randomUUID()
      const myController = new AbortController()
      researchController = myController
      try {
        const draft = await loadResearchDraft()
        const ids = (params.videoIds?.length ? params.videoIds : draft.selectedVideoIds) || []
        const titleOf = new Map((draft.videos || []).map((v) => [v.videoId, v.title || '']))
        const transcripts = ids
          .map((videoId) => ({ videoId, t: draft.transcripts?.[videoId] }))
          .filter(({ t }) => t?.ok && t.plainText)
          .map(({ videoId, t }) => ({ videoId, title: titleOf.get(videoId) || '', plainText: t.plainText }))
        if (!transcripts.length) return { error: 'no-transcripts-selected' }
        const opts = buildLlmOptions(effectiveOptions(params))
        const analysis = await llm.analyzeResearch(transcripts, opts, { signal: myController.signal })
        if (myController.signal.aborted) return { error: 'aborted' }
        draft.analysis = analysis
        await saveResearchDraft(draft)
        await sendResearchState(operationId)
        return { analysis }
      } finally {
        if (researchController === myController) researchController = null
      }
    },
    // §3.5 (M1/N4): 팩트체크 — 라우터 우회, 주입된 factCheck 어댑터(=llmClaude.factCheckClaims,
    // Claude 강제 조합은 어댑터 내부 소관). 사용자 선택 엔진과 무관하게 항상 실행 가능.
    async researchFactCheck(params = {}) {
      if (!state) state = await store.load()
      if (researchBusy()) return { error: 'busy' }
      if (typeof factCheck !== 'function') return { error: 'factcheck-unavailable' }
      const operationId = randomUUID()
      const myController = new AbortController()
      researchController = myController
      try {
        const draft = await loadResearchDraft()
        const claims = draft.analysis?.claims || []
        if (!claims.length) return { error: 'no-claims' }
        const language = params.options?.language || state?.input?.options?.language || 'ko'
        const r = await factCheck(claims, { language }, { signal: myController.signal })
        if (myController.signal.aborted) return { error: 'aborted' }
        const verifiedClaims = r?.claims || []
        draft.verifiedClaims = verifiedClaims
        await saveResearchDraft(draft)
        await sendResearchState(operationId)
        return { verifiedClaims }
      } finally {
        if (researchController === myController) researchController = null
      }
    },
    // §3.8: 확정 — research.json(구조 + supported 사실만 §3.5 + 출처 videoId §7) 저장 +
    // state.research 마커 durable(charactersConfirmed 패턴 미러 — storyStore.load 통과).
    // 자동 주입은 하지 않는다(M2) — 시놉시스 토글(useResearch)이 유일 스위치.
    // m4: commit도 researchController 뮤텍스를 설정하고(저장 중 다른 액션 진입 차단),
    // §6 "abort 중 커밋" — signal.aborted 검사 후에만 research.json을 저장한다.
    async researchCommit({ analysis, verifiedClaims, adoptedIndices } = {}) {
      if (!state) state = await store.load()
      if (researchBusy()) return { error: 'busy' }
      const operationId = randomUUID()
      const myController = new AbortController()
      researchController = myController
      try {
        const draft = await loadResearchDraft()
        const finalAnalysis = analysis ?? draft.analysis ?? null
        if (!finalAnalysis) return { error: 'no-analysis' }
        if (myController.signal.aborted) return { error: 'aborted' }
        const all = verifiedClaims ?? draft.verifiedClaims ?? []
        // 개선4(2026-07-08) + m3(R1): adoptedIndices(채택 체크박스의 인덱스 목록)가 배열로 오면
        // 그 인덱스 항목만 저장 — 미검증/반박도 채택 가능, 해제한 supported 제외. 인덱스 기반이라
        // 동일 claim 문자열이 중복돼도 정확히 그 항목만 채택된다. 미전달이면 supported만(§3.5) 유지.
        const research = {
          committedAt: new Date().toISOString(),
          keyword: draft.keyword || '',
          sources: draft.selectedVideoIds || [],
          analysis: finalAnalysis,
          // 팩트체크 미실행 commit 허용(§6) — 그 경우 [].
          verifiedClaims: Array.isArray(adoptedIndices)
            ? all.filter((_, i) => adoptedIndices.includes(i))
            : all.filter((c) => c?.verdict === 'supported'),
        }
        await store.saveText(RESEARCH_FILE, JSON.stringify(research, null, 2))
        state.research = { hasResearch: true }
        await flush()
        await sendResearchState(operationId)
        return { ok: true, operationId }
      } finally {
        if (researchController === myController) researchController = null
      }
    },
    // §3.8: 건너뛰기 — draft/research.json/자막 원문 정리 + state.research 클리어.
    // m4: commit과 대칭 — researchController 설정 + abort 중이면 정리하지 않는다.
    async researchSkip() {
      if (!state) state = await store.load()
      if (researchBusy()) return { error: 'busy' }
      const operationId = randomUUID()
      const myController = new AbortController()
      researchController = myController
      try {
        await Promise.resolve() // abort()가 같은 tick에 오면 아래 가드가 잡도록 양보
        if (myController.signal.aborted) return { error: 'aborted' }
        await store.remove(RESEARCH_DRAFT)
        await store.remove(RESEARCH_FILE)
        await store.remove('research') // transcripts 디렉토리
        delete state.research
        await flush()
        await sendResearchState(operationId)
        return { ok: true, operationId }
      } finally {
        if (researchController === myController) researchController = null
      }
    },
    // m5: 수동 URL 카드·fetch 전 선택 영속 — 탭전환/재오픈(machine 재생성) 시 소실과
    // "카드 없는 유령 선택"을 막는다. hydrate가 manualVideos를 videos에 병합 복원(§3.8).
    // m5-잔여(R2): researchController를 동기 설정해 fetch 등 다른 write와 상호배제하고,
    // 저장은 store.updateText로 write 큐 안에서 최신 draft를 재읽어 selectedVideoIds/manualVideos
    // 두 필드만 부분 병합한다 — concurrent write의 transcripts/analysis를 stale 스냅샷으로 덮지 않게.
    async researchSelect({ selectedVideoIds, manualVideos } = {}) {
      if (!state) state = await store.load()
      if (researchBusy()) return { error: 'busy' }
      const operationId = randomUUID()
      const myController = new AbortController()
      researchController = myController
      try {
        await store.updateText(RESEARCH_DRAFT, (raw) => {
          let draft = {}
          try { draft = raw ? (JSON.parse(raw) || {}) : {} } catch { draft = {} }
          if (Array.isArray(selectedVideoIds)) draft.selectedVideoIds = [...selectedVideoIds]
          if (Array.isArray(manualVideos)) draft.manualVideos = manualVideos
          return JSON.stringify(draft, null, 2)
        })
        await sendResearchState(operationId)
        return { ok: true, operationId }
      } finally {
        if (researchController === myController) researchController = null
      }
    },
    async start(step, params = {}) {
      if (!steps[step]) throw new Error(`unknown step: ${step}`)
      // HIGH: 어떤 스텝이든 running이면 새 start()는 실행하지 않는다 — 동시 실행이 같은
      // story.json/scenes.json에 경쟁적으로 쓰는 것을 막는다. abort()는 running을 동기적으로
      // error로 마킹하므로, abort 후에는 이 가드에 걸리지 않고 정상 재시작할 수 있다.
      // §3.3(Codex R2 #2): synopsis side action 진행 중에도 busy — step/preview/synopsis 상호배제.
      // 리서치 §5: research side action 진행 중에도 busy(상호배제 대칭).
      if (previewing || synopsisController || researchController || Object.values(state.steps).some((s) => s.status === 'running')) return { error: 'busy' }
      // FIX-2: 미확정 게이트 — 신규(title/pasted) 프로젝트(charactersConfirmed===false)는 synopsis
      // 확정 전까지 하류(scenes/audio/prompts)를 거부한다(§v2.8 B1/§v2.11 게이트 우회 차단).
      // script(붙여넣기 저장/제목 생성)는 게이트 전 단계라 허용. legacy(undefined)는 미적용(FIX-1).
      if (step !== 'script'
        && ['title', 'pasted'].includes(state?.input?.type)
        && state.charactersConfirmed === false) return { error: 'unconfirmed' }
      // FIX-6: pasted 미확정은 script *재생성*(이어쓰기/다시쓰기/검토)도 게이트 대상 — §v2.8 B1:
      // 확정 전 붙여넣은 script는 건드리지 않는다. 재붙여넣기(pastedScript)는 게이트 전 저장이라 허용.
      // title 미확정의 최초 script 생성은 기존대로 허용(FIX-2 — script 스텝은 게이트 전 단계).
      if (step === 'script'
        && state?.input?.type === 'pasted'
        && state.charactersConfirmed === false
        && !params.pastedScript) return { error: 'unconfirmed' }
      const operationId = randomUUID()
      const myController = new AbortController()
      controller = myController
      const deferDownstreamReset = params.reviewOnly === true
      // 하류 리셋 — revision은 스펙대로 단조 증가 유지(빈 push 재발신은 maybeResendPush의 prompts-done 가드가 차단)
      if (!deferDownstreamReset) {
        for (const d of DOWNSTREAM[step]) state.steps[d] = { status: 'pending' }
      }
      // reviewOnly 마커 — renderer가 "지금 도는 게 검수인지 생성인지"를 알아야 패널을 다르게
      // 그린다(검수는 델타가 없어 스트림 뷰가 빈 상자가 된다). reviewProgress로 유추하면 첫
      // progress 이벤트 전까지 한 프레임 어긋나므로 status와 같은 story:state에 함께 싣는다.
      // done/error 마킹은 객체를 통째 교체하므로 마커가 남지 않는다.
      state.steps[step] = {
        status: 'running',
        updatedAt: new Date().toISOString(),
        ...(params.reviewOnly === true ? { reviewOnly: true } : {}),
      }
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
        send('story:state', { state, scenes: await loadScenesForPayload(), scriptText: (await store.loadText('script.md')) || '', ...(await hydrateExtras()) }, operationId)
      }
      return { operationId }
    },
    async abort() {
      controller?.abort()
      // §3.3: synopsis side action도 대칭 중단 — 프로젝트 전환/open cleanup 경로 공용.
      synopsisController?.abort()
      // 리서치 §5: research side action도 대칭 중단(진행 중 fetch/analyze 등).
      researchController?.abort()
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
