// @vitest-environment node
// 리서치 슬라이스(spec §3.1 오케스트레이션 + §3.8 영속/hydrate + §5 busy 뮤텍스 + §3.6 시놉시스 연결):
// stepMachine research side actions — researchSearch/FetchTranscripts/Analyze/FactCheck/commit/skip.
// 백엔드(yt-dlp)·LLM·factCheck는 전부 mock DI(N4 seam).
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mkdtemp, readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createStepMachine } from '../../../electron/story/stepMachine.js'

const readStory = async (dir) => JSON.parse(await readFile(path.join(dir, 'story', 'story.json'), 'utf-8'))
const loadJson = async (dir, rel) => JSON.parse(await readFile(path.join(dir, 'story', rel), 'utf-8'))
const loadText = (dir, rel) => readFile(path.join(dir, 'story', rel), 'utf-8').catch(() => null)

const VIDEOS = [
  { videoId: 'vidA', title: '영상A', channelTitle: '채널A', viewCount: 100, durationSec: 60, thumbnailUrl: 'https://t/a.jpg' },
  { videoId: 'vidB', title: '영상B', channelTitle: '채널B', viewCount: 50, durationSec: 90, thumbnailUrl: 'https://t/b.jpg' },
]
const ANALYSIS = {
  structure: [{ beat: '도입', summary: '사건 발생' }],
  claims: [{ claim: '1592년에 일어났다', sources: ['vidA', 'vidB'] }],
  commonThemes: ['복수'],
}
const FACTCHECK_RESULT = {
  claims: [
    { claim: '1592년에 일어났다', verdict: 'supported', evidence: [{ url: 'https://ex', note: '근거' }] },
    { claim: '허구 주장', verdict: 'refuted', evidence: [] },
  ],
}

let dir, emitted, llm, youtube, factCheck, machine
function makeMachine(overrides = {}) {
  return createStepMachine({
    projectPath: dir, llm,
    emit: (ch, payload) => emitted.push({ ch, payload }),
    getApiKey: () => 'k',
    youtube, factCheck,
    ...overrides,
  })
}
beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'sm-research-'))
  emitted = []
  llm = {
    generateScript: vi.fn(async () => ({ scriptMd: '# 대본' })),
    generateSynopsis: vi.fn(async () => ({ synopsisMd: '시놉', characters: [] })),
    splitScenes: vi.fn(async () => ({ scenes: [], speakers: [] })),
    writePrompts: vi.fn(async (scenes) => ({ scenes })),
    analyzeResearch: vi.fn(async () => ANALYSIS),
  }
  youtube = {
    searchVideos: vi.fn(async () => ({ videos: VIDEOS })),
    fetchTranscript: vi.fn(async (videoId) => ({
      videoId, ok: true, lang: 'ko', isAuto: false, format: 'srv3',
      segments: [{ start: 0, dur: 1000, text: '안녕' }],
      srt: `1\n00:00:00,000 --> 00:00:01,000\n안녕(${videoId})\n`,
      plainText: `자막 본문 ${videoId}`,
    })),
  }
  factCheck = vi.fn(async () => FACTCHECK_RESULT)
  machine = makeMachine()
  await machine.open()
})

