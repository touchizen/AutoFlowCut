import {
  applyM1MentionExclusions,
  collectM1FlowReferenceExclusions,
  collectReferencedEmptyCards,
  flowSyncable,
} from '../utils/refImageGuard'
import { selectUnsyncedMentionedRefs } from '../utils/flowCharacterSync'
import { filterPendingScenes } from '../utils/sceneFilters'

// MCP 가 시작한 배치엔 사람이 없다 — 모달을 띄우면 아무도 안 눌러 배치가 영영 시작 안 되고
// latch 만 잡힌 채 남는다. 모달 대신 M1 의미(제외하고 진행)로 자동 응답한다(§2.1).
export const nonInteractiveGateView = {
  confirm: async () => 'exclude',
  setBusy: () => {},
  failure: async () => {},
  close: () => {},
}

// M2 이전에도 미동기화 mention은 사람 sync modal에서 return해 batch를 시작하지 않았다.
// MCP는 그 modal을 누를 사람이 없으므로 auto-proceed 대신 즉시 취소해 latch jam과 degraded 생성을 막는다.
// 장기적으로는 MCP용 headless auto-sync가 낫지만, sync loop의 비대화식 실행은 이번 범위 밖이다.
export const nonInteractiveSyncGate = async () => ({
  proceeded: false,
  patchedRefs: null,
})

// React wiring 경계. scenes/refs/mode/start는 모달 대기 뒤에도 최신이어야 하므로 값이나
// 렌더 closure를 캡처하지 않고 호출 시점의 ref.current를 읽는다.
export function buildEmptyRefGateDeps({
  source = 'ui',
  scenesRef,
  referencesRef,
  modeRef,
  getProjectName,
  getMatchingReferences,
  subscriptionPreGate,
  setPendingLatch,
  handleGenerateAllRefs,
  openSyncGate,
  automationStartRef,
  toastM1Exclusions,
  gateView,
}) {
  return {
    getLiveScenes: () => scenesRef.current,
    getLiveRefs: () => referencesRef.current,
    getMode: () => modeRef.current,
    getProjectName,
    matchRefs: getMatchingReferences,
    subscriptionPreGate,
    setPendingLatch,
    generateRefs: keys => handleGenerateAllRefs(null, {
      force: false,
      targetRefKeys: keys,
      reason: 'm2-empty-reference-gate',
    }),
    openSyncGate: source === 'mcp'
      ? nonInteractiveSyncGate
      : openSyncGate,
    startScenes: opts => automationStartRef.current(opts),
    toastM1Exclusions,
    gateView,
  }
}

// 스캔 집합과 최종 생성 집합의 단일 출처(§6.3). 최초 Start 의도(initialTargetSceneIds)를 membership
// 경계로 잠그고, 실행 시점 live scenes 로 force/pending 을 재적용한다.
export function resolveLiveTargetScenes(context, liveScenes = []) {
  const intendedIds = new Set(context.initialTargetSceneIds || [])
  const liveIntendedScenes = liveScenes.filter(scene => intendedIds.has(scene.id))
  return context.force
    ? liveIntendedScenes.filter(scene => scene.prompt)
    : filterPendingScenes(liveIntendedScenes)
}

// App 독립 postcondition(§10). batchResult.ok 만으로 씬 배치를 시작하지 않는다.
export function evaluateEmptyRefPostcondition({ batchResult, liveTargetScenes, matchRefs }) {
  const failures = []

  for (const item of batchResult.failed || []) {
    failures.push({ key: item.key, stage: 'postcondition', error: 'still-empty' })
  }
  if (batchResult.outcome === 'stopped') {
    failures.push({ key: null, stage: 'postcondition', error: 'still-empty' })
  }

  const requestedKeySet = new Set(batchResult.requestedKeys || [])

  // 요청했는데 사라진 target 은 성공으로 위장되면 안 된다(§11.3).
  for (const item of batchResult.skipped || []) {
    if (item.stage === 'not-found' && requestedKeySet.has(item.key)) {
      failures.push({ key: item.key, stage: 'postcondition', error: 'not-found' })
    }
  }

  // 요청한 target 이 여전히 빈카드로 참조되면 fail-closed.
  const liveEmpty = collectReferencedEmptyCards(liveTargetScenes, matchRefs)
  for (const card of liveEmpty.cards) {
    if (!requestedKeySet.has(card.key)) continue  // 요청 대상이 아니면 최종 M1 소관(§10.5)
    failures.push({
      key: card.key,
      stage: 'postcondition',
      error: card.hasPrompt ? 'still-empty' : 'missing-prompt',
    })
  }

  return { ok: failures.length === 0, failures }
}

