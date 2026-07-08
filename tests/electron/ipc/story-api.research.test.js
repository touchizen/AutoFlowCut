// @vitest-environment node
// 리서치 슬라이스(spec §5): story:research-* guarded IPC 배선 — machine 위임 + 주입(youtube/factCheck).
// story-api.synopsis.test.js 미러.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { registerStoryIPC } from '../../../electron/ipc/story-api.js'

function fakeIpcMain() {
  const handlers = new Map()
  return { handle: (ch, fn) => handlers.set(ch, fn), invoke: (ch, payload) => handlers.get(ch)(null, payload), handlers }
}

const VIDEOS = [{ videoId: 'vidA', title: 'A', channelTitle: 'ch', viewCount: 1, durationSec: 10, thumbnailUrl: '' }]
const ANALYSIS = { structure: [{ beat: 'b', summary: 's' }], claims: [{ claim: 'c', sources: ['vidA'] }], commonThemes: [] }

let ipc, dir, llm, youtube, factCheck, sent
beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'ipc-research-'))
  ipc = fakeIpcMain()
  sent = []
  llm = {
    generateScript: vi.fn(async () => ({ scriptMd: '#' })),
    generateSynopsis: vi.fn(async () => ({ synopsisMd: '시놉', characters: [] })),
    splitScenes: vi.fn(async () => ({ scenes: [], speakers: [] })),
    writePrompts: vi.fn(async (s) => ({ scenes: s })),
    analyzeResearch: vi.fn(async () => ANALYSIS),
  }
  youtube = {
    searchVideos: vi.fn(async () => ({ videos: VIDEOS })),
    fetchTranscript: vi.fn(async (videoId) => ({ videoId, ok: true, lang: 'ko', isAuto: false, srt: 's', plainText: '본문' })),
  }
  factCheck = vi.fn(async () => ({ claims: [{ claim: 'c', verdict: 'supported', evidence: [] }] }))
  registerStoryIPC(ipc, {
    keyStore: { getKey: () => 'k' },
    getWindow: () => ({ webContents: { send: (ch, payload) => sent.push({ ch, payload }) }, isDestroyed: () => false }),
    llm, youtube, factCheck,
  })
})

const CHANNELS = ['story:research-search', 'story:research-fetch', 'story:research-analyze', 'story:research-factcheck', 'story:research-commit', 'story:research-skip', 'story:research-select']