// ---------- researchSearch ----------
describe('researchSearch (side action)', () => {
  it('youtube.searchVideos({query,maxResults}) 위임 → {videos} 반환 + draft에 keyword/videos 저장', async () => {
    const r = await machine.researchSearch({ keyword: '조선 야담', maxResults: 10 })
    expect(youtube.searchVideos).toHaveBeenCalledWith({ query: '조선 야담', maxResults: 10 })
    expect(r.videos).toEqual(VIDEOS)
    const draft = await loadJson(dir, 'research.draft.json')
    expect(draft.keyword).toBe('조선 야담')
    expect(draft.videos).toEqual(VIDEOS)
    // step status 불변(side action)
    expect((await machine.getState()).steps.script.status).toBe('pending')
  })

  // 개선2(2026-07-08): 일자 필터 — UI의 dateFilter(none|week|month)가 searchVideos까지 전달돼야
  // 상세조회 분기가 동작한다. 미지정이면 안 실어 기존 계약({query,maxResults})을 유지한다.
  it('dateFilter가 오면 searchVideos에 전달한다 (개선2)', async () => {
    await machine.researchSearch({ keyword: 'k', maxResults: 20, dateFilter: 'week' })
    expect(youtube.searchVideos).toHaveBeenCalledWith({ query: 'k', maxResults: 20, dateFilter: 'week' })
  })

  // R2 MINOR: searchVideos의 dateFilterFallback 플래그를 검색 반환에 전달(UI 안내용). 없으면 미전달.
  it('searchVideos.dateFilterFallback를 검색 반환에 실어 전달한다 (R2)', async () => {
    youtube.searchVideos.mockResolvedValueOnce({ videos: VIDEOS, dateFilterFallback: true })
    const r = await machine.researchSearch({ keyword: 'k', dateFilter: 'week' })
    expect(r.dateFilterFallback).toBe(true)
    const plain = await machine.researchSearch({ keyword: 'k2' })
    expect(plain.dateFilterFallback).toBeUndefined()
  })

  it('searchVideos가 {error}를 반환하면 그대로 전달하고 draft를 쓰지 않는다', async () => {
    youtube.searchVideos.mockResolvedValueOnce({ error: 'binary-not-found' })
    const r = await machine.researchSearch({ keyword: 'x' })
    expect(r).toEqual({ error: 'binary-not-found' })
    expect(existsSync(path.join(dir, 'story', 'research.draft.json'))).toBe(false)
  })

  // m7(Fable R1): 새 검색이 이전 analysis/verifiedClaims/선택을 안 지우면 새 keyword + 옛 analysis가
  // commit돼 research.json이 불일치한다 — 검색 시 함께 클리어.
  it('새 검색은 이전 analysis/verifiedClaims/selectedVideoIds를 클리어한다 (m7)', async () => {
    await machine.researchSearch({ keyword: 'k' })
    await machine.researchFetchTranscripts({ videoIds: ['vidA'] })
    await machine.researchAnalyze({ videoIds: ['vidA'] })
    await machine.researchFactCheck({})

    await machine.researchSearch({ keyword: '완전히 새 키워드' })
    const draft = await loadJson(dir, 'research.draft.json')
    expect(draft.analysis).toBeUndefined()
    expect(draft.verifiedClaims).toBeUndefined()
    expect(draft.selectedVideoIds).toEqual([])
    // 옛 analysis가 사라졌으니 commit은 no-analysis로 거부된다(불일치 research.json 방지).
    expect(await machine.researchCommit({})).toEqual({ error: 'no-analysis' })
  })
})

// ---------- researchSelect (m5 — 수동 URL 카드·fetch 전 선택 영속) ----------
describe('researchSelect (m5)', () => {
  it('selectedVideoIds/manualVideos를 draft에 저장하고 재오픈 hydrate가 병합 복원한다', async () => {
    await machine.researchSearch({ keyword: 'k' })
    const manual = [{ videoId: 'manualV0001', title: 'manualV0001', channelTitle: '', viewCount: null, thumbnailUrl: 'https://i.ytimg.com/vi/manualV0001/hqdefault.jpg' }]
    const r = await machine.researchSelect({ selectedVideoIds: ['vidA', 'manualV0001'], manualVideos: manual })
    expect(r.ok).toBe(true)
    const draft = await loadJson(dir, 'research.draft.json')
    expect(draft.selectedVideoIds).toEqual(['vidA', 'manualV0001'])
    expect(draft.manualVideos).toEqual(manual)

    // 재오픈(machine 재생성): 수동 카드가 videos에 병합돼 "카드 없는 유령 선택"이 없다.
    const m2 = makeMachine()
    const opened = await m2.open()
    expect(opened.research.selectedVideoIds).toEqual(['vidA', 'manualV0001'])
    expect(opened.research.videos.map((v) => v.videoId)).toEqual(['vidA', 'vidB', 'manualV0001'])
  })

  it('research-state를 emit해 renderer 상태를 최신화한다', async () => {
    await machine.researchSelect({ selectedVideoIds: ['vidA'], manualVideos: [] })
    const ev = emitted.find((e) => e.ch === 'story:research-state')
    expect(ev.payload.research.selectedVideoIds).toEqual(['vidA'])
  })

  it('research 진행 중이면 busy', async () => {
    let resolveSearch
    youtube.searchVideos.mockImplementationOnce(() => new Promise((r) => { resolveSearch = r }))
    const p = machine.researchSearch({ keyword: 'k' })
    while (!resolveSearch) { await new Promise((r) => setImmediate(r)) }
    expect(await machine.researchSelect({ selectedVideoIds: [] })).toEqual({ error: 'busy' })
    resolveSearch({ videos: VIDEOS })
    await p
  })

  // m5-잔여(R2): researchSelect가 controller 미설정이면 fetch와 겹쳐 stale 스냅샷으로
  // draft.transcripts를 덮을 수 있다(lost-update). controller를 동기 설정해 fetch와 상호배제한다.
  it('researchSelect 진행 중에는 fetch가 busy — controller 설정으로 fetch와 상호배제 (m5-잔여)', async () => {
    await machine.researchSearch({ keyword: 'k' })
    // await 없이 두 액션을 같은 tick에 발사 — researchSelect가 controller를 동기 설정했으면
    // 뒤이은 fetch의 busy 검사(동기)가 걸린다(controller 미설정이면 겹쳐 실행됨).
    const selectP = machine.researchSelect({ selectedVideoIds: ['vidA'] })
    const fetchResult = await machine.researchFetchTranscripts({ videoIds: ['vidB'] })
    await selectP
    expect(fetchResult).toEqual({ error: 'busy' })
    // fetch가 막혔으니 transcripts는 비어 있고 selection만 반영된다(stale 덮어쓰기 없음).
    const draft = await loadJson(dir, 'research.draft.json')
    expect(draft.selectedVideoIds).toEqual(['vidA'])
    expect(draft.transcripts).toBeUndefined()
  })

  it('researchSelect는 draft의 다른 필드(transcripts/analysis)를 보존하며 부분 병합한다 (m5-잔여)', async () => {
    await machine.researchSearch({ keyword: 'k' })
    await machine.researchFetchTranscripts({ videoIds: ['vidA'] })
    await machine.researchAnalyze({ videoIds: ['vidA'] })
    await machine.researchSelect({ selectedVideoIds: ['vidA', 'vidB'] })
    const draft = await loadJson(dir, 'research.draft.json')
    expect(draft.selectedVideoIds).toEqual(['vidA', 'vidB'])
    // 선택만 바꿔도 자막/분석은 그대로 — 통째 스냅샷 덮어쓰기가 아니라 부분 병합.
    expect(draft.transcripts.vidA).toMatchObject({ ok: true })
    expect(draft.analysis).toEqual(ANALYSIS)
  })
})

