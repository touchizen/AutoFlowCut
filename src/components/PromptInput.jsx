/**
 * PromptInput Component - 텍스트 입력 탭
 *
 * `@` 입력 시 references 목록을 썸네일과 함께 드롭다운으로 보여주고, 선택하면
 * `@name` 토큰을 현재 커서 위치에 삽입한다 (Google Flow 스타일).
 * 멘션 해석은 백엔드(useScenes.getMatchingReferences + useAutomation/useSceneGeneration
 * stripMentionPrefixes)가 담당 — 이 컴포넌트는 입력 UX 전용.
 */

import { useState, useEffect, useMemo, useRef } from 'react'
import { createPortal } from 'react-dom'
import { useI18n } from '../hooks/useI18n'
import { resolveImageSrc } from '../utils/formatters'
import { getCaretCoordinates } from '../utils/textareaCaret'
import { tokenizeMentions } from '../utils/highlightMentions'

// `@` 직전이 문자열 시작/공백/구두점일 때만 트리거 — `user@example.com` 같은 이메일 제외.
const MENTION_TRIGGER_RE = /(^|[\s.,!?;:()\[\]{}'"`])@([A-Za-z0-9_\-가-힣]*)$/
const MENTION_DROPDOWN_MAX_HEIGHT = 320
const MENTION_DROPDOWN_MAX_WIDTH = 380

export default function PromptInput({
  value,
  onChange,
  disabled,
  placeholder,
  references = [],
  seedNo = null,
  seedLocked = false,
  onSeedChange,
  onSeedLockToggle,
  onSeedRandom,
}) {
  const { t } = useI18n()
  const [text, setText] = useState(value || '')
  const textareaRef = useRef(null)
  const overlayRef = useRef(null)

  // 멘션 시각화 segments — known 은 배경 highlight, unknown 은 빨간 wavy underline
  const highlightSegments = useMemo(
    () => tokenizeMentions(text, references),
    [text, references]
  )

  // textarea 스크롤 → overlay 위치 sync (textarea 가 wrap 보다 클 때만 의미 있음)
  const syncOverlayScroll = () => {
    const ta = textareaRef.current
    const ov = overlayRef.current
    if (!ta || !ov) return
    ov.scrollTop = ta.scrollTop
    ov.scrollLeft = ta.scrollLeft
  }

  // mention dropdown 상태
  const [mentionQuery, setMentionQuery] = useState(null) // null = 비활성, '' = 직후, 'al' = 'al' 까지 입력
  const [highlightedIndex, setHighlightedIndex] = useState(0)
  const [dropdownPos, setDropdownPos] = useState(null)

  // 입력창이 처음 등장할 때만 ~2.6초 윤기 인트로를 보여주고 끈다.
  const [intro, setIntro] = useState(true)
  useEffect(() => {
    const id = setTimeout(() => setIntro(false), 2600)
    return () => clearTimeout(id)
  }, [])

  // 외부에서 value가 변경되면 로컬 상태 동기화 (프로젝트 전환, 파일 로드 등)
  useEffect(() => {
    setText(value || '')
  }, [value])

  // references → dropdown 옵션. 이름 + 타입 + 썸네일 src.
  const refOptions = useMemo(
    () =>
      (references || [])
        .filter((r) => r?.name)
        .map((r) => ({
          name: r.name,
          type: r.type || 'character',
          src: resolveImageSrc(r) || null,
        })),
    [references]
  )

  // 현재 query 로 필터링된 옵션. query='' 이면 전체.
  const filteredOptions = useMemo(() => {
    if (mentionQuery == null) return []
    const q = mentionQuery.toLowerCase()
    if (!q) return refOptions
    return refOptions.filter((o) => o.name.toLowerCase().includes(q))
  }, [refOptions, mentionQuery])

  // 옵션 리스트 바뀌면 highlight 0으로 reset
  useEffect(() => {
    setHighlightedIndex(0)
  }, [mentionQuery])

  // textarea caret 위치 기준으로 드롭다운 좌표 계산.
  // 1) mirror-div 로 caret 의 textarea-local px 좌표 측정
  // 2) textarea bounding rect + 스크롤 보정으로 viewport(=fixed) 좌표 변환
  // 3) 화면 끝에 부딪히면 위로 펼치고, 가로로도 화면 안에 클램프
  const updateDropdownPos = () => {
    const el = textareaRef.current
    if (!el) return
    const r = el.getBoundingClientRect()
    const caret = getCaretCoordinates(el, el.selectionStart ?? 0)
    const caretTop = r.top + caret.top - el.scrollTop
    const caretBottom = caretTop + caret.height
    const caretLeft = r.left + caret.left - el.scrollLeft

    const spaceBelow = window.innerHeight - caretBottom
    const spaceAbove = caretTop
    const openUp =
      spaceBelow < MENTION_DROPDOWN_MAX_HEIGHT && spaceAbove > spaceBelow

    // 가로 클램프 — 드롭다운이 viewport 밖으로 나가지 않도록.
    const minLeft = 8
    const maxLeft = Math.max(minLeft, window.innerWidth - MENTION_DROPDOWN_MAX_WIDTH - 8)
    const left = Math.max(minLeft, Math.min(caretLeft, maxLeft))

    setDropdownPos({
      left,
      width: MENTION_DROPDOWN_MAX_WIDTH,
      ...(openUp
        ? {
            bottom: window.innerHeight - caretTop + 4,
            maxHeight: Math.min(MENTION_DROPDOWN_MAX_HEIGHT, spaceAbove - 8),
          }
        : {
            top: caretBottom + 4,
            maxHeight: Math.min(MENTION_DROPDOWN_MAX_HEIGHT, spaceBelow - 8),
          }),
    })
  }

  // 커서 위치 직전 텍스트가 `@xxx` 패턴이면 mention 모드 켜기.
  const checkMentionContext = (currentText) => {
    const el = textareaRef.current
    if (!el) {
      setMentionQuery(null)
      return
    }
    const pos = el.selectionStart
    if (pos !== el.selectionEnd) {
      setMentionQuery(null)
      return
    }
    const before = currentText.slice(0, pos)
    const m = before.match(MENTION_TRIGGER_RE)
    if (m) {
      setMentionQuery(m[2] || '')
      updateDropdownPos()
    } else {
      setMentionQuery(null)
    }
  }

  // 스크롤/리사이즈 시 드롭다운 위치 갱신
  useEffect(() => {
    if (mentionQuery == null) return
    const handler = () => updateDropdownPos()
    window.addEventListener('scroll', handler, true)
    window.addEventListener('resize', handler)
    return () => {
      window.removeEventListener('scroll', handler, true)
      window.removeEventListener('resize', handler)
    }
  }, [mentionQuery])

  const handleChange = (e) => {
    const newText = e.target.value
    setText(newText) // 로컬 상태 먼저 업데이트 (키 입력 즉시 반영)
    onChange(newText) // 부모에 전달 (파싱 + 씬 생성)
    // selectionStart 는 onChange 직후 정확 — 같은 frame 에 검사 가능.
    checkMentionContext(newText)
  }

  // 커서 이동(클릭/방향키) 시에도 mention 컨텍스트 갱신
  const handleSelect = () => {
    checkMentionContext(text)
  }

  // 멘션 선택 → `@name` 으로 치환
  const insertMention = (name) => {
    const el = textareaRef.current
    if (!el) return
    const pos = el.selectionStart
    const before = text.slice(0, pos)
    const after = text.slice(pos)
    const m = before.match(MENTION_TRIGGER_RE)
    if (!m) return
    // m[0] = boundary 문자 + `@xxx` (string-start 일 때는 boundary 없이 `@xxx`)
    const matchedFull = m[0]
    const startsAtStringStart = matchedFull[0] === '@'
    const boundaryLen = startsAtStringStart ? 0 : 1
    const replaceStart = before.length - matchedFull.length + boundaryLen
    const inserted = `@${name}`
    const newText = text.slice(0, replaceStart) + inserted + after
    setText(newText)
    onChange(newText)
    setMentionQuery(null)
    // 다음 paint 에 커서 이동 — React 의 state commit 이후 실제 textarea value 가 갱신된 뒤.
    requestAnimationFrame(() => {
      const newPos = replaceStart + inserted.length
      el.focus()
      el.setSelectionRange(newPos, newPos)
    })
  }

  const handleKeyDown = (e) => {
    if (mentionQuery == null || filteredOptions.length === 0) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setHighlightedIndex((i) => Math.min(i + 1, filteredOptions.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setHighlightedIndex((i) => Math.max(i - 1, 0))
    } else if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault()
      const opt = filteredOptions[highlightedIndex]
      if (opt) insertMention(opt.name)
    } else if (e.key === 'Escape') {
      e.preventDefault()
      setMentionQuery(null)
    }
  }

  // 엑셀/시트에서 복사한 탭 구분 데이터를 줄바꿈으로 정규화하여 붙여넣기
  // (각 줄 = 한 씬 규칙을 유지)
  const handlePaste = (e) => {
    const pasted = e.clipboardData?.getData('text')
    if (!pasted) return

    const normalized = pasted
      .replace(/\r\n?/g, '\n')   // CRLF/CR → LF
      .replace(/\t+/g, '\n')     // 탭(들) → 줄바꿈

    if (normalized === pasted) return // 변환할 게 없으면 기본 동작

    e.preventDefault()
    const target = e.target
    const start = target.selectionStart
    const end = target.selectionEnd
    const newText = text.slice(0, start) + normalized + text.slice(end)
    setText(newText)
    onChange(newText)

    // 커서를 붙여넣은 텍스트 끝으로 이동
    requestAnimationFrame(() => {
      const pos = start + normalized.length
      target.setSelectionRange(pos, pos)
    })
  }

  const lineCount = text.split('\n').filter(l => l.trim()).length

  // seed 핸들러: 빈 값 허용, 숫자만 입력
  const handleSeedInputChange = (e) => {
    const raw = e.target.value
    if (raw === '') {
      onSeedChange?.(null)
      return
    }
    const digits = raw.replace(/[^\d]/g, '')
    if (digits === '') {
      onSeedChange?.(null)
      return
    }
    const num = parseInt(digits, 10)
    if (Number.isFinite(num)) onSeedChange?.(num)
  }

  const showSeedUI = typeof onSeedChange === 'function'
  const showMentionDropdown = mentionQuery != null && dropdownPos && filteredOptions.length > 0

  return (
    <div className="prompt-input-container">
      <div
        className={`prompt-textarea-wrap ${intro ? 'intro' : ''}`}
        data-testid="prompt-textarea-wrap"
      >
        {/* highlight overlay — textarea 뒤 (z-index 0). 알려진 @멘션 = 배경 highlight,
            unmatched @멘션 = 빨간 wavy underline. 텍스트 색은 transparent 라 텍스트는
            보이지 않고 BG/underline 만 노출 → 위 textarea 가 진짜 텍스트를 그린다.
            aria-hidden — 보조 기술 중복 읽기 방지. */}
        <div
          className="prompt-highlight-overlay"
          ref={overlayRef}
          aria-hidden="true"
          data-testid="prompt-highlight-overlay"
        >
          {highlightSegments.map((s, i) =>
            s.kind === 'plain' ? (
              <span key={i}>{s.text}</span>
            ) : (
              <span key={i} className={`mention-token mention-${s.kind}`}>{s.text}</span>
            )
          )}
          {/* 마지막이 newline 으로 끝나면 div 는 빈 줄 layout 못 잡음 — zero-width 보조 */}
          {text.endsWith('\n') && <span>&#8203;</span>}
        </div>
        <textarea
          ref={textareaRef}
          className="prompt-textarea"
          value={text}
          onChange={handleChange}
          onPaste={handlePaste}
          onKeyDown={handleKeyDown}
          onSelect={handleSelect}
          onScroll={syncOverlayScroll}
          onBlur={() => setTimeout(() => setMentionQuery(null), 150)}
          placeholder={placeholder || t('prompt.placeholder')}
          disabled={disabled}
        />
      </div>

      <div className="prompt-input-footer">
        <span className="line-count">
          {t('prompt.count', { count: lineCount })}
        </span>

        {showSeedUI && (
          <div className="seed-control" title={t('prompt.seedTitle') || 'Seed (locked = reuse same image)'}>
            <span className="seed-label">Seed</span>
            <input
              type="text"
              inputMode="numeric"
              className="seed-input"
              value={seedNo ?? ''}
              onChange={handleSeedInputChange}
              placeholder={t('prompt.seedRandom') || 'random'}
              disabled={disabled}
              maxLength={12}
            />
            <button
              type="button"
              className="seed-btn seed-dice"
              onClick={() => onSeedRandom?.()}
              disabled={disabled}
              title={t('prompt.seedDice') || 'New random seed + lock'}
            >
              🎲
            </button>
            <button
              type="button"
              className={`seed-btn seed-lock ${seedLocked ? 'locked' : ''}`}
              onClick={() => onSeedLockToggle?.()}
              disabled={disabled}
              title={seedLocked
                ? (t('prompt.seedUnlock') || 'Unlock (use random each time)')
                : (t('prompt.seedLock') || 'Lock (reuse this seed)')}
            >
              {seedLocked ? '🔒' : '🔓'}
            </button>
          </div>
        )}

        <span className="hint">
          💡 {t('prompt.tip')}
        </span>
      </div>

      {showMentionDropdown && createPortal(
        <div
          className="prompt-mention-dropdown"
          style={{ position: 'fixed', ...dropdownPos }}
          data-testid="prompt-mention-dropdown"
        >
          {filteredOptions.map((opt, i) => (
            <div
              key={`${opt.name}-${i}`}
              className={`prompt-mention-option ${i === highlightedIndex ? 'highlighted' : ''}`}
              onMouseDown={(e) => {
                e.preventDefault() // textarea blur 방지
                insertMention(opt.name)
              }}
              onMouseEnter={() => setHighlightedIndex(i)}
            >
              {opt.src ? (
                <img src={opt.src} alt="" className="prompt-mention-thumb" loading="lazy" />
              ) : (
                <span className="prompt-mention-thumb empty" />
              )}
              <span className="prompt-mention-option-label">
                @{opt.name}
                <span className="prompt-mention-type">{opt.type}</span>
              </span>
            </div>
          ))}
        </div>,
        document.body
      )}
    </div>
  )
}
