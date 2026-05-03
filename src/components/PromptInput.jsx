/**
 * PromptInput Component - 텍스트 입력 탭
 */

import { useState, useEffect } from 'react'
import { useI18n } from '../hooks/useI18n'

export default function PromptInput({
  value,
  onChange,
  disabled,
  placeholder,
  seedNo = null,
  seedLocked = false,
  onSeedChange,
  onSeedLockToggle,
  onSeedRandom,
}) {
  const { t } = useI18n()
  const [text, setText] = useState(value || '')

  // 외부에서 value가 변경되면 로컬 상태 동기화 (프로젝트 전환, 파일 로드 등)
  useEffect(() => {
    setText(value || '')
  }, [value])

  const handleChange = (e) => {
    const newText = e.target.value
    setText(newText)      // 로컬 상태 먼저 업데이트 (키 입력 즉시 반영)
    onChange(newText)     // 부모에 전달 (파싱 + 씬 생성)
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

  return (
    <div className="prompt-input-container">
      <textarea
        className="prompt-textarea"
        value={text}
        onChange={handleChange}
        onPaste={handlePaste}
        placeholder={placeholder || t('prompt.placeholder')}
        disabled={disabled}
      />

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
    </div>
  )
}
