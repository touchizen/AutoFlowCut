/**
 * Story 파이프라인 IPC — 스펙 §6. 프로젝트당 하나의 스텝 머신 인스턴스.
 * 모든 R→M 명령은 projectToken 검증, 불일치 시 { error: 'stale-token' }.
 */
import { stat } from 'node:fs/promises'
import path from 'node:path'
import { createStepMachine, readAudioPackage } from '../story/stepMachine.js'
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

export function registerStoryIPC(ipcMain, { keyStore, getWindow, llm = llmGemini, loadMetaPrompt, getActiveWorkFolder = () => null, tts, ttsFor, probe, defaultVoice, sfxFor, youtube, factCheck, listClaudeModels = llmClaude.listClaudeModels, listCodexModels = defaultListCodexModels }) {
  let machine = null
  let openLock = Promise.resolve()

  // 리서치(spec §3.1/§3.5): 검색·자막은 yt-dlp 모듈 직접 배선, 팩트체크는 Claude 강제라 라우터
  // 우회 — llmClaude.factCheckClaims를 machine deps로 주입(N4 DI seam, 테스트는 mock 주입).
  const youtubeApi = youtube || { searchVideos, fetchTranscript, getVideoDetails }
  const factCheckFn = factCheck || llmClaude.factCheckClaims

  // C1-a: audio 스텝은 tts/probe 주입이 필수(없으면 실앱에서 tts.capabilities() 크래시).
  // 테스트/커스텀 provider는 주입 우선, 기본은 Typecast 어댑터 + music-metadata probe.
  // 화자매핑 UI·멀티 provider 선택은 M2a-3. 키는 typecastKey(env→~/.typecast/credentials).
  let cachedTtsKey
  const ttsAdapter = tts || createTtsAdapter('typecast', {
    getKey: () => (cachedTtsKey ??= getTypecastKey()),
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

  const guarded = (fn) => async (_e, payload = {}) => {
    if (!machine || payload.projectToken !== machine.projectToken) return { error: 'stale-token' }
    return fn(payload)
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

  ipcMain.handle('story:list-llm-options', async () => {
    const catalog = await loadLlmCatalog()
    const options = catalog.map((o) => ({ ...o, reasoningEfforts: [...(o.reasoningEfforts || [])] }))
    return {
      options,
      defaultOption: options[0] || { ...DEFAULT_STORY_LLM },
    }
  })

  ipcMain.handle('story:open', (_e, { projectPath } = {}) => {
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
  })

  ipcMain.handle('story:get-state', guarded(async () => machine.getState()))
  ipcMain.handle('story:start', guarded(({ step, params }) => machine.start(step, params)))
  ipcMain.handle('story:abort', guarded(() => machine.abort()))
  ipcMain.handle('story:push-ack', guarded(({ operationId, pushRevision, ok, reason }) =>
    machine.ackPush({ operationId, pushRevision, ok, reason })))
  // M2a-4 IP-A2: export(renderer)가 story 나레이션 배치에 쓸 { manifest, lastPushedRevision }.
  // guarded 아님 — export 는 현재 열린 프로젝트를 내보내므로 projectToken 없이 그 machine 것을 로드.
  ipcMain.handle('story:load-audio-package', async (_e, { projectPath } = {}) => {
    // projectPath 가 오면 그 경로 디스크를 직접 읽는다 — fresh session(story view 미진입, machine
    // 없음)에서도 동작. 경로는 story:open 과 동일하게 검증(절대/traversal/workFolder)해 임의 위치
    // 읽기를 막는다(Codex round3). projectPath 가 없으면 열린 machine 의 프로젝트(open 시 이미 검증됨).
    if (projectPath) {
      if (!(await validateProjectPath(projectPath))) return null
      const activeWorkFolder = getActiveWorkFolder()
      if (activeWorkFolder && !isWithinWorkFolder(projectPath, activeWorkFolder)) return null
      return readAudioPackage(projectPath)
    }
    if (!machine) return null
    return machine.loadAudioPackage()
  })
  ipcMain.handle('story:generate-title', guarded(({ scriptMd, options }) => machine.generateTitle(scriptMd, options || {})))
  // 슬라이스4(§3.4 + §v2.8 M4): 시놉시스 생성 side action — title/pasted 분기는 machine이 처리.
  // 리서치 §5 M2: 기존 채널에 useResearch 필드 추가(신규 채널 아님) — true일 때만 research.json 주입.
  ipcMain.handle('story:generate-synopsis', guarded(({ type, title, pastedScript, options, useResearch }) =>
    machine.generateSynopsis({ type, title, pastedScript, useResearch, options: options || {} })))
  // 시놉시스 검수(spec 2026-07-10): draft-only — 결과를 돌려줄 뿐 저장하지 않는다.
  ipcMain.handle('story:review-synopsis', guarded(({ synopsisMd, characters, options, review }) =>
    machine.reviewSynopsis({ synopsisMd, characters, options: options || {}, review })))
  // 슬라이스4(§v2.8 M1 + §v2.9): 시놉시스 확정 커밋 채널(title·pasted 공통) — characters→speakers
  // 반영 + charactersConfirmed=true + pushCharacters emit은 machine.confirmSynopsis가 수행.
  ipcMain.handle('story:confirm-synopsis', guarded(({ synopsisMd, characters }) =>
    machine.confirmSynopsis({ synopsisMd, characters })))
  // 슬라이스1: 세그먼트 단건 TTS 테스트(배치와 분리, 스텝 상태 미변경).
  ipcMain.handle('story:tts-preview', guarded(({ segmentIds, speakers, sfxSources }) => machine.synthPreview({ segmentIds, speakers, sfxSources })))

  // ── 화자별 오디오 출처 (mp3+SRT 가져오기) ──
  // 출처 자체는 speaker.voice = {provider:'import', mp3Path, srtPath}로 들어가므로 별도 채널이
  // 없다 — 기존 화자 배정(start('audio', {speakers}))이 그대로 나른다. 여기 있는 건 파일 선택뿐.
  //
  // 파일 선택 — renderer가 절대경로를 직접 만들 수 없으므로(그리고 만들게 하면 안 되므로) main이
  // 다이얼로그를 띄우고 사용자가 고른 경로만 돌려준다.
  // electron은 여기서 지연 import한다 — 이 모듈의 기존 테스트들은 electron을 mock하지 않으므로
  // top-level import를 넣으면 그쪽이 깨진다(다이얼로그는 실제로 열 때만 필요하다).
  // 다이얼로그 문구는 renderer가 실어 보낸다 — main은 useI18n을 부를 수 없어서, 여기에 문자열을
  // 박아두면 영어 사용자에게 한국어 창이 뜬다. 미지정이면 영어 기본값(이웃 다이얼로그와 같은 관행).
  ipcMain.handle('story:pick-audio-import-file', async (_e, { kind, title, filterName } = {}) => {
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
  })

  // 리서치(spec §5): story:research-* guarded 핸들러 — machine research side action 위임.
  ipcMain.handle('story:research-search', guarded(({ query, keyword, maxResults, dateFilter }) =>
    machine.researchSearch({
      keyword: query ?? keyword,
      // m5(R1): maxResults를 1~50으로 클램프 — 과대 pool로 인한 상세조회 폭주/타임아웃 방지.
      ...(maxResults != null ? { maxResults: Math.min(Math.max(1, Math.floor(maxResults)), 50) } : {}),
      // 개선2: 일자 필터(none|week|month) — 지정 시에만 전달.
      ...(dateFilter ? { dateFilter } : {}),
    })))
  // M4(R1): fetch도 언어 옵션을 받아 자막 1순위 언어를 프로젝트 언어로(analyze/factcheck 미러).
  ipcMain.handle('story:research-fetch', guarded(({ videoIds, options }) =>
    machine.researchFetchTranscripts({ videoIds: videoIds || [], options: options || {} })))
  ipcMain.handle('story:research-analyze', guarded(({ videoIds, options }) =>
    machine.researchAnalyze({ videoIds, options: options || {} })))
  ipcMain.handle('story:research-factcheck', guarded(({ options }) =>
    machine.researchFactCheck({ options: options || {} })))
  // 개선4/m3: adoptedIndices — 팩트체크 주장의 수동 채택 인덱스 목록(미전달 시 supported만).
  ipcMain.handle('story:research-commit', guarded(({ analysis, verifiedClaims, adoptedIndices }) =>
    machine.researchCommit({ analysis, verifiedClaims, adoptedIndices })))
  ipcMain.handle('story:research-skip', guarded(() => machine.researchSkip()))
  // m5: 수동 URL 카드·fetch 전 선택 영속(draft) — 탭전환/재오픈 유실 방지.
  ipcMain.handle('story:research-select', guarded(({ selectedVideoIds, manualVideos }) =>
    machine.researchSelect({ selectedVideoIds, manualVideos })))
  // 상세 모달(2026-07-08): 영상 카드 더블클릭 시 단일 영상 상세 조회(구독자·게시일·바이럴 지수).
  // 파이프라인 상태 불변 — 온디맨드 읽기 전용.
  ipcMain.handle('story:research-video-details', guarded(({ videoId }) =>
    machine.researchVideoDetails({ videoId })))
}
