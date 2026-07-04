// @vitest-environment node
// C2: audio 스텝이 재구성하는 scenes.json에는 sceneNo/summary가 없었다 — prompts 어댑터
// (llmClaude.js/llmGemini.js writePrompts)는 `byNo.get(s.sceneNo)`로 생성 프롬프트를 병합하므로
// sceneNo가 undefined면 여러 씬이 같은 Map 키로 뭉개져 프롬프트가 null/undefined가 되거나
// claude 어댑터는 계약 검증에서 즉시 throw한다. 이 테스트는 scenes → audio → prompts 전체
// 파이프라인을 실제 계약대로(mock splitScenes가 id 없는 SCENES_SCHEMA 모양 반환, mock
// writePrompts가 sceneNo로 병합) 태워 회귀를 잡는다.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createStepMachine } from '../../../electron/story/stepMachine.js'

describe('audio → prompts 통합 (C2: sceneNo/summary 보존)', () => {
  let dir, machine, llm, emitted

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'sm-audio-prompts-'))
    emitted = []
    llm = {
      generateScript: vi.fn(async () => ({ scriptMd: '# 대본' })),
      // 실제 SCENES_SCHEMA(schemas.js)에는 segment.id가 없다 — mock도 id 없이 반환한다.
      splitScenes: vi.fn(async () => ({
        scenes: [
          { sceneNo: 1, summary: '첫 씬 요약', segments: [
            { speaker: 'narrator', text: '첫 문장입니다.', emotion: 'normal' },
            { speaker: 'narrator', text: '둘째 문장입니다.', emotion: 'normal' },
          ] },
          { sceneNo: 2, summary: '둘째 씬 요약', segments: [
            { speaker: 'narrator', text: '셋째 문장입니다.', emotion: 'normal' },
          ] },
        ],
        speakers: [{ id: 'narrator', name: '나레이션' }],
      })),
      // 실제 llmClaude.js/llmGemini.js writePrompts의 병합 계약을 그대로 재현:
      // out.scenes를 sceneNo로 Map에 넣고, 입력 scenes 각각을 byNo.get(s.sceneNo)로 병합한다.
      writePrompts: vi.fn(async (scenes) => {
        const byNo = new Map(scenes.map((s, i) => [s.sceneNo, { imagePrompt: `IMG-${i}`, videoPrompt: `VID-${i}` }]))
        return {
          scenes: scenes.map((s) => ({
            ...s,
            imagePrompt: byNo.get(s.sceneNo)?.imagePrompt ?? null,
            videoPrompt: byNo.get(s.sceneNo)?.videoPrompt ?? null,
          })),
        }
      }),
    }
    // 세그먼트 3개 모두 7000ms로 실측 → regroupScenes(minMs 6000)가 세그먼트마다 단독 씬으로
    // 마감해 3개 그룹이 만들어진다(원 씬 경계 2개와 다름) — C2가 말하는 "재그룹 경계가 원 씬과
    // 달라서 옛 summary를 그대로 복사할 수 없다"는 상황을 그대로 재현한다.
    const tts = { capabilities: () => ({ maxConcurrency: 2 }), synthesize: async ({ text }) => ({ audio: Buffer.from('AUDIO:' + text), format: 'wav' }) }
    const probe = async () => 7000
    machine = createStepMachine({
      projectPath: dir, llm, tts, probe,
      emit: (ch, payload) => emitted.push({ ch, payload }),
      getApiKey: () => 'k',
    })
    await machine.open()
  })

  it('audio가 재구성한 scenes.json은 유효한 sceneNo를 가져 prompts 병합이 sceneNo별로 정확히 이뤄진다', async () => {
    await machine.start('script', { input: { type: 'title', title: 'T' }, options: { language: 'ko' } })
    await machine.start('scenes', {})
    await machine.start('audio', { speakers: [{ id: 'narrator', voice: { provider: 'typecast', voiceId: 'tc_x' } }] })
    let state = await machine.getState()
    expect(state.steps.audio.status).toBe('done')

    await machine.start('prompts', {})
    state = await machine.getState()
    expect(state.steps.prompts.status).toBe('done')

    // writePrompts에 실제로 넘어간 입력(audio가 재구성한 scenes)의 sceneNo가 정수이고 유일해야
    // 한다 — undefined면 Map 키가 뭉개져 여러 씬이 같은 프롬프트를 공유하거나 null이 된다.
    const calledScenes = llm.writePrompts.mock.calls[0][0]
    const sceneNos = calledScenes.map((s) => s.sceneNo)
    expect(sceneNos.every((n) => Number.isInteger(n))).toBe(true)
    expect(new Set(sceneNos).size).toBe(sceneNos.length)

    expect(state.scenes.length).toBeGreaterThan(0)
    for (const scene of state.scenes) {
      expect(scene.imagePrompt).toBeTruthy()
      expect(scene.videoPrompt).toBeTruthy()
      expect(scene.summary).toBeTruthy()
    }
  })

  // IP1: prompts push payload의 씬 timing은 audio 실측(finalScenes startSec/endSec)에서 와야 한다.
  // 현재 sendPush는 buildFallbackTimeline(글자수 추정)을 쓰므로 짧은 텍스트가 ~1.5s로 나가
  // 실측 7.0s와 어긋난다 — 실측이 push까지 흐르게 하는 게 M2a-2a 1번 과제.
  it('push payload timing이 글자수 추정이 아니라 audio 실측(startSec/endSec)을 반영한다', async () => {
    await machine.start('script', { input: { type: 'title', title: 'T' }, options: { language: 'ko' } })
    await machine.start('scenes', {})
    await machine.start('audio', { speakers: [{ id: 'narrator', voice: { provider: 'typecast', voiceId: 'tc_x' } }] })
    await machine.start('prompts', {})
    const state = await machine.getState()

    const push = emitted.filter((e) => e.ch === 'story:pushScenes').pop()
    expect(push).toBeTruthy()
    const byStory = new Map(state.scenes.map((s) => [s.storyId, s]))
    for (const p of push.payload.scenes) {
      const src = byStory.get(p.storyId)
      expect(src).toBeTruthy()
      // push timing === 실측 finalScenes timing (초)
      expect(p.startTime).toBeCloseTo(src.startSec, 3)
      expect(p.endTime).toBeCloseTo(src.endSec, 3)
      expect(p.duration).toBeCloseTo(src.endSec - src.startSec, 3)
    }
    // 실측 반영 증거: 각 세그먼트 7000ms라 씬 duration이 6초 초과 — 글자수 추정(짧은 문장 ~1.5s)이면 불가능.
    for (const p of push.payload.scenes) {
      expect(p.duration).toBeGreaterThan(6)
    }
  })

  // IP2: audio 실측 push는 세그먼트 SRT 라인(sub_<segId>)을 srtTrack으로 wholesale 전송하고,
  // 각 씬의 srtLineIds가 그 라인들을 참조해야 한다(스펙 §7 흐름A). 현재 mapScene은 srtLineIds:[]
  // 하드코딩 + sendPush가 srtTrack을 아예 안 보낸다.
  it('push payload가 srtLineIds를 채우고 srtTrack(초 단위)을 wholesale 전송한다', async () => {
    await machine.start('script', { input: { type: 'title', title: 'T' }, options: { language: 'ko' } })
    await machine.start('scenes', {})
    await machine.start('audio', { speakers: [{ id: 'narrator', voice: { provider: 'typecast', voiceId: 'tc_x' } }] })
    await machine.start('prompts', {})
    const state = await machine.getState()

    const push = emitted.filter((e) => e.ch === 'story:pushScenes').pop()
    expect(Array.isArray(push.payload.srtTrack)).toBe(true)
    const lineById = new Map(push.payload.srtTrack.map((l) => [l.id, l]))
    const byStory = new Map(state.scenes.map((s) => [s.storyId, s]))

    for (const p of push.payload.scenes) {
      const src = byStory.get(p.storyId)
      const narr = (src.segments || []).filter((g) => (g.type || 'narration') === 'narration')
      // srtLineIds = 그룹 내 narration 세그먼트 라인 id, 순서 보존
      expect(p.srtLineIds).toEqual(narr.map((g) => `sub_${g.id}`))
      for (const g of narr) {
        const line = lineById.get(`sub_${g.id}`)
        expect(line).toBeTruthy()
        expect(line.text).toBe(g.text)
        expect(line.startTime).toBeCloseTo(g.startMs / 1000, 3)
        expect(line.endTime).toBeCloseTo((g.startMs + g.durationMs) / 1000, 3)
      }
    }
    // srtTrack 라인 총수 = 전체 narration 세그먼트 수
    const totalNarr = state.scenes.flatMap((s) => (s.segments || []).filter((g) => (g.type || 'narration') === 'narration')).length
    expect(push.payload.srtTrack.length).toBe(totalNarr)
  })

  // IP3: 최초 정밀 실행에서 audio는 manifest.pushRevision=null로 두고(export 차단), prompts가
  // full push를 소유하며 pendingPushRevision++ 후 그 값으로 manifest를 재스탬프해야 한다(스펙 §7
  // revision 소유 프로토콜). 재스탬프가 없으면 manifest.pushRevision이 영원히 null → export 항상 차단.
  it('prompts가 manifest.pushRevision을 pendingPushRevision으로 재스탬프한다', async () => {
    await machine.start('script', { input: { type: 'title', title: 'T' }, options: { language: 'ko' } })
    await machine.start('scenes', {})
    await machine.start('audio', { speakers: [{ id: 'narrator', voice: { provider: 'typecast', voiceId: 'tc_x' } }] })

    // audio 직후: manifest.pushRevision은 null (prompts가 소유)
    const afterAudio = JSON.parse(await readFile(path.join(dir, 'story/audio/manifest.json'), 'utf8'))
    expect(afterAudio.pushRevision).toBeNull()

    await machine.start('prompts', {})
    const state = await machine.getState()

    const afterPrompts = JSON.parse(await readFile(path.join(dir, 'story/audio/manifest.json'), 'utf8'))
    expect(afterPrompts.pushRevision).toBe(state.pendingPushRevision)
    expect(Number.isInteger(afterPrompts.pushRevision)).toBe(true)
    // push payload의 pushRevision과도 일치해야 export 정합(manifest.pushRevision===lastPushedRevision) 성립
    const push = emitted.filter((e) => e.ch === 'story:pushScenes').pop()
    expect(push.payload.pushRevision).toBe(afterPrompts.pushRevision)
  })

  // Codex Medium: prompts가 abort되면 manifest는 재스탬프되지 않아야 한다(스펙 §5 커밋 전 abort 재검사).
  // manifest만 앞서고 push는 안 나가는 불일치를 막는다 — export 정합 검사가 그래도 차단하므로 안전하되,
  // 재스탬프 자체를 하지 않는 게 정합적. writePrompts를 abort 시점까지 붙잡아 in-flight 취소를 재현.
  it('prompts가 abort되면 manifest.pushRevision을 재스탬프하지 않는다(null 유지)', async () => {
    await machine.start('script', { input: { type: 'title', title: 'T' }, options: { language: 'ko' } })
    await machine.start('scenes', {})
    await machine.start('audio', { speakers: [{ id: 'narrator', voice: { provider: 'typecast', voiceId: 'tc_x' } }] })

    // 결정론적: writePrompts 안에서 abort를 호출해 스텝 진행 중 signal이 확실히 aborted되게 한다
    // (deferred+외부 abort 타이밍 경쟁 회피). 이후 스텝의 signal.aborted 가드가 manifest 재스탬프를 막는다.
    llm.writePrompts = vi.fn(async () => { await machine.abort(); return { scenes: [] } })
    await machine.start('prompts', {})

    const manifest = JSON.parse(await readFile(path.join(dir, 'story/audio/manifest.json'), 'utf8'))
    expect(manifest.pushRevision).toBeNull()
  })
})
