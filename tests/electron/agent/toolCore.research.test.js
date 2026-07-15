// @vitest-environment node
// M5 — 기존 storyCommands 리서치 파이프라인을 Tool Core에 그대로 노출한다(D7).
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createToolCore } from '../../../electron/agent/toolCore.js'
import { createGrantLedger, hashArgs } from '../../../electron/agent/grantLedger.js'
import { createStoryCommands, registerStoryIPC } from '../../../electron/ipc/story-api.js'

const VIDEOS = [{
  videoId: 'vidA',
  title: '영상 A',
  channelTitle: '채널 A',
  viewCount: 100,
  durationSec: 60,
  thumbnailUrl: 'https://i.ytimg.com/vi/vidA/hqdefault.jpg',
  uploadDate: '20260701',
}]
const ANALYSIS = {
  structure: [{ beat: '도입', summary: '요약' }],
  claims: [{ claim: '검증할 주장', sources: ['vidA'] }],
  commonThemes: ['테마'],
}
const VERIFIED = [{ claim: '검증할 주장', verdict: 'supported', evidence: [] }]
const RESEARCH_PERMISSIONS = {
  story_research_search: 'R',
  story_research_video_details: 'R',
  story_research_select: 'R',
  story_research_fetch_transcripts: 'R',
  story_research_analyze: 'G',
  story_research_factcheck: 'G',
  story_research_commit: 'G',
  story_research_skip: 'G',
}

function fakeIpcMain() {
  const handlers = new Map()
  return {
    handle: (channel, handler) => handlers.set(channel, handler),
    invoke: (channel, payload) => handlers.get(channel)(null, payload),
  }
}

function makeResearchCommands(overrides = {}) {
  const llm = {
    generateScript: vi.fn(async () => ({ scriptMd: '#' })),
    splitScenes: vi.fn(async () => ({ scenes: [], speakers: [] })),
    writePrompts: vi.fn(async (scenes) => ({ scenes })),
    analyzeResearch: vi.fn(async () => ANALYSIS),
    ...overrides.llm,
  }
  const youtube = {
    searchVideos: vi.fn(async () => ({ videos: VIDEOS })),
    fetchTranscript: vi.fn(async (videoId) => ({
      videoId, ok: true, lang: 'ko', isAuto: false, srt: '자막', plainText: '본문',
    })),
    getVideoDetails: vi.fn(async ({ videoId }) => ({ details: { videoId, title: '상세' } })),
    ...overrides.youtube,
  }
  const factCheck = overrides.factCheck || vi.fn(async () => ({ claims: VERIFIED }))
  const commands = createStoryCommands({
    keyStore: { getKey: () => 'key' },
    getWindow: () => ({ webContents: { send: () => {} }, isDestroyed: () => false }),
    llm,
    youtube,
    factCheck,
    listClaudeModels: async () => [],
    listCodexModels: async () => [],
  })
  return { commands, llm, youtube, factCheck }
}

function bindCore(commands, projectToken, { sessionId = 'research-session', ledger } = {}) {
  const grantLedger = ledger || createGrantLedger({ now: () => 0, ttlMs: 60_000 })
  const core = createToolCore({ grantLedger, sessionId, projectToken })
  core.use(commands)
  return { core, grantLedger, sessionId }
}

function grant({ grantLedger, sessionId }, commands, tool, args, nonce) {
  grantLedger.grant({
    nonce,
    tool,
    argsHash: hashArgs(args),
    sessionId,
    projectToken: commands.projectToken,
  })
}

let dir
beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'toolcore-research-'))
})

