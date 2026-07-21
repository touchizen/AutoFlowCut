/**
 * Story 파이프라인 IPC — 스펙 §6. 프로젝트당 하나의 스텝 머신 인스턴스.
 * 모든 R→M 명령은 projectToken 검증, 불일치 시 { error: 'stale-token' }.
 */
import { stat } from 'node:fs/promises'
import path from 'node:path'
import { createStepMachine, readAudioPackage } from '../story/stepMachine.js'
import { keyIdForProvider } from '../../src/config/apiKeyRegistry.js'
import * as llmGemini from '../api/llm/llmGemini.js'
import * as llmClaude from '../api/llm/llmClaude.js'
import { searchVideos } from '../api/youtube/searchVideos.js'
import { fetchTranscript } from '../api/youtube/fetchTranscript.js'
import { getVideoDetails } from '../api/youtube/getVideoDetails.js'
import { createTtsAdapter } from '../api/tts/index.js'
import { getTypecastKey } from '../api/tts/typecastKey.js'
import { probeDurationMs } from '../story/audioProbe.js'
import { DEFAULT_STORY_LLM, STORY_LLM_OPTIONS, setActiveStoryLlmCatalog } from '../api/llm/storyLlmCatalog.js'
import { buildClaudeStoryLlmOptions, buildCodexStoryLlmOptions, resolveStoryLlmCatalog } from '../api/llm/storyLlmDiscovery.js'
import { listCodexModels as defaultListCodexModels } from '../api/llm/codexAppServer.js'
import { clampResearchMaxResults } from '../story/researchParams.js'

// HIGH/Codex: renderer가 보낸 projectPath를 무검증으로 받으면 상대경로/traversal 경로로도
// 스텝 머신이 만들어져 임의 파일시스템 위치에 script.md/scenes.json/story.json을 쓸 수 있다.
// 절대경로 필수 + 원본 문자열에 ".." 세그먼트가 있으면 거부(정규화가 조용히 흡수해버리기
// 전에 원본에서 걸러낸다) + 정규화된 경로 기준 디렉토리 존재 확인까지 통과해야 연다.
function hasParentSegment(p) {
  return p.split(/[\\/]/).includes('..')
}

async function validateProjectPath(projectPath) {
  if (typeof projectPath !== 'string' || !projectPath) return false
  if (!path.isAbsolute(projectPath)) return false
  if (hasParentSegment(projectPath)) return false
  const normalized = path.normalize(projectPath)
  if (hasParentSegment(normalized)) return false
  try {
    const st = await stat(normalized)
    return st.isDirectory()
  } catch {
    return false
  }
}

// HIGH(부분): 절대경로/traversal/존재 검증을 통과해도 활성 workFolder(렌더러가 마지막으로
// activate한 작업 폴더) 밖의 임의 경로면 여전히 임의 위치에 script.md/scenes.json을 쓸 수
// 있다. workFolder가 알려져 있으면(활성화된 뒤) projectPath가 그 하위인지 확인한다.
function isWithinWorkFolder(projectPath, workFolder) {
  const rel = path.relative(workFolder, projectPath)
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel)
}

// M2 오디오 사전점검(§4.1/§4.3): audioPreflight()가 계산한 필요 provider 목록을 provider별
// 키 상태(store/fallback/missing)로 매핑하는 순수 함수 — IPC 핸들러에서 분리해 단위 테스트한다.
export function buildAudioPreflightResult(requiredProviders, { resolveKeyWithSource, encryptionAvailable }) {
  const providers = requiredProviders.map((provider) => {
    const keyId = keyIdForProvider(provider)
    const { source } = resolveKeyWithSource(keyId)
    const status = source === 'store' ? 'resolved-store' : source === 'fallback' ? 'resolved-fallback' : 'missing'
    return { provider, keyId, status, encryptionAvailable }
  })
  return { providers, encryptionAvailable }
}

/**
 * 🔴 **단일 storyCommands** (스펙 D7). `machine` 과 `openLock` 의 **유일한 소유자**다.
 *
 *     const storyCommands = createStoryCommands(deps)
 *     registerStoryIPC(ipcMain, storyCommands)
 *     toolCore.use(storyCommands)
 *
 * IPC(사람)와 Tool Core(에이전트)가 **같은 인스턴스**를 쓴다. 별도 Tool Core 가 자기 machine 을
 * 만들면 둘이 서로 다른 프로젝트를 보게 된다 — 같은 앱 안에서 상태가 갈라진다.
 */
