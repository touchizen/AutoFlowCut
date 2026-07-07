// @vitest-environment node
// 슬라이스 3b: 확정 명단(roster) 주입 + mergeSpeakers superset 병합 + ensureReferencedSpeakers 검증화
// + seg.speaker 재기록 (spec §v2.8 B2/B3 + §v2.9 MAJOR②/MINOR②)
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createStepMachine } from '../../../electron/story/stepMachine.js'

const readScenes = async (dir) => JSON.parse(await readFile(path.join(dir, 'story', 'scenes.json'), 'utf-8')).scenes
const readStory = async (dir) => JSON.parse(await readFile(path.join(dir, 'story', 'story.json'), 'utf-8'))

let dir, emitted, llm, machine
beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'sm-roster-'))
  emitted = []
  llm = {
    generateScript: vi.fn(async () => ({ scriptMd: '# 대본' })),
    splitScenes: vi.fn(async () => ({
      scenes: [{ sceneNo: 1, summary: 's', segments: [
        { speaker: 'narrator', text: '가'.repeat(40), emotion: 'normal' },
        { speaker: '리안', text: '대사', emotion: 'normal' },
      ] }],
      speakers: [{ id: 'narrator', name: '나레이션' }, { id: '리안', name: '리안', appearance: 'young man' }],
    })),
    writePrompts: vi.fn(async (scenes) => ({ scenes: scenes.map((s) => ({ ...s, imagePrompt: 'IMG', videoPrompt: 'VID' })) })),
    reviewScenes: vi.fn(async () => ({ verdict: 'pass', critique: '' })),
    reviseScenes: vi.fn(async (_s, scenes, speakers) => ({ scenes, speakers })),
  }
  machine = createStepMachine({
    projectPath: dir, llm,
    emit: (ch, payload) => emitted.push({ ch, payload }),
    getApiKey: () => 'k',
  })
  await machine.open()
})

async function confirmRoster(characters) {
  await machine.confirmSynopsis({ synopsisMd: 's', characters })
}
async function runScript() {
  await machine.start('script', { input: { type: 'title', title: 'T' }, options: { language: 'ko' } })
}

describe('roster 주입 (§v2.8 B2 + §v2.9 MINOR②)', () => {
  it('확정 후 scenes: splitScenes opts.roster에 확정 non-narrator {id,name,role}를 싣는다', async () => {
    await confirmRoster([{ name: '리안', role: '주인공' }, { name: '하나', role: '동생' }])
    await runScript()
    await machine.start('scenes', {})
    const opts = llm.splitScenes.mock.calls[0][1]
    expect(opts.roster).toEqual([
      { id: '리안', name: '리안', role: '주인공' },
      { id: '하나', name: '하나', role: '동생' },
    ])
  })

  it('미확정(legacy)이면 opts.roster 미주입 (회귀 고정)', async () => {
    await runScript()
    await machine.start('scenes', {})
    expect(llm.splitScenes.mock.calls[0][1].roster).toBeUndefined()
  })

  it('검토루프 reviseScenes에도 roster가 주입된다', async () => {
    llm.reviewScenes.mockResolvedValueOnce({ verdict: 'revise', critique: 'fix' })
    await confirmRoster([{ name: '리안', role: '주인공' }])
    await runScript()
    await machine.start('scenes', { options: { language: 'ko' }, review: { scenes: { enabled: true, rounds: 1 } } })
    expect(llm.reviseScenes).toHaveBeenCalled()
    const reviseOpts = llm.reviseScenes.mock.calls[0][4]
    expect(reviseOpts.roster).toEqual([{ id: '리안', name: '리안', role: '주인공' }])
  })
})

