import { useCallback, useRef, useState } from 'react'

/**
 * 동기화 게이트(모달)의 소유권 조정자.
 *
 * 게이트를 여는 경로가 여럿이다(배치 Start, T2V, 개별 씬 생성). 각자 setState 로 게이트를 갈아
 * 끼우면 두 가지가 깨진다:
 *  - 열려 있던 게이트의 resolver 가 사라져 그걸 기다리던 생성 큐가 **영영** 멈춘다(고아 promise).
 *  - 동기화가 도는 중에 열린 다른 게이트를, 먼저 돌던 작업이 끝나면서 닫아버린다(남의 모달).
 *
 * 그래서 여는 것도 닫는 것도 여기 하나로 모은다:
 *  - 이미 동기화가 **진행 중**이면 새 요청은 열지 않고 `reason:'busy'` 로 돌려보낸다. 진행 중인
 *    작업을 가로채면 그 결과를 전달할 곳이 없어진다.
 *  - 새 게이트가 열리면 이전 대기자는 `reason:'superseded'` 로 반드시 풀어준다.
 *  - 닫기는 **자기 게이트일 때만**(id 대조) — 그 사이 열린 게이트를 건드리지 않는다.
 *
 * busy 는 ref 로 **동기적으로** 세운다. 렌더된 state 를 거울처럼 따라가면 setState 직후~리렌더
 * 사이에 값이 반대인 창이 생겨, 바로 그 창에서 두 번째 요청이 통과한다.
 */
export function useSyncGateHost() {
  const [gate, setGate] = useState(null)
  const [busy, setBusy] = useState(false)
  const busyRef = useRef(false)
  const gateRef = useRef(null)
  const seqRef = useRef(0)

  const setCurrent = useCallback((next) => { gateRef.current = next; setGate(next) }, [])
  // 자기 게이트일 때만 화면에서 내린다 — 그 사이 다른 경로가 연 게이트를 닫으면 그 대기자가 남는다.
  const clearIfMine = useCallback((myGate) => {
    if (gateRef.current && gateRef.current.id === myGate.id) setCurrent(null)
  }, [setCurrent])

  const open = useCallback(({ refs, forceRepair = false }) => new Promise((resolve) => {
    if (busyRef.current) { resolve({ proceeded: false, patchedRefs: null, reason: 'busy' }); return }
    // 새 게이트가 이전 것을 대체한다면, 이전 대기자를 반드시 풀어준다(고아 promise 금지).
    gateRef.current?.settle({ proceeded: false, patchedRefs: null, reason: 'superseded' })
    let settled = false
    const settle = (value) => { if (settled) return; settled = true; resolve(value) }
    setCurrent({ id: ++seqRef.current, refs, forceRepair, settle })
  }), [setCurrent])

  /** 이 게이트의 동기화 작업을 시작한다(그동안 다른 요청은 busy 로 거절된다). */
  const beginWork = useCallback(() => { busyRef.current = true; setBusy(true) }, [])
  const endWork = useCallback(() => { busyRef.current = false; setBusy(false) }, [])

  /** 작업 완료 — 자기 게이트만 닫고 그 대기자에게 결과를 준다. */
  const finish = useCallback((myGate, patchedRefs) => {
    if (!myGate) return
    // 대기자를 먼저 풀고 화면을 내린다 — 모달이 사라진 뒤에도 대기자가 남아 있는 창을 만들지 않는다.
    myGate.settle({ proceeded: true, patchedRefs: patchedRefs ?? null })
    clearIfMine(myGate)
  }, [clearIfMine])

  /** 사용자가 닫음 — 인자 없으면 지금 열려 있는 게이트. */
  const cancel = useCallback((myGate) => {
    const g = myGate || gateRef.current
    if (!g) return
    g.settle({ proceeded: false, patchedRefs: null, reason: 'cancelled' })
    clearIfMine(g)
  }, [clearIfMine])

  return { gate, busy, busyRef, open, beginWork, endWork, finish, cancel }
}
