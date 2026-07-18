/**
 * ChatPanel 전용 IPC (D14).
 *
 * session command/event를 Story token/delta stream과 분리한다. 승인 request/response 한 쌍은
 * app-scoped approvalPrompt가 이미 소유하므로 여기서 다시 등록하지 않는다. 세션마다 permission
 * listener를 만들면 listener가 누적되고, prompt 수명을 세션 수명으로 잘못 닫을 길이 생긴다.
 */

import { listCodexModels } from '../api/llm/codexAppServer.js'
import { listClaudeModels } from '../api/llm/llmClaude.js'
import {
  CLAUDE_AGENT_DEFAULT_SDK_MODEL,
  COLD_DEFAULT_MODEL_ID,
} from '../agent/constants.js'

const CODEX_FALLBACK_SDK_MODEL = 'gpt-5.5'
const DEFAULT_FALLBACK_FROM = 'claude-opus-4-8'
const AGENT_MODEL_PROVIDERS = new Set(['codex', 'claude'])

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0
}

function capabilityMetadataOf(row) {
  const source = row ?? {}
  const {
    id: _id,
    value: _value,
    sourceKey: _sourceKey,
    provider: _provider,
    sdkModel: _sdkModel,
    isDefault: _isDefault,
    providerDefault: _providerDefault,
    defaultCandidate: _defaultCandidate,
    hidden: _hidden,
    defaultFallbackFrom: _defaultFallbackFrom,
    ...metadata
  } = source
  return metadata
}

function normalizeCodexModel(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  if (raw.provider != null && raw.provider !== 'codex') return null
  const sourceKey = raw.id
  if (!isNonEmptyString(sourceKey)) return null
  return {
    ...capabilityMetadataOf(raw),
    id: `codex:${sourceKey}`,
    sourceKey,
    provider: 'codex',
    sdkModel: sourceKey,
    displayName: typeof raw.displayName === 'string' ? raw.displayName : sourceKey,
    description: typeof raw.description === 'string' ? raw.description : '',
    isDefault: false,
    providerDefault: raw.isDefault === true,
    hidden: raw.hidden === true,
  }
}

function normalizeClaudeModel(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  if (raw.provider != null && raw.provider !== 'claude') return null
  const sourceKey = raw.value
  if (!isNonEmptyString(sourceKey)) return null
  const row = {
    ...capabilityMetadataOf(raw),
    id: `claude:${sourceKey}`,
    sourceKey,
    provider: 'claude',
    sdkModel: sourceKey,
    displayName: typeof raw.displayName === 'string' ? raw.displayName : sourceKey,
    description: typeof raw.description === 'string' ? raw.description : '',
    isDefault: false,
    providerDefault: false,
    hidden: false,
  }
  if (sourceKey !== 'default') return row
  return {
    ...row,
    sdkModel: null,
    providerDefault: true,
    defaultCandidate: true,
    hidden: true,
  }
}

function isValidAgentModelRow(row) {
  return row
    && typeof row === 'object'
    && isNonEmptyString(row.id)
    && isNonEmptyString(row.sourceKey)
    && AGENT_MODEL_PROVIDERS.has(row.provider)
    && (row.sdkModel === null || isNonEmptyString(row.sdkModel))
}

function uniqueRows(rows) {
  const seen = new Set()
  const unique = []
  for (const row of rows) {
    if (!isValidAgentModelRow(row) || seen.has(row.id)) continue
    seen.add(row.id)
    unique.push(row)
  }
  return unique
}

function normalizeRows(rawModels, normalize) {
  if (!Array.isArray(rawModels)) return []
  return uniqueRows(rawModels.map(normalize).filter(Boolean))
}

function createFallbackRow(fetchedRow, promoted) {
  const row = {
    ...capabilityMetadataOf(fetchedRow),
    id: COLD_DEFAULT_MODEL_ID,
    sourceKey: CODEX_FALLBACK_SDK_MODEL,
    provider: 'codex',
    sdkModel: CODEX_FALLBACK_SDK_MODEL,
    displayName: typeof fetchedRow?.displayName === 'string' ? fetchedRow.displayName : 'GPT-5.5',
    description: typeof fetchedRow?.description === 'string' ? fetchedRow.description : '',
    isDefault: !promoted,
    providerDefault: fetchedRow?.providerDefault === true,
    hidden: false,
  }
  if (!promoted) row.defaultFallbackFrom = DEFAULT_FALLBACK_FROM
  return row
}

function finalizeCatalogRows(sourceRows) {
  const rows = uniqueRows(sourceRows).map((row) => {
    const normalized = { ...row, isDefault: false }
    delete normalized.defaultFallbackFrom
    return normalized
  })
  const candidateIndex = rows.findIndex((row) => row.provider === 'claude' && row.defaultCandidate === true)
  const promoted = candidateIndex >= 0 && isNonEmptyString(CLAUDE_AGENT_DEFAULT_SDK_MODEL)
  const fallbackIndex = rows.findIndex((row) => row.id === COLD_DEFAULT_MODEL_ID)
  const fallback = createFallbackRow(fallbackIndex >= 0 ? rows[fallbackIndex] : null, promoted)
  if (fallbackIndex >= 0) rows[fallbackIndex] = fallback
  else rows.push(fallback)
  if (promoted) {
    const candidate = rows.find((row) => row.provider === 'claude' && row.defaultCandidate === true)
    candidate.sdkModel = CLAUDE_AGENT_DEFAULT_SDK_MODEL
    candidate.isDefault = true
  }
  return rows
}

