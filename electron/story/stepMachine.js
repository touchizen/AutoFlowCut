/**
 * Story 스텝 머신 — 스펙 §2/§3/§4. main process 소유, 결정적 순서 제어.
 * LLM 어댑터는 DI(테스트 mock). emit은 모든 payload에 projectToken/operationId 포함.
 */
import { randomUUID } from 'node:crypto'
import path from 'node:path'
import { createStoryStore } from './storyStore.js'
import { inheritStoryIds, assertUniqueStoryIds, assignStoryIdsByMembership, inheritSegmentIds } from './sceneIdentity.js'
import { buildFallbackTimeline, buildSegmentTimeline, buildSrt, srtLineId } from './timing.js'
import { regroupScenes } from './regroup.js'
import { buildManifest } from './manifest.js'

const DOWNSTREAM = { script: ['scenes', 'audio', 'prompts'], scenes: ['audio', 'prompts'], audio: ['prompts'], prompts: [] }

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
  const narration = (scenes || []).flatMap((sc) => sc.segments || []).filter((s) => (s.type || 'narration') === 'narration')
  const seen = new Set()
  for (const seg of narration) {
    if (!seg.id || seen.has(seg.id)) throw new Error('segment id missing or duplicate — rerun scenes step')
    if (!SAFE_SEGMENT_ID.test(seg.id)) throw new Error(`unsafe segment id (must match ${SAFE_SEGMENT_ID}): ${seg.id}`)
    seen.add(seg.id)
  }
}

