import { useCallback, useLayoutEffect, useRef } from 'react'

// 스트리밍 컨테이너를 바닥에 붙여 둔다. SSE 델타로 내용이 늘어나면 뷰가 따라 내려가 새 텍스트가
// 보이게 한다(안 하면 scrollTop이 0에 머물러 텍스트는 가만히 있고 스크롤바만 줄어든다).
//
// 무조건 끌어내리지는 않는다 — 사용자가 위로 올려 읽는 중이면 델타마다 도로 바닥으로 끌려가
// 아무것도 못 읽는다. 바닥(임계값 이내)에 있을 때만 따라가고, 다시 바닥으로 내리면 재개한다.
//
// 반환한 onScroll을 컨테이너의 onScroll에 연결해야 "붙어 있는지"가 갱신된다.
//
// 스트림 컨테이너는 생성이 끝나면 언마운트되지만 훅은 부모(StoryView)에 남는다. 위로 올려 읽다
// 끝낸 run의 stuck=false를 그대로 들고 있으면 다음 run은 영영 안 따라간다 — 되돌릴 onScroll도
// 안 온다(엘리먼트가 없으니). 그래서 새 컨테이너가 붙을 때마다 바닥에서 다시 시작한다.
export function useStickToBottom(dep, { threshold = 24 } = {}) {
  const elRef = useRef(null)
  const stuckRef = useRef(true) // 처음엔 바닥(빈 내용) — 첫 델타부터 따라간다

  const ref = useCallback((node) => {
    elRef.current = node
    if (node) stuckRef.current = true
  }, [])

  const onScroll = useCallback(() => {
    const el = elRef.current
    if (!el) return
    stuckRef.current = el.scrollHeight - el.scrollTop - el.clientHeight <= threshold
  }, [threshold])

  // paint 전에 맞춰야 한 프레임 깜빡이지 않는다.
  useLayoutEffect(() => {
    const el = elRef.current
    if (!el || !stuckRef.current) return
    el.scrollTop = el.scrollHeight - el.clientHeight
  }, [dep])

  return { ref, onScroll }
}
