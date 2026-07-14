import { useEffect, useState, useCallback } from 'react'
import { useOptionalI18n } from '../../hooks/useI18n'
import { useModalVisibility } from '../../hooks/useModalVisibility'
import en from '../../locales/en'
import './ApprovalDialog.css'

/**
 * 🔴 **읽을 수 없는 승인은 동의가 아니다.** 기본 언어는 `en` 인데(useI18n DEFAULT_LANG) 이 창의
 *    문구가 한글로 박혀 있으면, 영어 사용자는 **자기 돈이 나가는 작업**의 승인 문구를 못 읽는다.
 *    ⚠️ 단 `message`(툴 이름 + 인자)는 **번역하지 않는다** — 그건 앱이 만든 데이터고, 번역하면
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

/**
 * 승인 창의 **사람 말 요약**.
 *
 * 🔴 raw JSON 만 보여주는 건 **알리바이지 설명이 아니다** — `{"speakers":[{"id":"narrator",…}]}` 를
 *    보고 사용자가 무엇을 승인하는지 알 수 없다.
 * 🔴 **하지만 요약이 원본을 대체하면 안 된다.** grant 는 인자 **전체**에 묶인다. 요약만 보여주면
 *    "사람이 승인한 것"과 "실제 실행되는 것"이 갈릴 수 있다. **둘 다** 보여준다.
 * 🔴 **모르는 툴은 지어내지 않는다.** 아는 척 요약하면 사람이 **잘못된 것을 승인**한다.
 *    요약이 없는 편이 낫다 — 그때는 툴 이름과 원본 인자만 보여준다.
 *
 * 요약은 **앱이** 만든다 (모델이 아니라). 모델이 만든 문장을 승인 근거로 쓰면 모델이 거짓말할 수 있다.
 */
function summarize(tool, args, t) {
  if (!args || typeof args !== 'object') return null
  switch (tool) {
    case 'story_set_speakers': {
      const speakers = Array.isArray(args.speakers) ? args.speakers : null
      if (!speakers) return null
      const names = speakers.map((s) => s?.name || s?.id).filter(Boolean).join(', ')
      return t('agent.summarySetSpeakers', { count: speakers.length, names })
    }
    case 'story_confirm_synopsis': {
      const characters = Array.isArray(args.characters) ? args.characters : []
      return t('agent.summaryConfirmSynopsis', { count: characters.length })
    }
    case 'story_start_step': {
      if (typeof args.step !== 'string') return null
      return t('agent.summaryStartStep', { step: args.step })
    }
    default:
      return null
  }
}

/** 승인 payload 의 인자 부분. 파싱 실패는 **요약 없음**으로 닫는다 — 지어내지 않는다. */
function parseArgs(body) {
  try {
    const value = JSON.parse(body)
    return value && typeof value === 'object' ? value : null
  } catch {
    return null
  }
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
  const argsText = body.join('\n').trim()
  const summary = summarize(current.tool ?? title, parseArgs(argsText), t)

  return (
    <div className="approval-backdrop" role="dialog" aria-modal="true" aria-label={t('agent.approvalLabel')}>
      <div className="approval-dialog">
        <div className="approval-header">{t('agent.approvalHeader')}</div>

        {/* 사람 말로 무엇을 하는지. 없으면 없는 대로 둔다 — 모르는 툴을 아는 척 요약하지 않는다. */}
        {summary && <div className="approval-summary" data-testid="approval-summary">{summary}</div>}

        <div className="approval-tool">{title || current.tool}</div>
        {argsText && (
          // 🔴 요약이 있어도 **원본을 반드시 함께** 보여준다. grant 는 인자 전체에 묶인다 —
          //    요약만 보고 누르면 "승인한 것"과 "실행되는 것"이 갈릴 수 있다.
          <pre className="approval-args">{argsText}</pre>
        )}

        <div className="approval-actions">
          <button type="button" className="approval-deny" onClick={() => answer('decline')}>{t('agent.deny')}</button>
          <button type="button" className="approval-allow" onClick={() => answer('accept')}>{t('agent.approve')}</button>
        </div>

        {queue.length > 1 && (
          <div className="approval-more">{t('agent.morePending', { count: queue.length - 1 })}</div>
        )}
      </div>
    </div>
  )
}