// ---------- researchFetchTranscripts ----------
describe('researchFetchTranscripts (side action, §3.8 즉시 durable)', () => {
  it('videoId별 fetchTranscript → draft.transcripts 즉시 저장 + srt는 research/transcripts/<id>.srt', async () => {
    await machine.researchSearch({ keyword: 'k' })
    const r = await machine.researchFetchTranscripts({ videoIds: ['vidA', 'vidB'] })
    expect(youtube.fetchTranscript).toHaveBeenCalledTimes(2)
    expect(r.transcripts).toEqual([
      { videoId: 'vidA', ok: true, lang: 'ko', isAuto: false },
      { videoId: 'vidB', ok: true, lang: 'ko', isAuto: false },
    ])
    const draft = await loadJson(dir, 'research.draft.json')
    expect(draft.selectedVideoIds).toEqual(['vidA', 'vidB'])
    expect(draft.transcripts.vidA).toMatchObject({ ok: true, lang: 'ko', plainText: '자막 본문 vidA' })
    expect(await loadText(dir, 'research/transcripts/vidA.srt')).toContain('안녕(vidA)')
    expect(await loadText(dir, 'research/transcripts/vidB.srt')).toContain('안녕(vidB)')
  })

  it('videoId별 story:progress(kind=research-fetch) running→done을 emit한다', async () => {
    await machine.researchFetchTranscripts({ videoIds: ['vidA'] })
    const evs = emitted.filter((e) => e.ch === 'story:progress' && e.payload.kind === 'research-fetch')
    expect(evs.map((e) => e.payload.status)).toEqual(['running', 'done'])
    expect(evs[1].payload).toMatchObject({ videoId: 'vidA', lang: 'ko', isAuto: false })
    expect(evs.every((e) => e.payload.projectToken === machine.projectToken)).toBe(true)
  })

  it('부분 실패 허용: 실패 videoId는 error로 기록하고 나머지는 진행한다(§6)', async () => {
    youtube.fetchTranscript.mockImplementation(async (videoId) => (
      videoId === 'vidA'
        ? { videoId, ok: false, error: 'no-transcript' }
        : { videoId, ok: true, lang: 'en', isAuto: true, srt: 's', plainText: 'p' }
    ))
    const r = await machine.researchFetchTranscripts({ videoIds: ['vidA', 'vidB'] })
    expect(r.transcripts).toEqual([
      { videoId: 'vidA', ok: false, error: 'no-transcript' },
      { videoId: 'vidB', ok: true, lang: 'en', isAuto: true },
    ])
    const draft = await loadJson(dir, 'research.draft.json')
    expect(draft.transcripts.vidA).toEqual({ ok: false, error: 'no-transcript' })
    expect(draft.transcripts.vidB).toMatchObject({ ok: true })
    const errEv = emitted.find((e) => e.payload.kind === 'research-fetch' && e.payload.status === 'error')
    expect(errEv.payload).toMatchObject({ videoId: 'vidA', error: 'no-transcript' })
  })

  it('불안전한 videoId(경로 문자를 포함)는 파일을 쓰지 않고 invalid-video-id로 기록한다', async () => {
    const r = await machine.researchFetchTranscripts({ videoIds: ['../evil'] })
    expect(r.transcripts).toEqual([{ videoId: '../evil', ok: false, error: 'invalid-video-id' }])
    expect(youtube.fetchTranscript).not.toHaveBeenCalled()
  })

  // M4(R1): fetchTranscript가 langs 미전달이면 ko 고정 → en 프로젝트에서 ko 자막이 잡혀
  // "영어 자막 없음" 거짓 배지 + 분석이 한국어 자막으로. 프로젝트 언어를 1순위로 전달한다.
  it('프로젝트 언어를 1순위로 fetchTranscript langs에 전달한다 (M4)', async () => {
    await machine.researchSearch({ keyword: 'k' })
    await machine.researchFetchTranscripts({ videoIds: ['vidA'], options: { language: 'en' } })
    expect(youtube.fetchTranscript).toHaveBeenCalledWith('vidA', expect.objectContaining({ langs: ['en', 'ko'] }))
  })

  it('language 미지정이면 ko 우선 langs(현행 회귀)', async () => {
    await machine.researchSearch({ keyword: 'k' })
    await machine.researchFetchTranscripts({ videoIds: ['vidA'] })
    expect(youtube.fetchTranscript).toHaveBeenCalledWith('vidA', expect.objectContaining({ langs: ['ko', 'en'] }))
  })
})