describe('mergeSpeakers superset 병합 (§v2.8 B3)', () => {
  it('씬에서 미참조된 확정 인물도 삭제하지 않고 확정 구조화 필드·voice를 보존한다', async () => {
    await confirmRoster([
      { name: '리안', gender: 'male', age: '20대', role: '주인공' },
      { name: '하나', gender: 'female', age: '10대', role: '동생', appearance: 'girl in dress' },
    ])
    await runScript()
    await machine.start('scenes', {}) // LLM은 리안만 반환(하나 미참조)
    const st = await machine.getState()
    const ids = st.speakers.map((sp) => sp.id)
    expect(ids).toContain('하나') // ③ 미참조 확정 인물 삭제 금지
    expect(ids).toContain('narrator')
    const rian = st.speakers.find((sp) => sp.id === '리안')
    // ① 확정 gender/age/role 보존 + LLM appearance 승계(확정엔 없던 값 보강)
    expect(rian).toMatchObject({ gender: 'male', age: '20대', role: '주인공', appearance: 'young man' })
    expect(st.speakers.find((sp) => sp.id === '하나')).toMatchObject({ gender: 'female', appearance: 'girl in dress' })
  })

  // §v2.12: 확정 ethnicity도 scenes 재실행(mergeSpeakers)이 보존한다 — roster 강제/자유 모드 공통.
  it('확정 ethnicity는 scenes 실행 후에도 speakers에 보존된다 (§v2.12)', async () => {
    await confirmRoster([{ name: '리안', gender: 'male', ethnicity: '한국인' }])
    await runScript()
    await machine.start('scenes', {})
    const st = await machine.getState()
    expect(st.speakers.find((sp) => sp.id === '리안')).toMatchObject({ ethnicity: '한국인', appearance: 'young man' })
  })

  it('미확정(자유 모드)에서도 기존 speaker의 ethnicity를 LLM 출력이 덮지 않는다 (§v2.12)', async () => {
    // 확정은 했지만 input.type이 title/pasted가 아니면 rosterEnforced=false(자유 모드 merge 경로).
    await confirmRoster([{ name: '리안', gender: 'male', ethnicity: 'Korean' }])
    await machine.start('script', { input: { type: 'manual', title: 'T' }, options: { language: 'ko' } })
    await machine.start('scenes', {})
    const st = await machine.getState()
    expect(st.speakers.find((sp) => sp.id === '리안')).toMatchObject({ ethnicity: 'Korean', appearance: 'young man' })
  })

  it('확정 시 명단 밖 LLM 신규 speaker는 state.speakers에 추가하지 않는다', async () => {
    llm.splitScenes.mockResolvedValueOnce({
      scenes: [{ sceneNo: 1, summary: 's', segments: [
        { speaker: 'narrator', text: '가'.repeat(40), emotion: 'normal' },
        { speaker: '유령', text: '대사', emotion: 'normal' },
      ] }],
      speakers: [{ id: 'narrator', name: '나레이션' }, { id: '유령', name: '유령', appearance: 'ghost' }],
    })
    await confirmRoster([{ name: '리안', gender: 'male' }])
    await runScript()
    await machine.start('scenes', {})
    const st = await machine.getState()
    expect(st.speakers.map((sp) => sp.id).sort()).toEqual(['narrator', '리안'])
  })

  it('미확정(legacy)은 LLM 신규 speaker 추가를 유지하되, 이전 speakers도 삭제하지 않는다', async () => {
    await runScript()
    await machine.start('scenes', {}) // speakers: narrator, 리안
    llm.splitScenes.mockResolvedValueOnce({
      scenes: [{ sceneNo: 1, summary: 's', segments: [{ speaker: '신입', text: '가'.repeat(40), emotion: 'normal' }] }],
      speakers: [{ id: '신입', name: '신입' }],
    })
    await machine.start('scenes', {})
    const st = await machine.getState()
    const ids = st.speakers.map((sp) => sp.id)
    expect(ids).toContain('신입') // legacy: 신규 추가 유지
    expect(ids).toContain('리안') // superset: 이전 확정분 삭제 금지
  })
})

