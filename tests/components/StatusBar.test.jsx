/**
 * StatusBar 컴포넌트 테스트
 */

import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import StatusBar from '../../src/components/StatusBar'

describe('StatusBar', () => {
  const defaultProgress = { current: 0, total: 10, percent: 0 }

  describe('렌더링', () => {
    it('진행 상태 표시', () => {
      render(
        <StatusBar
          progress={{ current: 5, total: 10, percent: 50 }}
          status="running"
          message="생성 중..."
        />
      )

      expect(screen.getByText('5 / 10 (50%)')).toBeInTheDocument()
      expect(screen.getByText('생성 중...')).toBeInTheDocument()
    })

    it('완료(비활성) 시 비디오 실패(progress.errorCount)도 ❌ 로 표시 (씬 이미지 에러 0이어도)', () => {
      // T2V/F2V 실패는 scene.status='error' 가 아니라 progress.errorCount 로만 옴.
      const { container } = render(
        <StatusBar
          progress={{ current: 3, total: 3, percent: 100, errorCount: 2 }}
          status="done"
          message="⚠️ done — 1 regenerated, 2 failed"
          scenes={[{ id: 's1', imagePath: '/a.png' }]}
        />
      )
      const errEl = container.querySelector('.error-count')
      expect(errEl).toBeTruthy()
      expect(errEl.textContent).toContain('2')
    })

    it('부분 실패(done + errorCount>0)는 success 가 아니라 warning 색상', () => {
      const { container } = render(
        <StatusBar
          progress={{ current: 3, total: 3, percent: 100, errorCount: 2 }}
          status="done"
          message="⚠️ done — 1 regenerated, 2 failed"
          scenes={[{ id: 's1', imagePath: '/a.png' }]}
        />
      )
      const root = container.querySelector('.status-bar')
      expect(root.className).toContain('warning')
      expect(root.className).not.toContain('success')
    })

    it('전체 성공(done + errorCount 0)은 success 색상 유지', () => {
      const { container } = render(
        <StatusBar
          progress={{ current: 3, total: 3, percent: 100, errorCount: 0 }}
          status="done"
          message="✅ done"
          scenes={[{ id: 's1', imagePath: '/a.png' }]}
        />
      )
      const root = container.querySelector('.status-bar')
      expect(root.className).toContain('success')
    })

    it('progress bar 값 설정', () => {
      const { container } = render(
        <StatusBar
          progress={{ current: 3, total: 10, percent: 30 }}
          status="running"
          message=""
        />
      )

      const progressBar = container.querySelector('progress')
      expect(progressBar).toHaveAttribute('value', '30')
      expect(progressBar).toHaveAttribute('max', '100')
    })
  })

  describe('상태별 스타일', () => {
    it('ready 상태', () => {
      const { container } = render(
        <StatusBar progress={defaultProgress} status="ready" message="준비" />
      )

      expect(container.querySelector('.status-bar')).not.toHaveClass('running')
    })

    it('running 상태', () => {
      const { container } = render(
        <StatusBar progress={defaultProgress} status="running" message="실행 중" />
      )

      expect(container.querySelector('.status-bar')).toHaveClass('running')
    })

    it('done 상태', () => {
      const { container } = render(
        <StatusBar progress={defaultProgress} status="done" message="완료" />
      )

      expect(container.querySelector('.status-bar')).toHaveClass('success')
    })

    it('stopped 상태', () => {
      const { container } = render(
        <StatusBar progress={defaultProgress} status="stopped" message="중지됨" />
      )

      expect(container.querySelector('.status-bar')).toHaveClass('warning')
    })

    it('error 상태', () => {
      const { container } = render(
        <StatusBar progress={defaultProgress} status="error" message="에러" />
      )

      expect(container.querySelector('.status-bar')).toHaveClass('error')
    })

    it('알 수 없는 상태', () => {
      const { container } = render(
        <StatusBar progress={defaultProgress} status="unknown" message="?" />
      )

      // 클래스가 추가되지 않음
      const statusBar = container.querySelector('.status-bar')
      expect(statusBar).not.toHaveClass('running')
      expect(statusBar).not.toHaveClass('success')
      expect(statusBar).not.toHaveClass('error')
    })
  })

  describe('진행률 계산', () => {
    // 진행률 텍스트는 isActive(running/uploading) 상태일 때만 표시됨
    it('0% 진행률', () => {
      render(
        <StatusBar
          progress={{ current: 0, total: 100, percent: 0 }}
          status="running"
          message=""
        />
      )

      expect(screen.getByText('0 / 100 (0%)')).toBeInTheDocument()
    })

    it('100% 진행률', () => {
      render(
        <StatusBar
          progress={{ current: 100, total: 100, percent: 100 }}
          status="running"
          message=""
        />
      )

      expect(screen.getByText('100 / 100 (100%)')).toBeInTheDocument()
    })
  })
})