// ---------- researchAnalyze ----------
describe('researchAnalyze (side action, 라우터 경유)', () => {
  beforeEach(async () => {
    await machine.researchSearch({ keyword: 'k' })
    await machine.researchFetchTranscripts({ videoIds: ['vidA', 'vidB'] })
  })

  it('선택된 ok 자막들로 llm.analyzeResearch 호출(제목 포함, apiKey 주입) → analysis 반환 + draft 저장', async () => {
    const r = await machine.researchAnalyze({ videoIds: ['vidA', 'vidB'] })
    expect(r.analysis).toEqual(ANALYSIS)
    const [transcripts, opts] = llm.analyzeResearch.mock.calls[0]
    expect(transcripts).toEqual([
      { videoId: 'vidA', title: '영상A', plainText: '자막 본문 vidA' },
      { videoId: 'vidB', title: '영상B', plainText: '자막 본문 vidB' },
    ])
    expect(opts.apiKey).toBe('k')
    expect((await loadJson(dir, 'research.draft.json')).analysis).toEqual(ANALYSIS)
  })

  it('videoIds 생략 시 draft.selectedVideoIds를 쓰고, ok 자막이 0개면 no-transcripts-selected', async () => {
    await machine.researchAnalyze({})
    expect(llm.analyzeResearch.mock.calls[0][0]).toHaveLength(2)

    const empty = await machine.researchAnalyze({ videoIds: ['없는것'] })
    expect(empty).toEqual({ error: 'no-transcripts-selected' })
  })

  // M2(Fable R1) 회귀 고정: UI가 전달한 options(엔진·모델·언어)가 LLM opts에 반영된다(D10).
  it('params.options의 엔진·언어가 analyzeResearch opts에 반영된다 (M2)', async () => {
    await machine.researchAnalyze({ videoIds: ['vidA'], options: { engine: 'codex', model: 'gpt-5.5', language: 'en' } })
    const opts = llm.analyzeResearch.mock.calls[0][1]
    expect(opts).toMatchObject({ engine: 'codex', model: 'gpt-5.5', language: 'en' })
  })
})

// ---------- researchFactCheck ----------
describe('researchFactCheck (side action, 주입된 factCheck 어댑터 — 라우터 우회 N4)', () => {
  beforeEach(async () => {
    await machine.researchSearch({ keyword: 'k' })
    await machine.researchFetchTranscripts({ videoIds: ['vidA'] })
    await machine.researchAnalyze({ videoIds: ['vidA'] })
  })

  it('draft.analysis.claims로 주입된 factCheck 호출 → verifiedClaims 반환 + draft 저장', async () => {
    const r = await machine.researchFactCheck({})
    expect(factCheck).toHaveBeenCalledTimes(1)
    const [claims, opts] = factCheck.mock.calls[0]
    expect(claims).toEqual(ANALYSIS.claims)
    expect(opts).toMatchObject({ language: 'ko' })
    expect(r.verifiedClaims).toEqual(FACTCHECK_RESULT.claims)
    expect((await loadJson(dir, 'research.draft.json')).verifiedClaims).toEqual(FACTCHECK_RESULT.claims)
  })

  it('라우터(llm)에는 factCheckClaims가 없어도 동작한다 (라우터 우회 검증)', async () => {
    expect(llm.factCheckClaims).toBeUndefined()
    const r = await machine.researchFactCheck({})
    expect(r.verifiedClaims).toHaveLength(2)
  })

  it('claims가 없으면 no-claims (factCheck 미호출)', async () => {
    const m2 = makeMachine()
    await m2.open()
    await m2.researchSkip()
    const r = await m2.researchFactCheck({})
    expect(r).toEqual({ error: 'no-claims' })
  })

  // M2(Fable R1) 회귀 고정: 팩트체크는 엔진 Claude 강제(어댑터 소관)지만 언어는 UI 옵션을 따른다.
  it('params.options.language가 factCheck opts에 반영된다 (M2)', async () => {
    await machine.researchFactCheck({ options: { language: 'en' } })
    expect(factCheck.mock.calls[0][1]).toMatchObject({ language: 'en' })
  })
})

