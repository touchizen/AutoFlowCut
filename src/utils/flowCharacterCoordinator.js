// Flow character DOM/API 작업 공통 조정기.
//
// Flow 의 character 생성/업로드/재등록은 한 WebContentsView 와 네트워크 캡처 버퍼를 공유한다.
// ref 가 달라도 동시에 실행하면 navigation/응답이 서로 섞이므로 전역 직렬화하고, 같은 ref 의 같은
// 작업은 single-flight 로 합류한다. key 는 프로젝트 scope 를 포함해 프로젝트별로 재사용되는 ref id 가
// 서로 결과를 공유하지 않게 한다.

export const FLOW_CHARACTER_OPERATION_TIMEOUT_MS = 180000

const activeByKey = new Map()
let flowViewTail = Promise.resolve()

function scopePart(opts = {}) {
  const parts = []
  if (opts.projectId != null && opts.projectId !== '') parts.push(`flow:${String(opts.projectId)}`)
  const localScope = opts.scopeToken ?? opts.scope
  if (localScope != null && localScope !== '') parts.push(`local:${String(localScope)}`)
  return parts.length > 0 ? parts.join('|') : 'unscoped'
}

/** 프로젝트 scope + ref identity 로 안정적인 작업 key 를 만든다(legacy id-less 는 index 폴백). */
export function flowCharacterOperationKey(refOrId, opts = {}) {
  const ref = (refOrId && typeof refOrId === 'object') ? refOrId : { id: refOrId }
  let identity
  if (ref?.id != null) identity = `id:${String(ref.id)}`
  else if (ref?.entityId) identity = `entity:${String(ref.entityId)}`
  else if (ref?.filePath || ref?.imagePath) identity = `path:${String(ref.filePath || ref.imagePath)}`
  else if (opts.refIndex != null) identity = `index:${String(opts.refIndex)}`
  else identity = `legacy:${String(ref?.type || '')}:${String(ref?.name || '')}`
  return `${scopePart(opts)}::${identity}`
}

export function isFlowCharacterOperationActive(refOrId, opts = {}) {
  return activeByKey.has(flowCharacterOperationKey(refOrId, opts))
}

function withTimeout(promise, timeoutMs) {
  if (!(timeoutMs > 0)) return promise
  let timer
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Flow character operation timed out after ${timeoutMs}ms`)), timeoutMs)
  })
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer))
}

/**
 * 공유 flowView 작업을 직렬 실행한다. 같은 key+operation 의 joinable 작업은 같은 결과에 합류한다.
 * task 또는 publishResult 는 상태 publish 까지 포함해야 한다 — 반환되는 순간 key 가 해제된다.
 */
export function runFlowCharacterOperation({ ref, projectId, scopeToken, scope, refIndex, operation, join = false, timeoutMs, task, publishResult }) {
  const opts = { projectId, scopeToken, scope, refIndex }
  const key = flowCharacterOperationKey(ref, opts)
  const current = activeByKey.get(key)
  if (current) {
    if (join && current.join && current.operation === operation) {
      if (typeof publishResult === 'function') current.publishers.push(publishResult)
      return current.promise
    }
    return Promise.resolve({ ok: false, busy: true, error: 'Flow character operation already in flight' })
  }

  const previous = flowViewTail.catch(() => {})
  const entry = {
    operation,
    join,
    publishers: typeof publishResult === 'function' ? [publishResult] : [],
    promise: null,
  }
  // #R37: 실제 작업(inner)과 호출자가 기다리는 promise 를 분리한다.
  //
  //   타임아웃이 바깥 promise 를 reject 하면서 key 까지 지우면, **작업은 아직 Flow 를 건드리는 중인데**
  //   상호배제만 풀린다. 그 창으로 두 번째 업로드가 들어가면 Flow 가 entity 를 또 만든다 — 정확히
  //   이 작업이 고치려는 버그다. 그래서 key 해제와 flowView 직렬화는 **inner** 에 묶고, 타임아웃은
  //   호출자를 풀어주기만 한다(락은 유지).
  //
  //   대가: 영영 settle 안 되는 작업이 있으면 그 ref 가 잠긴 채 남는다. 그래도 원격 상태를 오염시키고
  //   중복 entity 를 만드는 것보다 낫다. 실제로는 flowPageFetch 가 자체 abort/timeout 을 갖고 있어
  //   inner 는 결국 settle 한다 — 이 락은 그 위의 백스톱이다.
  const inner = (async () => {
    await previous
    const result = await Promise.resolve().then(task)
    // joiner 는 서로 다른 React mirror(App gate local array, panel/modal state)를 가질 수 있다.
    // 등록된 publisher 를 모두 drain 해야 어느 caller 도 stale 결과로 다음 작업을 시작하지 않는다.
    let published = 0
    while (true) {
      while (published < entry.publishers.length) await entry.publishers[published++](result)
      await Promise.resolve()
      if (published === entry.publishers.length) break
    }
    return result
  })()
  const promise = withTimeout(inner, timeoutMs ?? FLOW_CHARACTER_OPERATION_TIMEOUT_MS)
  promise.catch(() => {})   // 타임아웃 reject 가 unhandled 로 새지 않게(호출자는 별도로 받는다)
  entry.promise = promise
  activeByKey.set(key, entry)
  // 직렬화도 inner 기준 — 타임아웃된 작업이 아직 flowView 를 쥐고 있는데 다음 작업을 태우면 안 된다.
  flowViewTail = inner.catch(() => {})
  inner.finally(() => {
    if (activeByKey.get(key)?.promise === promise) activeByKey.delete(key)
  }).catch(() => {})
  return promise
}
