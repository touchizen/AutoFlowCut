/**
 * src/utils/mcpSettingsWhitelist.js
 *
 * M2-LIVE N3(A3/B2): MCP HTTP `update-settings` 가 만질 수 있는 설정 키의 화이트리스트 + 값 모양 — main(`/api/update`, 400) 과
 * 렌더러(useMcpServer, 버린다)가 **같은 상수**를 쓴다(이중 방어). 전엔 fields 를 그대로 스프레드해 projectName(자동 저장이 다른
 * 프로젝트로 간다)·mcpHttpEnabled/mcpHttpPort(에이전트 채널이 죽는다)·saveMode('none' — 과금은 계속되는데 저장이 멈춘다)·
 * flowAgentOn(모든 Flow 생성 거부) 을 로컬의 아무 프로세스나(CORS *, 인증 없음, text/plain 단순 요청) 바꿀 수 있었다.
 * 값은 loadSettings 의 coercion 을 우회하므로 여기서 모양까지 본다(seedNo 는 정수 ≥ 0, 열거형은 목록 그대로).
 */
const STR = (max) => (v) => typeof v === 'string' && v.trim().length > 0 && v.length <= max
const ENUM = (list) => (v) => typeof v === 'string' && list.includes(v)
const NUM = (min, max) => (v) => typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max
const INT = (min, max) => (v) => Number.isInteger(v) && v >= min && v <= max

/** 키 → 값 검사(true 면 유효). 여기 없는 키는 거부. */
export const MCP_SETTINGS_FIELDS = Object.freeze({
  videoModelT2V: STR(64),
  videoModelF2V: STR(64),
  imageModel: STR(64),
  videoResolution: ENUM(['360p', '720p', '1080p', '4k']),
  aspectRatio: ENUM(['16:9', '9:16', '1:1', '4:3', '3:4']),
  defaultDuration: NUM(1, 60),
  imageBatchCount: INT(1, 4),
  videoBatchCount: INT(1, 4),
  concurrency: INT(1, 10),
  videoConcurrency: INT(1, 10),
  seedNo: INT(0, Number.MAX_SAFE_INTEGER),
  seedLocked: (v) => typeof v === 'boolean',
  imageUpscale: (v) => typeof v === 'string' && v.length <= 16,
})
export const MCP_SETTINGS_KEYS = Object.freeze(Object.keys(MCP_SETTINGS_FIELDS))

const isPlainObject = (v) => !!v && typeof v === 'object' && !Array.isArray(v)

/**
 * 전부 유효해야 통과 — 아니면 나쁜 키 **이름만**(값은 싣지 않는다 — 로그·응답으로 새지 않게).
 * @returns {{ok:true, fields:object} | {ok:false, badKeys:string[]}}
 */
export function validateMcpSettingsFields(fields) {
  if (!isPlainObject(fields)) return { ok: false, badKeys: [] }
  const badKeys = []
  const out = {}
  for (const k of Object.keys(fields)) {
    const check = Object.hasOwn(MCP_SETTINGS_FIELDS, k) ? MCP_SETTINGS_FIELDS[k] : null
    if (!check || !check(fields[k])) badKeys.push(k)
    else out[k] = fields[k]
  }
  return badKeys.length ? { ok: false, badKeys } : { ok: true, fields: out }
}

/** 렌더러용 — 유효한 항목만 남긴다(객체가 아니면 null). */
export function pickMcpSettingsFields(fields) {
  if (!isPlainObject(fields)) return null
  const out = {}
  for (const k of Object.keys(fields)) {
    if (Object.hasOwn(MCP_SETTINGS_FIELDS, k) && MCP_SETTINGS_FIELDS[k](fields[k])) out[k] = fields[k]
  }
  return out
}
