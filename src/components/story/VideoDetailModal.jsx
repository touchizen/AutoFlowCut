/**
 * VideoDetailModal — 리서치 영상 카드 더블클릭 상세 모달 (2026-07-08).
 *
 * yt-dlp 상세 조회(getVideoDetails, fetchDetails prop)로 구독자수·게시일·조회수·좋아요·
 * 재생시간·채널 + 바이럴 지수를 보여주고, 유튜브 임베드로 자동재생(소리 ON)한다.
 * Mute 토글·Volume 슬라이더는 YouTube IFrame API(enablejsapi=1) postMessage로 제어 —
 * 외부 스크립트 없이 iframe.contentWindow에 command 메시지를 직접 보낸다.
 *
 * 프레젠테이션 컴포넌트: fetchDetails/onClose를 prop 주입받아 단위 테스트 가능(패널 미러).
 */
import { useState, useEffect, useRef } from 'react'
import Modal from '../Modal.jsx'
import { detectOS, ytDlpInstallCommand } from '../../utils/ytdlpInstall.js'

// YouTube IFrame API command postMessage (enablejsapi=1 임베드 대상). 순수 — 테스트 주입 용이.
export function playerCommand(iframe, func, args = []) {
  const win = iframe?.contentWindow
  if (!win || typeof win.postMessage !== 'function') return false
  win.postMessage(JSON.stringify({ event: 'command', func, args }), 'https://www.youtube.com')
  return true
}

// YYYYMMDD → YYYY.MM.DD (미상이면 빈 문자열).
function formatUploadDot(d) {
  return /^\d{8}$/.test(String(d || '')) ? `${d.slice(0, 4)}.${d.slice(4, 6)}.${d.slice(6)}` : ''
}
const fmtNum = (n) => (typeof n === 'number' && isFinite(n) ? n.toLocaleString() : null)
// i18n 없는 폴백(단위 테스트·provider 미장착) — locale story.research.viral.* 와 동일.
const VIRAL_FALLBACK = { explosive: '🚀 바이럴 폭발', high: '🔥 바이럴 높음', ok: '양호', low: '낮음', unknown: '—' }

