/**
 * Modal - 공통 모달 래퍼 컴포넌트
 *
 * React Portal을 사용하여 document.body에 렌더링.
 * 모달 열릴 때 Flow WebContentsView를 숨김 (네이티브 레이어는 CSS z-index로 가릴 수 없음).
 */

import { createPortal } from 'react-dom'
import { useModalVisibility } from '../hooks/useModalVisibility'

export default function Modal({
  isOpen = true,
  onClose,
  title,
  className = '',
  children,
  footer
}) {
  // 모달 열릴 때 Flow 뷰 숨기기, 닫힐 때 복원
  useModalVisibility(isOpen)

  if (!isOpen) return null

  return createPortal(
    <div className="modal-overlay" onClick={onClose}>
      <div
        className={`modal ${className}`}
        onClick={e => e.stopPropagation()}
      >
        <div className="modal-header">
          <h3>{title}</h3>
          {/* onClose 를 안 준 모달은 닫을 수 없는 모달이다 — ✕ 를 그려두면 눌러도 반응이
              없어 앱이 멈춘 것처럼 보인다. 핸들러가 있을 때만 닫기를 노출한다. */}
          {onClose && <button className="btn-close" onClick={onClose}>✕</button>}
        </div>

        <div className="modal-body">
          {children}
        </div>

        {footer && (
          <div className="modal-footer">
            {footer}
          </div>
        )}
      </div>
    </div>,
    document.body
  )
}
