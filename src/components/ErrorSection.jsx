/**
 * ErrorSection - 에러 메시지 표시 + 클립보드 복사 공용 컴포넌트
 *
 * 상세 모달 하단에 배치하여, 생성 실패 시 사용자가 에러 메시지를
 * 한 번에 복사해 이슈 리포팅/디버깅에 쓸 수 있도록 한다.
 *
 * `error`가 falsy면 아무것도 렌더링하지 않는다.
 */

import { useI18n } from '../hooks/useI18n'
import { toast } from './Toast'
import './ErrorSection.css'

export default function ErrorSection({ error, label, className = '' }) {
  const { t } = useI18n()

  if (!error) return null

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(String(error))
      toast.success(t('common.copied') || 'Copied')
    } catch (err) {
      console.error('[ErrorSection] Copy failed:', err)
      toast.error(t('common.copyFailed') || 'Copy failed')
    }
  }

  const title = label || t('errorSection.title') || t('common.error') || 'Error'
  const copyLabel = t('common.copy') || 'Copy'
  const rootClassName = ['error-section', className].filter(Boolean).join(' ')

  return (
    <div className={rootClassName} role="alert">
      <div className="error-section-header">
        <span className="error-section-title">⚠ {title}</span>
        <button
          type="button"
          className="error-section-copy"
          onClick={handleCopy}
          title={copyLabel}
          aria-label={copyLabel}
        >
          ⧉ {copyLabel}
        </button>
      </div>
      <div className="error-section-body">{String(error)}</div>
    </div>
  )
}