// FIX-1: roster 강제(신규 금지 + 명단밖→narrator)는 rosterEnforced(확정 + title/pasted + 명단
// 존재)일 때만 — legacy(charactersConfirmed undefined)는 migrate durable write 없이 자유 모드 유지.
describe('legacy 재오픈 rosterEnforced 분리 (FIX-1)', () => {
  it('legacy(script done) 재오픈: charactersConfirmed durable write 없음 + scenes 재실행이 LLM 신규 speaker를 유지한다', async () => {
    // 1세션: legacy 프로젝트 형성(title 경로, charactersConfirmed 필드 없음)
    await runScript()
    await machine.start('scenes', {})
    expect((await readStory(dir)).charactersConfirmed).toBeUndefined()

    // 재오픈 — migrate가 true를 기록하면 mergeSpeakers/confirmedRoster가 roster 강제로 오해석한다(회귀)
    const m2 = createStepMachine({
      projectPath: dir, llm,
      emit: (ch, payload) => emitted.push({ ch, payload }),
      getApiKey: () => 'k',
    })
    await m2.open()
    expect((await readStory(dir)).charactersConfirmed).toBeUndefined() // durable write 제거

    llm.splitScenes.mockResolvedValueOnce({
      scenes: [{ sceneNo: 1, summary: 's', segments: [
        { speaker: 'narrator', text: '가'.repeat(40), emotion: 'normal' },
        { speaker: '신입', text: '대사', emotion: 'normal' },
      ] }],
      speakers: [{ id: 'narrator', name: '나레이션' }, { id: '신입', name: '신입', appearance: 'new man' }],
    })
    await m2.start('scenes', {})
    // roster 미주입(자유 모드)
    expect(llm.splitScenes.mock.calls.at(-1)[1].roster).toBeUndefined()
    // LLM 신규 speaker 유지 — narrator 뭉개짐 없음
    const st = await m2.getState()
    expect(st.speakers.map((sp) => sp.id)).toContain('신입')
    const scenes = await readScenes(dir)
    expect(scenes[0].segments.map((g) => g.speaker)).toEqual(['narrator', '신입'])
  })

  it('확정(title/pasted + true + 명단)은 여전히 roster 강제 — 명단 밖은 narrator', async () => {
    await confirmRoster([{ name: '리안', role: '주인공' }])
    await runScript()
    llm.splitScenes.mockResolvedValueOnce({
      scenes: [{ sceneNo: 1, summary: 's', segments: [
        { speaker: '리안', text: '가'.repeat(40), emotion: 'normal' },
        { speaker: '유령', text: '대사', emotion: 'normal' },
      ] }],
      speakers: [{ id: '리안', name: '리안' }, { id: '유령', name: '유령' }],
    })
    await machine.start('scenes', {})
    expect(llm.splitScenes.mock.calls.at(-1)[1].roster).toEqual([{ id: '리안', name: '리안', role: '주인공' }])
    const scenes = await readScenes(dir)
    expect(scenes[0].segments.map((g) => g.speaker)).toEqual(['리안', 'narrator'])
  })
})

// FIX-3: 확정 roster의 id/name/구조화 필드는 LLM 출력이 덮지 못한다(§v2.9 id=name.trim 고정).
describe('mergeSpeakers 확정 id/name/구조화 필드 보존 (FIX-3)', () => {
  it('확정 상태: matched speaker의 id/name/gender/age/role 보존 + appearance만 보강', async () => {
    llm.splitScenes.mockResolvedValueOnce({
      scenes: [{ sceneNo: 1, summary: 's', segments: [
        { speaker: 'narrator', text: '가'.repeat(40), emotion: 'normal' },
        { speaker: '리안', text: '대사', emotion: 'normal' },
      ] }],
      speakers: [{ id: '리안', name: '강리안', gender: 'female', age: '30대', role: '악역', appearance: 'young man' }],
    })
    await confirmRoster([{ name: '리안', gender: 'unknown', age: '', role: '' }])
    await runScript()
    await machine.start('scenes', {})
    const st = await machine.getState()
    const rian = st.speakers.find((sp) => sp.id === '리안')
    expect(rian).toMatchObject({ id: '리안', name: '리안', gender: 'unknown', age: '', role: '', appearance: 'young man' })
    expect(st.speakers.some((sp) => sp.name === '강리안')).toBe(false) // LLM rename 차단
  })

  it('미확정(legacy): 기존 {...next} rename 동작 유지(회귀 고정)', async () => {
    await runScript()
    await machine.start('scenes', {}) // speakers: narrator, 리안
    llm.splitScenes.mockResolvedValueOnce({
      scenes: [{ sceneNo: 1, summary: 's', segments: [{ speaker: '강리안', text: '가'.repeat(40), emotion: 'normal' }] }],
      speakers: [{ id: '리안', name: '강리안', appearance: 'renamed man' }],
    })
    await machine.start('scenes', {})
    const st = await machine.getState()
    expect(st.speakers.find((sp) => sp.id === '리안')?.name).toBe('강리안')
  })
})

