/**
 * MediaMetaBar — 상세 모달의 한 줄 메타 정보 표시 + 추가 정보 expand 토글.
 *
 * Primary 행 (항상 표시):
 *   1376 × 768  ·  3.2s  ·  1.8 MB  ·  🌱 12345 ⧉  ·  🕒 2시간 전   [▼]
 *
 * Expanded 행 (▼ 클릭 시):
 *   🤖 flow / veo_3_1_t2v_fast_ultra_relaxed
 *
 * Primary 5종은 데이터 없으면 자동 숨김.
 * 보조 정보(model 등)가 하나도 없으면 toggle 버튼도 숨김.
 *
 * @param {object} props
 * @param {number}        [props.width]
 * @param {number}        [props.height]
 * @param {number}        [props.duration]   - 초 (비디오)
 * @param {string}        [props.fileSize]   - 사람이 읽는 형식
 * @param {string|number} [props.seed]
 * @param {number}        [props.generatedAt] - ms epoch
 * @param {string}        [props.model]       - 엔진/모델 식별자 ('flow', 'veo_3_1_t2v_*' 등)
 * @param {function}      [props.onCopySeed]
 * @param {function}      [props.t]
 */

import { useState } from 'react'
import { toast } from './Toast'
import { parseModelLabel } from '../utils/mediaMeta'

function formatRelativeTime(ts, t) {
  if (!ts || typeof ts !== 'number') return null
  const diff = Date.now() - ts
  if (diff < 0) return null
  const sec = Math.floor(diff / 1000)
  const min = Math.floor(sec / 60)
  const hr = Math.floor(min / 60)
  const day = Math.floor(hr / 24)
  // i18n 시스템이 키 미존재 시 키 자체를 반환할 수 있어 (`'mediaMeta.hrAgo'`)
  // 단순 `||` fallback 으로는 잡히지 않는다. 반환값이 키와 같거나 비어 있으면 fallback 사용.
  const tx = (key, fallback) => {
    const v = t?.(key)
    return (!v || v === key) ? fallback : v
  }
  if (sec < 60) return tx('mediaMeta.justNow', 'just now')
  if (min < 60) return `${min}${tx('mediaMeta.minAgo', 'm ago')}`
  if (hr < 24) return `${hr}${tx('mediaMeta.hrAgo', 'h ago')}`
  if (day < 7) return `${day}${tx('mediaMeta.dayAgo', 'd ago')}`
  return new Date(ts).toISOString().slice(0, 10)
}

function formatFullDateTime(ts) {
  if (!ts || typeof ts !== 'number') return ''
  const d = new Date(ts)
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

export default function MediaMetaBar({
  width,
  height,
  duration,
  fileSize,
  seed,
  generatedAt,
  model,
  onCopySeed,
  t,
  className = ''
}) {
  const [expanded, setExpanded] = useState(false)

  const hasResolution = Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0
  const hasDuration = Number.isFinite(duration) && duration > 0
  const hasFileSize = typeof fileSize === 'string' && fileSize.length > 0
  const hasSeed = seed != null && String(seed).length > 0
  const hasGeneratedAt = Number.isFinite(generatedAt) && generatedAt > 0

  const modelLabel = parseModelLabel(model)
  const hasMore = !!modelLabel

  const hasPrimary = hasResolution || hasDuration || hasFileSize || hasSeed || hasGeneratedAt
  // 표시할 게 아무것도 없으면 아예 안 그림 (primary 도 expanded 도 비어 있을 때)
  if (!hasPrimary && !hasMore) return null

  // i18n 키 미존재 시 키 자체가 반환될 수 있어 (`'mediaMeta.copySeed'` 그대로) — 키와 같거나 비면 fallback.
  const tx = (key, fallback) => {
    const v = t?.(key)
    return (!v || v === key) ? fallback : v
  }

  const handleSeedClick = async (e) => {
    e.preventDefault()
    e.stopPropagation()
    if (!hasSeed) return
    if (onCopySeed) {
      onCopySeed(seed)
      return
    }
    try {
      await navigator.clipboard.writeText(String(seed))
      toast.success(tx('toast.copied', 'Seed copied'))
    } catch {
      toast.error(tx('toast.copyFailed', 'Copy failed'))
    }
  }

  // ── primary 줄 구성 ──
  const primary = []
  if (hasResolution) {
    primary.push(<span key="res" className="meta-item meta-resolution">{width} × {height}</span>)
  }
  if (hasDuration) {
    primary.push(<span key="dur" className="meta-item">{duration}s</span>)
  }
  if (hasFileSize) {
    primary.push(<span key="size" className="meta-item">{fileSize}</span>)
  }
  if (hasSeed) {
    primary.push(
      <button
        key="seed"
        type="button"
        className="meta-item meta-seed"
        onClick={handleSeedClick}
        title={tx('mediaMeta.copySeed', 'Copy seed')}
      >
        🌱 {seed} ⧉
      </button>
    )
  }
  // formatRelativeTime 는 미래/잘못된 ts 에 null 반환 — 실제 표시 가능할 때만 push.
  const relativeTime = hasGeneratedAt ? formatRelativeTime(generatedAt, t) : null
  if (relativeTime) {
    primary.push(
      <span
        key="time"
        className="meta-item meta-time"
        title={formatFullDateTime(generatedAt)}
      >
        🕒 {relativeTime}
      </span>
    )
  }

  // dot 구분자 삽입
  const primaryWithSeparators = []
  primary.forEach((item, idx) => {
    if (idx > 0) {
      primaryWithSeparators.push(<span key={`sep-${idx}`} className="meta-sep">·</span>)
    }
    primaryWithSeparators.push(item)
  })

  return (
    <div className={`media-meta-bar ${className}`.trim()}>
      <div className="meta-primary">
        {primaryWithSeparators}
        {hasMore && (
          <button
            type="button"
            className="meta-toggle"
            onClick={() => setExpanded(v => !v)}
            title={expanded
              ? tx('mediaMeta.hideDetails', 'Hide details')
              : tx('mediaMeta.showDetails', 'Show details')
            }
            aria-expanded={expanded}
          >
            {expanded ? '▲' : '▼'}
          </button>
        )}
      </div>
      {expanded && hasMore && (
        <div className="meta-secondary">
          {modelLabel && (
            <span className="meta-item meta-model" title={model}>
              🤖 {modelLabel.name}
              {modelLabel.version && (
                <span className="meta-model-version"> v{modelLabel.version}</span>
              )}
            </span>
          )}
        </div>
      )}
    </div>
  )
}
