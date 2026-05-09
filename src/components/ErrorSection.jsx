/**
 * ErrorSection - 에러 메시지 표시 + 클립보드 복사 공용 컴포넌트
 *
 * 상세 모달 하단에 배치하여, 생성 실패 시 사용자가 에러 메시지를
 * 한 번에 복사해 이슈 리포팅/디버깅에 쓸 수 있도록 한다.
 *
 * Props
 *   - error      : 자유 형식 에러 문자열 (주로 generation 실패의 API 메시지). 그대로 표시.
 *   - errorKind  : 코드화된 에러 종류 (예: 'image-missing'). 주어지면 `t('errorSection.kind.<kind>')`
 *                  로 현재 로케일에서 메시지를 조회. 데이터 언어 독립을 위해 errorKind 만 저장하고
 *                  표시 시점에 번역하는 패턴.
 *   - errorKind 와 error 가 모두 주어지면 errorKind 우선 (번역된 메시지가 사용자 화면에 더 정확).
 *   - 둘 다 falsy 면 아무것도 렌더링하지 않는다.
 */

import { useI18n } from '../hooks/useI18n'
import { resolveDisplayError } from '../utils/errorDisplay'
import { toast } from './Toast'
import './ErrorSection.css'

export default function ErrorSection({ error, errorKind, label, className = '' }) {
  const { t } = useI18n()

  // 공용 util — errorKind 우선, 알 수 없는 kind 일 때 raw 키가 새지 않도록 fallback 가드.
  const displayError = resolveDisplayError(t, errorKind, error)

  if (!displayError) return null

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(String(displayError))
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
      <div className="error-section-body">{String(displayError)}</div>
    </div>
  )
}