const REQUIRED_DEPS = [
  'getLiveScenes',
  'getLiveRefs',
  'getMode',
  'getProjectName',
  'matchRefs',
  'subscriptionPreGate',
  'setPendingLatch',
  'generateRefs',
  'openSyncGate',
  'startScenes',
  'toastM1Exclusions',
]

const REQUIRED_GATE_VIEW_DEPS = [
  'confirm',
  'setBusy',
  'failure',
  'close',
]

function assertFunctionDeps(deps) {
  for (const name of REQUIRED_DEPS) {
    if (typeof deps?.[name] !== 'function') {
      throw new Error(`[emptyRefGate] deps.${name} must be a function`)
    }
  }
  for (const name of REQUIRED_GATE_VIEW_DEPS) {
    if (typeof deps?.gateView?.[name] !== 'function') {
      throw new Error(`[emptyRefGate] deps.gateView.${name} must be a function`)
    }
  }
}

/**
 * 빈 Reference Card gate의 비동기 순서를 App/React state와 분리해 실행한다.
 * context에는 최초 Start 의도와 설정만 두고, 씬/ref 판정은 매 단계 live getter로 다시 읽는다.
 */
export async function runEmptyRefGateFlow(context, deps) {
  assertFunctionDeps(deps)

  const invariantBroken = () => {
    if (deps.getMode() !== context.startMode) return 'mode-changed'
    if (deps.getProjectName() !== context.projectName) return 'project-changed'
    return null
  }

  const entryInvariant = invariantBroken()
  if (entryInvariant) return { started: false, reason: entryInvariant }

  let authoritativeRefs = deps.getLiveRefs()
  const matchWithRefs = scene => deps.matchRefs(scene, authoritativeRefs)
  const initialTargetScenes = resolveLiveTargetScenes(
    context,
    deps.getLiveScenes()
  )
  const initialEmpty = collectReferencedEmptyCards(
    initialTargetScenes,
    matchWithRefs
  )

  const continueToSceneLaunch = async (successReason) => {
    let liveTargetScenes = resolveLiveTargetScenes(
      context,
      deps.getLiveScenes()
    )
    let m1Result = collectM1FlowReferenceExclusions(
      liveTargetScenes,
      matchWithRefs
    )
    const syncCandidateScenes = liveTargetScenes.map(scene =>
      applyM1MentionExclusions(scene, m1Result.mentionNamesBySceneId)
    )
    const unsyncedMentioned = selectUnsyncedMentionedRefs(
      syncCandidateScenes,
      authoritativeRefs
    ).filter(flowSyncable)

    if (unsyncedMentioned.length > 0) {
      const syncResult = await deps.openSyncGate({ refs: unsyncedMentioned })
      const afterSyncInvariant = invariantBroken()
      if (afterSyncInvariant) {
        return { started: false, reason: afterSyncInvariant }
      }
      if (!syncResult?.proceeded) {
        return { started: false, reason: 'sync-cancelled' }
      }
      authoritativeRefs = syncResult.patchedRefs ?? authoritativeRefs
    } else {
      const afterSyncInvariant = invariantBroken()
      if (afterSyncInvariant) {
        return { started: false, reason: afterSyncInvariant }
      }
    }

    // sync가 refs를 패치하거나 대기 중 씬이 바뀔 수 있어 launch 직전 둘 다 다시 계산한다.
    liveTargetScenes = resolveLiveTargetScenes(
      context,
      deps.getLiveScenes()
    )
    m1Result = collectM1FlowReferenceExclusions(
      liveTargetScenes,
      matchWithRefs
    )

    if (liveTargetScenes.length === 0) {
      return { started: false, reason: 'no-live-targets' }
    }

    const beforeStartInvariant = invariantBroken()
    if (beforeStartInvariant) {
      return { started: false, reason: beforeStartInvariant }
    }

    // 실제 launch에 쓰이는 최종 M1 결과만 한 번 알린다. 실패/취소 경로에는 토스트가 없다.
    if (m1Result.exclusions.length > 0) {
      deps.toastM1Exclusions(m1Result.exclusions)
    }

    // 큐 대기 구간을 잠근다 — App 이 원래 setHasPendingBatch(true) 로 start 를 감싸던 계약이다.
    // M2 경로는 모달을 열 때 이미 잡았으므로 여기선 idempotent, 빈카드 없는 경로는 여기서 잡는다.
    deps.setPendingLatch(true)
    await deps.startScenes({
      ...context.startOptionsWithoutSceneIds,
      sceneIds: liveTargetScenes.map(scene => scene.id),
      force: context.force,
      batchIntent: 'full',
      currentRefs: authoritativeRefs,
      m1ExcludedMentionNamesBySceneId: m1Result.mentionNamesBySceneId,
    })
    return { started: true, reason: successReason }
  }

  if (initialEmpty.cards.length === 0) {
    try {
      return await continueToSceneLaunch('no-empty-cards')
    } finally {
      // 빈카드가 없어 M2 latch를 잡지 않았어도 기존 pending 표시가 남지 않게 idempotent 해제한다.
      deps.setPendingLatch(false)
    }
  }

  const subscriptionGate = await deps.subscriptionPreGate()
  if (subscriptionGate !== 'proceed') {
    return { started: false, reason: `gate-${subscriptionGate}` }
  }

  deps.setPendingLatch(true)
  try {
    const choice = await deps.gateView.confirm(initialEmpty.cards)
    const afterConfirmInvariant = invariantBroken()
    if (afterConfirmInvariant) {
      deps.gateView.close()
      return { started: false, reason: afterConfirmInvariant }
    }

    if (choice === 'cancel') {
      deps.gateView.close()
      return { started: false, reason: 'cancelled' }
    }

    if (choice === 'generate-first') {
      // 모달 snapshot은 렌더용일 뿐이다. 클릭 시점 live scenes/refs로 target key를 다시 만든다.
      const liveTargetScenes = resolveLiveTargetScenes(
        context,
        deps.getLiveScenes()
      )
      authoritativeRefs = deps.getLiveRefs()
      const liveEmpty = collectReferencedEmptyCards(liveTargetScenes, matchWithRefs)
      const targetRefKeys = liveEmpty.generatableCards.map(card => card.key)

      deps.gateView.setBusy()
      const batchResult = await deps.generateRefs(targetRefKeys)

      const afterBatchInvariant = invariantBroken()
      if (afterBatchInvariant) {
        deps.gateView.close()
        return { started: false, reason: afterBatchInvariant }
      }

      // Ref batch 내부의 동기 mirror가 유일한 권위다. App live ref mirror를 다시 읽지 않는다.
      authoritativeRefs = batchResult.currentRefs

      if (batchResult.ok !== true) {
        await deps.gateView.failure({
          outcome: batchResult.outcome,
          failures: batchResult.failed || [],
        })
        return {
          started: false,
          reason: batchResult.outcome === 'stopped'
            ? 'batch-stopped'
            : 'batch-failed',
        }
      }

      const postcondition = evaluateEmptyRefPostcondition({
        batchResult,
        liveTargetScenes: resolveLiveTargetScenes(
          context,
          deps.getLiveScenes()
        ),
        matchRefs: matchWithRefs,
      })
      if (!postcondition.ok) {
        await deps.gateView.failure({
          outcome: batchResult.outcome,
          failures: postcondition.failures,
        })
        return { started: false, reason: 'postcondition-failed' }
      }

      // postcondition을 통과하기 전에는 failure UI를 닫지 않는다.
      deps.gateView.close()
    } else if (choice === 'exclude') {
      // 배치를 돌리지 않는 경로는 클릭 시점 App live ref mirror가 권위다.
      authoritativeRefs = deps.getLiveRefs()
      deps.gateView.close()
    } else {
      deps.gateView.close()
      return { started: false, reason: 'cancelled' }
    }

    return await continueToSceneLaunch('started')
  } finally {
    // failure 모달 확인, scene start early-return/throw를 포함해 latch 수명의 마지막 소유자다.
    deps.setPendingLatch(false)
  }
}
