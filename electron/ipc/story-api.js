/**
 * Story 파이프라인 IPC — 스펙 §6. 프로젝트당 하나의 스텝 머신 인스턴스.
 * 모든 R→M 명령은 projectToken 검증, 불일치 시 { error: 'stale-token' }.
 */
import { stat } from 'node:fs/promises'
import path from 'node:path'
import { createStepMachine, readAudioPackage } from '../story/stepMachine.js'
import * as llmGemini from '../api/llm/llmGemini.js'
import { createTtsAdapter } from '../api/tts/index.js'
import { getTypecastKey } from '../api/tts/typecastKey.js'
import { probeDurationMs } from '../story/audioProbe.js'

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

export function registerStoryIPC(ipcMain, { keyStore, getWindow, llm = llmGemini, loadMetaPrompt, getActiveWorkFolder = () => null, tts, ttsFor, probe, defaultVoice }) {
  let machine = null
  let openLock = Promise.resolve()

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
      machine = createStepMachine({ projectPath, llm, emit, getApiKey: () => keyStore.getKey(), loadMetaPrompt, tts: ttsAdapter, ttsFor, probe: probeFn, defaultVoice: defaultVoiceCfg })
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
  ipcMain.handle('story:generate-title', guarded(({ scriptMd }) => machine.generateTitle(scriptMd)))
  // 슬라이스1: 세그먼트 단건 TTS 테스트(배치와 분리, 스텝 상태 미변경).
  ipcMain.handle('story:tts-preview', guarded(({ segmentIds, speakers }) => machine.synthPreview({ segmentIds, speakers })))
}
