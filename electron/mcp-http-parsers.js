/**
 * electron/mcp-http-parsers.js
 *
 * main 의 MCP HTTP 라우트(`startMcpHttp`, main.js)가 쓰는 **순수** 본문 판정 — main.js 는 Electron 부팅이 필요해 라우트 자체는
 * 실행 테스트가 없다; 판정을 여기로 빼서 행동을 tests/electron/mcpHttpParsers.test.js 로 묶고 라우트는 소스 핀으로만 묶는다.
 *   M2-LIVE N3(A3/B2): POST /api/update 의 update-settings 는 화이트리스트(src/utils/mcpSettingsWhitelist.js) 밖 키·틀린 값이면 400 + 키 이름.
 *   M2-LIVE N7(A5/A6/B7): POST /api/start-scene-batch 의 mode 는 없거나(null 포함) 'video'|'image' 만 — 모르는 값('Video'·'v2v'·'constructor')은 400.
 *     전엔 그대로 넘겨 렌더러가 현재 UI 탭으로 조용히 떨어졌다(이미지 탭이면 영상 씬 대신 이미지 배치가 과금된다).
 *   M2-CLOSE O4(A4): 같은 라우트 — 비어 있지 않은데 객체로 파싱되지 않는 본문(`{"mode":"video",}`)은 400(전엔 조용히 기본값으로 현재 탭 배치 시작), force 는 없거나 boolean 만
 *     (전엔 `!!parsed.force` 라 "false"·"0" 이 true — 완료 씬 전부 재생성·과금 영상 재과금), styleId 는 없거나 null 이거나 ≤128 문자열만. 빈 본문(공백만)은 옛 기본값 그대로.
 */
import { validateMcpSettingsFields } from '../src/utils/mcpSettingsWhitelist.js'

const parseObject = (raw) => {
  try {
    const v = JSON.parse(raw)
    return v && typeof v === 'object' && !Array.isArray(v) ? v : null
  } catch (_e) { return null }
}

/**
 * POST /api/update 본문 → { status, body, forward? } — forward 가 있으면 그대로 렌더러에 'mcp-update' 로 보낸다.
 * update-settings 는 정리된 fields 만 넘긴다(다른 type 은 본문 그대로 — 기존 계약).
 */
export function decideUpdateRequest(rawBody) {
  const data = parseObject(rawBody)
  if (!data) return { status: 400, body: { error: 'body must be a JSON object' } }
  if (data.type === 'update-settings') {
    const v = validateMcpSettingsFields(data.fields)
    if (!v.ok) return { status: 400, body: { error: 'update-settings: unknown or invalid fields', keys: v.badKeys } }
    return { status: 200, body: { success: true }, forward: { ...data, fields: v.fields } }
  }
  return { status: 200, body: { success: true }, forward: data }
}

const BATCH_MODES = new Set(['video', 'image'])

const STYLE_ID_MAX_LEN = 128

/**
 * POST /api/start-scene-batch 본문 → { ok:true, payload } | { ok:false, error }. 본문 없음(빈 문자열·공백)은 옛 기본값(styleId null, force false) 그대로;
 * 비어 있지 않은데 객체로 파싱되지 않으면 400(M2-CLOSE O4). payload 는 렌더러의 'mcp-update' 그대로: { type:'start-scene-batch', styleId, force, mode? } — mode 는 유효할 때만 키가 생긴다.
 */
export function parseStartSceneBatchBody(rawBody) {
  const raw = String(rawBody ?? '')
  const parsed = raw.trim() === '' ? {} : parseObject(raw)
  if (!parsed) return { ok: false, error: 'invalid JSON body' }   // M2-CLOSE O4
  const mode = parsed.mode
  if (mode != null && !BATCH_MODES.has(mode)) return { ok: false, error: "mode must be 'video' or 'image'" }
  // M2-CLOSE O4: force 는 없거나 boolean 만("false"·"0" 을 true 로 읽지 않는다), styleId 는 없거나 null 이거나 ≤128 문자열만(빈 문자열은 옛대로 null)
  if (parsed.force !== undefined && typeof parsed.force !== 'boolean') return { ok: false, error: 'force must be a boolean' }
  if (parsed.styleId != null && (typeof parsed.styleId !== 'string' || parsed.styleId.length > STYLE_ID_MAX_LEN)) return { ok: false, error: `styleId must be a string of at most ${STYLE_ID_MAX_LEN} characters` }
  return { ok: true, payload: { type: 'start-scene-batch', styleId: parsed.styleId || null, force: parsed.force === true, ...(mode != null ? { mode } : {}) } }
}