export function createStepMachine({ projectPath, llm, emit, getApiKey, loadMetaPrompt, tts, probe, defaultVoice = null }) {
  const store = createStoryStore(projectPath)
  const projectToken = randomUUID()
  let state = null
  let controller = null

  const send = (ch, payload, operationId) =>
    emit(ch, { projectToken, operationId: operationId || randomUUID(), ...payload })

  async function flush() { await store.save(state) }

  function mapScene(s, timing) {
    // 스펙 §4-④: project.json 씬 확장 필드는 storyId/stalePrompt/stalePromptAt/staleVideo/
    // staleVideoAt 5개로 제한 — sceneNo(scenes.json 전용 표시용 순번)는 push payload에 넣지 않는다.
    const measured = typeof s.startSec === 'number' && typeof s.endSec === 'number'
    return {
      storyId: s.storyId,
      prompt: s.imagePrompt || '',
      videoT2VPrompt: s.videoPrompt || '',
      // IP1: audio 실측(finalScenes startSec/endSec)이 있으면 timing의 유일 소스. 없으면(대략 모드)
      // buildFallbackTimeline 글자수 추정으로 폴백(스펙 §3 대략 모드 / §7 흐름A).
      startTime: measured ? s.startSec : timing.startTime,
      endTime: measured ? s.endSec : timing.endTime,
      duration: measured ? s.endSec - s.startSec : timing.duration,
      // IP2: 실측이면 그룹 내 narration 세그먼트 라인 id(sub_<segId>, 순서 보존), 아니면 폴백은 오디오 없음.
      srtLineIds: measured ? narrationLineIds(s) : [],
      subtitle: (s.segments || []).map((g) => g.text).join(' '),
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
    }
    // 실측 라인이 있을 때만 srtTrack 전송 — renderer가 wholesale 교체(대략 모드는 미전송→기존 유지).
    if (srtTrack.length) payload.srtTrack = srtTrack
    send('story:pushScenes', payload, operationId)
  }

  // Important: Story 뷰 ②/④ 패널(씬 세그먼트·프롬프트)이 실데이터를 그리려면 scenes.json
  // 내용이 필요하다. story.json에는 저장하지 않는 파생 데이터 — open/getState/스텝 완료 시
  // payload에만 실어 보낸다.
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
      // 대본 재설계: 이어쓰기 — 편집 중 대본을 받아 LLM이 이어서 완성한 전체 대본을 저장한다.
      if (params.continue) {
        const opts = { apiKey: getApiKey(), model: state.engine.model, ...(params.options || {}) }
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
        state.input = { type: 'pasted', title: params.input?.title, options: params.options }
        // HIGH: abort 직후 파일 쓰기 자체를 막는 방어 가드 — start() 래퍼의 결과 처리 가드와
        // 별개로, 취소된 스텝이 디스크에 흔적을 남기지 않도록 saveText 직전에 한 번 더 확인한다.
        if (signal?.aborted) return
        await store.saveText('script.md', params.pastedScript)
        return
      }
      state.input = params.input ? { ...params.input, options: params.options } : state.input
      const language = params.options?.language || state.input?.options?.language || 'ko'
      const metaPrompt = loadMetaPrompt
        ? await loadMetaPrompt({ genre: params.options?.genre, wave: 'script', language })
        : ''
      const opts = { apiKey: getApiKey(), model: state.engine.model, metaPrompt, ...(params.options || {}) }
      const { scriptMd } = await llm.generateScript(state.input, opts, {
        onDelta: (text) => send('story:delta', { text }, opId), signal,
      })
      if (signal?.aborted) return
      await store.saveText('script.md', scriptMd)
    },
    async scenes(params, opId, signal) {
      // 대본 재설계: 편집된 대본으로 씬 분리 — 공백이면 기존 script.md를 보존하고 실패시킨다.
      if (typeof params.scriptOverride === 'string') {
        if (!params.scriptOverride.trim()) throw new Error('빈 대본으로 씬 분리할 수 없습니다')
        await store.saveText('script.md', params.scriptOverride)
        state.input = state.input
          ? { ...state.input, options: params.options || state.input.options }
          : { type: 'manual', options: params.options }
        // 분리시작이 넘긴 title(자동생성 포함)을 보존 — 재오픈 hydrate가 제목을 복원하려면 필요.
        if (params.title) state.input.title = params.title
      }
      const scriptMd = await store.loadText('script.md')
      if (!scriptMd) throw new Error('script.md not found — run script step first')
      const opts = { apiKey: getApiKey(), model: state.engine.model, ...(state.input?.options || {}) }
      const { scenes, speakers } = await llm.splitScenes(scriptMd, opts, { signal })
      if (signal?.aborted) return
      const prev = JSON.parse((await store.loadText('scenes.json')) || '{"scenes":[]}').scenes
      const { scenes: withIds } = inheritStoryIds(prev, scenes)
      assertUniqueStoryIds(withIds)
      // IP4: 위치기반 발급 전에 이전 세그먼트 id를 정규화 텍스트 1:1로 승계 — 재실행 identity 안정.
      const { scenes: withInheritedSegs } = inheritSegmentIds(prev, withIds)
      const withSegmentIds = assignSegmentIds(withInheritedSegs)
      await store.saveText('scenes.json', JSON.stringify({ scenes: withSegmentIds }, null, 2))
      // speakers 병합 (스펙 §4-②): 정규화 이름 완전 일치만 voice 승계
      const norm = (n) => (n || '').replace(/\s/g, '')
      const prevSpeakers = new Map(state.speakers.map((sp) => [norm(sp.name), sp]))
      state.speakers = speakers.map((sp) => ({ ...sp, voice: prevSpeakers.get(norm(sp.name))?.voice ?? null }))
    },
    async audio(params, opId, signal) {
      const scenesJson = JSON.parse((await store.loadText('scenes.json')) || 'null')
      if (!scenesJson) throw new Error('scenes.json not found — run scenes step first')
      assertSegmentIdsValid(scenesJson.scenes)
      // 화자 voice 배정 (params.speakers 우선, 없으면 state.speakers)
      const speakers = params.speakers || state.speakers || []
      // C1-a: 화자 매핑 UI(M2a-3) 전에는 미배정 화자를 주입된 기본 voice로 폴백해 audio가 앱에서
      // 돌게 한다. defaultVoice 미주입(정식 흐름)이면 null → 아래 미배정 검증이 그대로 실행 차단(스펙 §6).
      const voiceOf = (spk) => (speakers.find((s) => s.id === spk)?.voice) || defaultVoice || null
      // 모든 씬의 세그먼트를 순서대로 평탄화
      const segments = scenesJson.scenes.flatMap((sc) => sc.segments || [])
      const narration = segments.filter((s) => (s.type || 'narration') === 'narration')

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
      const conc = (tts.capabilities?.()?.maxConcurrency) || 2
      const results = new Map()
      for (let i = 0; i < narration.length; i += conc) {
        const batch = narration.slice(i, i + conc)
        await Promise.all(batch.map(async (seg) => {
          const voice = voiceOf(seg.speaker)
          if (!voice) throw new Error(`voice not assigned for speaker: ${seg.speaker}`) // safety net — 사전 검증이 이미 막지만 방어적으로 유지
          const { audio, format } = await tts.synthesize({ text: seg.text, voiceId: voice.voiceId, emotion: seg.emotion, signal })
          if (signal?.aborted) return
          const rel = `audio/segments/${seg.id}.${format}`
          await store.saveBinary(rel, audio)
          const durationMs = await probe(path.join(projectPath, 'story', rel))
          results.set(seg.id, { audioPath: path.join(projectPath, 'story', rel), durationMs })
        }))
        if (signal?.aborted) return
      }
      if (signal?.aborted) return

      // I2: probe 실패(0)의 안전값을 그대로 받아들이면 SRT 0ms 줄·클립 겹침·manifest.durationMs=0
      // ≠ 실제 wav 길이로 조용히 붕괴한다 — 실제로 합성·저장된 narration 세그먼트인데 실측이
      // 0이면 재시도를 유도하도록 즉시 실패시킨다. (sfx는 이 스텝 범위 밖 — M2a-1엔 없음.)
      for (const seg of narration) {
        if (results.get(seg.id)?.durationMs === 0) {
          throw new Error(`audio measurement failed for segment ${seg.id} — retry`)
        }
      }

      // 2) 세그먼트에 실측 durationMs·audioPath 병합 (원 순서 보존)
      const measured = segments.map((s) => {
        const r = results.get(s.id)
        return { ...s, durationMs: r?.durationMs || 0, audioPath: r?.audioPath || null }
      })
      // 3) 타임라인(startMs) + 4) SRT
      const timed = buildSegmentTimeline(measured, { gapMs: 150 })
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
      // 8) 산출 저장: 세그먼트 파일은 이미 저장됨 → SRT → manifest → scenes.json 순서 원자 쓰기.
      // I1/스펙 §5: manifest가 scenes.json보다 먼저 확정돼야 스텝 중간 크래시가 "새 씬 +
      // 옛 manifest" 조합(export가 씬-오디오 불일치를 감지 못하는 상태)을 남기지 않는다.
      // Codex-2 MED: abort는 이 세 커밋 사이 어디서든 도착할 수 있다 — 시퀀스 진입 전 한 번만
      // 체크하면 그 뒤 커밋들이 그대로 진행돼 "abort 이후 쓰기"가 남는다. 각 커밋 직전에 재체크한다
      // (첫 커밋 직전 체크는 위 line의 signal?.aborted 가드가 이미 겸함).
      await store.saveText('audio/final.srt', srt)
      if (signal?.aborted) return
      const manifest = buildManifest(timed, { pushRevision: null }) // 최초 정밀: null (prompts가 재스탬프)
      await store.saveText('audio/manifest.json', JSON.stringify(manifest, null, 2))
      if (signal?.aborted) return
      await store.saveText('scenes.json', JSON.stringify({ scenes: finalScenes }, null, 2))
    },
    async prompts(params, opId, signal) {
      const scenesJson = JSON.parse((await store.loadText('scenes.json')) || 'null')
      if (!scenesJson) throw new Error('scenes.json not found — run scenes step first')
      const scriptMd = await store.loadText('script.md')
      const opts = { apiKey: getApiKey(), model: state.engine.model, ...(state.input?.options || {}) }
      const { scenes } = await llm.writePrompts(scenesJson.scenes, { scriptMd, style: params.style || null }, opts, { signal })
      if (signal?.aborted) return
      await store.saveText('scenes.json', JSON.stringify({ scenes }, null, 2))
      state.pendingPushRevision += 1
      // IP3/스펙 §7 revision 소유: 최초 정밀 실행의 push는 prompts가 소유한다 — audio가 null로 둔
      // manifest.pushRevision을 이 revision으로 재스탬프해야 export 정합 검사
      // (manifest.pushRevision === lastPushedRevision)가 ack 후 성립한다. 대략 모드(manifest 없음)면 skip.
      // Codex Medium/스펙 §5: 재스탬프도 하나의 커밋 — abort가 이 사이에 도착하면 push는 wrapper
      // isStale로 막히므로 manifest도 스탬프하지 않아 "manifest만 앞선" 불일치를 만들지 않는다.
      if (!signal?.aborted) {
        const manifestRaw = await store.loadText('audio/manifest.json')
        // Codex-2 MED: loadText await 사이에도 abort가 도착할 수 있다 — 커밋(saveText) 직전에
        // 한 번 더 재검사해 abort 이후 스탬프를 막는다(audio 스텝의 각-커밋-전 재검사와 동일).
        if (manifestRaw && !signal?.aborted) {
          const m = JSON.parse(manifestRaw)
          m.pushRevision = state.pendingPushRevision
          await store.saveText('audio/manifest.json', JSON.stringify(m, null, 2))
        }
      }
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
      await maybeResendPush()
      const scenes = await loadScenesForPayload()
      const scriptText = (await store.loadText('script.md')) || ''
      send('story:state', { state, scenes, scriptText })
      return { projectToken, state, scenes, scriptText }
    },
    async getState() {
      if (!state) state = await store.load()
      await maybeResendPush()
      const scenes = await loadScenesForPayload()
      const scriptText = (await store.loadText('script.md')) || ''
      // 기존 top-level 필드(steps/speakers/...)는 그대로 접근 가능하도록 spread — story.json에는
      // scenes를 쓰지 않으므로(flush 시 이 반환값이 아니라 내부 state 변수를 저장) 안전하다.
      return { ...state, scenes, scriptText }
    },
    async generateTitle(scriptMd) {
      const opts = { apiKey: getApiKey(), model: state?.engine?.model, ...(state?.input?.options || {}) }
      return llm.generateTitle(scriptMd, opts, {})
    },
    async start(step, params = {}) {
      if (!steps[step]) throw new Error(`unknown step: ${step}`)
      // HIGH: 어떤 스텝이든 running이면 새 start()는 실행하지 않는다 — 동시 실행이 같은
      // story.json/scenes.json에 경쟁적으로 쓰는 것을 막는다. abort()는 running을 동기적으로
      // error로 마킹하므로, abort 후에는 이 가드에 걸리지 않고 정상 재시작할 수 있다.
      if (Object.values(state.steps).some((s) => s.status === 'running')) return { error: 'busy' }
      const operationId = randomUUID()
      const myController = new AbortController()
      controller = myController
      // 하류 리셋 — revision은 스펙대로 단조 증가 유지(빈 push 재발신은 maybeResendPush의 prompts-done 가드가 차단)
      for (const d of DOWNSTREAM[step]) state.steps[d] = { status: 'pending' }
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