describe('M5 research Tool Core inventory와 위임', () => {
  it('list()에 research 8개가 정확한 R/G 권한으로 있고 B inventory는 generate_videos 하나뿐이다', () => {
    const tools = createToolCore().list()
    const research = Object.fromEntries(tools
      .filter((tool) => tool.name.startsWith('story_research_'))
      .map((tool) => [tool.name, tool.permission]))

    expect(research).toEqual(RESEARCH_PERMISSIONS)
    expect(tools.filter((tool) => tool.permission === 'B').map((tool) => tool.name)).toEqual(['generate_videos'])
  })

  it('8개 도구가 storyCommands의 기존 메서드에 adapter 인자를 정확히 위임한다', async () => {
    const commands = {
      projectToken: 'project-1',
      hasProject: () => true,
      researchSearch: vi.fn(async () => ({ videos: [] })),
      researchVideoDetails: vi.fn(async () => ({ details: { videoId: 'vidA' } })),
      researchSelect: vi.fn(async () => ({ ok: true, operationId: 'select-op' })),
      researchFetchTranscripts: vi.fn(async () => ({ transcripts: [] })),
      researchAnalyze: vi.fn(async () => ({ analysis: ANALYSIS })),
      researchFactCheck: vi.fn(async () => ({ verifiedClaims: VERIFIED })),
      researchCommit: vi.fn(async () => ({ ok: true, operationId: 'commit-op' })),
      researchSkip: vi.fn(async () => ({ ok: true, operationId: 'skip-op' })),
    }
    const bound = bindCore(commands, commands.projectToken)
    const manualVideos = [{
      videoId: 'manual_1', title: '수동', channelTitle: '', viewCount: null,
      thumbnailUrl: 'https://i.ytimg.com/vi/manual_1/hqdefault.jpg', durationSec: 0, uploadDate: '',
    }]
    const calls = [
      ['story_research_search', { keyword: '키워드', maxResults: 4.9, dateFilter: 'month' }],
      ['story_research_video_details', { videoId: 'vidA' }],
      ['story_research_select', { selectedVideoIds: ['vidA'], manualVideos }],
      ['story_research_fetch_transcripts', { videoIds: ['vidA'], options: { language: 'ko' } }],
      ['story_research_analyze', { videoIds: ['vidA'], options: { language: 'ko' } }],
      ['story_research_factcheck', { options: { language: 'ko' } }],
      ['story_research_commit', { adoptedIndices: [0] }],
      ['story_research_skip', {}],
    ]

    for (const [name, args] of calls) {
      const context = {}
      if (RESEARCH_PERMISSIONS[name] === 'G') {
        context.nonce = `grant-${name}`
        grant(bound, commands, name, args, context.nonce)
      }
      await bound.core.call(name, args, context)
    }

    expect(commands.researchSearch).toHaveBeenCalledWith({ keyword: '키워드', maxResults: 4, dateFilter: 'month' })
    expect(commands.researchVideoDetails).toHaveBeenCalledWith({ videoId: 'vidA' })
    expect(commands.researchSelect).toHaveBeenCalledWith({ selectedVideoIds: ['vidA'], manualVideos })
    expect(commands.researchFetchTranscripts).toHaveBeenCalledWith({ videoIds: ['vidA'], options: { language: 'ko' } })
    expect(commands.researchAnalyze).toHaveBeenCalledWith({ videoIds: ['vidA'], options: { language: 'ko' } })
    expect(commands.researchFactCheck).toHaveBeenCalledWith({ options: { language: 'ko' } })
    expect(commands.researchCommit).toHaveBeenCalledWith({ adoptedIndices: [0] })
    expect(commands.researchSkip).toHaveBeenCalledWith()
  })

  it('commit adapter는 0 이상의 정수 adoptedIndices만 machine에 위임한다', async () => {
    const commands = {
      projectToken: 'project-1',
      hasProject: () => true,
      researchCommit: vi.fn(async () => ({ ok: true, operationId: 'commit-op' })),
    }
    const bound = bindCore(commands, commands.projectToken)
    const args = { adoptedIndices: [1, 2.5, -1, 3] }
    grant(bound, commands, 'story_research_commit', args, 'normalized-commit')

    await expect(bound.core.call('story_research_commit', args, { nonce: 'normalized-commit' }))
      .resolves.toEqual({ operationId: 'commit-op', status: 'done' })
    expect(commands.researchCommit).toHaveBeenCalledWith({ adoptedIndices: [1, 3] })
  })

  it('R search는 grant 없이 실행되고 maxResults floor+clamp 및 dateFilter none 생략 뒤 done payload를 반환한다', async () => {
    const { commands, youtube } = makeResearchCommands({
      youtube: { searchVideos: vi.fn(async () => ({ videos: VIDEOS, dateFilterFallback: true })) },
    })
    const opened = await commands.open(dir)
    const { core } = bindCore(commands, opened.projectToken)

    const result = await core.call('story_research_search', {
      keyword: '조선 야담', maxResults: 99.9, dateFilter: 'none',
    })

    expect(result).toEqual({ videos: VIDEOS, dateFilterFallback: true, status: 'done' })
    expect(youtube.searchVideos).toHaveBeenCalledWith({ query: '조선 야담', maxResults: 50 })
    await core.call('story_research_search', { keyword: '최소', maxResults: 0.9 })
    expect(youtube.searchVideos).toHaveBeenCalledWith({ query: '최소', maxResults: 1 })
  })

  it('G analyze는 grant가 없으면 unconfirmed이고 LLM side effect가 0회다', async () => {
    const { commands, llm } = makeResearchCommands()
    const opened = await commands.open(dir)
    const { core } = bindCore(commands, opened.projectToken)

    await expect(core.call('story_research_analyze', { videoIds: ['vidA'] }))
      .resolves.toEqual({ status: 'rejected', reason: 'unconfirmed' })
    expect(llm.analyzeResearch).not.toHaveBeenCalled()
  })

  it('G commit은 grant 뒤 draft만 사용해 research.json을 저장하고 reopen에서도 보인다', async () => {
    const env = makeResearchCommands()
    const opened = await env.commands.open(dir)
    await env.commands.researchSearch({ keyword: '공유 리서치' })
    await env.commands.researchFetchTranscripts({ videoIds: ['vidA'] })
    await env.commands.researchAnalyze({ videoIds: ['vidA'] })
    await env.commands.researchFactCheck()
    const bound = bindCore(env.commands, opened.projectToken)
    const args = { adoptedIndices: [0] }
    grant(bound, env.commands, 'story_research_commit', args, 'commit-1')

    await expect(bound.core.call('story_research_commit', args, { nonce: 'commit-1' }))
      .resolves.toMatchObject({ operationId: expect.any(String), status: 'done' })

    const disk = JSON.parse(await readFile(path.join(dir, 'story', 'research.json'), 'utf8'))
    expect(disk).toMatchObject({ analysis: ANALYSIS, verifiedClaims: VERIFIED })
    const reopened = await makeResearchCommands().commands.open(dir)
    expect(reopened.research).toMatchObject({ confirmed: true, analysis: ANALYSIS, verifiedClaims: VERIFIED })
  })

  it('no-project는 grant를 소비하지 않아 프로젝트 open 뒤 같은 nonce로 재시도할 수 있다', async () => {
    let hasProject = false
    const commands = {
      projectToken: 'future-project',
      hasProject: () => hasProject,
      open: vi.fn(async () => {
        hasProject = true
        return { projectToken: 'future-project' }
      }),
      researchCommit: vi.fn(async () => ({ ok: true, operationId: 'commit-op' })),
    }
    const bound = bindCore(commands, commands.projectToken)
    const args = { adoptedIndices: [0] }
    grant(bound, commands, 'story_research_commit', args, 'retry-nonce')

    await expect(bound.core.call('story_research_commit', args, { nonce: 'retry-nonce' }))
      .resolves.toEqual({ status: 'rejected', reason: 'no-project' })
    await commands.open()
    await expect(bound.core.call('story_research_commit', args, { nonce: 'retry-nonce' }))
      .resolves.toEqual({ operationId: 'commit-op', status: 'done' })
    expect(commands.researchCommit).toHaveBeenCalledTimes(1)
  })

  it('세션 projectToken이 바뀌면 research tool은 stale-token으로 거부된다', async () => {
    const { commands, youtube } = makeResearchCommands()
    await commands.open(dir)
    const { core } = bindCore(commands, 'old-project-token')

    await expect(core.call('story_research_search', { keyword: '키워드' }))
      .resolves.toEqual({ status: 'rejected', reason: 'stale-token' })
    expect(youtube.searchVideos).not.toHaveBeenCalled()
  })

  it('진행 중 fetch가 mutex를 잡으면 승인된 analyze도 rejected/busy다', async () => {
    let releaseFetch
    const fetchTranscript = vi.fn(() => new Promise((resolve) => { releaseFetch = resolve }))
    const env = makeResearchCommands({ youtube: { fetchTranscript } })
    const opened = await env.commands.open(dir)
    const bound = bindCore(env.commands, opened.projectToken)
    const fetching = bound.core.call('story_research_fetch_transcripts', { videoIds: ['vidA'] })
    await vi.waitFor(() => expect(releaseFetch).toBeTypeOf('function'))
    const analyzeArgs = { videoIds: ['vidA'] }
    grant(bound, env.commands, 'story_research_analyze', analyzeArgs, 'analyze-busy')

    await expect(bound.core.call('story_research_analyze', analyzeArgs, { nonce: 'analyze-busy' }))
      .resolves.toEqual({ status: 'rejected', reason: 'busy' })
    expect(env.llm.analyzeResearch).not.toHaveBeenCalled()

    releaseFetch({ videoId: 'vidA', ok: true, lang: 'ko', isAuto: false, srt: 's', plainText: '본문' })
    await expect(fetching).resolves.toMatchObject({ status: 'done' })
  })

  it('researchRun은 부분 fetch aborted와 error aborted를 D8 aborted로 보존한다', async () => {
    const commands = {
      projectToken: 'project-1',
      hasProject: () => true,
      researchFetchTranscripts: vi.fn(async () => ({
        transcripts: [{ videoId: 'vidA', ok: true }], aborted: true,
      })),
      researchAnalyze: vi.fn(async () => ({ error: 'aborted' })),
    }
    const bound = bindCore(commands, commands.projectToken)

    await expect(bound.core.call('story_research_fetch_transcripts', { videoIds: ['vidA'] }))
      .resolves.toEqual({ status: 'aborted', transcripts: [{ videoId: 'vidA', ok: true }] })

    const args = { videoIds: ['vidA'] }
    grant(bound, commands, 'story_research_analyze', args, 'abort-analyze')
    await expect(bound.core.call('story_research_analyze', args, { nonce: 'abort-analyze' }))
      .resolves.toEqual({ status: 'aborted' })
  })

  it('research schema 위반은 invalid-params로 grant consume보다 먼저 닫힌다', async () => {
    const ledger = createGrantLedger({ now: () => 0, ttlMs: 60_000 })
    const core = createToolCore({ grantLedger: ledger, sessionId: 'schema-order', projectToken: 'project-1' })

    await expect(core.call('story_research_search', { keyword: 'q', maxResults: '10' }))
      .resolves.toEqual({ status: 'rejected', reason: 'invalid-params', params: ['maxResults'] })
    await expect(core.call('story_research_fetch_transcripts', { videoIds: [] }))
      .resolves.toEqual({ status: 'rejected', reason: 'invalid-params', params: ['videoIds'] })
    await expect(core.call('story_research_video_details', { videoId: 'a;rm -rf' }))
      .resolves.toEqual({ status: 'rejected', reason: 'invalid-params', params: ['videoId'] })

    const invalidCommit = { adoptedIndices: [0], analysis: ANALYSIS }
    const identity = {
      nonce: 'invalid-before-grant',
      tool: 'story_research_commit',
      argsHash: hashArgs(invalidCommit),
      sessionId: 'schema-order',
      projectToken: 'project-1',
    }
    ledger.grant(identity)
    await expect(core.call('story_research_commit', invalidCommit, { nonce: identity.nonce }))
      .resolves.toEqual({ status: 'rejected', reason: 'invalid-params', params: ['analysis'] })
    expect(ledger.consume(identity), 'invalid params가 승인 nonce를 소비했다').toBe(true)
  })

  it('D7: IPC search 직후 agent analyze가 같은 research draft의 영상 메타와 자막을 읽는다', async () => {
    await mkdir(path.join(dir, 'story'), { recursive: true })
    await writeFile(path.join(dir, 'story', 'research.draft.json'), JSON.stringify({
      transcripts: { vidA: { ok: true, lang: 'ko', isAuto: false, plainText: '공유 자막' } },
    }))
    const env = makeResearchCommands()
    const ipc = fakeIpcMain()
    registerStoryIPC(ipc, env.commands)
    const opened = await ipc.invoke('story:open', { projectPath: dir })
    await ipc.invoke('story:research-search', {
      projectToken: opened.projectToken, query: 'IPC가 쓴 검색', maxResults: 3,
    })
    const bound = bindCore(env.commands, opened.projectToken)
    const args = { videoIds: ['vidA'] }
    grant(bound, env.commands, 'story_research_analyze', args, 'shared-draft')

    await expect(bound.core.call('story_research_analyze', args, { nonce: 'shared-draft' }))
      .resolves.toEqual({ analysis: ANALYSIS, status: 'done' })
    expect(env.llm.analyzeResearch).toHaveBeenCalledWith(
      [{ videoId: 'vidA', title: '영상 A', plainText: '공유 자막' }],
      expect.any(Object),
      expect.any(Object),
    )
  })
})