function defaultIdOf(rows) {
  return rows.find((row) => row.isDefault === true)?.id ?? COLD_DEFAULT_MODEL_ID
}

function visibleAgentModels(models) {
  if (!Array.isArray(models)) return []
  return models.filter((model) => model && typeof model.id === 'string' && model.hidden !== true)
}

export function createAgentModelCatalog({
  listCodexModels: listCodexModelsImpl = listCodexModels,
  listClaudeModels: listClaudeModelsImpl = listClaudeModels,
} = {}) {
  const coldRows = finalizeCatalogRows([])
  let cached = null
  let inFlight = null

  const fetchModels = async (listModels) => {
    try {
      const models = await listModels()
      return Array.isArray(models) ? models : []
    } catch {
      return []
    }
  }
  const fetchSource = async (listModels, normalize) => {
    const first = normalizeRows(await fetchModels(listModels), normalize)
    if (first.some((row) => row.hidden !== true)) return first
    return normalizeRows(await fetchModels(listModels), normalize)
  }
  return {
    snapshot() {
      const rows = (cached ?? coldRows).map((model) => ({ ...model }))
      return {
        cacheReady: cached !== null,
        rows,
        defaultId: defaultIdOf(rows),
      }
    },
    /**
     * Cache-only 동기 lookup. cold에서도 built-in 행을 찾아 항상 opaque id 문자열을 준다.
     * `list()`를 부르지 않으므로 provider 조회 타임아웃이 Send를 막지 않는다.
     */
    defaultModelId() {
      return defaultIdOf(cached ?? coldRows)
    },
    list() {
      if (cached) return Promise.resolve(cached.map((model) => ({ ...model })))
      if (inFlight) return inFlight
      inFlight = (async () => {
        const [codexRows, claudeRows] = await Promise.all([
          fetchSource(listCodexModelsImpl, normalizeCodexModel),
          fetchSource(listClaudeModelsImpl, normalizeClaudeModel),
        ])
        const sourceRows = uniqueRows([...codexRows, ...claudeRows])
        const models = finalizeCatalogRows(sourceRows)
        if (sourceRows.some((model) => model.hidden !== true)) {
          cached = models.map((model) => ({ ...model }))
        }
        return models.map((model) => ({ ...model }))
      })().finally(() => { inFlight = null })
      return inFlight
    },
  }
}

export const defaultModelCatalog = createAgentModelCatalog()

function isWindowAlive(window) {
  if (!window || typeof window.isDestroyed !== 'function' || window.isDestroyed()) return false
  if (!window.webContents || typeof window.webContents.send !== 'function') return false
  return typeof window.webContents.isDestroyed !== 'function' || !window.webContents.isDestroyed()
}

function messageOf(value, fallback) {
  if (value instanceof Error && value.message) return value.message
  if (value && typeof value.message === 'string' && value.message) return value.message
  if (typeof value === 'string' && value) return value
  return fallback
}

function createEmitter(getWindow) {
  return (channel, payload) => {
    const window = getWindow?.()
    if (!isWindowAlive(window)) return false
    window.webContents.send(channel, payload)
    return true
  }
}

/** sessionManager 생성 시 그대로 넘길 callback 묶음. */
export function createAgentEventForwarder({ getWindow } = {}) {
  if (typeof getWindow !== 'function') throw new TypeError('getWindow must be a function')
  const emit = createEmitter(getWindow)

  return {
    onDelta(delta) {
      emit('agent:delta', { delta })
    },

    onEvent(event = {}) {
      const { method, params = {} } = event
      const item = params.item

      if (method === 'item/completed' && item?.type === 'agentMessage') {
        // delta 합과 completed text는 실제로 다를 수 있고 빈 문자열도 확정값이다. renderer가 fallback
        // 조각을 최종 답으로 오인하지 않게 wire item 전체를 별도 authoritative event로 보낸다.
        emit('agent:message', {
          turnId: params.turnId ?? null,
          item,
        })
        return
      }

      if ((method === 'item/started' || method === 'item/completed')
        && item?.type === 'mcpToolCall') {
        emit('agent:tool-call', {
          turnId: params.turnId ?? null,
          phase: method === 'item/started' ? 'started' : 'completed',
          item,
        })
        return
      }

      if (method !== 'turn/completed' || !params.turn) return
      const turn = params.turn
      if (turn.status === 'failed') {
        emit('agent:error', {
          error: 'agent-turn-failed',
          message: messageOf(turn.error, '에이전트 작업에 실패했습니다.'),
          turnId: turn.id ?? null,
          turn,
        })
        return
      }

      emit('agent:done', {
        turnId: turn.id ?? null,
        status: turn.status ?? 'completed',
        turn,
      })
    },

    onUsage(usage) {
      emit('agent:usage', usage)
    },

    onError(error) {
      if (error && typeof error === 'object' && !(error instanceof Error)) {
        emit('agent:error', error)
        return
      }
      emit('agent:error', {
        error: 'agent-error',
        message: messageOf(error, '에이전트 오류가 발생했습니다.'),
      })
    },

    onExit(details = {}) {
      emit('agent:error', {
        error: 'agent-exit',
        message: messageOf(details.error, '에이전트 프로세스가 종료됐습니다.'),
        code: details.code ?? null,
        signal: details.signal ?? null,
      })
    },
  }
}