export default function VideoDetailModal({ videoId, t = (k, f) => f, fetchDetails, onClose, nav }) {
  const [state, setState] = useState({ loading: true, details: null, error: null })
  const [muted, setMuted] = useState(false) // 소리 ON 시작(더블클릭 제스처라 정책상 허용)
  const [volume, setVolume] = useState(100)
  const iframeRef = useRef(null)
  // MINOR C: 플레이어 준비 신호(onReady)에서 상태를 딱 1회 재적용하기 위한 플래그.
  const readyAppliedRef = useRef(false)

  // 상세 조회 — videoId 바뀔 때마다 재조회. 언마운트/변경 시 stale 응답 무시.
  useEffect(() => {
    if (!videoId) return undefined
    let alive = true
    setState({ loading: true, details: null, error: null })
    Promise.resolve(fetchDetails?.({ videoId }))
      .then((r) => {
        if (!alive) return
        if (r?.error) setState({ loading: false, details: null, error: r.error })
        else setState({ loading: false, details: r?.details || null, error: r?.details ? null : 'parse-failed' })
      })
      .catch((e) => { if (alive) setState({ loading: false, details: null, error: String(e?.message || e) }) })
    return () => { alive = false }
  }, [videoId, fetchDetails])

  // Escape로 닫기.
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose?.() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  // videoId 바뀌면 준비-재적용 플래그 리셋(다른 영상은 새 플레이어).
  useEffect(() => { readyAppliedRef.current = false }, [videoId])

  // MINOR C: iframe onLoad는 "문서 로드"일 뿐 유튜브 플레이어 준비 신호가 아니다 — 준비 전 보낸
  // mute/volume 명령은 드롭될 수 있다. enablejsapi 핸드셰이크로 플레이어의 onReady 응답을 받으면
  // 현재 mute/volume을 1회 재적용해 컨트롤과 실제 재생을 일치시킨다. (이후 변경은 직접 명령으로 반영)
  useEffect(() => {
    const onMsg = (e) => {
      if (readyAppliedRef.current || typeof e.data !== 'string') return
      let data
      try { data = JSON.parse(e.data) } catch { return }
      if (data && (data.event === 'onReady' || data.event === 'initialDelivery' || data.event === 'infoDelivery')) {
        readyAppliedRef.current = true
        playerCommand(iframeRef.current, muted ? 'mute' : 'unMute')
        playerCommand(iframeRef.current, 'setVolume', [volume])
      }
    }
    window.addEventListener('message', onMsg)
    return () => window.removeEventListener('message', onMsg)
  }, [muted, volume])

  const toggleMute = () => {
    const next = !muted
    setMuted(next)
    playerCommand(iframeRef.current, next ? 'mute' : 'unMute')
  }
  const onVolume = (e) => {
    const v = Number(e.target.value)
    setVolume(v)
    playerCommand(iframeRef.current, 'setVolume', [v])
    // 슬라이더를 올리면 음소거 자동 해제(직관적).
    if (v > 0 && muted) { setMuted(false); playerCommand(iframeRef.current, 'unMute') }
  }

  const { loading, details, error } = state
  const d = details
  const viral = d?.viral || null
  const tier = viral?.tier || 'unknown'
  // origin은 enablejsapi 핸드셰이크가 부모를 검증하는 데 쓰인다(있을 때만 부착).
  const origin = (typeof window !== 'undefined' && window.location && window.location.origin) || ''
  const src = videoId
    ? `https://www.youtube.com/embed/${encodeURIComponent(videoId)}?autoplay=1&enablejsapi=1&playsinline=1&rel=0${origin ? `&origin=${encodeURIComponent(origin)}` : ''}`
    : ''

  const errorNode = () => {
    if (error === 'binary-not-found') {
      const cmd = ytDlpInstallCommand(detectOS(nav))
      return t('story.research.binaryNotFound', 'yt-dlp가 설치되어 있지 않습니다. 터미널에서 `{cmd}`로 설치하세요.', { cmd })
    }
    return t('story.research.detail.error', '상세 정보를 불러오지 못했습니다')
  }

  // 공용 Modal 래퍼 사용 — createPortal(document.body)로 부모 stacking context를 벗어나고,
  // useModalVisibility가 Flow 네이티브 뷰(WebContentsView)를 숨긴다(CSS z-index로 못 가리는 레이어).
  return (
    <Modal onClose={() => onClose?.()} title={t('story.research.detail.title', '영상 상세')} className="story-video-modal">
      <div className="story-video-modal-body" role="dialog" aria-modal="true">
        {/* 임베드 자동재생(소리 ON) — 모달 닫히면 언마운트되어 재생 정지 */}
        <div className="story-video-embed-wrap">
          {src && (
            <iframe
              ref={iframeRef}
              data-testid="video-embed"
              className="story-video-embed"
              src={src}
              title={d?.title || videoId}
              allow="autoplay; encrypted-media; picture-in-picture"
              allowFullScreen
              // 로드 완료 시 플레이어에 이벤트 구독 등록(listening) → 준비되면 onReady 회신이 와서
              // 위 message 리스너가 상태를 재적용한다. 즉시 1회 재적용도 시도(대개 여기서 충분).
              onLoad={() => {
                const win = iframeRef.current?.contentWindow
                if (win && typeof win.postMessage === 'function') {
                  win.postMessage(JSON.stringify({ event: 'listening', id: 1, channel: 'widget' }), 'https://www.youtube.com')
                }
                playerCommand(iframeRef.current, muted ? 'mute' : 'unMute')
                playerCommand(iframeRef.current, 'setVolume', [volume])
              }}
            />
          )}
        </div>

        {/* Mute/Volume — YouTube IFrame API postMessage 제어 */}
        <div className="story-video-controls">
          <button
            type="button"
            className="story-video-mute"
            aria-label={muted ? t('story.research.detail.unmute', '음소거 해제') : t('story.research.detail.mute', '음소거')}
            onClick={toggleMute}
          >
            {muted ? '🔇' : '🔊'}
          </button>
          <input
            type="range"
            className="story-video-volume"
            aria-label={t('story.research.detail.volume', '볼륨')}
            min={0}
            max={100}
            value={volume}
            onChange={onVolume}
          />
        </div>

        {loading && <div className="story-video-loading">{t('story.research.detail.loading', '상세 정보를 불러오는 중…')}</div>}
        {!loading && error && <div className="story-error-banner" role="alert">⚠️ {errorNode()}</div>}

        {!loading && d && (
          <div className="story-video-detail">
            <div className="story-video-detail-title">{d.title || videoId}</div>

            {/* 바이럴 지수(핵심) + 보조지표 */}
            <div className={`story-video-viral story-video-viral-${tier}`}>
              <span className="story-video-viral-tier">{t(`story.research.viral.${tier}`, VIRAL_FALLBACK[tier] || tier)}</span>
              {viral?.ratio != null && (
                <span className="story-video-viral-ratio">
                  {t('story.research.detail.viralRatio', '구독자 대비 {ratio}배', { ratio: viral.ratio.toFixed(1) })}
                </span>
              )}
              {viral?.viewsPerDay != null && (
                <span className="story-video-viral-vpd">
                  {t('story.research.detail.viewsPerDay', '일평균 {count}', { count: viral.viewsPerDay.toLocaleString() })}
                </span>
              )}
              {viral?.engagement != null && (
                <span className="story-video-viral-eng">
                  {t('story.research.detail.engagement', '참여율 {percent}', { percent: `${(viral.engagement * 100).toFixed(1)}%` })}
                </span>
              )}
            </div>

            {/* 상세 메타 */}
            <dl className="story-video-meta">
              <DetailRow label={t('story.research.detail.channel', '채널')} value={d.channelTitle} />
              <DetailRow label={t('story.research.detail.subscribers', '구독자')} value={fmtNum(d.subscribers)} />
              <DetailRow label={t('story.research.detail.uploadDate', '게시일')} value={formatUploadDot(d.uploadDate)} />
              <DetailRow label={t('story.research.detail.views', '조회수')} value={fmtNum(d.viewCount)} />
              <DetailRow label={t('story.research.detail.likes', '좋아요')} value={fmtNum(d.likeCount)} />
              <DetailRow label={t('story.research.detail.duration', '재생시간')} value={d.durationString || null} />
            </dl>
          </div>
        )}
      </div>
    </Modal>
  )
}

function DetailRow({ label, value }) {
  if (value == null || value === '') return null
  return (
    <div className="story-video-meta-row">
      <dt className="story-video-meta-label">{label}</dt>
      <dd className="story-video-meta-value">{value}</dd>
    </div>
  )
}