// ---------- researchCommit / researchSkip ----------
describe('researchCommit / researchSkip (§3.8 영속)', () => {
  beforeEach(async () => {
    await machine.researchSearch({ keyword: 'k' })
    await machine.researchFetchTranscripts({ videoIds: ['vidA'] })
    await machine.researchAnalyze({ videoIds: ['vidA'] })
    await machine.researchFactCheck({})
  })

  it('commit: research.json(analysis + supported만 + sources) 저장 + state.research 마커 durable', async () => {
    const r = await machine.researchCommit({})
    expect(r.ok).toBe(true)
    const research = await loadJson(dir, 'research.json')
    expect(research.analysis).toEqual(ANALYSIS)
    // §3.5: supported만 최종 컨텍스트에 채택 (refuted 제외)
    expect(research.verifiedClaims).toEqual([FACTCHECK_RESULT.claims[0]])
    // §7: 출처 videoId 기록
    expect(research.sources).toEqual(['vidA'])
    expect((await readStory(dir)).research).toEqual({ hasResearch: true })
  })

  it('commit: params의 analysis/verifiedClaims가 draft보다 우선한다 (IPC §5 페이로드)', async () => {
    const analysis = { structure: [], claims: [], commonThemes: ['편집됨'] }
    await machine.researchCommit({ analysis, verifiedClaims: [{ claim: 'c', verdict: 'supported', evidence: [] }] })
    const research = await loadJson(dir, 'research.json')
    expect(research.analysis).toEqual(analysis)
    expect(research.verifiedClaims).toEqual([{ claim: 'c', verdict: 'supported', evidence: [] }])
  })

  // 개선4(2026-07-08) + m3(R1): 팩트체크 미검증/반박 주장도 채택 가능. 채택은 **인덱스 기반**
  // (adoptedIndices) — 동일 claim 문자열이 여럿이어도 개별 토글되고 정확히 그 항목만 저장된다.
  it('commit: adoptedIndices 배열이 오면 해당 인덱스 주장만 저장 — 미검증 채택 포함, 해제한 supported 제외 (개선4/m3)', async () => {
    const claims = [
      { claim: 'A(검증)', verdict: 'supported', evidence: [] },
      { claim: 'B(미검증)', verdict: 'unverified', evidence: [] },
      { claim: 'C(반박)', verdict: 'refuted', evidence: [] },
    ]
    const r = await machine.researchCommit({ verifiedClaims: claims, adoptedIndices: [1, 2] })
    expect(r.ok).toBe(true)
    expect((await loadJson(dir, 'research.json')).verifiedClaims).toEqual([claims[1], claims[2]])
  })

  it('commit: 동일 claim 문자열이 중복돼도 인덱스로 정확히 하나만 채택된다 (m3 — includes 중복 버그 방지)', async () => {
    const claims = [
      { claim: '같은문장', verdict: 'supported', evidence: [{ url: 'https://a' }] },
      { claim: '같은문장', verdict: 'unverified', evidence: [] },
    ]
    await machine.researchCommit({ verifiedClaims: claims, adoptedIndices: [0] })
    expect((await loadJson(dir, 'research.json')).verifiedClaims).toEqual([claims[0]])
  })

  it('commit: adoptedIndices=[]이면 아무 주장도 저장하지 않는다 (전체 해제)', async () => {
    await machine.researchCommit({ adoptedIndices: [] })
    expect((await loadJson(dir, 'research.json')).verifiedClaims).toEqual([])
  })

  it('commit: adoptedIndices 미전달 → draft의 supported만 (기본 동작 회귀)', async () => {
    await machine.researchCommit({})
    expect((await loadJson(dir, 'research.json')).verifiedClaims).toEqual([FACTCHECK_RESULT.claims[0]])
  })

  it('analysis가 없으면 commit 거부(no-analysis)', async () => {
    await machine.researchSkip()
    expect(await machine.researchCommit({})).toEqual({ error: 'no-analysis' })
  })

  it('팩트체크 미실행이어도 구조분석만으로 commit 허용 — verifiedClaims=[] (§6)', async () => {
    const m2 = makeMachine()
    await m2.open()
    await m2.researchSkip()
    await m2.researchSearch({ keyword: 'k' })
    await m2.researchFetchTranscripts({ videoIds: ['vidA'] })
    await m2.researchAnalyze({ videoIds: ['vidA'] })
    const r = await m2.researchCommit({})
    expect(r.ok).toBe(true)
    expect((await loadJson(dir, 'research.json')).verifiedClaims).toEqual([])
  })

  it('skip: draft/research.json/transcripts 정리 + state.research 클리어', async () => {
    await machine.researchCommit({})
    const r = await machine.researchSkip()
    expect(r.ok).toBe(true)
    expect(existsSync(path.join(dir, 'story', 'research.draft.json'))).toBe(false)
    expect(existsSync(path.join(dir, 'story', 'research.json'))).toBe(false)
    expect(existsSync(path.join(dir, 'story', 'research', 'transcripts', 'vidA.srt'))).toBe(false)
    expect((await readStory(dir)).research).toBeUndefined()
  })
})

