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

    it('preparing은 별도 CSS 클래스 없이 active progress 텍스트를 표시한다', () => {
      const { container } = render(
        <StatusBar
          progress={{ current: 2, total: 5, percent: 40 }}
          status="preparing"
          message="준비 중"
          scenes={[{ id: 's1', status: 'done', image: 'old' }]}
        />
      )

      expect(screen.getByText('2 / 5 (40%)')).toBeInTheDocument()
      const root = container.querySelector('.status-bar')
      expect(root).not.toHaveClass('preparing')
      expect(root).not.toHaveClass('running')
    })

    it('비디오 뷰 완료 시 비디오 실패(progress.errorCount)를 ❌ 로 표시', () => {
      // T2V/F2V 실패는 scene.status='error' 가 아니라 progress.errorCount 로만 옴.
      const { container } = render(
        <StatusBar
          progress={{ current: 3, total: 3, percent: 100, errorCount: 2 }}
          status="done"
          message="⚠️ done — 1 regenerated, 2 failed"
          scenes={[{ id: 's1', imagePath: '/a.png' }]}
          progressIsVideo
        />
      )
      const errEl = container.querySelector('.error-count')
      expect(errEl).toBeTruthy()
      expect(errEl.textContent).toContain('2')
    })

    it('비디오 뷰 성공 완료는 이전 이미지 씬 에러로 warning 되지 않음 (도메인 분리)', () => {
      // 비디오는 성공(progress.errorCount=0)인데 이미지 씬에 옛 에러가 남아있는 경우.
      const { container } = render(
        <StatusBar
          progress={{ current: 2, total: 2, percent: 100, errorCount: 0 }}
          status="done"
          message="✅ done"
          scenes={[{ id: 's1', status: 'error' }, { id: 's2', imagePath: '/b.png' }]}
          progressIsVideo
        />
      )
      const root = container.querySelector('.status-bar')
      expect(root.className).toContain('success')
      expect(root.className).not.toContain('warning')
      expect(container.querySelector('.error-count')).toBeNull() // 이미지 에러가 비디오에 안 샘
    })

    it('부분 실패(done + errorCount>0)는 success 가 아니라 warning 색상', () => {
      const { container } = render(
        <StatusBar
          progress={{ current: 3, total: 3, percent: 100, errorCount: 2 }}
          status="done"
          message="⚠️ done — 1 regenerated, 2 failed"
          scenes={[{ id: 's1', imagePath: '/a.png' }]}
          progressIsVideo
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

    it('stale imagePath 가 남은 pending/error 씬은 완료 개수에서 제외', () => {
      const { container } = render(
        <StatusBar
          progress={{ current: 0, total: 3, percent: 0, errorCount: 0 }}
          status="done"
          message="완료"
          scenes={[
            { id: 's1', status: 'done', imagePath: '/done.png' },
            { id: 's2', status: 'pending', imagePath: '/old-pending.png' },
            { id: 's3', status: 'error', imagePath: '/old-error.png' },
          ]}
        />
      )

      expect(container.querySelector('.progress-text').textContent).toContain('1')
      expect(container.querySelector('.progress-text').textContent).toContain('/ 3')
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
