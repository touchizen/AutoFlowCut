import { useCallback, useLayoutEffect, useRef } from 'react'

// 스트리밍 컨테이너를 바닥에 붙여 둔다. SSE 델타로 내용이 늘어나면 뷰가 따라 내려가 새 텍스트가
// 보이게 한다(안 하면 scrollTop이 0에 머물러 텍스트는 가만히 있고 스크롤바만 줄어든다).
//
// 무조건 끌어내리지는 않는다 — 사용자가 위로 올려 읽는 중이면 델타마다 도로 바닥으로 끌려가
// 아무것도 못 읽는다. 바닥(임계값 이내)에 있을 때만 따라가고, 다시 바닥으로 내리면 재개한다.
//
// 반환한 onScroll을 컨테이너의 onScroll에 연결해야 "붙어 있는지"가 갱신된다.
export function useStickToBottom(dep, { threshold = 24 } = {}) {
  const ref = useRef(null)
  const stuckRef = useRef(true) // 처음엔 바닥(빈 내용) — 첫 델타부터 따라간다

  const onScroll = useCallback(() => {
    const el = ref.current
    if (!el) return
    stuckRef.current = el.scrollHeight - el.scrollTop - el.clientHeight <= threshold
  }, [threshold])

  // paint 전에 맞춰야 한 프레임 깜빡이지 않는다.
  useLayoutEffect(() => {
    const el = ref.current
    if (!el || !stuckRef.current) return
    el.scrollTop = el.scrollHeight - el.clientHeight
  }, [dep])

  return { ref, onScroll }
}