export function createStoryCommands({ keyStore, getWindow, llm = llmGemini, loadMetaPrompt, getActiveWorkFolder = () => null, tts, ttsFor, probe, defaultVoice, sfxFor, youtube, factCheck, listClaudeModels = llmClaude.listClaudeModels, listCodexModels = defaultListCodexModels, resolveKeyWithSource, safeStorage }) {
  let machine = null
  let openLock = Promise.resolve()

  // 리서치(spec §3.1/§3.5): 검색·자막은 yt-dlp 모듈 직접 배선, 팩트체크는 Claude 강제라 라우터
  // 우회 — llmClaude.factCheckClaims를 machine deps로 주입(N4 DI seam, 테스트는 mock 주입).
  const youtubeApi = youtube || { searchVideos, fetchTranscript, getVideoDetails }
  const factCheckFn = factCheck || llmClaude.factCheckClaims

  // C1-a: audio 스텝은 tts/probe 주입이 필수(없으면 실앱에서 tts.capabilities() 크래시).
  // 테스트/커스텀 provider는 주입 우선, 기본은 Typecast 어댑터 + music-metadata probe.
  // 화자매핑 UI·멀티 provider 선택은 M2a-3. 키는 typecastKey(env→~/.typecast/credentials).
  // finding 4: getTypecastKey는 키가 없으면 throw하는 로더다 — 그대로 캐싱하면 그 throw가
  // 어댑터의 nullable getKey 경계를 우회해 MissingProviderKeyError 대신 raw Error가 샌다.
  // try/catch로 null을 캐싱해 어댑터가 정식으로 MissingProviderKeyError를 던지게 한다.
  let cachedTtsKey
  const ttsAdapter = tts || createTtsAdapter('typecast', {
    getKey: () => {
      if (cachedTtsKey !== undefined) return cachedTtsKey
      try { cachedTtsKey = getTypecastKey() } catch { cachedTtsKey = null }
      return cachedTtsKey
    },
    fetch: (...a) => globalThis.fetch(...a),
  })
  const probeFn = probe || ((filePath) => probeDurationMs(filePath))
  // C1-a: 화자 매핑 UI(M2a-3) 전에는 미배정 화자를 기본 voice로 폴백해 audio가 앱에서 돌게 한다.
  // Typecast Joonkyu(CLAUDE.md). 정식 화자매핑이 들어오면(M2a-3) 화자별 voice가 우선한다.
  const defaultVoiceCfg = defaultVoice || { provider: 'typecast', voiceId: 'tc_6436dbbb602bde66c6b39504' }

  const emit = (channel, payload) => {
    const win = getWindow?.()
    if (win && !win.isDestroyed()) win.webContents.send(channel, payload)
  }

  // 엔진이 보고하는 모델 목록으로 카탈로그를 만든다. CLI 프로세스를 띄우므로 한 번만 하고 캐시한다.
  // 두 엔진을 동시에 조회하고, 실패한 엔진만 정적 목록으로 메운다(다른 엔진까지 되돌리지 않는다).
  let llmCatalogPromise = null
  const loadLlmCatalog = () => {
    if (!llmCatalogPromise) {
      llmCatalogPromise = Promise.all([
        Promise.resolve().then(() => listClaudeModels()).catch(() => []),
        Promise.resolve().then(() => listCodexModels()).catch(() => []),
      ])
        .then(([claudeModels, codexModels]) => {
          const catalog = resolveStoryLlmCatalog({
            claude: buildClaudeStoryLlmOptions(claudeModels),
            codex: buildCodexStoryLlmOptions(codexModels),
            fallback: STORY_LLM_OPTIONS,
          })
          // 라우터/스텝머신도 같은 카탈로그로 검증해야 렌더러가 보낸 별칭 model 이 통과한다.
          setActiveStoryLlmCatalog(catalog)
          return catalog
        })
        .catch(() => [...STORY_LLM_OPTIONS])
    }
    return llmCatalogPromise
  }

  /**
   * 툴/IPC 가 공유하는 command 표면. **여기 아래로 `machine` 이 새어나가지 않는다** —
   * 새어나가면 Tool Core 가 자기 machine 을 만들 길이 생기고, 그게 D7 이 막으려는 버그다.
   */
  const commands = {
    get projectToken() { return machine?.projectToken ?? null },
    // M3 slice 32: Tool Core가 scene directory(`<projectPath>/scenes`)를 유도하는 유일한 소스.
    // open()이 절대/traversal/workFolder 검증을 통과한 값만 machine에 실리므로 여기 read-only로 노출한다.
    // machine 자체는 새지 않는다 — Tool Core가 자기 machine을 만들 길을 열지 않기 위함(D7).
    get projectPath() { return machine?.projectPath ?? null },
    hasProject: () => !!machine,

    async listLlmOptions() {
      const catalog = await loadLlmCatalog()
      const options = catalog.map((o) => ({ ...o, reasoningEfforts: [...(o.reasoningEfforts || [])] }))
      return { options, defaultOption: options[0] || { ...DEFAULT_STORY_LLM } }
    },

    open(projectPath) {
      // 동시 open 레이스 방지 — 직렬화(promise 체인): 이전 open이 끝나야 다음 open이 실행된다
      const task = openLock.then(async () => {
        if (!(await validateProjectPath(projectPath))) return { error: 'invalid-project-path' }
        const activeWorkFolder = getActiveWorkFolder()
        // activeWorkFolder를 아직 모르면(활성화 전) 기존 검증만 적용 — 하위호환.
        if (activeWorkFolder && !isWithinWorkFolder(projectPath, activeWorkFolder)) {
          return { error: 'invalid-project-path' }
        }
        if (machine) await machine.abort()
        machine = createStepMachine({ projectPath, llm, emit, getApiKey: () => keyStore.getKey(), loadMetaPrompt, tts: ttsAdapter, ttsFor, probe: probeFn, defaultVoice: defaultVoiceCfg, sfxFor, youtube: youtubeApi, factCheck: factCheckFn })
        return machine.open()
      })
      openLock = task.then(() => undefined, () => undefined)
      return task
    },

    getState: () => machine.getState(),

    // M2a-4 IP-A2: export(renderer)가 story 나레이션 배치에 쓸 { manifest, lastPushedRevision }.
    // projectPath 가 오면 그 경로 디스크를 직접 읽는다 — fresh session(story view 미진입, machine
    // 없음)에서도 동작. 경로는 story:open 과 동일하게 검증(절대/traversal/workFolder)해 임의 위치
    // 읽기를 막는다(Codex round3). projectPath 가 없으면 열린 machine 의 프로젝트(open 시 이미 검증됨).
    // readAudioPackage 는 stale/손상 manifest 를 throw 로 알린다. 그 throw 를 그대로 두면
    // ipcRenderer.invoke 가 message 만 직렬화해 **errorKind 가 소실된다** — renderer 는 번역할
    // 코드가 없어 한국어 UI에도 내부 영문 진단문을 띄운다. 이 파일의 관습대로 { error: kind } 로
    // 넘긴다(stale-token 과 같은 모양). errorKind 없는 예외는 버그이므로 그대로 던져 드러낸다.
    async loadAudioPackage({ projectPath } = {}) {
      const asKind = async (fn) => {
        try { return await fn() } catch (e) {
          if (!e?.errorKind) throw e
          return { error: e.errorKind }
        }
      }
      if (projectPath) {
        if (!(await validateProjectPath(projectPath))) return null
        const activeWorkFolder = getActiveWorkFolder()
        if (activeWorkFolder && !isWithinWorkFolder(projectPath, activeWorkFolder)) return null
        return asKind(() => readAudioPackage(projectPath))
      }
      if (!machine) return null
      return asKind(() => machine.loadAudioPackage())
    },

    // M2 오디오 사전점검은 읽기 전용이라 projectToken guard를 타지 않는다. 프로젝트가 아직
    // 열리지 않았으면 다른 비guarded 조회(loadAudioPackage)처럼 빈 결과를 안전하게 돌려준다.
    async audioPreflight(params = {}) {
      if (!machine) return []
      return machine.audioPreflight(params)
    },
    // registerStoryIPC는 pre-built commands만 받으므로, 키 조회 deps도 같은 단일-owner 객체가
    // 캡처해 IPC의 결과 매핑에 필요한 최소 context만 제공한다(machine 자체는 노출하지 않는다).
    getAudioPreflightContext: () => ({
      resolveKeyWithSource: resolveKeyWithSource || (() => ({ key: null, source: null })),
      encryptionAvailable: safeStorage?.isEncryptionAvailable?.() ?? false,
    }),

    // 화자별 오디오 출처 파일 선택. renderer가 절대경로를 직접 만들지 않도록 main에서 열고,
    // 현재 창 소유권도 createStoryCommands가 캡처한 getWindow로 일관되게 적용한다.
    async pickAudioImportFile({ kind, title, filterName } = {}) {
      const { dialog } = await import('electron')
      const spec = kind === 'srt'
        ? { title: title || 'Select subtitles (SRT)', filters: [{ name: filterName || 'SubRip subtitles', extensions: ['srt'] }] }
        : { title: title || 'Select narration audio', filters: [{ name: filterName || 'Audio', extensions: ['mp3'] }] }
      const win = getWindow?.()
      const result = win
        ? await dialog.showOpenDialog(win, { properties: ['openFile'], ...spec })
        : await dialog.showOpenDialog({ properties: ['openFile'], ...spec })
      if (result.canceled || !result.filePaths.length) return { canceled: true }
      return { canceled: false, filePath: result.filePaths[0] }
    },

    stageImageFirst: (params) => machine.stageImageFirst(params),
    start: (step, params) => machine.start(step, params),
    abort: () => machine.abort(),
    ackPush: (params) => machine.ackPush(params),
    generateTitle: (scriptMd, options) => machine.generateTitle(scriptMd, options),
    generateSynopsis: (params) => machine.generateSynopsis(params),
    reviewSynopsis: (params) => machine.reviewSynopsis(params),
    confirmSynopsis: (params) => machine.confirmSynopsis(params),
    setSpeakers: (params) => machine.setSpeakers(params),
    synthPreview: (params) => machine.synthPreview(params),

    researchSearch: (params) => machine.researchSearch(params),
    researchFetchTranscripts: (params) => machine.researchFetchTranscripts(params),
    researchAnalyze: (params) => machine.researchAnalyze(params),
    researchFactCheck: (params) => machine.researchFactCheck(params),
    researchCommit: (params) => machine.researchCommit(params),
    researchSkip: () => machine.researchSkip(),
    researchSelect: (params) => machine.researchSelect(params),
    researchVideoDetails: (params) => machine.researchVideoDetails(params),
  }

  return commands
}