describe('story:research-* IPC (guarded)', () => {
  it('일곱 핸들러가 모두 등록된다', () => {
    for (const ch of CHANNELS) expect(ipc.handlers.get(ch), ch).toBeDefined()
  })

  it('stale token은 전부 거부한다', async () => {
    await ipc.invoke('story:open', { projectPath: dir })
    for (const ch of CHANNELS) {
      const r = await ipc.invoke(ch, { projectToken: 'wrong', query: 'q', videoIds: [] })
      expect(r, ch).toEqual({ error: 'stale-token' })
    }
    expect(youtube.searchVideos).not.toHaveBeenCalled()
  })

  it('search: query(spec §5)/maxResults를 machine.researchSearch로 위임한다', async () => {
    const { projectToken } = await ipc.invoke('story:open', { projectPath: dir })
    const r = await ipc.invoke('story:research-search', { projectToken, query: '조선 야담', maxResults: 5 })
    expect(r.videos).toEqual(VIDEOS)
    expect(youtube.searchVideos).toHaveBeenCalledWith({ query: '조선 야담', maxResults: 5 })
  })

  it('fetch → analyze → factcheck → commit 전체 플로우가 IPC로 흐른다', async () => {
    const { projectToken } = await ipc.invoke('story:open', { projectPath: dir })
    await ipc.invoke('story:research-search', { projectToken, query: 'q' })
    const f = await ipc.invoke('story:research-fetch', { projectToken, videoIds: ['vidA'] })
    expect(f.transcripts).toEqual([{ videoId: 'vidA', ok: true, lang: 'ko', isAuto: false }])

    const a = await ipc.invoke('story:research-analyze', { projectToken, videoIds: ['vidA'] })
    expect(a.analysis).toEqual(ANALYSIS)
    expect(llm.analyzeResearch).toHaveBeenCalled()

    const fc = await ipc.invoke('story:research-factcheck', { projectToken })
    expect(fc.verifiedClaims).toEqual([{ claim: 'c', verdict: 'supported', evidence: [] }])
    expect(factCheck).toHaveBeenCalledWith(ANALYSIS.claims, expect.anything(), expect.anything())

    const c = await ipc.invoke('story:research-commit', { projectToken })
    expect(c.ok).toBe(true)
    const research = JSON.parse(await readFile(path.join(dir, 'story', 'research.json'), 'utf-8'))
    expect(research.analysis).toEqual(ANALYSIS)

    // hydrate: get-state에 research 상태 포함
    const gs = await ipc.invoke('story:get-state', { projectToken })
    expect(gs.research.confirmed).toBe(true)
  })

  it('search(개선2): dateFilter가 machine.researchSearch → searchVideos까지 전달된다', async () => {
    const { projectToken } = await ipc.invoke('story:open', { projectPath: dir })
    await ipc.invoke('story:research-search', { projectToken, query: 'q', maxResults: 20, dateFilter: 'month' })
    expect(youtube.searchVideos).toHaveBeenCalledWith({ query: 'q', maxResults: 20, dateFilter: 'month' })
  })

  // m5(R1): maxResults는 1~50으로 클램프한다(과대 pool로 인한 상세조회 폭주/타임아웃 방지).
  it('search(m5): maxResults를 1~50으로 클램프한다', async () => {
    const { projectToken } = await ipc.invoke('story:open', { projectPath: dir })
    await ipc.invoke('story:research-search', { projectToken, query: 'q', maxResults: 999 })
    expect(youtube.searchVideos).toHaveBeenCalledWith({ query: 'q', maxResults: 50 })
    await ipc.invoke('story:research-search', { projectToken, query: 'q', maxResults: 0 })
    expect(youtube.searchVideos).toHaveBeenCalledWith({ query: 'q', maxResults: 1 })
  })

  // M4(R1): fetch options(언어)가 machine → fetchTranscript langs까지 흐른다.
  it('fetch(M4): options.language가 machine.researchFetchTranscripts로 전달된다', async () => {
    const { projectToken } = await ipc.invoke('story:open', { projectPath: dir })
    await ipc.invoke('story:research-search', { projectToken, query: 'q' })
    await ipc.invoke('story:research-fetch', { projectToken, videoIds: ['vidA'], options: { language: 'en' } })
    expect(youtube.fetchTranscript).toHaveBeenCalledWith('vidA', expect.objectContaining({ langs: ['en', 'ko'] }))
  })

  it('commit(개선4/m3): adoptedIndices 페이로드가 machine으로 전달돼 인덱스 채택 주장이 저장된다', async () => {
    const { projectToken } = await ipc.invoke('story:open', { projectPath: dir })
    await ipc.invoke('story:research-search', { projectToken, query: 'q' })
    await ipc.invoke('story:research-fetch', { projectToken, videoIds: ['vidA'] })
    await ipc.invoke('story:research-analyze', { projectToken, videoIds: ['vidA'] })
    const claims = [
      { claim: 'S', verdict: 'supported', evidence: [] },
      { claim: 'U', verdict: 'unverified', evidence: [] },
    ]
    const c = await ipc.invoke('story:research-commit', { projectToken, verifiedClaims: claims, adoptedIndices: [0, 1] })
    expect(c.ok).toBe(true)
    const research = JSON.parse(await readFile(path.join(dir, 'story', 'research.json'), 'utf-8'))
    expect(research.verifiedClaims).toEqual(claims)
  })

  it('select(m5): selectedVideoIds/manualVideos를 machine.researchSelect로 위임해 draft에 영속한다', async () => {
    const { projectToken } = await ipc.invoke('story:open', { projectPath: dir })
    const manual = [{ videoId: 'manualV0001', title: 'manualV0001' }]
    const r = await ipc.invoke('story:research-select', { projectToken, selectedVideoIds: ['vidA'], manualVideos: manual })
    expect(r.ok).toBe(true)
    const draft = JSON.parse(await readFile(path.join(dir, 'story', 'research.draft.json'), 'utf-8'))
    expect(draft.selectedVideoIds).toEqual(['vidA'])
    expect(draft.manualVideos).toEqual(manual)
  })

  it('analyze/factcheck(M2): 페이로드 options가 machine까지 전달된다', async () => {
    const { projectToken } = await ipc.invoke('story:open', { projectPath: dir })
    await ipc.invoke('story:research-search', { projectToken, query: 'q' })
    await ipc.invoke('story:research-fetch', { projectToken, videoIds: ['vidA'] })
    await ipc.invoke('story:research-analyze', { projectToken, videoIds: ['vidA'], options: { engine: 'codex', model: 'gpt-5.5', language: 'en' } })
    expect(llm.analyzeResearch.mock.calls[0][1]).toMatchObject({ engine: 'codex', model: 'gpt-5.5', language: 'en' })

    await ipc.invoke('story:research-factcheck', { projectToken, options: { language: 'en' } })
    expect(factCheck.mock.calls[0][1]).toMatchObject({ language: 'en' })
  })

  it('skip: machine.researchSkip 위임 — draft 정리', async () => {
    const { projectToken } = await ipc.invoke('story:open', { projectPath: dir })
    await ipc.invoke('story:research-search', { projectToken, query: 'q' })
    const r = await ipc.invoke('story:research-skip', { projectToken })
    expect(r.ok).toBe(true)
    const gs = await ipc.invoke('story:get-state', { projectToken })
    expect(gs.research).toBeNull()
  })

  it('generate-synopsis 페이로드의 useResearch가 machine으로 전달된다 (§5 — 기존 채널 필드 추가)', async () => {
    const { projectToken } = await ipc.invoke('story:open', { projectPath: dir })
    await ipc.invoke('story:research-search', { projectToken, query: 'q' })
    await ipc.invoke('story:research-fetch', { projectToken, videoIds: ['vidA'] })
    await ipc.invoke('story:research-analyze', { projectToken, videoIds: ['vidA'] })
    await ipc.invoke('story:research-commit', { projectToken })

    await ipc.invoke('story:generate-synopsis', { projectToken, type: 'title', title: 'T', useResearch: true, options: {} })
    expect(llm.generateSynopsis.mock.calls[0][1].research).toBeTruthy()

    await ipc.invoke('story:generate-synopsis', { projectToken, type: 'title', title: 'T', options: {} })
    expect(llm.generateSynopsis.mock.calls[1][1].research).toBeUndefined()
  })
})
