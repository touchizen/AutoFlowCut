import { useEffect, useState, useCallback } from 'react'
import { useOptionalI18n } from '../../hooks/useI18n'
import { useModalVisibility } from '../../hooks/useModalVisibility'
import en from '../../locales/en'
import { leafPaths, presentApproval, residualPaths } from '../../agent/approvalPresenters'
import './ApprovalDialog.css'

/**
 * 🔴 **읽을 수 없는 승인은 동의가 아니다.** 기본 언어는 `en` 인데(useI18n DEFAULT_LANG) 이 창의
 *    문구가 한글로 박혀 있으면, 영어 사용자는 **자기 돈이 나가는 작업**의 승인 문구를 못 읽는다.
 *    ⚠️ 단 tool/args는 **번역하지 않는다** — 그건 앱이 검증한 데이터고, 번역하면
 *    "사람이 승인한 것"과 "실행되는 것"이 갈린다. UI chrome 만 locale 을 따른다.
 * I18nProvider 없이도 렌더 가능해야 하므로(단위 테스트) provider 가 없으면 기본 locale 로 떨어진다.
 */
function useSafeT() {
  const ctx = useOptionalI18n()
  return (key, params = {}) => {
    if (ctx?.t) return ctx.t(key, params)
    const value = key.split('.').reduce((node, part) => (node && typeof node === 'object' ? node[part] : undefined), en)
    if (typeof value !== 'string') return key
    return value.replace(/\{(\w+)\}/g, (match, name) => (params[name] !== undefined ? params[name] : match))
  }
}

function valueAtPath(value, pointer) {
  if (pointer === '') return value
  return pointer.slice(1).split('/').reduce((node, token) => {
    const key = token.replace(/~1/g, '/').replace(/~0/g, '~')
    return node?.[key]
  }, value)
}

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
  const t = useSafeT()
  const [queue, setQueue] = useState([])
  const current = queue[0] ?? null

  // 🔴 **Flow 는 Electron `WebContentsView` — 네이티브 레이어라 CSS z-index 로 절대 못 가린다.**
  //    실앱 실측: z-index 를 최대로 올려도 Flow UI 가 승인 창을 계속 덮었다. **다른 레이어이기 때문이다.**
  //    설정 모달은 이미 이 훅으로 Flow 를 접는다. 승인 창만 안 쓰고 있었다.
  //    가려진 승인 창 = 무엇을 승인하는지 못 보고 누르는 것 → 게이트의 목적이 무너진다.
  useModalVisibility(!!current)

  useEffect(() => {
    const offRequest = window.electronAPI?.onAgentPermissionRequest?.((req) => {
      setQueue((q) => (q.some((x) => x.requestId === req.requestId) ? q : [...q, req]))
    })
    const offCancel = window.electronAPI?.onAgentPermissionCancel?.(({ requestId } = {}) => {
      // cancel은 main이 이미 decline으로 정산한 알림이다. renderer 응답을 다시 보내지 않고 해당 건만 뺀다.
      if (requestId) setQueue((q) => q.filter((entry) => entry.requestId !== requestId))
    })
    return () => { offRequest?.(); offCancel?.() }
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

  const title = current.tool ?? ''
  const args = current.args === undefined ? null : current.args
  const argsText = JSON.stringify(args, null, 2)
  const presentation = presentApproval(title, args, t)
  const coveredPaths = presentation
    ? [
        ...presentation.lines.flatMap((line) => line.paths),
        ...presentation.blocks.map((block) => block.path),
      ]
    : []
  const residual = presentation ? residualPaths(args, coveredPaths) : leafPaths(args)
  const residualText = JSON.stringify(residual.map((path) => ({ path, value: valueAtPath(args, path) })), null, 2)
  // 무엇을 하는지가 먼저 와야 한다. headline 뒤에서만 danger를 정보보다 앞세우고 각 그룹 내부 순서는 지킨다.
  const orderedLines = presentation
    ? [
        ...presentation.lines.filter((line) => line.headline),
        ...presentation.lines.filter((line) => !line.headline && line.danger),
        ...presentation.lines.filter((line) => !line.headline && !line.danger),
      ]
    : []
  const hasDescription = orderedLines.length > 0 || presentation?.blocks.length > 0
  const rawMustStayOpen = presentation === null || residual.length > 0

  return (
    <div className="approval-backdrop" role="dialog" aria-modal="true" aria-label={t('agent.approvalLabel')}>
      <div className="approval-dialog">
        <div className="approval-header">{t('agent.approvalHeader')}</div>

        {presentation === null && (
          // presenter 없는 G/B 호출은 inventory skew나 손상이다. grant만 태우지 않도록 승인 자체를 막는다.
          <div className="approval-unknown-warning" role="alert">{t('agent.approvalUnknownWarning')}</div>
        )}

        {hasDescription && (
          <div className="approval-description" data-testid="approval-description">
            <ul className="approval-lines">
              {orderedLines.map((line, index) => (
                // CSS가 빠지는 테스트/임베드 경로에서도 승인값의 개행·연속 공백을 접지 않는다.
                <li
                  className={`approval-line${line.danger ? ' approval-line-danger' : ''}`}
                  key={`${index}-${line.text}`}
                  style={{ whiteSpace: 'pre-wrap' }}
                >
                  {line.text}
                </li>
              ))}
            </ul>
            {presentation.blocks.map((block) => (
              <section className="approval-block" key={block.path}>
                <div className="approval-section-label">{block.label}</div>
                {/* 긴 원문을 JSON string escape로 바꾸면 사용자가 실제 문단을 읽기 어렵다. */}
                <pre className="approval-block-text">{block.text}</pre>
              </section>
            ))}
          </div>
        )}

        <div className="approval-tool">{title}</div>
        {presentation !== null && residual.length > 0 && (
          <section className="approval-residual">
            <div className="approval-section-label">{t('agent.approvalResidualLabel')}</div>
            {/* 설명 못 한 leaf만 따로 펼친다. 미래 키 하나 때문에 검증된 문장 전체를 버리지 않는다. */}
            <pre className="approval-residual-args">{residualText}</pre>
          </section>
        )}

        {rawMustStayOpen ? (
          <section className="approval-original approval-original-expanded">
            <div className="approval-section-label">{t('agent.approvalOriginalArgs')}</div>
            {/* residual/미지 툴에서는 원본을 접으면 사용자가 보지 못한 값에 grant를 묶게 된다. */}
            <pre className="approval-args">{argsText}</pre>
          </section>
        ) : (
          // coverage가 완전할 때 접는 것은 이미 문장/block에 노출된 값의 중복 표현뿐이다.
          <details className="approval-original approval-original-details">
            <summary>{t('agent.approvalOriginalArgs')}</summary>
            <pre className="approval-args">{argsText}</pre>
          </details>
        )}

        <div className="approval-actions">
          <button type="button" className="approval-deny" onClick={() => answer('decline')}>{t('agent.deny')}</button>
          <button
            type="button"
            className="approval-allow"
            onClick={() => answer('accept')}
            disabled={presentation === null}
          >
            {t('agent.approve')}
          </button>
        </div>

        {queue.length > 1 && (
          <div className="approval-more">{t('agent.morePending', { count: queue.length - 1 })}</div>
        )}
      </div>
    </div>
  )
}
