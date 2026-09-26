/**
 * versioned generation handle codec (스펙 §5.6, R1 BLOCKER-3).
 *
 * google 비디오는 raw operationName 을 그대로 generationId 로 쓴다(handle 없음).
 * google 외 async video provider(grok/fal/wavespeed/higgsfield)는 provider별 rawId 를
 * versioned opaque handle 로 인코딩:
 *   generationId = "gen:v1:" + base64url(JSON.stringify({ provider, rawId }))
 *
 * base64url JSON 은 신뢰 경계가 아니다(project.json 왕복·손상 가능) → decode 시 엄격 검증:
 *   provider allowlist, rawId provider별 exact schema, 추가 필드 거부, 최대 길이.
 * malformed → 명시 throw. **google 폴백 금지**(엉뚱한 키로 폴링하는 것 방지).
 *
 * ⚠ MAX_HANDLE_LENGTH 와 provider별 rawId schema 의 정확한 수치는 M2 provider fixture
 *   동결 게이트(§4)에서 실측 확정. M0b 는 방어적 상한 + string/fal-object 구조만 고정.
 */

export const HANDLE_PREFIX = 'gen:v1:'
// 예약 네임스페이스: `gen:` 로 시작하는 모든 generationId 는 handle 전용.
// google raw op name 이 여기 충돌하면 인코딩은 되지만 디코딩 불가(복구불가) → encode 에서 거부.
// `gen:v2:` 같은 미지원 버전은 legacy google 로 오라우팅하지 않고 명시 실패(malformed=throw 규칙).
const RESERVED_NAMESPACE = 'gen:'

// 과도한 handle 거부(오염/DoS 방어). M0b 방어값 — M2 fixture 로 정밀 확정.
const MAX_HANDLE_LENGTH = 8192

// base64url payload 문자 규칙(padding 없음).
const BASE64URL_RE = /^[A-Za-z0-9_-]+$/

// provider별 rawId schema. google 은 여기 없음 — handle 로 인코딩되지 않는다(raw passthrough).
// 'string' → 비어있지 않은 문자열. 'fal-object' → {model_id, request_id} 정확히.
const RAWID_SCHEMA = Object.assign(Object.create(null), {
  grok: 'string',
  fal: 'fal-object',
  wavespeed: 'string',
  higgsfield: 'string',
})

function isNonEmptyString(v) {
  return typeof v === 'string' && v.length > 0
}

/** rawId 가 provider schema 에 맞는지. 안 맞으면 false. */
function rawIdMatchesSchema(provider, rawId) {
  const schema = Object.hasOwn(RAWID_SCHEMA, provider) ? RAWID_SCHEMA[provider] : undefined
  if (!schema) return false
  if (schema === 'string') return isNonEmptyString(rawId)
  if (schema === 'fal-object') {
    if (!rawId || typeof rawId !== 'object' || Array.isArray(rawId)) return false
    const keys = Object.keys(rawId).sort()
    if (keys.length !== 2 || keys[0] !== 'model_id' || keys[1] !== 'request_id') return false
    return isNonEmptyString(rawId.model_id) && isNonEmptyString(rawId.request_id)
  }
  return false
}

/**
 * provider별 rawId → generationId(handle 또는 raw). google=raw passthrough.
 * round-trip 못 하는 handle 은 방출하지 않는다(unknown provider·schema 위반 → throw).
 *
 * @param {string} providerId
 * @param {string|object} rawId
 * @returns {string}
 */
export function encodeHandle(providerId, rawId) {
  if (providerId === 'google') {
    if (!isNonEmptyString(rawId)) {
      throw new Error('encodeHandle: google rawId must be a non-empty string (operationName)')
    }
    // google raw op name 은 예약 네임스페이스와 충돌하면 안 된다(디코딩 시 handle 로 오인 → 복구불가).
    if (rawId.startsWith(RESERVED_NAMESPACE)) {
      throw new Error(`encodeHandle: google rawId must not start with reserved namespace '${RESERVED_NAMESPACE}'`)
    }
    return rawId
  }
  if (!Object.hasOwn(RAWID_SCHEMA, providerId)) {
    throw new Error(`encodeHandle: unknown provider '${providerId}'`)
  }
  if (!rawIdMatchesSchema(providerId, rawId)) {
    throw new Error(`encodeHandle: rawId does not match schema for provider '${providerId}'`)
  }
  const handle = HANDLE_PREFIX + Buffer.from(JSON.stringify({ provider: providerId, rawId }), 'utf8').toString('base64url')
  // 대칭 불변식: decode 가 거부할 handle 은 방출하지 않는다(emit-then-reject 방지).
  // decode 의 MAX_HANDLE_LENGTH 상한을 encode 도 강제 — 초과 시 여기서 즉시 실패(영속 후 영구 복구불가 방지).
  if (handle.length > MAX_HANDLE_LENGTH) {
    throw new Error('encodeHandle: encoded handle exceeds maximum length')
  }
  return handle
}

/**
 * generationId → { provider, rawId }. prefix 없으면 legacy google.
 * prefix 있으면 엄격 검증 후 반환 — 실패 시 throw(google 폴백 금지).
 *
 * @param {string} generationId
 * @returns {{ provider: string, rawId: string|object }}
 */
export function decodeHandle(generationId) {
  if (!isNonEmptyString(generationId)) {
    throw new Error('decodeHandle: generationId must be a non-empty string')
  }
  if (!generationId.startsWith(HANDLE_PREFIX)) {
    // 예약 네임스페이스지만 지원 버전(gen:v1:)이 아니면 legacy google 로 오라우팅하지 않고 명시 실패.
    if (generationId.startsWith(RESERVED_NAMESPACE)) {
      throw new Error(`decodeHandle: unsupported handle version in reserved namespace '${RESERVED_NAMESPACE}'`)
    }
    // legacy: prefix 없는 raw op name → google
    return { provider: 'google', rawId: generationId }
  }
  if (generationId.length > MAX_HANDLE_LENGTH) {
    throw new Error('decodeHandle: handle exceeds maximum length')
  }
  const payload = generationId.slice(HANDLE_PREFIX.length)
  if (!BASE64URL_RE.test(payload)) {
    throw new Error('decodeHandle: malformed base64url payload')
  }
  let obj
  try {
    const json = Buffer.from(payload, 'base64url').toString('utf8')
    obj = JSON.parse(json)
  } catch {
    throw new Error('decodeHandle: payload is not valid JSON')
  }
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
    throw new Error('decodeHandle: payload is not an object')
  }
  const keys = Object.keys(obj).sort()
  if (keys.length !== 2 || keys[0] !== 'provider' || keys[1] !== 'rawId') {
    throw new Error('decodeHandle: payload must have exactly { provider, rawId }')
  }
  const { provider, rawId } = obj
  // google 은 handle 로 인코딩되지 않으므로 allowlist(RAWID_SCHEMA)에 없다 → prefix 붙은 google 은 malformed.
  if (!Object.hasOwn(RAWID_SCHEMA, provider)) {
    throw new Error(`decodeHandle: provider '${provider}' not in handle allowlist`)
  }
  if (!rawIdMatchesSchema(provider, rawId)) {
    throw new Error(`decodeHandle: rawId does not match schema for provider '${provider}'`)
  }
  return { provider, rawId }
}
