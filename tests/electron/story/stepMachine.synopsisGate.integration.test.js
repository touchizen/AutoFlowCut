// @vitest-environment node
// 통합: 시놉시스 게이트 전체 흐름 — title(생성→확정→시나리오→씬→오디오)과 pasted(저장→역추출→확정→재오픈).
// spec §v2 전반: 확정 명단이 다운스트림을 관통하고, 명단 밖 화자는 narrator로 흡수되어
// audio 사전검증(voice not assigned) 하드실패가 나지 않는 것까지 검증한다.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createStepMachine } from '../../../electron/story/stepMachine.js'

let dir, emitted, llm, machine
beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'sm-syn-int-'))
  emitted = []
  llm = {
    generateSynopsis: vi.fn(async (input, _o, { onDelta }) => {
      if (input.type === 'pasted') {
        return { synopsisMd: '', characters: [{ name: '민수', gender: 'male', age: '30대', role: '가장', appearance: 'tired man' }] }
      }
      onDelta?.('줄거리')
      return { synopsisMd: '줄거리 개요', characters: [{ name: '리안', gender: 'male', age: '20대', role: '주인공', appearance: 'young man' }] }
    }),
    generateScript: vi.fn(async (_i, _o, { onDelta }) => { onDelta?.('부분'); return { scriptMd: '# 시나리오' } }),
    splitScenes: vi.fn(async () => ({
      scenes: [{ sceneNo: 1, summary: 's', segments: [
        { speaker: 'narrator', text: '가'.repeat(40), emotion: 'normal' },
        { speaker: '리안', text: '대사입니다', emotion: 'normal' },
        { speaker: '강리안', text: '명단 밖 표기', emotion: 'normal' }, // 리안=강리안 류 어긋남
      ] }],
      speakers: [{ id: 'narrator', name: '나레이션' }, { id: '리안', name: '리안', appearance: 'young man' }],
    })),
    writePrompts: vi.fn(async (scenes) => ({ scenes: scenes.map((s) => ({ ...s, imagePrompt: 'IMG', videoPrompt: 'VID' })) })),
  }
  const tts = { capabilities: () => ({ maxConcurrency: 2 }), synthesize: async ({ text }) => ({ audio: Buffer.from('A:' + text), format: 'wav' }) }
  machine = createStepMachine({
    projectPath: dir, llm, tts, probe: async () => 2000,
    emit: (ch, payload) => emitted.push({ ch, payload }),
    getApiKey: () => 'k',
  })
  await machine.open()
})

describe('시놉시스 게이트 통합 (title 경로)', () => {
  it('생성→확정→시나리오→씬→오디오: 확정 명단 관통 + 명단 밖 화자 narrator 흡수로 audio 성공', async () => {
    // 1) 시놉시스 생성 (게이트)
    const syn = await machine.generateSynopsis({ type: 'title', title: '제목', options: { language: 'ko' } })
    expect(syn.characters[0].name).toBe('리안')

    // 2) 확정 커밋 — Ref 앞당김(pushCharacters) + 확정 마커
    await machine.confirmSynopsis({ synopsisMd: syn.synopsisMd, characters: syn.characters })
    expect(emitted.some((e) => e.ch === 'story:pushCharacters')).toBe(true)

    // 3) 시나리오 — 확정 synopsis/characters가 프롬프트 opts로 주입
    await machine.start('script', { input: { type: 'title', title: '제목' }, options: { language: 'ko' }, synopsis: syn.synopsisMd })
    const scriptOpts = llm.generateScript.mock.calls[0][1]
    expect(scriptOpts.synopsis).toBe('줄거리 개요')
    expect(scriptOpts.characters).toEqual([{ id: '리안', name: '리안', gender: 'male', age: '20대', role: '주인공', ethnicity: '', appearance: 'young man' }])

    // 4) 씬 분리 — roster 주입 + 명단 밖 '강리안' seg는 narrator로 재기록
    await machine.start('scenes', {})
    expect(llm.splitScenes.mock.calls[0][1].roster).toEqual([{ id: '리안', name: '리안', role: '주인공' }])
    const scenes = JSON.parse(await readFile(path.join(dir, 'story', 'scenes.json'), 'utf-8')).scenes
    expect(scenes[0].segments.map((g) => g.speaker)).toEqual(['narrator', '리안', 'narrator'])

    // 5) 오디오 — 확정 명단 + narrator voice만으로 하드실패 없이 done.
    // renderer(오디오 탭)처럼 state.speakers에 voice를 얹어 보낸다(audio 스텝은 params.speakers로 교체).
    const before = await machine.getState()
    const voiced = before.speakers.map((sp) => ({
      ...sp,
      voice: { provider: 'typecast', voiceId: sp.id === 'narrator' ? 'tc_n' : 'tc_r' },
    }))
    await machine.start('audio', { speakers: voiced })
    const st = await machine.getState()
    expect(st.steps.audio.status).toBe('done')

    // 6) push payload 구조화 캐릭터
    await machine.start('prompts', {})
    const push = emitted.filter((e) => e.ch === 'story:pushScenes').pop()
    expect(push.payload.storyCharacters).toEqual([
      { name: '리안', gender: 'male', age: '20대', role: '주인공', ethnicity: '', appearance: 'young man' },
    ])
  })
})

