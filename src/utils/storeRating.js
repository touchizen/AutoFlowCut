/**
 * storeRating — "성공 N회 후 평점 유도" 결정 로직 (순수 함수)
 *
 * Microsoft Store 평점은 Store 빌드(appx)에서만 의미가 있다. NSIS/직접 배포본은
 * ms-windows-store:// 딥링크를 처리할 수 없으므로 프롬프트를 띄우지 않는다.
 *
 * 두 종류의 "성공 이벤트"가 평점 유도를 트리거한다 (채널):
 *   - export     : CapCut 내보내기 성공        — 임계값 3회
 *   - generation : 생성 시작 → 100% 완료      — 임계값 5회
 * 두 채널은 독립 카운터지만, 평점 모달과 종료 상태(rated/never)는 공유한다.
 * 어느 한 채널이라도 임계값에 도달하면 모달이 뜨고, 한 번 평가/거절하면 둘 다 멈춘다.
 *
 * 상태(localStorage 영속):
 *   - status      : 'pending' | 'rated' | 'never'
 *   - counts      : { export, generation } 누적 성공 횟수
 *   - nextPromptAt: { export, generation } 다음 프롬프트를 띄울 임계값
 *
 * UI/React 와 분리하여 단위 테스트가 쉽도록 모든 분기를 순수 함수로 노출한다.
 */

export const STORE_RATING_KEY = 'autoflowcut_store_rating'

/** AutoFlowCut Microsoft Store Product ID (Partner Center) */
export const STORE_PRODUCT_ID = '9PNZVP54WRSM'

/** 평점 유도 트리거 채널 */
export const CHANNELS = ['export', 'generation']

/** 채널별 첫 평점 유도까지 필요한 성공 횟수 */
export const PROMPT_THRESHOLDS = { export: 3, generation: 5 }

/** "나중에" 선택 시 각 채널에서 추가로 필요한 성공 횟수 */
export const SNOOZE_INCREMENT = 5

/** Store 평점 페이지 딥링크 */
export function buildStoreReviewUrl(productId = STORE_PRODUCT_ID) {
  return `ms-windows-store://review/?ProductId=${productId}`
}

export function createInitialRatingState() {
  return {
    status: 'pending',
    counts: { export: 0, generation: 0 },
    nextPromptAt: { export: PROMPT_THRESHOLDS.export, generation: PROMPT_THRESHOLDS.generation }
  }
}

function safeCount(v, fallback) {
  return Number.isFinite(v) && v >= 0 ? Math.floor(v) : fallback
}

/**
 * 외부(localStorage)에서 읽은 임의의 값을 안전한 상태로 정규화한다.
 * 손상/구버전 데이터(단일 exportCount 스키마 포함)가 들어와도 복구된다.
 */
export function normalizeRatingState(raw) {
  const defaults = createInitialRatingState()
  if (!raw || typeof raw !== 'object') return defaults

  const status =
    raw.status === 'rated' || raw.status === 'never' || raw.status === 'pending'
      ? raw.status
      : defaults.status

  // 구버전 단일 카운터 스키마({ exportCount, nextPromptAt: number }) 마이그레이션
  const legacyExportCount = safeCount(raw.exportCount, null)
  const legacyNext = safeCount(raw.nextPromptAt, null)

  const rawCounts = raw.counts && typeof raw.counts === 'object' ? raw.counts : {}
  const rawNext = raw.nextPromptAt && typeof raw.nextPromptAt === 'object' ? raw.nextPromptAt : {}

  const counts = {
    export: safeCount(rawCounts.export, legacyExportCount ?? defaults.counts.export),
    generation: safeCount(rawCounts.generation, defaults.counts.generation)
  }
  const nextPromptAt = {
    export: safeCount(rawNext.export, legacyNext ?? defaults.nextPromptAt.export),
    generation: safeCount(rawNext.generation, defaults.nextPromptAt.generation)
  }

  return { status, counts, nextPromptAt }
}

/** 채널 1회 성공을 반영한 새 상태 반환 (불변). 알 수 없는 채널은 무시. */
export function registerEvent(state, channel) {
  const s = normalizeRatingState(state)
  if (!CHANNELS.includes(channel)) return s
  return { ...s, counts: { ...s.counts, [channel]: s.counts[channel] + 1 } }
}

/**
 * 지금 평점 프롬프트를 띄워야 하는가?
 * - Store 빌드가 아니면 절대 false
 * - 이미 평가했거나(rated) 영구 거절(never)이면 false
 * - 어느 한 채널이라도 누적 횟수가 임계값에 도달했으면 true
 */
export function shouldShowRatingPrompt(state, { isStoreBuild } = {}) {
  if (!isStoreBuild) return false
  const s = normalizeRatingState(state)
  if (s.status === 'rated' || s.status === 'never') return false
  return CHANNELS.some(c => s.counts[c] >= s.nextPromptAt[c])
}

/** 사용자가 평가함 → 다시 묻지 않음 */
export function markRated(state) {
  return { ...normalizeRatingState(state), status: 'rated' }
}

/** 사용자가 영구 거절 → 다시 묻지 않음 */
export function markNever(state) {
  return { ...normalizeRatingState(state), status: 'never' }
}

/** "나중에" → 모든 채널의 임계값을 현재 횟수 기준 SNOOZE_INCREMENT 만큼 미룬다 */
export function snooze(state) {
  const s = normalizeRatingState(state)
  const nextPromptAt = {}
  for (const c of CHANNELS) nextPromptAt[c] = s.counts[c] + SNOOZE_INCREMENT
  return { ...s, nextPromptAt }
}
