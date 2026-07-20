/**
 * VoicePicker - 성우 선택 카드 그리드 (provider 칩 + 성별 세그먼트 + 검색)
 *
 * - provider(전체/Typecast/Gemini/ElevenLabs) 칩 + 성별 세그먼트 + 검색으로 필터링
 * - RENDER_CAP(120) 개까지만 렌더링, 초과분은 "더 보기"로 확장
 * - 카드 클릭 시 즉시 onSelect({ provider, voiceId }) 호출 (StylePicker와 동일하게 controlled)
 * - 미리듣기 버튼은 onPreview(voice), 성별 미확정(genderSource: null/f0/manual) 보이스는
 *   우클릭 메뉴로 onOverrideGender({ provider, voiceId, gender })
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { voiceKey } from '../../utils/voiceKey'
import AudioKeyGateCard from './AudioKeyGateCard'
import { keyIdForProvider } from '../../config/apiKeyRegistry'
import './VoicePicker.css'

const RENDER_CAP = 120
const PROVIDERS = ['typecast', 'gemini', 'elevenlabs']
const PROVIDER_BADGE = { typecast: 'TC', gemini: 'GM', elevenlabs: '11' }
const PROVIDER_CLASS = { typecast: 'tc', gemini: 'gm', elevenlabs: 'el' }
const OVERRIDABLE_SOURCES = new Set([null, undefined, 'f0', 'manual'])
const SEARCH_DEBOUNCE_MS = 300
const GENDER_SEGMENTS = new Set(['male', 'female'])

function shortVpId(id) {
  if (!id) return id
  return id.length > 12 ? `${id.slice(0, 10)}…` : id
}

// Codex 최종 리뷰 Finding 1: selected.voiceId가 있는데 현재 voices 목록(selectedVoice)에서 못
// 찾으면(예: 이전 세션의 ElevenLabs shared voice가 이번 preload에 없음) "기본 성우"로 잘못
// 읽히던 버그 — 저장된 id가 실제로 있음을 구분해서 보여준다.
function selectedSummaryLabel(selected, selectedVoice, t, isKo) {
  if (!selected?.voiceId) return t('story.voicePicker.defaultVoice', isKo ? '기본 성우' : 'Default voice')
  if (selectedVoice) return selectedVoice.name
  const id = shortVpId(selected.voiceId)
  return t(
    'story.voicePicker.unloadedVoice',
    isKo ? `저장된 성우 (미로드) · ${id}` : `Saved voice (not loaded) · ${id}`,
    { id },
  )
}

function genderInfo(gender, t, isKo) {
  if (gender === 'female') {
    return { cls: 'f', icon: '♀', label: t('story.voicePicker.genderFemaleShort', isKo ? '여성' : 'Female') }
  }
  if (gender === 'male') {
    return { cls: 'm', icon: '♂', label: t('story.voicePicker.genderMaleShort', isKo ? '남성' : 'Male') }
  }
  return { cls: 'u', icon: '—', label: t('story.voicePicker.genderUnknown', isKo ? '미상' : 'Unknown') }
}

export default function VoicePicker({
  voices = [],
  selected = {},
  onSelect,
  onPreview,
  onOverrideGender,
  onConfirm,
  onCancel,
  onVoiceSearch = null,
  previewState = { voiceId: null, status: 'idle' },
  initialGender = null,
  t,
  isKo
}) {
  const [activeProvider, setActiveProvider] = useState('all')
  // C(성우 추천): 캐릭터 성별이 잡히면(initialGender) 그 세그먼트로 시작. 없거나 잘못된 값이면
  // 'all'로 폴백해 기존 동작을 유지한다.
  const [activeGender, setActiveGender] = useState(GENDER_SEGMENTS.has(initialGender) ? initialGender : 'all')
  const [query, setQuery] = useState('')
  const [visibleCount, setVisibleCount] = useState(RENDER_CAP)
  const [overrideKey, setOverrideKey] = useState(null)
  const searchTimerRef = useRef(null)

  // Remote search: ElevenLabs has thousands of shared voices, only the first preload page is
  // loaded locally. Debounce the search box and fetch more from the main process, merging into
  // the voice list. Typecast/Gemini are already fully loaded, so remote search only targets
  // elevenlabs (including when the "all" chip is active).
  useEffect(() => {
    if (!onVoiceSearch) return undefined
    const provider = activeProvider === 'all' ? 'elevenlabs' : activeProvider
    if (provider !== 'elevenlabs') return undefined
    const q = query.trim()
    if (q.length < 2) return undefined
    searchTimerRef.current = setTimeout(() => {
      onVoiceSearch({ provider, query: q })
    }, SEARCH_DEBOUNCE_MS)
    return () => clearTimeout(searchTimerRef.current)
  }, [query, activeProvider, onVoiceSearch])

  const providerCounts = useMemo(() => {
    const counts = { all: voices.length }
    for (const p of PROVIDERS) counts[p] = voices.filter(v => v.provider === p).length
    return counts
  }, [voices])

  const filtered = useMemo(() => {
    let list = voices
    if (activeProvider !== 'all') list = list.filter(v => v.provider === activeProvider)
    if (activeGender !== 'all') list = list.filter(v => v.gender === activeGender)
    const q = query.trim().toLowerCase()
    if (q) {
      list = list.filter(v =>
        v.name?.toLowerCase().includes(q) ||
        (v.traits || []).some(tr => tr.toLowerCase().includes(q))
      )
    }
    return list
  }, [voices, activeProvider, activeGender, query])

  const visible = filtered.slice(0, visibleCount)
  const hasMore = filtered.length > visible.length

  const selectedVoice = useMemo(
    () => voices.find(v => v.provider === selected?.provider && v.id === selected?.voiceId),
    [voices, selected]
  )

  // Default-voice card selection and footer confirm must agree on the same fallback provider,
  // otherwise selected={} shows the default card as selected while confirm stays disabled.
  const effectiveProvider = selected?.provider || 'typecast'

  const setFilter = (setter, value) => {
    setter(value)
    setVisibleCount(RENDER_CAP)
  }

  return (
    <div className="voice-picker">
      <div className="vp-filters">
        <div className="vp-row">
          <div className="vp-providers">
            <button
              type="button"
              className={`vp-chip ${activeProvider === 'all' ? 'active' : ''}`}
              onClick={() => setFilter(setActiveProvider, 'all')}
            >
              {t('story.voicePicker.providerAll', isKo ? '전체' : 'All')} <span className="n">{providerCounts.all}</span>
            </button>
            <button
              type="button"
              className={`vp-chip ${activeProvider === 'typecast' ? 'active' : ''}`}
              onClick={() => setFilter(setActiveProvider, 'typecast')}
            >
              Typecast <span className="n">{providerCounts.typecast}</span>
            </button>
            <button
              type="button"
              className={`vp-chip ${activeProvider === 'gemini' ? 'active' : ''}`}
              onClick={() => setFilter(setActiveProvider, 'gemini')}
            >
              Gemini <span className="n">{providerCounts.gemini}</span>
            </button>
            <button
              type="button"
              className={`vp-chip ${activeProvider === 'elevenlabs' ? 'active' : ''}`}
              onClick={() => setFilter(setActiveProvider, 'elevenlabs')}
            >
              ElevenLabs <span className="n">{providerCounts.elevenlabs}</span>
            </button>
          </div>
        </div>
        <div className="vp-row">
          <div className="vp-search">
            <span className="mag">⌕</span>
            <input
              type="text"
              value={query}
              onChange={(e) => setFilter(setQuery, e.target.value)}
              placeholder={t('story.voicePicker.searchPlaceholder', isKo ? '이름·특성 검색…' : 'Search name or traits…')}
            />
          </div>
          <div className="vp-seg">
            <button
              type="button"
              className={activeGender === 'all' ? 'active' : ''}
              onClick={() => setFilter(setActiveGender, 'all')}
            >
              {t('story.voicePicker.genderAll', isKo ? '전체' : 'All')}
            </button>
            <button
              type="button"
              className={`f ${activeGender === 'female' ? 'active' : ''}`}
              onClick={() => setFilter(setActiveGender, 'female')}
            >
              ♀ {t('story.voicePicker.genderFemale', isKo ? '여성' : 'Female')}
            </button>
            <button
              type="button"
              className={`m ${activeGender === 'male' ? 'active' : ''}`}
              onClick={() => setFilter(setActiveGender, 'male')}
            >
              ♂ {t('story.voicePicker.genderMale', isKo ? '남성' : 'Male')}
            </button>
          </div>
        </div>
      </div>

      <div className="vp-grid">
        <div
          className={`vp-card vp-default ${!selected?.voiceId ? 'selected' : ''}`}
          onClick={() => onSelect({ provider: effectiveProvider, voiceId: '' })}
        >
          <div className="vp-card-top">
            <div className="vp-default-icon">★</div>
            <div className="vp-id">
              <div className="vp-name">{t('story.voicePicker.defaultVoice', isKo ? '기본 성우' : 'Default voice')}</div>
            </div>
          </div>
          <span className="vp-check">✔</span>
        </div>

        {visible.map(v => {
          const key = voiceKey(v.provider, v.id)
          const gInfo = genderInfo(v.gender, t, isKo)
          const isSelected = selected?.provider === v.provider && selected?.voiceId === v.id
          const previewStatus = previewState?.provider === v.provider && previewState?.voiceId === v.id ? (previewState.status || 'idle') : 'idle'
          const canOverride = OVERRIDABLE_SOURCES.has(v.genderSource)

          return (
            <div
              key={key}
              className={`vp-card ${isSelected ? 'selected' : ''}`}
              onClick={() => onSelect({ provider: v.provider, voiceId: v.id })}
              onContextMenu={(e) => {
                if (!canOverride) return
                e.preventDefault()
                setOverrideKey(key)
              }}
            >
              <span className={`vp-prov ${PROVIDER_CLASS[v.provider] || ''}`}>
                {PROVIDER_BADGE[v.provider] || v.provider}
              </span>
              <div className="vp-card-top">
                <button
                  type="button"
                  className={`vp-play ${previewStatus}`}
                  aria-label={t('story.voicePicker.previewAria', isKo ? '미리듣기' : 'Preview')}
                  onClick={(e) => {
                    e.stopPropagation()
                    onPreview({ provider: v.provider, voiceId: v.id, language: v.language, genderSource: v.genderSource, name: v.name })
                  }}
                >
                  {previewStatus === 'loading' && <span className="spin" />}
                  {previewStatus === 'playing' && (
                    <span className="bars"><i /><i /><i /><i /></span>
                  )}
                  {previewStatus !== 'loading' && previewStatus !== 'playing' && <span className="tri" />}
                </button>
                <div className="vp-id">
                  <div className="vp-name">{v.name}</div>
                  <div className="vp-meta">
                    <span className={`vp-gender ${gInfo.cls}`}>{gInfo.icon} {gInfo.label}</span>
                    <span className="vp-lang">{v.language}</span>
                  </div>
                </div>
              </div>
              {v.traits?.length > 0 && (
                <div className="vp-tags">
                  {v.traits.map(tag => <span key={tag} className="vp-tag">{tag}</span>)}
                </div>
              )}
              {/* Task 3(attempt-first): a preview click first tries the call, and only when it
                  actually fails with no-key does an inline key field show up right on the card
                  that was clicked — the list itself stays keyless (no upfront gate per voice). */}
              {previewStatus === 'error' && previewState?.error === 'no-key' && (
                <div onClick={(e) => e.stopPropagation()}>
                  <AudioKeyGateCard missing={[{ provider: v.provider, keyId: keyIdForProvider(v.provider) }]} t={t} />
                </div>
              )}
              <span className="vp-check">✔</span>

              {overrideKey === key && (
                <>
                  <div className="vp-override-overlay" onClick={(e) => { e.stopPropagation(); setOverrideKey(null) }} />
                  <div className="vp-override-menu" onClick={(e) => e.stopPropagation()}>
                    <button
                      type="button"
                      onClick={() => { onOverrideGender({ provider: v.provider, voiceId: v.id, gender: 'female' }); setOverrideKey(null) }}
                    >
                      ♀ {t('story.voicePicker.overrideFemale', isKo ? '여성으로 지정' : 'Mark as female')}
                    </button>
                    <button
                      type="button"
                      onClick={() => { onOverrideGender({ provider: v.provider, voiceId: v.id, gender: 'male' }); setOverrideKey(null) }}
                    >
                      ♂ {t('story.voicePicker.overrideMale', isKo ? '남성으로 지정' : 'Mark as male')}
                    </button>
                  </div>
                </>
              )}
            </div>
          )
        })}
      </div>

      {hasMore && (
        <button type="button" className="vp-more" onClick={() => setVisibleCount(c => c + RENDER_CAP)}>
          {t('story.voicePicker.showMore', isKo ? '더 보기' : 'Show more')} ({filtered.length - visible.length})
        </button>
      )}

      <div className="vp-foot">
        <div className="sel">
          {t('story.voicePicker.selectedLabel', isKo ? '선택됨' : 'Selected')} ·{' '}
          <b>{selectedSummaryLabel(selected, selectedVoice, t, isKo)}</b>
        </div>
        <div className="vp-actions">
          <button type="button" className="vp-btn" onClick={() => onCancel?.()}>
            {t('story.voicePicker.cancel', isKo ? '취소' : 'Cancel')}
          </button>
          <button
            type="button"
            className="vp-btn primary"
            disabled={!effectiveProvider}
            onClick={() => {
              onSelect({ provider: effectiveProvider, voiceId: selected?.voiceId ?? '' })
              onConfirm?.()
            }}
          >
            {t('story.voicePicker.confirm', isKo ? '이 성우로 지정' : 'Use this voice')}
          </button>
        </div>
      </div>
    </div>
  )
}