// FIX-7(R2) 통합: 빈 명단 확정(나레이션-only) — rosterEnforced = 확정 + title/pasted(명단 크기 무관).
// 확정된 빈 명단도 강제되어 scenes가 새 인물을 못 만들고 narrator로 흡수, audio까지 하드실패 없음.
describe('시놉시스 게이트 통합 (빈 명단 확정 = 나레이션-only, FIX-7)', () => {
  it('confirm([]) → scenes: roster=[] 주입 + 전 세그먼트 narrator 흡수 → narrator voice만으로 audio done', async () => {
    await machine.generateSynopsis({ type: 'title', title: '제목', options: { language: 'ko' } })
    await machine.confirmSynopsis({ synopsisMd: '줄거리', characters: [] })
    await machine.start('script', { input: { type: 'title', title: '제목' }, options: { language: 'ko' }, synopsis: '줄거리' })
    await machine.start('scenes', {})
    // 빈 확정 명단도 roster로 주입(null 아님)
    expect(llm.splitScenes.mock.calls[0][1].roster).toEqual([])
    // LLM이 낸 리안/강리안 전부 narrator로 흡수 — 새 speaker 미생성
    const scenes = JSON.parse(await readFile(path.join(dir, 'story', 'scenes.json'), 'utf-8')).scenes
    expect(scenes[0].segments.map((g) => g.speaker)).toEqual(['narrator', 'narrator', 'narrator'])
    const before = await machine.getState()
    expect(before.speakers.map((sp) => sp.id)).toEqual(['narrator'])
    // narrator voice 하나만으로 audio 성공(voice not assigned 하드실패 없음)
    const voiced = before.speakers.map((sp) => ({ ...sp, voice: { provider: 'typecast', voiceId: 'tc_n' } }))
    await machine.start('audio', { speakers: voiced })
    expect((await machine.getState()).steps.audio.status).toBe('done')
  })
})

describe('시놉시스 게이트 통합 (pasted 경로, §v2.8 B1)', () => {
  it('붙여넣기 저장→역추출→확정: script.md 비파괴 + 재오픈 hydrate가 확정 상태를 복원한다', async () => {
    // 1) 즉시 저장(script done) — charactersConfirmed=false durable
    await machine.start('script', { pastedScript: '붙여넣은 대본 원문', options: { language: 'ko' } })

    // 2) 역추출 (non-streaming, 등장인물만)
    const r = await machine.generateSynopsis({ type: 'pasted', pastedScript: '붙여넣은 대본 원문', options: { language: 'ko' } })
    expect(r.characters[0].name).toBe('민수')

    // 재오픈: 확정 전이면 charactersConfirmed=false 유지(§v2.11 — script done이어도 게이트 보존)
    const mid = createStepMachine({ projectPath: dir, llm, emit: () => {}, getApiKey: () => 'k' })
    const midState = await mid.open()
    expect(midState.charactersConfirmed).toBe(false)
    expect(midState.state.steps.script.status).toBe('done')
    expect(midState.characters).toEqual([
      { id: '민수', name: '민수', gender: 'male', age: '30대', role: '가장', ethnicity: '', appearance: 'tired man' },
    ])

    // 3) 확정 — script 재생성/덮어쓰기 없음
    await machine.confirmSynopsis({ synopsisMd: '', characters: r.characters })
    expect(llm.generateScript).not.toHaveBeenCalled()
    expect(await readFile(path.join(dir, 'story', 'script.md'), 'utf-8')).toBe('붙여넣은 대본 원문')

    // 4) 재오픈 hydrate — 확정 상태 복원
    const reopened = createStepMachine({ projectPath: dir, llm, emit: () => {}, getApiKey: () => 'k' })
    const hyd = await reopened.open()
    expect(hyd.charactersConfirmed).toBe(true)
    expect(hyd.state.input.type).toBe('pasted')
    expect(hyd.state.speakers.map((sp) => sp.id)).toEqual(['민수', 'narrator'])
  })
})