/**
 * session command 5개만 등록한다. `agent:permission-response`는 main의 app-scoped listener가
 * 여섯 번째 command로 이미 한 번 등록돼 있다.
 */
export function registerAgentIPC(ipcMain, {
  sessionManager,
  modelCatalog = defaultModelCatalog,
  getWindow,
} = {}) {
  if (!ipcMain || typeof ipcMain.handle !== 'function') throw new TypeError('ipcMain.handle is required')
  if (!sessionManager) throw new TypeError('sessionManager is required')
  if (typeof modelCatalog?.list !== 'function') throw new TypeError('modelCatalog.list is required')
  // 🔴 `agent:send` 의 계약이 이제 여기에 의존한다. 없으면 옵셔널 호출이 **조용히 생략 폴백**으로
  //    무너져 sticky 버그가 되살아난다(테스트가 list-only 카탈로그를 주입하면 아무도 못 알아챈다).
  //    계약이면 계약답게 막는다.
  if (typeof modelCatalog?.defaultModelId !== 'function') throw new TypeError('modelCatalog.defaultModelId is required')
  if (typeof getWindow !== 'function') throw new TypeError('getWindow must be a function')

  const emit = createEmitter(getWindow)
  const registrations = [
    // thread/start 의 model 생략은 **실측상 안전**하다 — 새 thread 는 서버 기본으로 시작한다(m0-14 turn1).
    // 그래서 open 은 통과만 시킨다. 계약을 필요 이상으로 넓히지 않는다.
    ['agent:session-open', 'open', (payload) => (payload?.model ? [payload.model] : [])],
    // 🔴 `agent:send` 에서 model 이 없으면 **기본 모델 id 를 명시해서** 내려보낸다.
    //
    //    이유(실측 m0-14, codex app-server 0.144.5): `turn/start.model` 은 **sticky inheritance** 다.
    //    생략은 "기본으로" 가 아니라 "직전 모델 유지" 로 동작한다(턴 사이에 `thread/settings/updated`
    //    가 뜬다 = turn 파라미터가 thread 설정을 갱신한다). 그래서 사용자가 '기본' 을 골라도 안 돌아왔다.
    //
    //    ⚠️ 여기(main)에서 푸는 이유: 렌더러에서 풀면 **ChatPanel 이 remount** 될 때 구멍이 난다 —
    //    main 세션(=thread)은 살아있는데 `selectedModel` 은 null 로 리셋되고 `models` 는 아직 로딩 중이라,
    //    그 창에서 send 하면 **사용자가 selector 를 건드리지도 않았는데** 직전 sticky 모델로 나간다.
    //    카탈로그 캐시는 main 에 있으므로 렌더러 수명과 무관하게 일관된다.
    //
    //    → 이 채널의 계약: **model 생략 = 앱 기본(카탈로그 isDefault)**. "thread 의 현재 모델을 물려받기"는
    //      이 경계에서 **표현 불가능**해야 한다. 그게 바로 위 버그이기 때문이다.
    ['agent:send', 'send', (payload) => {
      const model = payload?.model || modelCatalog.defaultModelId?.() || null
      return model ? [payload?.text, model] : [payload?.text]
    }],
    ['agent:steer', 'steer', (payload) => [payload?.text]],
    ['agent:abort', 'abort', () => []],
    ['agent:session-close', 'close', () => []],
  ]
  const channels = registrations.map(([channel]) => channel)
  channels.push('agent:list-models')

  ipcMain.handle('agent:list-models', async () => visibleAgentModels(await modelCatalog.list()))

  for (const [channel, method, argsFor] of registrations) {
    if (typeof sessionManager[method] !== 'function') {
      throw new TypeError(`sessionManager.${method} is required`)
    }
    ipcMain.handle(channel, async (_event, payload = {}) => {
      try {
        return await sessionManager[method](...argsFor(payload))
      } catch (error) {
        // IPC rejection은 renderer에서 놓치기 쉽다. 실패를 값과 agent:error 양쪽에 남긴다.
        const failure = {
          error: 'agent-command-failed',
          command: channel,
          message: messageOf(error, '에이전트 명령에 실패했습니다.'),
        }
        emit('agent:error', failure)
        return failure
      }
    })
  }

  return () => {
    if (typeof ipcMain.removeHandler !== 'function') return
    for (const channel of channels) ipcMain.removeHandler(channel)
  }
}

export default { createAgentEventForwarder, registerAgentIPC }