describe('ensureReferencedSpeakers 검증화 + seg.speaker 재기록 (§v2.8 B2 + §v2.9 MAJOR②)', () => {
  it('명단 밖 seg.speaker는 speakers에 새로 생성하지 않고 narrator로 재기록 + progress warn', async () => {
    llm.splitScenes.mockResolvedValueOnce({
      scenes: [{ sceneNo: 1, summary: 's', segments: [
        { speaker: 'narrator', text: '가'.repeat(40), emotion: 'normal' },
        { speaker: '리안', text: '대사', emotion: 'normal' },
        { speaker: '유령', text: '정체불명', emotion: 'normal' },
      ] }],
      speakers: [{ id: 'narrator', name: '나레이션' }, { id: '리안', name: '리안' }],
    })
    await confirmRoster([{ name: '리안', gender: 'male' }])
    await runScript()
    await machine.start('scenes', {})

    // speakers에 유령 미생성
    const st = await machine.getState()
    expect(st.speakers.some((sp) => sp.id === '유령')).toBe(false)
    // scenes.json의 seg.speaker 재기록 (데이터 자체 수정 — audio 사전검증 하드실패 방지)
    const scenes = await readScenes(dir)
    expect(scenes[0].segments.map((g) => g.speaker)).toEqual(['narrator', '리안', 'narrator'])
    // story:progress warn
    const warn = emitted.find((e) => e.ch === 'story:progress' && e.payload.level === 'warn')
    expect(warn).toBeTruthy()
    expect(String(warn.payload.message)).toContain('유령')
  })

  it('매칭은 공백/대소문자 정규화만 — 정규화 일치하는 참조는 재기록하지 않는다', async () => {
    llm.splitScenes.mockResolvedValueOnce({
      scenes: [{ sceneNo: 1, summary: 's', segments: [
        { speaker: ' Ri An ', text: '가'.repeat(40), emotion: 'normal' },
        { speaker: '나레이션', text: '나'.repeat(40), emotion: 'normal' }, // narrator 별칭도 유지
      ] }],
      speakers: [],
    })
    await confirmRoster([{ name: 'rian' }])
    await runScript()
    await machine.start('scenes', {})
    const scenes = await readScenes(dir)
    expect(scenes[0].segments[0].speaker).toBe(' Ri An ') // 정규화 매칭 성공 → 원문 유지
    expect(scenes[0].segments[1].speaker).toBe('나레이션')
  })

  it('narrator 시딩은 유지: 세그먼트가 narrator를 참조하면 speakers에 narrator가 채워진다', async () => {
    llm.splitScenes.mockResolvedValueOnce({
      scenes: [{ sceneNo: 1, summary: 's', segments: [{ speaker: 'narrator', text: '가'.repeat(40), emotion: 'normal' }] }],
      speakers: [],
    })
    await runScript()
    await machine.start('scenes', {})
    const st = await machine.getState()
    expect(st.speakers.find((sp) => sp.id === 'narrator')).toMatchObject({ name: '나레이션' })
  })

  // FIX-5(R2): 미확정/legacy(rosterEnforced=false)는 base HEAD의 auto-add 복원 — LLM speakers에
  // 안 담긴 명단 밖 referenced seg.speaker도 state.speakers에 생성해 scenes/speakers를 일치시킨다
  // (audio voice 조회/voice 매핑 UI/Ref 후보 불일치 방지). narrator 재기록·warn 없음.
  // "검증화(생성 폐지)"는 rosterEnforced(확정) 전용이다.
  it('미확정(legacy) 흐름은 명단 밖 referenced speaker를 auto-add한다(재기록·warn 없음)', async () => {
    llm.splitScenes.mockResolvedValueOnce({
      scenes: [{ sceneNo: 1, summary: 's', segments: [
        { speaker: 'narrator', text: '가'.repeat(40), emotion: 'normal' },
        { speaker: 'ghost', text: '대사', emotion: 'normal' },
      ] }],
      speakers: [{ id: 'narrator', name: '나레이션' }],
    })
    await runScript()
    await machine.start('scenes', {})
    const st = await machine.getState()
    expect(st.speakers.find((sp) => sp.id === 'ghost')).toMatchObject({ id: 'ghost', name: 'ghost' }) // auto-add 복원
    const scenes = await readScenes(dir)
    expect(scenes[0].segments[1].speaker).toBe('ghost') // 재기록 없음 — scenes/speakers 일치
    expect(emitted.some((e) => e.ch === 'story:progress' && e.payload.level === 'warn')).toBe(false)
  })

  // FIX-5 회귀 고정: legacy(charactersConfirmed=undefined) 재오픈 후에도 auto-add가 동작한다.
  it('legacy 재오픈: 명단 밖 referenced speaker가 auto-add되어 audio voice 조회가 가능하다', async () => {
    await runScript()
    await machine.start('scenes', {})
    const m2 = createStepMachine({
      projectPath: dir, llm,
      emit: (ch, payload) => emitted.push({ ch, payload }),
      getApiKey: () => 'k',
    })
    await m2.open()
    llm.splitScenes.mockResolvedValueOnce({
      scenes: [{ sceneNo: 1, summary: 's', segments: [
        { speaker: 'narrator', text: '가'.repeat(40), emotion: 'normal' },
        { speaker: '유령', text: '대사', emotion: 'normal' },
      ] }],
      speakers: [{ id: 'narrator', name: '나레이션' }], // LLM이 speakers에 유령을 빠뜨림
    })
    await m2.start('scenes', {})
    const st = await m2.getState()
    expect(st.speakers.find((sp) => sp.id === '유령')).toMatchObject({ id: '유령', name: '유령' })
    const scenes = await readScenes(dir)
    expect(scenes[0].segments.map((g) => g.speaker)).toEqual(['narrator', '유령'])
  })

  it('검토루프(reviewOnly)가 명단 밖 화자를 만들어도 최종 정규화가 다시 흡수한다(확정 상태)', async () => {
    await confirmRoster([{ name: '리안', role: '주인공' }]) // FIX-1: 최종 정규화는 rosterEnforced 전용
    await runScript()
    await machine.start('scenes', {})
    llm.reviewScenes.mockResolvedValueOnce({ verdict: 'revise', critique: 'fix' })
    llm.reviseScenes.mockResolvedValueOnce({
      scenes: [{ sceneNo: 1, summary: 's', segments: [
        { speaker: 'narrator', text: '가'.repeat(40), emotion: 'normal' },
        { speaker: '난입자', text: '대사', emotion: 'normal' },
      ] }],
      speakers: [],
    })
    await machine.start('scenes', { reviewOnly: true, options: { language: 'ko' }, review: { scenes: { enabled: true, rounds: 1 } } })
    const scenes = await readScenes(dir)
    expect(scenes[0].segments.map((g) => g.speaker)).toEqual(['narrator', 'narrator'])
    const st = await machine.getState()
    expect(st.speakers.some((sp) => sp.id === '난입자')).toBe(false)
  })
})