/**
 * IPC 는 **주입받은 단일 commands** 를 쓴다 (스펙 D7). deps 를 받아 자기 commands 를 만들지 않는다 —
 * 만들 수 있게 두면 main 이 실수로 두 번째 machine 을 띄우고, 에이전트와 사람의 상태가 갈라진다.
 *
 * custom 은 token guard 를 안 타는 것들: `story:list-llm-options`(프로젝트 무관), `story:open`
 * (토큰을 발급하는 쪽), `story:load-audio-package`(경로 직독 허용), `story:audio-preflight`
 * (읽기 전용 키 점검), `story:pick-audio-import-file`(OS 파일 선택).
 */
export function registerStoryIPC(ipcMain, commands) {
  const guarded = (fn) => async (_e, payload = {}) => {
    if (!commands.hasProject() || payload.projectToken !== commands.projectToken) return { error: 'stale-token' }
    return fn(payload)
  }

  ipcMain.handle('story:list-llm-options', () => commands.listLlmOptions())
  ipcMain.handle('story:open', (_e, { projectPath } = {}) => commands.open(projectPath))
  ipcMain.handle('story:load-audio-package', (_e, { projectPath } = {}) => commands.loadAudioPackage({ projectPath }))
  // M2 오디오 사전점검(§4.1/§4.3): command가 계산한 필요 provider에 provider별 키 상태를 붙인다.
  // 프로젝트 미오픈은 commands.audioPreflight()가 빈 목록으로 정규화한다.
  ipcMain.handle('story:audio-preflight', async (_e, params) => {
    const required = await commands.audioPreflight(params || {})
    const { resolveKeyWithSource, encryptionAvailable } = commands.getAudioPreflightContext()
    return buildAudioPreflightResult(required, { resolveKeyWithSource, encryptionAvailable })
  })

  ipcMain.handle('story:get-state', guarded(() => commands.getState()))
  ipcMain.handle('story:stage-image-first', guarded(({ fixedSceneRevision, imageFirstVariant, fixedScenes, storyboardCsv }) =>
    commands.stageImageFirst({ fixedSceneRevision, imageFirstVariant, fixedScenes, storyboardCsv })))
  ipcMain.handle('story:start', guarded(({ step, params }) => commands.start(step, params)))
  ipcMain.handle('story:abort', guarded(() => commands.abort()))
  ipcMain.handle('story:push-ack', guarded(({ operationId, pushRevision, ok, reason }) =>
    commands.ackPush({ operationId, pushRevision, ok, reason })))
  ipcMain.handle('story:generate-title', guarded(({ scriptMd, options }) => commands.generateTitle(scriptMd, options || {})))
  // 슬라이스4(§3.4 + §v2.8 M4): 시놉시스 생성 side action — title/pasted 분기는 machine이 처리.
  // 리서치 §5 M2: 기존 채널에 useResearch 필드 추가(신규 채널 아님) — true일 때만 research.json 주입.
  ipcMain.handle('story:generate-synopsis', guarded(({ type, title, pastedScript, options, useResearch }) =>
    commands.generateSynopsis({ type, title, pastedScript, useResearch, options: options || {} })))
  // 시놉시스 검수(spec 2026-07-10): draft-only — 결과를 돌려줄 뿐 저장하지 않는다.
  ipcMain.handle('story:review-synopsis', guarded(({ synopsisMd, characters, options, review }) =>
    commands.reviewSynopsis({ synopsisMd, characters, options: options || {}, review })))
  // 슬라이스4(§v2.8 M1 + §v2.9): 시놉시스 확정 커밋 채널(title·pasted 공통).
  ipcMain.handle('story:confirm-synopsis', guarded(({ synopsisMd, characters, sceneMode, imageFirstVariant, fixedSceneRevision }) =>
    commands.confirmSynopsis({ synopsisMd, characters, sceneMode, imageFirstVariant, fixedSceneRevision })))
  // 슬라이스1: 세그먼트 단건 TTS 테스트(배치와 분리, 스텝 상태 미변경).
  // §4.8 R3: synthPreview가 ProviderAuthError/MissingProviderKeyError(errorKind 있음)를 그대로
  // throw하면 ipcRenderer.invoke가 message만 직렬화해 errorKind가 소실된다 — renderer가 번역할
  // 코드를 잃고 raw 영문 진단문을 그대로 토스트한다. story:load-audio-package의 asKind 관습대로
  // { error: kind, provider } 로 감싸 돌려준다. errorKind 없는 예외는 버그이므로 그대로 던져 드러낸다.
  ipcMain.handle('story:tts-preview', guarded(async ({ segmentIds, speakers, sfxSources }) => {
    try {
      return await commands.synthPreview({ segmentIds, speakers, sfxSources })
    } catch (e) {
      if (!e?.errorKind) throw e
      return { error: e.errorKind, provider: e.provider }
    }
  }))

  // ── 화자별 오디오 출처 (mp3+SRT 가져오기) ──
  // 출처 자체는 speaker.voice = {provider:'import', mp3Path, srtPath}로 들어가므로 별도 채널이
  // 없다 — 기존 화자 배정(start('audio', {speakers}))이 그대로 나른다. 여기 있는 건 파일 선택뿐.
  //
  // 지연 electron import와 다국어 dialog 문자열 처리는 commands가 담당하고 IPC는 위임만 한다.
  ipcMain.handle('story:pick-audio-import-file', (_e, params = {}) => commands.pickAudioImportFile(params))

  // 리서치(spec §5): story:research-* guarded 핸들러 — machine research side action 위임.
  ipcMain.handle('story:research-search', guarded(({ query, keyword, maxResults, dateFilter }) =>
    commands.researchSearch({
      keyword: query ?? keyword,
      // m5(R1): maxResults를 1~50으로 클램프 — 과대 pool로 인한 상세조회 폭주/타임아웃 방지.
      ...(maxResults != null ? { maxResults: clampResearchMaxResults(maxResults) } : {}),
      // 개선2: 일자 필터(none|week|month) — 지정 시에만 전달.
      ...(dateFilter ? { dateFilter } : {}),
    })))
  // M4(R1): fetch도 언어 옵션을 받아 자막 1순위 언어를 프로젝트 언어로(analyze/factcheck 미러).
  ipcMain.handle('story:research-fetch', guarded(({ videoIds, options }) =>
    commands.researchFetchTranscripts({ videoIds: videoIds || [], options: options || {} })))
  ipcMain.handle('story:research-analyze', guarded(({ videoIds, options }) =>
    commands.researchAnalyze({ videoIds, options: options || {} })))
  ipcMain.handle('story:research-factcheck', guarded(({ options }) =>
    commands.researchFactCheck({ options: options || {} })))
  // 개선4/m3: adoptedIndices — 팩트체크 주장의 수동 채택 인덱스 목록(미전달 시 supported만).
  ipcMain.handle('story:research-commit', guarded(({ analysis, verifiedClaims, adoptedIndices }) =>
    commands.researchCommit({ analysis, verifiedClaims, adoptedIndices })))
  ipcMain.handle('story:research-skip', guarded(() => commands.researchSkip()))
  // m5: 수동 URL 카드·fetch 전 선택 영속(draft) — 탭전환/재오픈 유실 방지.
  ipcMain.handle('story:research-select', guarded(({ selectedVideoIds, manualVideos }) =>
    commands.researchSelect({ selectedVideoIds, manualVideos })))
  // 상세 모달(2026-07-08): 영상 카드 더블클릭 시 단일 영상 상세 조회. 파이프라인 상태 불변 — 온디맨드 읽기 전용.
  ipcMain.handle('story:research-video-details', guarded(({ videoId }) =>
    commands.researchVideoDetails({ videoId })))
}
