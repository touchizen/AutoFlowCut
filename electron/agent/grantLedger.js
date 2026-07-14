import { createHash } from 'node:crypto'

const DEFAULT_TTL_MS = 10 * 60 * 1000

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (value === null || typeof value !== 'object') return value

  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, canonicalize(value[key])]),
  )
}

/**
 * 객체 키 순서는 승인의 의미가 아니지만, 배열 순서와 값은 의미가 있다.
 * 런타임의 객체 삽입 순서가 달라졌다는 이유만으로 같은 승인이 깨지지 않게 정규화한다.
 */
export function hashArgs(args) {
  return createHash('sha256').update(JSON.stringify(canonicalize(args))).digest('hex')
}

/**
 * 승인 사실은 adapter 문자열이 아니라 main 이 소유한 1회용 grant 로만 증명한다 (D9 ERRATA).
 */
export function createGrantLedger({ now = () => Date.now(), ttlMs = DEFAULT_TTL_MS } = {}) {
  if (typeof now !== 'function') throw new TypeError('now must be a function')
  if (!Number.isFinite(ttlMs) || ttlMs < 0) {
    throw new TypeError('ttlMs must be a non-negative finite number')
  }

  const grants = new Map()

  function grant({ nonce, tool, argsHash, sessionId }) {
    grants.set(nonce, { tool, argsHash, sessionId, expiresAt: now() + ttlMs })
  }

  function consume({ nonce, tool, argsHash, sessionId } = {}) {
    const recorded = grants.get(nonce)
    if (!recorded) return false

    // 🔴 조회 뒤 삭제 전에 await 가 끼면 병렬 호출 둘이 같은 grant 를 본다.
    //    검증보다 먼저 동기 삭제해야 성공·불일치 어느 경로도 replay 창을 다시 열지 않는다.
    grants.delete(nonce)

    if (now() >= recorded.expiresAt) return false
    return recorded.tool === tool
      && recorded.argsHash === argsHash
      && recorded.sessionId === sessionId
  }

  function closeSession(sessionId) {
    for (const [nonce, recorded] of grants) {
      if (recorded.sessionId === sessionId) grants.delete(nonce)
    }
  }

  return { grant, consume, closeSession }
}
