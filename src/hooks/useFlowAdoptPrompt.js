import { useEffect, useRef, useState } from 'react'
import { shouldPromptAdopt, ADOPT_PROMPT_COOLDOWN_MS, ADOPT_RETRY_COOLDOWN_MS } from '../utils/flowAdoptPrompt'

/** 쿨다운 키: 거절은 (로컬 프로젝트, Flow 프로젝트) 쌍에 대한 것이다. */
const cooldownKey = (projectName, flowProjectId) => (flowProjectId ? `${projectName ?? ''}\u0000${flowProjectId}` : null)

/** 채택 회복을 다시 시도하는 주기. */
export const ADOPT_POLL_MS = 5000

/**
 * Flow 생성이 차단된 동안(flowProjectReady=false) 회복을 주기적으로 시도하고, 채택 후보가
 * 나오면 확인 모달을 띄우는 배선.
 *
 * tryAdopt 는 arm 되기 전이거나 Flow 가 이전 프로젝트에 머물러 있으면 아무것도 하지 않으므로
 * 도는 동안 무해하다. 성공하면 flowProjectReady 가 true 가 되어 폴링이 멈춘다.
 *
 * - 모달이 떠 있는 동안(candidate)에는 폴링을 멈춘다 — 사용자가 답하는 중에 상태를 바꾸지 않는다.
 * - 프로젝트 전환 중(projectLoading)에도 멈춘다 — 전환은 projectName 과 flowProjectId 를 따로
 *   커밋하므로 그 사이의 채택은 어느 프로젝트의 것인지 어긋난다.
 * - 취소한 후보는 한동안 다시 묻지 않는다(모달이 Flow 뷰를 0×0 으로 접어 선택 시간을 뺏는다).
 *   거절은 "이 로컬 프로젝트에 저 Flow 프로젝트를 붙이지 않겠다"는 뜻이므로 (로컬 프로젝트, Flow id)
 *   쌍으로 기억한다 — Flow id 는 전역이라 id 만으로 기억하면 다른 프로젝트의 정답까지 막는다.
 *
 * @param {{mode: string, flowProjectReady: boolean, projectLoading: boolean, projectName: string,
 *          tryAdopt: (opts?: object) => Promise<object>, intervalMs?: number}} params
 * @returns {{candidate: string|null, confirm: () => Promise<void>, cancel: () => void}}
 */
export function useFlowAdoptPrompt({ mode, flowProjectReady, projectLoading, projectName, tryAdopt, onAdoptFailed, intervalMs = ADOPT_POLL_MS }) {
  // ⚠️ tryAdopt 는 매 render 새 함수라 deps 에 넣으면 리렌더마다(재생 중 playhead 등) interval 이
  //    리셋돼 영원히 안 터진다. ref 로 최신 함수만 들고 deps 에서 뺀다.
  const adoptRef = useRef(tryAdopt)
  adoptRef.current = tryAdopt
  const onFailedRef = useRef(onAdoptFailed)
  onFailedRef.current = onAdoptFailed
  // {projectId, projectName} — 후보를 **관측한 프로젝트**를 함께 들고 다닌다. 취소/확인 시점의
  // 프로젝트로 판단하면 그 사이 전환이 있었을 때 엉뚱한 프로젝트를 침묵시키거나 승인하게 된다.
  const [candidate, setCandidate] = useState(null)
  const cancelledAtRef = useRef(new Map())

  useEffect(() => {
    // 확인이 무의미해진 상태면 모달을 닫는다: 관측한 프로젝트를 떠났거나, flow 를 떠났거나,
    // 그 사이 다른 경로로 바인딩이 열렸거나. 열어 두면 사용자는 X 에 연결했다고 믿는데 앱은
    // 이미 다른 프로젝트에 바인딩돼 있고, 승인은 조용히 무시된다.
    if (candidate && (candidate.projectName !== projectName || mode !== 'flow' || flowProjectReady)) {
      setCandidate(null)
      return
    }
    if (mode !== 'flow' || flowProjectReady || candidate || projectLoading || !projectName) return
    const timer = setInterval(async () => {
      const r = await adoptRef.current?.()
      if (r?.reason !== 'needs-confirm' || !r.projectId) return
      if (shouldPromptAdopt(cooldownKey(projectName, r.projectId), cancelledAtRef.current, Date.now())) {
        setCandidate({ projectId: r.projectId, projectName })
      }
    }, intervalMs)
    return () => clearInterval(timer)
  }, [mode, flowProjectReady, candidate, projectLoading, projectName, intervalMs])

  const confirm = async () => {
    // 사용자가 승인한 것은 "그때 보여준 ID" 다 — 확인 사이에 Flow 가 옮겨갔으면 채택되지 않는다.
    const approved = candidate
    setCandidate(null)
    if (!approved) return
    const r = await adoptRef.current?.({ confirmed: true, expectedId: approved.projectId })
    if (r?.ok) return
    // 실패를 묻으면 아무 일도 안 일어난 것처럼 보이고 5초 뒤 같은 모달이 다시 뜬다 — 취소를
    // 눌러야만 멈추는 루프다. 사용자에게 알리고, 같은 후보는 쿨다운을 걸어 바로 다시 묻지 않는다.
    // 침묵은 짧게 — 실패는 대개 일시적이고(Flow 뷰가 그 순간 바쁨) 사용자의 의사는 이미 확인됐다.
    // 거절과 같은 10분을 재우면 "다시 시도하세요" 라고 띄워 놓고 10분간 안 묻는 꼴이 된다.
    cancelledAtRef.current.set(cooldownKey(approved.projectName, approved.projectId),
      { at: Date.now(), cooldownMs: ADOPT_RETRY_COOLDOWN_MS })
    onFailedRef.current?.(r)
  }

  const cancel = () => {
    // 이 프로젝트는 아니라는 의사표시 — 한동안 다시 묻지 않아 Flow 뷰를 되찾을 시간을 준다.
    if (candidate) {
      cancelledAtRef.current.set(cooldownKey(candidate.projectName, candidate.projectId),
        { at: Date.now(), cooldownMs: ADOPT_PROMPT_COOLDOWN_MS })
    }
    setCandidate(null)
  }

  return { candidate: candidate?.projectId ?? null, confirm, cancel }
}