// ---------- hydrate (§3.8 M6 재오픈 복원) ----------
describe('research hydrate — 재오픈 복원 (story:open마다 machine 재생성 대비)', () => {
  it('진행 중 draft: 재생성한 machine의 open()이 research 상태(plainText 제외 메타)를 복원한다', async () => {
    await machine.researchSearch({ keyword: '야담' })
    await machine.researchFetchTranscripts({ videoIds: ['vidA'] })
    await machine.researchAnalyze({ videoIds: ['vidA'] })

    const m2 = makeMachine()
    const r = await m2.open()
    expect(r.research).toMatchObject({
      confirmed: false,
      keyword: '야담',
      selectedVideoIds: ['vidA'],
      analysis: ANALYSIS,
    })
    expect(r.research.videos).toEqual(VIDEOS)
    expect(r.research.transcripts.vidA).toMatchObject({ ok: true, lang: 'ko' })
    // 자막 원문은 hydrate 페이로드에 싣지 않는다(대용량) — draft 파일에만 남는다.
    expect(r.research.transcripts.vidA.plainText).toBeUndefined()
    // story:state emit에도 포함
    const ev = emitted.find((e) => e.ch === 'story:state' && e.payload.research)
    expect(ev.payload.research.keyword).toBe('야담')
  })

  it('commit 후: confirmed=true + analysis/verifiedClaims 복원 (getState)', async () => {
    await machine.researchSearch({ keyword: 'k' })
    await machine.researchFetchTranscripts({ videoIds: ['vidA'] })
    await machine.researchAnalyze({ videoIds: ['vidA'] })
    await machine.researchFactCheck({})
    await machine.researchCommit({})

    const m2 = makeMachine()
    await m2.open()
    const st = await m2.getState()
    expect(st.research.confirmed).toBe(true)
    expect(st.research.analysis).toEqual(ANALYSIS)
  })

  it('리서치 미사용 프로젝트는 research=null (legacy 회귀 고정 §D14)', async () => {
    const r = await machine.open()
    expect(r.research).toBeNull()
  })

  // m7-잔여(R2): 이미 commit된 프로젝트가 재진입→새 검색(draft.analysis 삭제)해도
  // hydrate가 committed.analysis로 폴백하면 옛 analysis가 되살아나 새 keyword+옛 analysis로
  // 불일치 commit된다. 새 검색 후에는 draft가 committed 폴백을 무효화(analysis=null 유지)해야 한다.
  it('committed 프로젝트 재진입 → 새 검색: hydrate가 committed.analysis를 되살리지 않는다 (m7-잔여)', async () => {
    await machine.researchSearch({ keyword: '원래' })
    await machine.researchFetchTranscripts({ videoIds: ['vidA'] })
    await machine.researchAnalyze({ videoIds: ['vidA'] })
    await machine.researchFactCheck({})
    await machine.researchCommit({}) // research.json에 analysis 저장

    // 재진입 후 새 검색 — draft.analysis/verifiedClaims/선택은 클리어된다.
    await machine.researchSearch({ keyword: '완전히 다른 키워드' })

    const st = await machine.getState()
    expect(st.research.analysis).toBeNull() // committed 폴백으로 되살아나면 안 됨
    expect(st.research.verifiedClaims).toEqual([])
    expect(st.research.keyword).toBe('완전히 다른 키워드')

    // 재오픈(machine 재생성)에도 동일 — draft 우선.
    const m2 = makeMachine()
    const opened = await m2.open()
    expect(opened.research.analysis).toBeNull()

    // 분석 전 commit은 거부(불일치 research.json 방지).
    expect(await machine.researchCommit({})).toEqual({ error: 'no-analysis' })
  })

  it('재검색 후 재분석하면 새 analysis가 정상 복원된다 (m7-잔여 — dirty 해제 회귀)', async () => {
    await machine.researchSearch({ keyword: '원래' })
    await machine.researchFetchTranscripts({ videoIds: ['vidA'] })
    await machine.researchAnalyze({ videoIds: ['vidA'] })
    await machine.researchCommit({})

    await machine.researchSearch({ keyword: '새 키워드' })
    await machine.researchFetchTranscripts({ videoIds: ['vidA'] })
    const newAnalysis = { structure: [{ beat: '신규', summary: '새 분석' }], claims: [], commonThemes: [] }
    llm.analyzeResearch.mockResolvedValueOnce(newAnalysis)
    await machine.researchAnalyze({ videoIds: ['vidA'] })

    const st = await machine.getState()
    expect(st.research.analysis).toEqual(newAnalysis) // draft.analysis 우선(dirty여도 draft에 있으면 표시)
    expect((await machine.researchCommit({})).ok).toBe(true)
    expect((await loadJson(dir, 'research.json')).analysis).toEqual(newAnalysis)
  })
})

