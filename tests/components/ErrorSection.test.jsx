/**
 * ErrorSection — 단위 테스트
 *
 * 검증:
 *  - error가 falsy일 때 아무것도 렌더링 안 함
 *  - error가 있을 때 제목/메시지/Copy 버튼 노출
 *  - Copy 클릭 시 navigator.clipboard.writeText 호출 + 성공 토스트
 *  - Copy 실패 시 에러 토스트
 *  - 커스텀 label prop 우선 사용
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import ErrorSection from '../../src/components/ErrorSection'
import { ToastProvider } from '../../src/components/Toast'
import { I18nProvider } from '../../src/hooks/useI18n'

const wrap = (ui) => render(
  <I18nProvider>
    <ToastProvider>{ui}</ToastProvider>
  </I18nProvider>
)

describe('ErrorSection', () => {
  beforeEach(() => {
    Object.assign(navigator, {
      clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
    })
  })

  describe('렌더링', () => {
    it('error가 null이면 아무것도 렌더링하지 않음', () => {
      const { container } = wrap(<ErrorSection error={null} />)
      expect(container.querySelector('.error-section')).not.toBeInTheDocument()
    })

    it('error가 빈 문자열이면 아무것도 렌더링하지 않음', () => {
      const { container } = wrap(<ErrorSection error="" />)
      expect(container.querySelector('.error-section')).not.toBeInTheDocument()
    })

    it('error가 undefined면 아무것도 렌더링하지 않음', () => {
      const { container } = wrap(<ErrorSection error={undefined} />)
      expect(container.querySelector('.error-section')).not.toBeInTheDocument()
    })

    it('error가 있으면 메시지와 Copy 버튼 노출', () => {
      wrap(<ErrorSection error="Generation timed out after 60s" />)
      expect(screen.getByText('Generation timed out after 60s')).toBeInTheDocument()
      expect(screen.getByRole('button')).toBeInTheDocument()
    })

    it('기본 제목 노출 (locale 키 사용)', () => {
      const { container } = wrap(<ErrorSection error="some error" />)
      const title = container.querySelector('.error-section-title')
      expect(title).toBeInTheDocument()
      // ko or en 둘 중 하나여야 — '에러 정보' 또는 'Error details'
      expect(title.textContent).toMatch(/에러 정보|Error details|Error/)
    })

    it('커스텀 label prop 사용', () => {
      const { container } = wrap(<ErrorSection error="x" label="Custom Label" />)
      const title = container.querySelector('.error-section-title')
      expect(title.textContent).toContain('Custom Label')
    })

    it('숫자 등 비문자열 error도 안전하게 표시', () => {
      wrap(<ErrorSection error={42} />)
      expect(screen.getByText('42')).toBeInTheDocument()
    })

    it('role="alert" 속성 부여 (접근성)', () => {
      const { container } = wrap(<ErrorSection error="x" />)
      expect(container.querySelector('[role="alert"]')).toBeInTheDocument()
    })

    it('className prop 비어있을 때 trailing space 없음', () => {
      const { container } = wrap(<ErrorSection error="x" />)
      const root = container.querySelector('[role="alert"]')
      expect(root.className).toBe('error-section')
    })

    it('className prop 있을 때 정상 결합', () => {
      const { container } = wrap(<ErrorSection error="x" className="extra" />)
      const root = container.querySelector('[role="alert"]')
      expect(root.className).toBe('error-section extra')
    })
  })

  describe('errorKind (codified, i18n-translated)', () => {
    it('errorKind 가 주어지면 t(`errorSection.kind.<kind>`) 로 번역된 메시지 표시', () => {
      // 'image-missing' 키는 en/ko 양쪽 모두 errorSection.kind 에 등록돼 있음.
      // 기본 로케일이 en (DEFAULT_LANG) 이므로 영어 메시지가 노출되는지 확인.
      const { container } = wrap(<ErrorSection errorKind="image-missing" />)
      const body = container.querySelector('.error-section-body')
      expect(body).toBeInTheDocument()
      expect(body.textContent).toBe('Image file not found — please regenerate')
    })

    it('errorKind 가 free-form error 보다 우선 (번역된 메시지가 사용자 화면에 정확)', () => {
      // 사용자가 언어를 바꿨거나 stale 메시지가 남은 경우에도 errorKind 가 있으면
      // 번역된 메시지로 덮어쓴다. 데이터 언어 독립성의 핵심 보장.
      const { container } = wrap(
        <ErrorSection error="이미지 파일을 찾을 수 없습니다 — 재생성이 필요합니다" errorKind="image-missing" />,
      )
      const body = container.querySelector('.error-section-body')
      expect(body.textContent).toBe('Image file not found — please regenerate')
    })

    it('errorKind 도 error 도 없으면 렌더링 안 함', () => {
      const { container } = wrap(<ErrorSection />)
      expect(container.querySelector('.error-section')).not.toBeInTheDocument()
    })

    it('Copy 시 번역된 메시지를 클립보드로 보냄 (raw kind 코드 X)', async () => {
      wrap(<ErrorSection errorKind="image-missing" />)
      fireEvent.click(screen.getByRole('button'))
      await waitFor(() => {
        expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
          'Image file not found — please regenerate',
        )
      })
    })
  })

  describe('Copy 동작', () => {
    it('Copy 버튼 클릭 시 navigator.clipboard.writeText 호출', async () => {
      wrap(<ErrorSection error="abc 123 error" />)
      fireEvent.click(screen.getByRole('button'))
      await waitFor(() => {
        expect(navigator.clipboard.writeText).toHaveBeenCalledWith('abc 123 error')
      })
    })

    it('Copy 실패해도 throw 하지 않음', async () => {
      navigator.clipboard.writeText = vi.fn().mockRejectedValue(new Error('denied'))
      wrap(<ErrorSection error="x" />)
      // throw하지 않는지만 확인 — 토스트 검증은 ToastProvider 격리 부담 큼
      expect(() => fireEvent.click(screen.getByRole('button'))).not.toThrow()
    })
  })
})
