/**
 * Modal 컴포넌트 테스트 (Desktop)
 *
 * Desktop에서는 createPortal을 사용하여 document.body에 렌더링하므로
 * DOM 쿼리 시 document.body를 사용
 */

import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import Modal from '../../src/components/Modal'

describe('Modal', () => {
  describe('렌더링', () => {
    it('isOpen이 true일 때 모달 렌더링', () => {
      render(
        <Modal isOpen={true} onClose={() => {}} title="테스트 모달">
          <p>모달 내용</p>
        </Modal>
      )

      expect(screen.getByText('테스트 모달')).toBeInTheDocument()
      expect(screen.getByText('모달 내용')).toBeInTheDocument()
    })

    it('isOpen이 false일 때 모달 렌더링하지 않음', () => {
      render(
        <Modal isOpen={false} onClose={() => {}} title="테스트 모달">
          <p>모달 내용</p>
        </Modal>
      )

      expect(screen.queryByText('테스트 모달')).not.toBeInTheDocument()
    })

    it('footer가 있으면 렌더링', () => {
      render(
        <Modal
          isOpen={true}
          onClose={() => {}}
          title="테스트"
          footer={<button>저장</button>}
        >
          <p>내용</p>
        </Modal>
      )

      expect(screen.getByText('저장')).toBeInTheDocument()
    })

    it('footer가 없으면 footer 영역 렌더링하지 않음', () => {
      render(
        <Modal isOpen={true} onClose={() => {}} title="테스트">
          <p>내용</p>
        </Modal>
      )

      // Portal로 body에 렌더링되므로 document.body에서 검색
      expect(document.body.querySelector('.modal-footer')).not.toBeInTheDocument()
    })
  })

  describe('상호작용', () => {
    it('닫기 버튼 클릭 시 onClose 호출', () => {
      const onClose = vi.fn()
      render(
        <Modal isOpen={true} onClose={onClose} title="테스트">
          <p>내용</p>
        </Modal>
      )

      fireEvent.click(screen.getByText('✕'))
      expect(onClose).toHaveBeenCalledTimes(1)
    })

    it('오버레이 클릭 시 onClose 호출', () => {
      const onClose = vi.fn()
      render(
        <Modal isOpen={true} onClose={onClose} title="테스트">
          <p>내용</p>
        </Modal>
      )

      // Portal로 body에 렌더링되므로 document.body에서 검색
      fireEvent.click(document.body.querySelector('.modal-overlay'))
      expect(onClose).toHaveBeenCalledTimes(1)
    })

    // onClose 없는 모달은 "닫을 수 없는" 모달이다 (예: 빈 레퍼런스 게이트의 busy 단계 —
    // ref 배치가 진행 중이라 사용자에게 돌려줄 안전한 답이 없다). 그런 모달이 ✕ 를 그리면
    // 눌러도 아무 일이 없어 앱이 멈춘 것처럼 보인다. 아예 안 그리는 게 맞다.
    it('onClose가 없으면 닫기 버튼을 그리지 않는다 (죽은 컨트롤 방지)', () => {
      render(
        <Modal isOpen={true} title="테스트">
          <p>내용</p>
        </Modal>
      )

      expect(screen.queryByText('✕')).not.toBeInTheDocument()
      expect(screen.getByText('내용')).toBeInTheDocument()
    })

    it('onClose가 없으면 오버레이 클릭도 아무 일이 없다', () => {
      render(
        <Modal isOpen={true} title="테스트">
          <p>내용</p>
        </Modal>
      )

      // 던지지 않아야 하고, 모달은 그대로 있어야 한다
      fireEvent.click(document.body.querySelector('.modal-overlay'))
      expect(screen.getByText('내용')).toBeInTheDocument()
    })

    it('모달 내부 클릭 시 onClose 호출하지 않음 (stopPropagation)', () => {
      const onClose = vi.fn()
      render(
        <Modal isOpen={true} onClose={onClose} title="테스트">
          <p>내용</p>
        </Modal>
      )

      // Portal로 body에 렌더링되므로 document.body에서 검색
      const modalEl = document.body.querySelector('.modal')
      fireEvent.click(modalEl)
      expect(onClose).not.toHaveBeenCalled()
    })
  })

  describe('스타일', () => {
    it('커스텀 className 적용', () => {
      render(
        <Modal isOpen={true} onClose={() => {}} title="테스트" className="custom-modal">
          <p>내용</p>
        </Modal>
      )

      // Desktop Modal: className={`modal ${className}`} → "modal custom-modal"
      const modalEl = document.body.querySelector('.modal.custom-modal')
      expect(modalEl).toBeInTheDocument()
    })
  })

  describe('Desktop: Electron 연동', () => {
    it('모달 열릴 때 setModalVisible 호출', () => {
      const mockSetModalVisible = vi.fn()
      window.electronAPI.setModalVisible = mockSetModalVisible

      render(
        <Modal isOpen={true} onClose={() => {}} title="테스트">
          <p>내용</p>
        </Modal>
      )

      expect(mockSetModalVisible).toHaveBeenCalledWith({ visible: true })
    })
  })
})