// ---------- busy 뮤텍스 + abort (§5) ----------
describe('research busy 뮤텍스 / abort 대칭', () => {
  it('research 진행 중이면 start/generateSynopsis/confirmSynopsis/synthPreview/다른 research 모두 busy', async () => {
    let resolveSearch
    youtube.searchVideos.mockImplementationOnce(() => new Promise((r) => { resolveSearch = r }))
    const p = machine.researchSearch({ keyword: 'k' })
    while (!resolveSearch) { await new Promise((r) => setImmediate(r)) }

    expect(await machine.start('script', { input: { type: 'title', title: 'T' } })).toEqual({ error: 'busy' })
    expect(await machine.generateSynopsis({ type: 'title', title: 'T' })).toEqual({ error: 'busy' })
    expect(await machine.confirmSynopsis({ synopsisMd: 's', characters: [] })).toEqual({ error: 'busy' })
    expect(await machine.synthPreview({ segmentIds: [] })).toEqual({ busy: true })
    expect(await machine.researchSearch({ keyword: 'k2' })).toEqual({ error: 'busy' })
    expect(await machine.researchFetchTranscripts({ videoIds: ['vidA'] })).toEqual({ error: 'busy' })
    expect(await machine.researchCommit({})).toEqual({ error: 'busy' })
    expect(await machine.researchSkip()).toEqual({ error: 'busy' })

    resolveSearch({ videos: VIDEOS })
    await p
    // 종료 후 정상 재개
    const r = await machine.researchSearch({ keyword: 'k3' })
    expect(r.videos).toEqual(VIDEOS)
  })

  it('스텝 running/시놉시스 진행 중이면 research side action은 busy', async () => {
    let resolveScript
    llm.generateScript.mockImplementationOnce(() => new Promise((r) => { resolveScript = r }))
    const p = machine.start('script', { input: { type: 'title', title: 'T' }, options: { language: 'ko' } })
    while (!resolveScript) { await new Promise((r) => setImmediate(r)) }
    expect(await machine.researchSearch({ keyword: 'k' })).toEqual({ error: 'busy' })
    expect(youtube.searchVideos).not.toHaveBeenCalled()
    resolveScript({ scriptMd: '#' })
    await p
  })

  it('abort(): 진행 중 fetch를 중단하고 나머지 videoId를 처리하지 않는다 + 부분 draft는 유지(§6)', async () => {
    let resolveFirst
    youtube.fetchTranscript.mockImplementationOnce(() => new Promise((r) => { resolveFirst = r }))
    const p = machine.researchFetchTranscripts({ videoIds: ['vidA', 'vidB'] })
    while (!resolveFirst) { await new Promise((r) => setImmediate(r)) }
    await machine.abort()
    resolveFirst({ videoId: 'vidA', ok: true, lang: 'ko', isAuto: false, srt: 's', plainText: 'p' })
    await p
    expect(youtube.fetchTranscript).toHaveBeenCalledTimes(1) // vidB 미진행
    // abort 후 재시작 가능(controller 정리)
    const r = await machine.researchFetchTranscripts({ videoIds: ['vidB'] })
    expect(r.transcripts).toHaveLength(1)
  })

  // m3(Fable R1): abort 시 in-flight video가 done/error 없이 break되면 renderer의 fetchProgress에
  // 'running' 배지가 잔류한다 — abort된 in-flight를 error(aborted)로 마킹해 배지를 정리한다.
  it('abort(): in-flight videoId를 error(aborted)로 마킹해 stale running 배지를 남기지 않는다 (m3)', async () => {
    let resolveFirst
    youtube.fetchTranscript.mockImplementationOnce(() => new Promise((r) => { resolveFirst = r }))
    const p = machine.researchFetchTranscripts({ videoIds: ['vidA', 'vidB'] })
    while (!resolveFirst) { await new Promise((r) => setImmediate(r)) }
    await machine.abort()
    resolveFirst({ videoId: 'vidA', ok: true, lang: 'ko', isAuto: false, srt: 's', plainText: 'p' })
    await p
    const evs = emitted
      .filter((e) => e.ch === 'story:progress' && e.payload.kind === 'research-fetch' && e.payload.videoId === 'vidA')
      .map((e) => e.payload)
    // 마지막 이벤트가 running으로 남지 않는다 — error(aborted)로 terminal 마킹.
    expect(evs.map((e) => e.status)).toEqual(['running', 'error'])
    expect(evs[evs.length - 1].error).toBe('aborted')
  })

  // M2(R1): fetch가 abort돼도 {transcripts}(부분성공)를 반환해 auto 오케스트레이션이 error만
  // 보면 다음 단계를 실행한다 — abort 시 반환에 aborted:true를 실어 auto가 중단할 수 있게 한다.
  it('abort 시 반환에 aborted:true 플래그를 싣는다 (M2 — 부분성공은 유지)', async () => {
    let resolveFirst
    youtube.fetchTranscript.mockImplementationOnce(() => new Promise((r) => { resolveFirst = r }))
    const p = machine.researchFetchTranscripts({ videoIds: ['vidA', 'vidB'] })
    while (!resolveFirst) { await new Promise((r) => setImmediate(r)) }
    await machine.abort()
    resolveFirst({ videoId: 'vidA', ok: true, lang: 'ko', isAuto: false, srt: 's', plainText: 'p' })
    const r = await p
    expect(r.aborted).toBe(true)
    expect(Array.isArray(r.transcripts)).toBe(true) // 부분성공 배열은 그대로
  })

  it('정상 완료 fetch에는 aborted 플래그가 없다 (M2 회귀)', async () => {
    await machine.researchSearch({ keyword: 'k' })
    const r = await machine.researchFetchTranscripts({ videoIds: ['vidA'] })
    expect(r.aborted).toBeUndefined()
  })
})

