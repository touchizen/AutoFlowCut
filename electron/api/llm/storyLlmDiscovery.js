/**
 * 엔진이 보고한 모델 목록 → story LLM 카탈로그 옵션.
 * 순수 함수만 둔다(프로세스를 안 띄운다) — 실제 조회는 호출측이 하고 결과만 넘긴다.
 */

// Fable/Mythos 는 thinking: disabled 를 400 으로 거부한다. ModelInfo 에는 이걸 구분할 필드가
// 없다(supportsAdaptiveThinking 은 opus/sonnet/fable 모두 true) — resolvedModel 로 판별한다.
const THINKING_ALWAYS_ON = /^claude-(fable|mythos)-/

const str = (v) => (typeof v === 'string' ? v : '')

export function buildClaudeStoryLlmOptions(models) {
  if (!Array.isArray(models)) return []
  const seen = new Set()
  const options = []
  for (const m of models) {
    const value = str(m?.value).trim()
    // 'default' 는 다른 행의 별칭이다 — 같은 모델을 두 번 보여주지 않는다.
    if (!value || value === 'default') continue
    const resolvedModel = str(m?.resolvedModel).trim() || value
    if (seen.has(resolvedModel)) continue
    seen.add(resolvedModel)

    const alwaysOn = THINKING_ALWAYS_ON.test(resolvedModel)
    const levels = m?.supportsEffort && Array.isArray(m.supportedEffortLevels)
      ? m.supportedEffortLevels.filter((l) => typeof l === 'string')
      : []

    let reasoningEfforts = []
    let defaultReasoningEffort = ''
    if (levels.length) {
      reasoningEfforts = alwaysOn ? [...levels] : ['off', ...levels]
      defaultReasoningEffort = alwaysOn ? 'high' : 'off'
    }

    options.push({
      id: `claude:${value}`,
      engine: 'claude',
      model: value,
      resolvedModel,
      label: `Claude ${str(m?.displayName).trim() || value}`,
      description: str(m?.description).trim(),
      reasoningEfforts,
      defaultReasoningEffort,
    })
  }
  return options
}

// app-server 의 supportedReasoningEfforts 는 { reasoningEffort, description } 객체 배열이다.
// (문자열 배열도 받아 준다 — 테스트/구버전 대비.)
function codexEffortLevels(raw) {
  if (!Array.isArray(raw)) return []
  return raw
    .map((e) => (typeof e === 'string' ? e : str(e?.reasoningEffort)))
    .filter(Boolean)
}

// 서버가 알려준 기본값(대개 medium)을 존중한다. xhigh 강제는 속도용 mini·짧은 숏폼에서 첫 토큰만
// 느리게 만든다(mini + 1분 숏폼 실사용에서 드러남) — 더 깊은 추론은 사용자가 설정에서 올린다.
// 서버 기본값이 없거나 미지원이면 medium, 그것도 없으면 중간 단계로(양극단 회피).
function codexDefaultEffort(levels, serverDefault) {
  if (!levels.length) return ''
  if (serverDefault && levels.includes(serverDefault)) return serverDefault
  if (levels.includes('medium')) return 'medium'
  return levels[Math.floor((levels.length - 1) / 2)]
}

export function buildCodexStoryLlmOptions(models) {
  if (!Array.isArray(models)) return []
  const options = []
  for (const m of models) {
    const id = str(m?.id).trim()
    if (!id || m?.hidden) continue
    const levels = codexEffortLevels(m?.supportedReasoningEfforts)
    options.push({
      id: `codex:${id}`,
      engine: 'codex',
      model: id,
      resolvedModel: id,
      label: `Codex ${str(m?.displayName).trim() || id}`,
      description: str(m?.description).trim(),
      reasoningEfforts: levels,
      defaultReasoningEffort: codexDefaultEffort(levels, str(m?.defaultReasoningEffort)),
    })
  }
  return options
}

/**
 * 엔진별 동적 목록 + 정적 폴백 → 최종 카탈로그.
 * 한 엔진이 죽었다고 다른 엔진까지 정적으로 되돌리지 않는다 — 죽은 쪽만 정적으로 메운다.
 */
export function resolveStoryLlmCatalog({ claude, codex, fallback = [] } = {}) {
  const staticFor = (engine) => fallback.filter((o) => o.engine === engine)
  const pick = (dynamic, engine) => (Array.isArray(dynamic) && dynamic.length ? dynamic : staticFor(engine))
  return [...pick(claude, 'claude'), ...pick(codex, 'codex')]
}

export default { buildClaudeStoryLlmOptions, buildCodexStoryLlmOptions, resolveStoryLlmCatalog }
