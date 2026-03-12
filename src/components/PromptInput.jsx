/**
 * PromptInput Component - 텍스트 입력 탭
 */

import { useState, useEffect } from 'react'
import { useI18n } from '../hooks/useI18n'

export default function PromptInput({ value, onChange, disabled, placeholder }) {
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

  const lineCount = text.split('\n').filter(l => l.trim()).length

  return (
    <div className="prompt-input-container">
      <textarea
        className="prompt-textarea"
        value={text}
        onChange={handleChange}
        placeholder={placeholder || t('prompt.placeholder')}
        disabled={disabled}
      />

      <div className="prompt-input-footer">
        <span className="line-count">
          {t('prompt.count', { count: lineCount })}
        </span>
        <span className="hint">
          💡 {t('prompt.tip')}
        </span>
      </div>
    </div>
  )
}
