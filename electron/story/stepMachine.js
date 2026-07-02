/**
 * Story 스텝 머신 — 스펙 §2/§3/§4. main process 소유, 결정적 순서 제어.
 * LLM 어댑터는 DI(테스트 mock). emit은 모든 payload에 projectToken/operationId 포함.
 */
import { randomUUID } from 'node:crypto'
import { createStoryStore } from './storyStore.js'
import { inheritStoryIds, assertUniqueStoryIds } from './sceneIdentity.js'
import { buildFallbackTimeline } from './timing.js'

const DOWNSTREAM = { script: ['scenes', 'prompts'], scenes: ['prompts'], prompts: [] }

export function createStepMachine({ projectPath, llm, emit, getApiKey }) {
  const store = createStoryStore(projectPath)
  const projectToken = randomUUID()
  let state = null
  let controller = null

  const send = (ch, payload, operationId) =>
    emit(ch, { projectToken, operationId: operationId || randomUUID(), ...payload })

  async function flush() { await store.save(state) }

  function mapScene(s, timing) {
    return {
      storyId: s.storyId,
      sceneNo: s.sceneNo,
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

  async function maybeResendPush(operationId) {
    if (state.steps.prompts.status === 'done' && state.pendingPushRevision > state.lastPushedRevision) {
      const scenesJson = JSON.parse((await store.loadText('scenes.json')) || '{"scenes":[]}')
      sendPush(scenesJson.scenes, operationId)
    }
  }

  const steps = {
    async script(params, opId, signal) {
      state.input = params.input ? { ...params.input, options: params.options } : state.input
      const opts = { apiKey: getApiKey(), model: state.engine.model || 'gemini-2.5-pro', ...(params.options || {}) }
      const { scriptMd } = await llm.generateScript(state.input, opts, {
        onDelta: (text) => send('story:delta', { text }, opId), signal,
      })
      await store.saveText('script.md', scriptMd)
    },
    async scenes(params, opId, signal) {
      const scriptMd = await store.loadText('script.md')
      if (!scriptMd) throw new Error('script.md not found — run script step first')
      const opts = { apiKey: getApiKey(), model: state.engine.model || 'gemini-2.5-pro', ...(state.input?.options || {}) }
      const { scenes, speakers } = await llm.splitScenes(scriptMd, opts, { signal })
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
      const opts = { apiKey: getApiKey(), model: state.engine.model || 'gemini-2.5-pro', ...(state.input?.options || {}) }
      const { scenes } = await llm.writePrompts(scenesJson.scenes, { scriptMd, style: params.style || null }, opts, { signal })
      await store.saveText('scenes.json', JSON.stringify({ scenes }, null, 2))
      state.pendingPushRevision += 1
      sendPush(scenes, opId)
    },
  }

  return {
    projectToken,
    async open() {
      state = await store.load()
      await maybeResendPush()
      send('story:state', { state })
      return { projectToken, state }
    },
    async getState() {
      await maybeResendPush()
      return state
    },
    async start(step, params = {}) {
      if (!steps[step]) throw new Error(`unknown step: ${step}`)
      const operationId = randomUUID()
      const myController = new AbortController()
      controller = myController
      // 하류 리셋 — revision은 스펙대로 단조 증가 유지(빈 push 재발신은 maybeResendPush의 prompts-done 가드가 차단)
      for (const d of DOWNSTREAM[step]) state.steps[d] = { status: 'pending' }
      state.steps[step] = { status: 'running', updatedAt: new Date().toISOString() }
      await flush(); send('story:state', { state }, operationId)
      try {
        await steps[step](params, operationId, myController.signal)
        if (controller === myController) {
          state.steps[step] = { status: 'done', updatedAt: new Date().toISOString() }
        }
      } catch (e) {
        if (controller === myController) {
          state.steps[step] = { status: 'error', error: String(e.message || e), updatedAt: new Date().toISOString() }
        }
      }
      if (controller === myController) {
        await flush(); send('story:state', { state }, operationId)
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
      await flush()
    },
    async ackPush({ pushRevision, ok }) {
      if (ok && pushRevision > state.lastPushedRevision) {
        state.lastPushedRevision = pushRevision
        state.pushedAt = new Date().toISOString()
        await flush()
      }
    },
  }
}
