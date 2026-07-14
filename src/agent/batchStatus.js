import { isSceneGenerationDone, isReferenceUploadedDone } from '../services/generationStatus'

/**
 * 배치 상태의 **유일한 진실은 renderer** 다 — main 엔 없다. 그래서 `wait_batch`(§2.3)는 이 값을
 * toolBridge 로 읽는다. 순수 함수로 뽑아 legacy `__mcpBatchStatus` 와 **같은 계산**을 쓰게 한다
 * (두 벌이면 드리프트한다).
 *
 * 🔴 **legacy shape 을 그대로 태우면 안 된다** (`useMcpServer.js:552-560`):
 *    `isRunning` 이 `videoAutomation.isRunning` 을 **OR** 하고, `status` 는 scene automation 이 멈추면
 *    **video 의 status** 를 돌려준다. 영상은 `wait_videos` 소관이다 — 이미지 배치 판정에 섞으면
 *    에이전트가 엉뚱한 걸 기다린다. 여기서는 영상을 **보지 않는다.**
 *
 * `status` 매핑 (renderer 종결 상태 → 스펙 §2.3 enum):
 *   running → 'running' / 'done' → 'complete' / 'stopped' → 'cancelled-by-user' / 'error' → 'error'
 *
 * ⚠️ **알려진 컨플레이션**: renderer 의 `stopRequestedRef` 는 **사용자 Stop 과 쿼터 중단을 구분하지 않는다**
 *    (`quotaStop.js` 가 같은 ref 를 세운다). 그래서 쿼터 중단도 `cancelled-by-user` 로 나간다.
 *    구분이 필요하면 renderer 에 `stopReason` 을 다는 게 별도 슬라이스다 —
 *    지금 `complete` 로 위장하는 것보다는 정직하다.
 */
export function readBatchStatus({
  type,
  automation = {},
  scenes = [],
  references = [],
  generatingRefs = [],
  refBatchRunning = false,
} = {}) {
  if (type === 'scene') {
    const total = scenes.length
    return {
      type,
      status: terminalStatus({ isRunning: automation.isRunning, status: automation.status }),
      done: scenes.filter(isSceneGenerationDone).length,
      total,
      error: scenes.filter((s) => s.status === 'error').length,
    }
  }

  if (type === 'ref') {
    // total/done 을 같은 모집단(prompt 있는 것)에서 계산해 **done ⊆ total** 을 보장한다 —
    // prompt 없는 수동 업로드 ref 가 done 만 키우는 모순 차단.
    const eligible = references.filter((r) => r.prompt)
    // ref hook 은 종결 사유(stopped/error)를 밖으로 내보내지 않는다 → running/complete 만 구분 가능.
    // ref 배치의 취소 감지는 hook 이 사유를 노출할 때 붙는다.
    const isRunning = refBatchRunning || generatingRefs.length > 0
    return {
      type,
      status: isRunning ? 'running' : 'complete',
      done: eligible.filter(isReferenceUploadedDone).length,
      total: eligible.length,
      error: 0,
    }
  }

  // fail-closed. 조용히 scene 으로 폴백하면 에이전트는 엉뚱한 배치를 기다리고도 모른다.
  throw new Error(`unknown batch type: ${type}`)
}

function terminalStatus({ isRunning, status }) {
  if (isRunning) return 'running'
  if (status === 'stopped') return 'cancelled-by-user'
  // auth 실패를 complete 로 내면 에이전트가 죽은 인증으로 재시도 루프를 돈다.
  if (status === 'error') return 'error'
  return 'complete'
}
