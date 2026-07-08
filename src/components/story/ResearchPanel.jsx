/**
 * ResearchPanel — 리서치 phase 패널 (리서치 spec §3.6).
 *
 * 프레젠테이션 컴포넌트 — useStoryPipeline의 research 상태/side action을 prop으로 받는다
 * (시놉시스 게이트 패널 미러, 테스트 용이성). 흐름:
 *   키워드 검색(개수·업로드 기간 지정, +URL 수동 추가) → 영상 카드 그리드(체크박스 다중 선택,
 *   설정 언어 1차 필터 — 개선3)
 *   → [자막 가져오기](videoId별 진행 표시, 진행 중 취소 — MINOR 4)
 *   → [구조분석] → [팩트체크](선택) 또는 [한꺼번에 분석](자동 순차 — 개선5)
 *   → [이 리서치로 확정](미검증 주장 채택 체크 — 개선4) / [건너뛰기]
 * commit/skip의 phase 전이는 StoryView(onCommit/onSkip 핸들러)가 수행한다.
 * 백엔드(yt-dlp)·LLM 로직은 main 소관 — 여기선 소비만(§2.2).
 */
import { useState, useEffect } from 'react'
import { StopwatchIcon, ElapsedTime } from '../StopwatchIcon'

// URL 수동 추가 보조(§3.6) — watch?v= / youtu.be/ / shorts/ 에서 videoId 추출. 실패 시 null.
export function parseVideoIdFromUrl(url) {
  const m = String(url || '').match(
    /(?:youtube\.com\/watch\?(?:[^#\s]*&)?v=|youtu\.be\/|youtube\.com\/shorts\/)([\w-]{6,})/,
  )
  return m ? m[1] : null
}

// 개선3(2026-07-08): 설정 언어 기준 1차 필터(순수) — 제목/채널 문자셋 판정.
// ko: 제목 또는 채널에 한글 포함. en: 한글 없이 라틴 문자 제목. 그 외 언어는 필터 없음.
const HANGUL_RE = /[가-힣]/
export function filterByLang(videos, lang) {
  const list = Array.isArray(videos) ? videos : []
  if (lang === 'ko') {
    return list.filter((v) => HANGUL_RE.test(v?.title || '') || HANGUL_RE.test(v?.channelTitle || ''))
  }
  if (lang === 'en') {
    return list.filter((v) => !HANGUL_RE.test(`${v?.title || ''}${v?.channelTitle || ''}`) && /[A-Za-z]/.test(v?.title || ''))
  }
  return list
}

// 썸네일 폴백(2026-07-08 실앱 확인) — flat 검색의 thumbnail이 NA/빈값인 경우가 많다.
// videoId만 있으면 표준 hqdefault URL이 항상 유효하므로 무조건 img를 렌더한다.
const thumbnailOf = (v) => v.thumbnailUrl || `https://i.ytimg.com/vi/${v.videoId}/hqdefault.jpg`

// upload_date(YYYYMMDD) → 카드 메타용 YYYY-MM-DD.
const formatUploadDate = (d) => (/^\d{8}$/.test(d || '') ? `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6)}` : '')

const VERDICT_LABEL = { supported: '검증됨', refuted: '반박됨', unverified: '미검증' }
const FETCH_STATUS_LABEL = { running: '진행 중', done: '완료', error: '오류' }
const LANG_MISS_LABEL = { ko: '한국어 자막 없음', en: '영어 자막 없음' }
const AUTO_STAGE_ORDER = ['fetch', 'analyze', 'factcheck']

export default function ResearchPanel({
  t = (key, fallback) => fallback,
  research = null,
  fetchProgress = {},
  disabled = false,
  language = null,
  onSearch, onFetch, onAnalyze, onFactCheck, onCommit, onSkip, onAbort, onSelect,
}) {
  const [keyword, setKeyword] = useState(research?.keyword || '')
  const [url, setUrl] = useState('')
  // 개선1/2: 검색 개수(10/20/30) + 업로드 기간(전체/1주일/30일).
  const [maxResults, setMaxResults] = useState(10)
  const [dateFilter, setDateFilter] = useState('none')
  // URL 수동 추가 카드(로컬) — 검색 결과(research.videos)와 병합 렌더.
  const [manualVideos, setManualVideos] = useState([])
  const [selected, setSelected] = useState(() => research?.selectedVideoIds || [])
  // side action 단일 busy(검색/자막/분석/팩트체크 상호배제 — main researchController 미러).
  const [busy, setBusy] = useState(null)
  const [actionError, setActionError] = useState(null)
  // 개선4/m3: 팩트체크 주장 채택 — **인덱스 배열**. null=기본(supported 인덱스). 인덱스 기반이라
  // 동일 claim 문자열이 중복돼도 개별 토글된다. 팩트체크 내용이 실제로 바뀌면 기본으로 리셋(M1).
  const [adopted, setAdopted] = useState(null)
  // 개선5: [한꺼번에 분석] 진행 상태 — { stage, startedAt, endedAt, error, skipped:[] }.
  const [autoRun, setAutoRun] = useState(null)
  // R2 MINOR(M3 잔여): 일자필터 상세조회 실패로 flat 폴백했을 때 안내(검색마다 갱신 — transient).
  const [dateFilterFallback, setDateFilterFallback] = useState(false)

  const rawSearchVideos = research?.videos || []
  // 개선3: 설정 언어 1차 필터 — 전부 불일치면 필터를 풀어 빈 그리드를 막는다(보조 안전망).
  const langFiltered = filterByLang(rawSearchVideos, language)
  const kept = langFiltered.length ? langFiltered : rawSearchVideos
  // m2(R1): 숨기려는 카드라도 이미 선택된 것은 표시한다 — 안 보이면 해제 불가 + fetch에 계속
  // 포함되는 "보이지 않는 선택"이 된다.
  const searchVideos = rawSearchVideos.filter((v) => kept.includes(v) || selected.includes(v.videoId))
  const langHiddenCount = rawSearchVideos.length - searchVideos.length
  const videos = [
    ...searchVideos,
    ...manualVideos.filter((m) => !searchVideos.some((v) => v.videoId === m.videoId)),
  ]
  const transcripts = research?.transcripts || {}
  const analysis = research?.analysis || null
  const verifiedClaims = research?.verifiedClaims || []
  // 구조분석은 선택 영상 중 자막 확보(ok)된 게 있어야 의미가 있다(§6 no-transcripts-selected 선방어).
  const hasOkTranscript = selected.some((id) => transcripts[id]?.ok)

  // 개선4/m3: 기본 채택 = supported 인덱스. 사용자가 만지면 adopted(인덱스 배열)가 명시 소스.
  const supportedIndices = verifiedClaims.map((c, i) => (c?.verdict === 'supported' ? i : -1)).filter((i) => i >= 0)
  const adoptedIndices = adopted ?? supportedIndices
  // M1(R1): 무관한 상태갱신(researchSelect의 research-state emit → 새 배열 identity)에 리셋되지
  // 않도록, 배열 identity 대신 **내용 키**로 리셋을 건다. R2 nit: 구분자 문자(|/~~)가 claim
  // 텍스트에 있으면 다른 내용이 같은 키로 뭉개져 리셋 누락 — JSON.stringify로 충돌 없이 구분한다.
  const factKey = JSON.stringify(verifiedClaims.map((c) => [c?.claim, c?.verdict]))
  useEffect(() => { setAdopted(null) }, [factKey])
  const toggleAdopt = (idx) => {
    const cur = adopted ?? supportedIndices
    setAdopted(cur.includes(idx) ? cur.filter((i) => i !== idx) : [...cur, idx])
  }

  const runAction = async (kind, fn) => {
    if (busy) return
    // m4(R1): 개별 액션 시작 시 이전 [한꺼번에 분석] 진행 패널을 클리어(완료 패널 잔류 방지).
    if (kind !== 'auto') setAutoRun(null)
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
      // 개선1/2: 개수는 항상, 일자 필터는 선택 시에만 전달(기본 '전체'는 현행 빠른 flat 검색).
      const r = await onSearch?.({
        keyword: keyword.trim(),
        maxResults,
        ...(dateFilter !== 'none' ? { dateFilter } : {}),
      })
      // R2 MINOR: 매 검색마다 폴백 안내를 갱신(성공/none이면 해제 — transient 신호).
      setDateFilterFallback(!!(r && !r.error && r.dateFilterFallback))
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
  // 개선4/m3: 팩트체크 결과가 있으면 채택 인덱스를 함께 커밋(미전달 시 main은 supported만 — 회귀 유지).
  const handleCommit = () => runAction('commit', () => onCommit?.({
    analysis,
    verifiedClaims,
    ...(verifiedClaims.length ? { adoptedIndices } : {}),
  }))
  const handleSkip = () => runAction('skip', () => onSkip?.())

  // 개선5: [한꺼번에 분석] — 기존 액션을 renderer에서 순차 await(신규 main side action 없음).
  // 각 단계 진행 하이라이트 + ElapsedTime 총 경과시간, 중간 실패 시 중단(runAction이 에러 표시).
  const handleAutoAnalyze = () => runAction('auto', async () => {
    setAutoRun({ stage: 'fetch', startedAt: Date.now(), endedAt: null, error: false, skipped: [] })
    const fail = (r) => {
      setAutoRun((a) => (a ? { ...a, error: true, endedAt: Date.now() } : a))
      return r
    }
    try {
      const f = await onFetch?.({ videoIds: selected })
      // M2(R1): abort(부분성공 {aborted:true})도 중단 — error만 검사하면 다음 단계로 새어나간다.
      if (f?.error || f?.aborted) return fail(f || {})
      setAutoRun((a) => (a ? { ...a, stage: 'analyze' } : a))
      const an = await onAnalyze?.({ videoIds: selected })
      if (an?.error) return fail(an)
      // 팩트체크는 claims가 있을 때만 — 없으면 건너뛰고 완료(§6 팩트체크 선택성 미러).
      // m4(R1): 건너뛴 팩트체크 칩은 'done'이 아니라 'skipped'로 구분 표기.
      if (an?.analysis?.claims?.length) {
        setAutoRun((a) => (a ? { ...a, stage: 'factcheck' } : a))
        const fc = await onFactCheck?.()
        if (fc?.error) return fail(fc)
        setAutoRun((a) => (a ? { ...a, stage: 'done', endedAt: Date.now() } : a))
      } else {
        setAutoRun((a) => (a ? { ...a, stage: 'done', endedAt: Date.now(), skipped: [...(a.skipped || []), 'factcheck'] } : a))
      }
      return {}
    } catch (e) {
      fail(null)
      throw e
    }
  })

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
    const meta = prog?.status === 'done' ? (transcripts[videoId] || { ok: true, ...(prog.lang ? { lang: prog.lang } : {}) }) : transcripts[videoId]
    if (!meta) return null
    if (meta.ok === false) return { cls: 'error', text: t('story.research.transcriptError', '자막 없음') }
    const lang = meta.lang ? ` (${meta.lang})` : ''
    return { cls: 'done', text: `${t('story.research.transcriptDone', '자막 확보')}${lang}` }
  }

  // 개선3: 취득한 자막 lang(실제)이 설정 언어와 다르면 "OO 자막 없음" 배지로 명시.
  const langMissBadge = (videoId) => {
    if (language !== 'ko' && language !== 'en') return null
    const prog = progressOf(videoId)
    const meta = transcripts[videoId] || (prog?.status === 'done' && prog.lang ? { ok: true, lang: prog.lang } : null)
    if (!meta || meta.ok === false || !meta.lang) return null
    if (String(meta.lang).split('-')[0] === language) return null
    return t(`story.research.langMissing.${language}`, LANG_MISS_LABEL[language])
  }

  // m2(§6/§3.7): binary-not-found는 검색뿐 아니라 fetch(progress error)·재오픈 복원 메타에서도
  // 온다 — 어느 경로든 yt-dlp 설치 안내 배너로 이어져야 한다(수동 URL fetch 포함).
  const binaryNotFound = actionError === 'binary-not-found'
    || Object.values(fetchProgress).some((p) => (typeof p === 'object' && p?.error === 'binary-not-found'))
    || Object.values(transcripts).some((tr) => tr?.ok === false && tr?.error === 'binary-not-found')

  const actionsDisabled = disabled || !!busy
  const autoStageIdx = autoRun ? (autoRun.stage === 'done' ? AUTO_STAGE_ORDER.length : AUTO_STAGE_ORDER.indexOf(autoRun.stage)) : -1
  const AUTO_STAGE_LABELS = {
    fetch: t('story.research.autoStageFetch', '자막'),
    analyze: t('story.research.autoStageAnalyze', '분석'),
    factcheck: t('story.research.autoStageFactCheck', '팩트체크'),
  }

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

      {/* 키워드 검색(개수·업로드 기간 — 개선1/2) + URL 수동 추가(보조) */}
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
        <select
          className="story-input story-research-select"
          aria-label={t('story.research.maxResultsLabel', '검색 개수')}
          value={maxResults}
          onChange={(e) => setMaxResults(Number(e.target.value))}
          disabled={actionsDisabled}
        >
          {[10, 20, 30].map((n) => (
            <option key={n} value={n}>{t('story.research.maxResultsOption', `${n}개`, { count: n })}</option>
          ))}
        </select>
        <select
          className="story-input story-research-select"
          aria-label={t('story.research.dateFilterLabel', '업로드 기간')}
          value={dateFilter}
          onChange={(e) => setDateFilter(e.target.value)}
          disabled={actionsDisabled}
        >
          <option value="none">{t('story.research.dateFilterNone', '전체')}</option>
          <option value="week">{t('story.research.dateFilterWeek', '최근 1주일')}</option>
          <option value="month">{t('story.research.dateFilterMonth', '최근 30일')}</option>
        </select>
        <button type="button" className="story-btn-primary" onClick={handleSearch} disabled={actionsDisabled || !keyword.trim()}>
          {busy === 'search' ? t('story.research.searching', '검색 중…') : t('story.research.search', '검색')}
        </button>
      </div>
      {/* 개선2: 일자 필터 검색은 후보 상세조회(upload_date)가 있어 flat 검색보다 느리다. */}
      {busy === 'search' && dateFilter !== 'none' && (
        <div className="story-research-slow-hint">
          {t('story.research.dateFilterSlow', '업로드일 확인 중 — 상세조회로 조금 더 걸립니다…')}
        </div>
      )}
      {/* R2 MINOR: 일자필터 상세조회 실패로 flat 폴백 시 조용한 무시를 알리는 안내. */}
      {dateFilterFallback && !busy && (
        <div className="story-research-lang-hint" role="status">
          {t('story.research.dateFilterFallback', '기간 필터를 적용하지 못해 전체 결과를 표시합니다.')}
        </div>
      )}
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

      {/* 개선3: 설정 언어 1차 필터로 숨긴 카드 수 안내 */}
      {langHiddenCount > 0 && (
        <div className="story-research-lang-hint">
          {t('story.research.langHidden', `언어 불일치 ${langHiddenCount}개 숨김`, { count: langHiddenCount })}
        </div>
      )}

      {/* 영상 카드 그리드 — 썸네일(폴백 포함)·제목·채널·조회수·업로드일 + 체크박스 다중 선택 */}
      {videos.length === 0 ? (
        <div className="story-empty-hint">{t('story.research.noVideos', '검색 결과가 여기에 표시됩니다.')}</div>
      ) : (
        <div className="story-research-grid">
          {videos.map((v) => {
            const checked = selected.includes(v.videoId)
            const badge = transcriptBadge(v.videoId)
            const langMiss = langMissBadge(v.videoId)
            const uploadDate = formatUploadDate(v.uploadDate)
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
                <img src={thumbnailOf(v)} alt={v.title || v.videoId} loading="lazy" />
                <div className="story-research-card-title">{v.title || v.videoId}</div>
                <div className="story-research-card-meta">
                  {v.channelTitle}
                  {v.viewCount != null && ` · ${t('story.research.views', `조회수 ${Number(v.viewCount).toLocaleString()}`, { count: Number(v.viewCount).toLocaleString() })}`}
                  {uploadDate && ` · ${uploadDate}`}
                </div>
                <div className="story-research-card-badges">
                  {badge && <span className={`story-research-transcript story-research-transcript-${badge.cls}`}>{badge.text}</span>}
                  {langMiss && <span className="story-research-transcript story-research-transcript-langmiss">{langMiss}</span>}
                </div>
              </label>
            )
          })}
        </div>
      )}

      {/* 액션 — 자막 취득은 최대 10개×수분 가능(MINOR 4 취소 버튼). 개선5: [한꺼번에 분석] 추가. */}
      <div className="story-research-actions">
        <button type="button" className="story-btn-primary" onClick={handleAutoAnalyze} disabled={actionsDisabled || selected.length === 0}>
          {busy === 'auto' ? t('story.research.autoAnalyzing', '분석 중…') : t('story.research.autoAnalyze', '한꺼번에 분석')}
        </button>
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

      {/* 개선5: 한꺼번에 분석 진행 — 단계 하이라이트 + 총 경과시간(StoryView 초시계 패턴 재사용) */}
      {autoRun && (
        <div className="story-research-auto" data-testid="research-auto-progress">
          <span className="story-research-auto-timer">
            <StopwatchIcon size={14} />
            <ElapsedTime startedAt={autoRun.startedAt} endedAt={autoRun.endedAt} />
          </span>
          {AUTO_STAGE_ORDER.map((key, i) => {
            // m4(R1): 스킵된 단계는 'done'이 아니라 'skipped'로 구분(팩트체크 미실행 오표기 방지).
            const skipped = autoRun.skipped?.includes(key)
            const cls = skipped
              ? 'skipped'
              : `${i === autoStageIdx ? 'active' : ''}${i < autoStageIdx ? 'done' : ''}${i === autoStageIdx && autoRun.error ? ' error' : ''}`
            return (
              <span key={key} className={`story-research-auto-stage${cls ? ` ${cls.trim()}` : ''}`}>
                {AUTO_STAGE_LABELS[key]}
              </span>
            )
          })}
          {autoRun.stage === 'done' && !autoRun.error && (
            <span className="story-research-auto-done">{t('story.research.autoDone', '완료')}</span>
          )}
        </div>
      )}

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

      {/* 팩트체크 결과(§3.5) — verdict 배지(supported=녹색/refuted=빨강/unverified=회색) + evidence url
          + 개선4: 주장별 채택 체크박스(기본 supported만 체크 — 미검증/반박도 수동 채택 가능) */}
      {verifiedClaims.length > 0 && (
        <div className="story-research-factcheck">
          <div className="story-opt-label">{t('story.research.factCheckTitle', '팩트체크 결과')}</div>
          <div className="story-research-adopt-hint">
            {t('story.research.adoptHint', '체크한 주장만 리서치 확정에 포함됩니다 (기본: 검증됨만)')}
          </div>
          {verifiedClaims.map((c, i) => (
            <div key={`${c.claim || 'claim'}-${i}`} className="story-research-verdict-row">
              <input
                type="checkbox"
                className="story-research-adopt-check"
                aria-label={t('story.research.adoptClaim', `${c.claim} 채택`, { claim: c.claim })}
                checked={adoptedIndices.includes(i)}
                onChange={() => toggleAdopt(i)}
                disabled={actionsDisabled}
              />
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
