/**
 * useModalVisibility — 모달 열릴 때 Flow WebContentsView를 숨기고, 닫힐 때 복원
 *
 * Electron WebContentsView는 네이티브 레이어라 CSS z-index로 가릴 수 없어서
 * 모달이 열릴 때 IPC로 숨겨야 함.
 *
 * @param {boolean} isOpen - 모달 열림 상태
 */

import { useEffect } from 'react'

export function useModalVisibility(isOpen) {
  useEffect(() => {
    if (!isOpen) return
    window.electronAPI?.setModalVisible?.({ visible: true })
    return () => {
      window.electronAPI?.setModalVisible?.({ visible: false })
    }
  }, [isOpen])
}
