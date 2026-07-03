/**
 * Story 스텝 머신 — 스펙 §2/§3/§4. main process 소유, 결정적 순서 제어.
 * LLM 어댑터는 DI(테스트 mock). emit은 모든 payload에 projectToken/operationId 포함.
 */
import { randomUUID } from 'node:crypto'
import { createStoryStore } from './storyStore.js'
import { inheritStoryIds, assertUniqueStoryIds } from './sceneIdentity.js'
import { buildFallbackTimeline } from './timing.js'

const DOWNSTREAM = { script: ['scenes', 'prompts'], scenes: ['prompts'], prompts: [] }

export function createStepMachine({ projectPath, llm, emit, getApiKey, loadMetaPrompt }) {
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
    return {
      storyId: s.storyId,
      prompt: s.imagePrompt || '',
      videoT2VPrompt: s.videoPrompt || '',
      startTime: timing.startTime,
      endTime: timing.endTime,
      duration: timing.duration,
      srtLineIds: [],                                  // M1: 오디오 없음 (스펙 §4-④ 폴백)
      subtitle: (s.segments || []).map((g) => g.text).join(' '),
    }
  }

  function sendPush(scenes, operationId) {
    assertUniqueStoryIds(scenes)
    const timeline = buildFallbackTimeline(scenes, state.input?.options?.language || 'ko')
    const byId = new Map(timeline.map((t) => [t.storyId, t]))
    send('story:pushScenes', {
      pushRevision: state.pendingPushRevision,
      scenes: scenes.map((s) => mapScene(s, byId.get(s.storyId))),
    }, operationId)
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
        state.input = { type: 'pasted', options: params.options }
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
      }
      const scriptMd = await store.loadText('script.md')
      if (!scriptMd) throw new Error('script.md not found — run script step first')
      const opts = { apiKey: getApiKey(), model: state.engine.model, ...(state.input?.options || {}) }
      const { scenes, speakers } = await llm.splitScenes(scriptMd, opts, { signal })
      if (signal?.aborted) return
      const prev = JSON.parse((await store.loadText('scenes.json')) || '{"scenes":[]}').scenes
      const { scenes: withIds } = inheritStoryIds(prev, scenes)
      assertUniqueStoryIds(withIds)
      await store.saveText('scenes.json', JSON.stringify({ scenes: withIds }, null, 2))
      // speakers 병합 (스펙 §4-②): 정규화 이름 완전 일치만 voice 승계
      const norm = (n) => (n || '').replace(/\s/g, '')
      const prevSpeakers = new Map(state.speakers.map((sp) => [norm(sp.name), sp]))
      state.speakers = speakers.map((sp) => ({ ...sp, voice: prevSpeakers.get(norm(sp.name))?.voice ?? null }))
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
