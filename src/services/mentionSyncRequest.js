import { selectMentionSyncTargets } from '../utils/mentionSyncTargets'

/**
 * "이 씬의 미동기화 @멘션을 처리해 달라"는 요청을 처리한다.
 *
 * App 안에 인라인으로 두면 실행되는 테스트를 붙일 수 없다 — 실제로 이 판정을 통째로 되돌려도
 * 전체 스위트가 초록불이었다(뮤테이션 실측). 판정을 여기로 빼고 주변(refs/프로젝트/모달)만
 * deps 로 받는다.
 *
 * 두 종류의 요청:
 *  - names 없음(프리플라이트): 생성 전에 물어본다. 동기화할 게 없으면 모달 없이 진행하되
 *    **live refs 를 돌려준다** — 큐에 쌓여 있던 다음 씬은 이전 씬이 동기화한 결과를 모르는
 *    클로저를 들고 있어서, 그냥 진행시키면 옛 ref 로 또 미해결 실패가 난다.
 *  - names 있음(엔진이 거절한 뒤의 복구): 그 이름들을 **강제 재등록**으로 태운다(forceRepair) —
 *    우리 기록이 synced 여도 엔진이 못 쓴다고 했으므로 기록 쪽이 옛것일 수 있다.
 *    고칠 대상이 없으면 진행시키지 않는다 — 그대로 진행하면 호출부가 같은 실패를 한 번 더 부른다.
 *
 * 프로젝트 스코프: 전환은 **레퍼런스를 먼저 갈고 이름을 나중에** 커밋한다. 그래서 이름만 보면
 * 이름은 아직 A 인데 refs 는 이미 B 인 창이 있다 — 전환 진행 중이면 아예 진행하지 않는다.
 * 게이트를 기다리는 동안 시작된 전환도 잡아야 하므로 매번 **지금** 값을 읽는다(렌더 클로저 금지).
 *
 * @param {{scene?: object, names?: string[], projectName?: string}} req
 * @param {{
 *   getReferences: () => Array,
 *   getProjectName: () => string,
 *   isProjectLoading: () => boolean,
 *   openGate: (o: {refs: Array, forceRepair: boolean}) => Promise<{proceeded: boolean, patchedRefs?: Array, reason?: string}>,
 *   onBlocked?: (reason: string) => void,
 * }} deps
 * @returns {Promise<{proceeded: boolean, refs?: Array, reason?: string}>}
 */
export async function runMentionSyncRequest({ scene, names, projectName: expectedProject }, deps) {
  const outOfScope = () => deps.isProjectLoading()
    || (expectedProject != null && expectedProject !== deps.getProjectName())

  if (outOfScope()) return { proceeded: false, reason: 'project-changed' }

  const refs = deps.getReferences() || []
  const targets = selectMentionSyncTargets({ scene, names, references: refs })
  if (targets.length === 0) {
    if (names?.length) return { proceeded: false, reason: 'no-target' }
    return { proceeded: true, refs }
  }

  const res = await deps.openGate({ refs: targets, forceRepair: !!names?.length })
  if (!res.proceeded) {
    // 다른 동기화가 돌고 있어서(busy) 또는 다른 게이트에 밀려서(superseded) 거절된 경우엔 조용히
    // 넘어가지 않는다 — 사용자에겐 버튼이 안 먹은 것으로 보인다.
    if (res.reason === 'busy' || res.reason === 'superseded') deps.onBlocked?.(res.reason)
    return { proceeded: false, reason: res.reason }
  }
  if (outOfScope()) return { proceeded: false, reason: 'project-changed' }
  return { proceeded: true, refs: res.patchedRefs || deps.getReferences() || refs }
}
