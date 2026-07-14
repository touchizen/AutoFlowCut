import { useEffect, useState, useCallback } from 'react'
import './ApprovalDialog.css'

/**
 * 에이전트가 위험한 툴(G = 사람 동의 필요 / B = 과금)을 부르려 할 때 뜨는 승인 창 (D14).
 *
 * 🔴 **무엇을 승인하는지 보여준다.** 툴 *이름*만 띄우면 — "generate_videos 를 승인할까요?" —
 *    사용자는 영상이 2개인지 8개인지 모른 채 누른다. 그건 동의가 아니다.
 *    (main 이 `argsHash` 로 "승인한 것"과 "실행되는 것"을 묶지만, **사람이 본 적 없는 값에 묶으면 소용없다.**)
 *
 * 🔴 **닫기 = 거부.** ESC 든 X 든, 창을 닫는 건 승인이 아니다.
 *    (main 도 같은 방향이다 — 창이 죽거나 시간이 지나면 decline 이다.)
 *
 * Codex 는 tool call 을 **병렬로 쏜다** → 승인 요청이 여러 개 겹칠 수 있다. 큐로 하나씩 처리한다.
 */
export default function ApprovalDialog() {
  const [queue, setQueue] = useState([])
  const current = queue[0] ?? null

  useEffect(() => {
    const off = window.electronAPI?.onAgentPermissionRequest?.((req) => {
      setQueue((q) => (q.some((x) => x.requestId === req.requestId) ? q : [...q, req]))
    })
    return () => off?.()
  }, [])

  const answer = useCallback((action) => {
    setQueue((q) => {
      const [head, ...rest] = q
      if (!head) return q
      // 큐에서 먼저 빼고 나서 응답한다 — 연타로 같은 요청에 두 번 답하지 않게.
      window.electronAPI?.respondAgentPermission?.({ requestId: head.requestId, action })
      return rest
    })
  }, [])

  useEffect(() => {
    if (!current) return undefined
    const onKey = (e) => { if (e.key === 'Escape') answer('decline') }   // 닫기 = 거부
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [current, answer])

  if (!current) return null

  const [title, ...body] = String(current.message ?? current.tool ?? '').split('\n')

  return (
    <div className="approval-backdrop" role="dialog" aria-modal="true" aria-label="에이전트 승인 요청">
      <div className="approval-dialog">
        <div className="approval-header">에이전트가 이 작업을 하려고 합니다</div>

        <div className="approval-tool">{title || current.tool}</div>
        {body.join('\n').trim() && (
          // 인자를 **그대로** 보여준다. 요약하면 사용자가 승인한 것과 실행되는 것이 갈릴 수 있다.
          <pre className="approval-args">{body.join('\n').trim()}</pre>
        )}

        <div className="approval-actions">
          <button type="button" className="approval-deny" onClick={() => answer('decline')}>거부</button>
          <button type="button" className="approval-allow" onClick={() => answer('accept')}>승인</button>
        </div>

        {queue.length > 1 && (
          <div className="approval-more">대기 중인 요청 {queue.length - 1}개</div>
        )}
      </div>
    </div>
  )
}
