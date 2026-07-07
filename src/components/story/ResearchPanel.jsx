/**
 * ResearchPanel — 리서치 phase 패널 (리서치 spec §3.6).
 *
 * 프레젠테이션 컴포넌트 — useStoryPipeline의 research 상태/side action을 prop으로 받는다
 * (시놉시스 게이트 패널 미러, 테스트 용이성). 흐름:
 *   키워드 검색(+URL 수동 추가) → 영상 카드 그리드(체크박스 다중 선택)
 *   → [자막 가져오기](videoId별 진행 표시, 진행 중 취소 — MINOR 4)
 *   → [구조분석] → [팩트체크](선택) → [이 리서치로 확정] / [건너뛰기]
 * commit/skip의 phase 전이는 StoryView(onCommit/onSkip 핸들러)가 수행한다.
 * 백엔드(yt-dlp)·LLM 로직은 main 소관 — 여기선 소비만(§2.2).
 */
import { useState } from 'react'

// URL 수동 추가 보조(§3.6) — watch?v= / youtu.be/ / shorts/ 에서 videoId 추출. 실패 시 null.
export function parseVideoIdFromUrl(url) {
  const m = String(url || '').match(
    /(?:youtube\.com\/watch\?(?:[^#\s]*&)?v=|youtu\.be\/|youtube\.com\/shorts\/)([\w-]{6,})/,
  )
  return m ? m[1] : null
}

const VERDICT_LABEL = { supported: '검증됨', refuted: '반박됨', unverified: '미검증' }
const FETCH_STATUS_LABEL = { running: '진행 중', done: '완료', error: '오류' }

export default function ResearchPanel({
  t = (key, fallback) => fallback,
  research = null,
  fetchProgress = {},
  disabled = false,
  onSearch, onFetch, onAnalyze, onFactCheck, onCommit, onSkip, onAbort, onSelect,
}) {
  const [keyword, setKeyword] = useState(research?.keyword || '')
  const [url, setUrl] = useState('')
  // URL 수동 추가 카드(로컬) — 검색 결과(research.videos)와 병합 렌더.
  const [manualVideos, setManualVideos] = useState([])
  const [selected, setSelected] = useState(() => research?.selectedVideoIds || [])
  // side action 단일 busy(검색/자막/분석/팩트체크 상호배제 — main researchController 미러).
  const [busy, setBusy] = useState(null)
  const [actionError, setActionError] = useState(null)

  const searchVideos = research?.videos || []
  const videos = [
    ...searchVideos,
    ...manualVideos.filter((m) => !searchVideos.some((v) => v.videoId === m.videoId)),
  ]
  const transcripts = research?.transcripts || {}
  const analysis = research?.analysis || null
  const verifiedClaims = research?.verifiedClaims || []
  // 구조분석은 선택 영상 중 자막 확보(ok)된 게 있어야 의미가 있다(§6 no-transcripts-selected 선방어).
  const hasOkTranscript = selected.some((id) => transcripts[id]?.ok)

  const runAction = async (kind, fn) => {
    if (busy) return
    setBusy(kind)
    setActionError(null)
    try {
      const r = await fn()
      if (r?.error) setActionError(r.error)
      return r
    } catch (e) {
      setActionError(String(e?.message || e))
    } finally {
      setBusy(null)
    }
  }

  const handleSearch = () => {
    if (!keyword.trim()) return
    runAction('search', async () => {
      const r = await onSearch?.({ keyword: keyword.trim() })
      // m7: 새 검색은 main이 draft의 선택/분석을 클리어한다 — 로컬 선택도 함께 클리어해
      // 새 결과 위에 옛 선택(유령 선택)이 남지 않게 미러.
      if (r && !r.error) setSelected([])
      return r
    })
  }

  const handleAddUrl = () => {
    const videoId = parseVideoIdFromUrl(url)
    if (!videoId) {
      setActionError('invalid-url')
      return
    }
    setActionError(null)
    // 수동 추가는 메타가 없다 — 제목은 videoId, 썸네일은 YouTube 표준 URL(§3.6 보조 경로).
    const nextManual = manualVideos.some((v) => v.videoId === videoId) ? manualVideos : [
      ...manualVideos,
      { videoId, title: videoId, channelTitle: '', viewCount: null, thumbnailUrl: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg` },
    ]
    const nextSelected = selected.includes(videoId) ? selected : [...selected, videoId]
    setManualVideos(nextManual)
    setSelected(nextSelected)
    // m5: 수동 카드·선택을 즉시 draft에 영속 — 탭전환/재오픈 시 소실·유령 선택 방지.
    onSelect?.({ selectedVideoIds: nextSelected, manualVideos: nextManual })
    setUrl('')
  }

  const toggleSelect = (videoId) => {
    const next = selected.includes(videoId) ? selected.filter((id) => id !== videoId) : [...selected, videoId]
    setSelected(next)
    // m5: fetch 전 선택도 즉시 영속(researchFetchTranscripts만으로는 fetch 전 선택이 비영속).
    onSelect?.({ selectedVideoIds: next, manualVideos })
  }

  const handleFetch = () => runAction('fetch', () => onFetch?.({ videoIds: selected }))
  const handleAnalyze = () => runAction('analyze', () => onAnalyze?.({ videoIds: selected }))
  const handleFactCheck = () => runAction('factcheck', () => onFactCheck?.())
  const handleCommit = () => runAction('commit', () => onCommit?.({ analysis, verifiedClaims }))
  const handleSkip = () => runAction('skip', () => onSkip?.())

  // m2: 훅이 {status, error?} 객체로 저장(에러 코드 보존) — 구형 문자열 값도 함께 허용.
  const progressOf = (videoId) => {
    const prog = fetchProgress[videoId]
    return typeof prog === 'string' ? { status: prog } : prog
  }

  // 카드 자막 상태 — 실시간 진행(fetchProgress)이 영속 메타(transcripts)보다 우선.
  const transcriptBadge = (videoId) => {
    const prog = progressOf(videoId)
    if (prog?.status === 'running') return { cls: 'running', text: t('story.status.running', FETCH_STATUS_LABEL.running) }
    if (prog?.status === 'error') {
      // m3: abort로 중단된 fetch는 "자막 없음"(영상에 CC 없음)과 구분해 중단 배지로.
      if (prog.error === 'aborted') return { cls: 'error', text: t('story.research.transcriptAborted', '중단됨') }
      return { cls: 'error', text: t('story.research.transcriptError', '자막 없음') }
    }
    const meta = prog?.status === 'done' ? (transcripts[videoId] || { ok: true }) : transcripts[videoId]
    if (!meta) return null
    if (meta.ok === false) return { cls: 'error', text: t('story.research.transcriptError', '자막 없음') }
    const lang = meta.lang ? ` (${meta.lang})` : ''
    return { cls: 'done', text: `${t('story.research.transcriptDone', '자막 확보')}${lang}` }
  }

  // m2(§6/§3.7): binary-not-found는 검색뿐 아니라 fetch(progress error)·재오픈 복원 메타에서도
  // 온다 — 어느 경로든 yt-dlp 설치 안내 배너로 이어져야 한다(수동 URL fetch 포함).
  const binaryNotFound = actionError === 'binary-not-found'
    || Object.values(fetchProgress).some((p) => (typeof p === 'object' && p?.error === 'binary-not-found'))
    || Object.values(transcripts).some((tr) => tr?.ok === false && tr?.error === 'binary-not-found')

  const actionsDisabled = disabled || !!busy

  return (
    <div className="story-research-phase" data-testid="story-research">
      {/* §7: 리서치 phase 고지 — 참고·재구성 용도(원문 복제·재배포 금지). */}
      <div className="story-research-tos">
        {t('story.research.tosNotice', '참고·재구성 용도입니다. 타인 자막의 무단 복제·재배포는 저작권 침해가 될 수 있습니다.')}
      </div>

      {/* m2: yt-dlp 미설치 안내 — 검색 에러뿐 아니라 fetch progress/복원 메타의 error에서도 노출 */}
      {binaryNotFound && (
        <div className="story-error-banner" role="alert">
          ⚠️ {t('story.research.binaryNotFound', 'yt-dlp가 설치되어 있지 않습니다. 터미널에서 `brew install yt-dlp`로 설치하세요.')}
        </div>
      )}
      {actionError && actionError !== 'binary-not-found' && (
        <div className="story-error-banner" role="alert">
          ⚠️ {actionError === 'invalid-url'
            ? t('story.research.invalidUrl', '유효한 YouTube URL이 아닙니다')
            : `${t('story.error.prefix', '오류')}: ${actionError}`}
        </div>
      )}

      {/* 키워드 검색 + URL 수동 추가(보조) */}
      <div className="story-research-searchbar">
        <input
          className="story-input story-research-keyword"
          aria-label={t('story.research.keywordLabel', '검색 키워드')}
          placeholder={t('story.research.keywordPlaceholder', '키워드로 YouTube 인기 영상 검색')}
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') handleSearch() }}
          disabled={actionsDisabled}
        />
        <button type="button" className="story-btn-primary" onClick={handleSearch} disabled={actionsDisabled || !keyword.trim()}>
          {busy === 'search' ? t('story.research.searching', '검색 중…') : t('story.research.search', '검색')}
        </button>
      </div>
      <div className="story-research-searchbar">
        <input
          className="story-input story-research-url"
          aria-label={t('story.research.urlLabel', 'YouTube URL')}
          placeholder={t('story.research.urlPlaceholder', 'YouTube URL 수동 추가 (보조)')}
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') handleAddUrl() }}
          disabled={actionsDisabled}
        />
        <button type="button" className="story-btn-secondary" onClick={handleAddUrl} disabled={actionsDisabled || !url.trim()}>
          {t('story.research.addUrl', 'URL 추가')}
        </button>
      </div>

      {/* 영상 카드 그리드 — 썸네일(yt-dlp thumbnail URL)·제목·채널·조회수 + 체크박스 다중 선택 */}
      {videos.length === 0 ? (
        <div className="story-empty-hint">{t('story.research.noVideos', '검색 결과가 여기에 표시됩니다.')}</div>
      ) : (
        <div className="story-research-grid">
          {videos.map((v) => {
            const checked = selected.includes(v.videoId)
            const badge = transcriptBadge(v.videoId)
            return (
              <label key={v.videoId} className={`story-research-card${checked ? ' selected' : ''}`}>
                <input
                  type="checkbox"
                  className="story-research-card-check"
                  aria-label={t('story.research.selectVideo', `${v.title || v.videoId} 선택`, { title: v.title || v.videoId })}
                  checked={checked}
                  onChange={() => toggleSelect(v.videoId)}
                  disabled={actionsDisabled}
                />
                {v.thumbnailUrl && <img src={v.thumbnailUrl} alt={v.title || v.videoId} loading="lazy" />}
                <div className="story-research-card-title">{v.title || v.videoId}</div>
                <div className="story-research-card-meta">
                  {v.channelTitle}
                  {v.viewCount != null && ` · ${t('story.research.views', `조회수 ${Number(v.viewCount).toLocaleString()}`, { count: Number(v.viewCount).toLocaleString() })}`}
                </div>
                {badge && <span className={`story-research-transcript story-research-transcript-${badge.cls}`}>{badge.text}</span>}
              </label>
            )
          })}
        </div>
      )}

      {/* 액션 — 자막 취득은 최대 10개×수분 가능(MINOR 4 취소 버튼) */}
      <div className="story-research-actions">
        <button type="button" className="story-btn-secondary" onClick={handleFetch} disabled={actionsDisabled || selected.length === 0}>
          {busy === 'fetch' ? t('story.research.fetching', '자막 가져오는 중…') : t('story.research.fetch', '자막 가져오기')}
        </button>
        <button type="button" className="story-btn-secondary" onClick={handleAnalyze} disabled={actionsDisabled || !hasOkTranscript}>
          {busy === 'analyze' ? t('story.research.analyzing', '구조 분석 중…') : t('story.research.analyze', '구조분석')}
        </button>
        <button type="button" className="story-btn-secondary" onClick={handleFactCheck} disabled={actionsDisabled || !(analysis?.claims?.length)}>
          {busy === 'factcheck' ? t('story.research.factChecking', '팩트체크 중…') : t('story.research.factCheck', '팩트체크')}
        </button>
        <button type="button" className="story-btn-primary" onClick={handleCommit} disabled={actionsDisabled || !analysis}>
          {t('story.research.commit', '이 리서치로 확정')}
        </button>
        <button type="button" className="story-btn-secondary" onClick={handleSkip} disabled={disabled || (busy && busy !== 'skip')}>
          {t('story.research.skip', '건너뛰기')}
        </button>
        {busy && busy !== 'commit' && busy !== 'skip' && (
          <button type="button" className="story-btn-secondary" onClick={() => onAbort?.()}>
            {t('story.action.abort', '⏹ 중단')}
          </button>
        )}
      </div>

      {/* 구조분석 결과(§3.4) — structure/claims/commonThemes */}
      {analysis && (
        <div className="story-research-analysis">
          <div className="story-opt-label">{t('story.research.analysisTitle', '구조 분석')}</div>
          {(analysis.structure || []).map((s, i) => (
            <div key={`${s.beat || 'beat'}-${i}`} className="story-research-beat">
              <span className="story-research-beat-name">{s.beat}</span>
              <span className="story-research-beat-summary">{s.summary}</span>
            </div>
          ))}
          {(analysis.commonThemes || []).length > 0 && (
            <div className="story-research-themes">
              {t('story.research.themesTitle', '공통 논점')}: {(analysis.commonThemes || []).join(' · ')}
            </div>
          )}
          {(analysis.claims || []).length > 0 && (
            <div className="story-research-claims">
              <div className="story-opt-label">{t('story.research.claimsTitle', '핵심 주장')}</div>
              {(analysis.claims || []).map((c, i) => (
                <div key={`${c.claim || 'claim'}-${i}`} className="story-research-claim">{c.claim}</div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* 팩트체크 결과(§3.5) — verdict 배지(supported=녹색/refuted=빨강/unverified=회색) + evidence url */}
      {verifiedClaims.length > 0 && (
        <div className="story-research-factcheck">
          <div className="story-opt-label">{t('story.research.factCheckTitle', '팩트체크 결과')}</div>
          {verifiedClaims.map((c, i) => (
            <div key={`${c.claim || 'claim'}-${i}`} className="story-research-verdict-row">
              <span className={`story-verdict-badge story-verdict-${c.verdict || 'unverified'}`}>
                {t(`story.research.verdict.${c.verdict || 'unverified'}`, VERDICT_LABEL[c.verdict] || VERDICT_LABEL.unverified)}
              </span>
              <span className="story-research-verdict-claim">{c.claim}</span>
              {(c.evidence || []).map((e, j) => (
                e?.url ? (
                  <a key={`${e.url}-${j}`} className="story-research-evidence" href={e.url} target="_blank" rel="noreferrer">
                    {e.url}
                  </a>
                ) : null
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
