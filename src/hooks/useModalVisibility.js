/**
 * useModalVisibility — 모달/전체화면 등 DOM 오버레이가 열릴 때 Flow WebContentsView를 숨기고
 * (네이티브 레이어라 CSS z-index로 못 가림) 닫힐 때 복원.
 *
 * 여러 오버레이(모달 여러 개 + 전체화면 모니터)가 동시에 숨김을 필요로 할 수 있으므로
 * 단일 글로벌 flag 를 ref-count 로 관리한다 — 0→1 일 때만 숨기고(visible:true),
 * 1→0 일 때만 복원(visible:false)한다. 안 그러면 먼저 닫히는 오버레이가 Flow 를 복원해
 * 아직 숨김이 필요한 다른 오버레이를 가린다.
 *
 * @param {boolean} isOpen
 */
import { useEffect } from 'react'

let heldCount = 0

function setNativeFlowHidden(hidden) {
  window.electronAPI?.setModalVisible?.({ visible: hidden })
}

/** Flow 숨김 1건 획득 — 0→1 전환에서만 실제 숨김. */
export function acquireFlowHidden() {
  heldCount += 1
  if (heldCount === 1) setNativeFlowHidden(true)
}

/** Flow 숨김 1건 해제 — 1→0 전환에서만 실제 복원. (음수 방지) */
export function releaseFlowHidden() {
  if (heldCount === 0) return
  heldCount -= 1
  if (heldCount === 0) setNativeFlowHidden(false)
}

/** 테스트 전용 — 카운터 초기화. */
export function __resetFlowHiddenForTests() {
  heldCount = 0
}

export function useModalVisibility(isOpen) {
  useEffect(() => {
    if (!isOpen) return
    acquireFlowHidden()
    return () => releaseFlowHidden()
  }, [isOpen])
}
