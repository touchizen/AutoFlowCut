const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
export function newBatchId() { return crypto.randomUUID() }
export function isValidBatchId(s) { return typeof s === 'string' && UUID_V4.test(s) }

/**
 * 프로젝트별 batchId 관리. 한 프로젝트의 한 논리적 배치 동안만 같은 id 를 재사용한다.
 *   - full start (isPartialRetry=false): 새 id 발급 + 저장 (= 새 배치, 새 과금).
 *   - partial retry (isPartialRetry=true): 그 프로젝트의 기존 id 재사용(서버 멱등 → 무료),
 *     없으면 새로 발급(fresh).
 * 프로젝트별로 분리되므로 (a) 다른 프로젝트의 과금된 id 에 무임승차할 수 없고(누수 차단),
 * (b) 프로젝트를 오가도 각 프로젝트의 id 가 보존돼 retry 가 이중과금되지 않는다.
 * @param {Map<string,string>} map  projectName -> batchId
 * @returns {{ batchId: string, reused: boolean }}
 */
export function resolveProjectBatchId(map, projectName, isPartialRetry) {
  const existing = map.get(projectName)
  if (isPartialRetry && existing) return { batchId: existing, reused: true }
  const batchId = newBatchId()
  map.set(projectName, batchId)
  return { batchId, reused: false }
}