// FIX-7(R2): 빈 명단 확정(나레이션-only)도 roster 강제 — rosterEnforced에서 length>0 조건 제거.
// confirmedRoster는 null이 아닌 빈 배열을 반환해 프롬프트에 "등장인물 없음" 제약을 주입한다.
describe('빈 명단 확정 roster 강제 (FIX-7)', () => {
  it('confirmSynopsis({characters:[]}) 후 scenes: opts.roster=[](null 아님) + 신규 speaker 금지 + narrator 흡수', async () => {
    llm.splitScenes.mockResolvedValueOnce({
      scenes: [{ sceneNo: 1, summary: 's', segments: [
        { speaker: 'narrator', text: '가'.repeat(40), emotion: 'normal' },
        { speaker: '유령', text: '대사', emotion: 'normal' },
      ] }],
      speakers: [{ id: 'narrator', name: '나레이션' }, { id: '유령', name: '유령' }],
    })
    await confirmRoster([])
    await runScript()
    await machine.start('scenes', {})
    // 빈 확정 명단도 roster 주입(빈 배열) — buildSplitPrompt가 "등장인물 없음" 제약을 만든다
    expect(llm.splitScenes.mock.calls.at(-1)[1].roster).toEqual([])
    // 명단 밖 신규 speaker 생성 금지 — narrator만
    const st = await machine.getState()
    expect(st.speakers.map((sp) => sp.id)).toEqual(['narrator'])
    // 명단 밖 seg.speaker는 narrator로 흡수(재기록) + warn
    const scenes = await readScenes(dir)
    expect(scenes[0].segments.map((g) => g.speaker)).toEqual(['narrator', 'narrator'])
    const warn = emitted.find((e) => e.ch === 'story:progress' && e.payload.level === 'warn')
    expect(String(warn?.payload?.message || '')).toContain('유령')
  })

  it('검토루프(reviewOnly)도 빈 확정 명단을 강제한다 — 난입자 narrator 흡수', async () => {
    // 첫 분리는 narrator-only로 고정 — state.speakers가 [narrator]로 유지된 채 reviewOnly에
    // 진입해야 "빈 명단 자체의 강제"를 변별한다(첫 실행이 자유 생성한 인물로 명단이 오염되면
    // 구식 length>0 조건에서도 우연히 강제가 걸려 테스트가 통과해 버린다).
    llm.splitScenes.mockResolvedValueOnce({
      scenes: [{ sceneNo: 1, summary: 's', segments: [{ speaker: 'narrator', text: '가'.repeat(40), emotion: 'normal' }] }],
      speakers: [{ id: 'narrator', name: '나레이션' }],
    })
    await confirmRoster([])
    await runScript()
    await machine.start('scenes', {})
    expect((await machine.getState()).speakers.map((sp) => sp.id)).toEqual(['narrator'])
    llm.reviewScenes.mockResolvedValueOnce({ verdict: 'revise', critique: 'fix' })
    llm.reviseScenes.mockResolvedValueOnce({
      scenes: [{ sceneNo: 1, summary: 's', segments: [
        { speaker: 'narrator', text: '가'.repeat(40), emotion: 'normal' },
        { speaker: '난입자', text: '대사', emotion: 'normal' },
      ] }],
      speakers: [],
    })
    await machine.start('scenes', { reviewOnly: true, options: { language: 'ko' }, review: { scenes: { enabled: true, rounds: 1 } } })
    const scenes = await readScenes(dir)
    expect(scenes[0].segments.map((g) => g.speaker)).toEqual(['narrator', 'narrator'])
    const st = await machine.getState()
    expect(st.speakers.some((sp) => sp.id === '난입자')).toBe(false)
  })
})

describe('push payload 구조화 필드 (§v2.2)', () => {
  it('pushScenes/pushCharacters storyCharacters가 {name,gender,age,role,appearance}로 확장된다', async () => {
    await confirmRoster([{ name: '리안', gender: 'male', age: '20대', role: '주인공', appearance: 'young man' }])
    emitted.length = 0
    await runScript()
    await machine.start('scenes', {})
    await machine.start('prompts', {})

    const push = emitted.filter((e) => e.ch === 'story:pushScenes').pop()
    expect(push.payload.storyCharacters).toEqual([
      { name: '리안', gender: 'male', age: '20대', role: '주인공', ethnicity: '', appearance: 'young man' },
    ])
    const chars = emitted.filter((e) => e.ch === 'story:pushCharacters').pop()
    expect(chars.payload.storyCharacters[0]).toEqual(
      { name: '리안', gender: 'male', age: '20대', role: '주인공', ethnicity: '', appearance: 'young man' },
    )
  })
})