// ---------- m4: commit/skip 뮤텍스 + abort 가드 (§6 "abort 중 커밋") ----------
describe('researchCommit/researchSkip 뮤텍스·abort 가드 (m4)', () => {
  beforeEach(async () => {
    await machine.researchSearch({ keyword: 'k' })
    await machine.researchFetchTranscripts({ videoIds: ['vidA'] })
    await machine.researchAnalyze({ videoIds: ['vidA'] })
  })

  it('commit 진행 중에는 다른 research 액션이 busy — researchController 설정', async () => {
    const p = machine.researchCommit({})
    expect(await machine.researchSearch({ keyword: 'x' })).toEqual({ error: 'busy' })
    expect((await p).ok).toBe(true)
  })

  it('skip 진행 중에는 다른 research 액션이 busy — researchController 설정', async () => {
    const p = machine.researchSkip()
    expect(await machine.researchSearch({ keyword: 'x' })).toEqual({ error: 'busy' })
    expect((await p).ok).toBe(true)
  })

  it('abort 중 commit은 research.json을 저장하지 않는다 (signal.aborted 검사, §6)', async () => {
    const p = machine.researchCommit({})
    await machine.abort()
    expect(await p).toEqual({ error: 'aborted' })
    expect(existsSync(path.join(dir, 'story', 'research.json'))).toBe(false)
    expect((await readStory(dir)).research).toBeUndefined()
    // abort 후 재시도 가능(controller 정리)
    expect((await machine.researchCommit({})).ok).toBe(true)
  })

  it('abort 중 skip은 draft를 정리하지 않는다 (signal.aborted 검사)', async () => {
    const p = machine.researchSkip()
    await machine.abort()
    expect(await p).toEqual({ error: 'aborted' })
    expect(existsSync(path.join(dir, 'story', 'research.draft.json'))).toBe(true)
  })
})

// ---------- 시놉시스 연결 (§3.6 M2/Q5 수동 주입) ----------
describe('generateSynopsis({useResearch}) — research.json 수동 주입', () => {
  beforeEach(async () => {
    await machine.researchSearch({ keyword: 'k' })
    await machine.researchFetchTranscripts({ videoIds: ['vidA'] })
    await machine.researchAnalyze({ videoIds: ['vidA'] })
    await machine.researchFactCheck({})
    await machine.researchCommit({})
  })

  it('useResearch=true → research.json을 opts.research로 주입한다', async () => {
    await machine.generateSynopsis({ type: 'title', title: 'T', useResearch: true, options: { language: 'ko' } })
    const opts = llm.generateSynopsis.mock.calls[0][1]
    expect(opts.research).toMatchObject({
      analysis: ANALYSIS,
      verifiedClaims: [FACTCHECK_RESULT.claims[0]],
    })
  })

  it('useResearch falsy → research.json이 있어도 미주입 (회귀 고정)', async () => {
    await machine.generateSynopsis({ type: 'title', title: 'T', options: { language: 'ko' } })
    expect(llm.generateSynopsis.mock.calls[0][1].research).toBeUndefined()

    await machine.generateSynopsis({ type: 'title', title: 'T', useResearch: false, options: {} })
    expect(llm.generateSynopsis.mock.calls[1][1].research).toBeUndefined()
  })

  it('useResearch=true인데 research.json이 없으면 미주입(현행 동작)', async () => {
    await machine.researchSkip()
    await machine.generateSynopsis({ type: 'title', title: 'T', useResearch: true, options: {} })
    expect(llm.generateSynopsis.mock.calls[0][1].research).toBeUndefined()
  })
})
