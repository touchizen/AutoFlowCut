import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import SpeakerRegenConfirmModal from '../../../src/components/story/SpeakerRegenConfirmModal.jsx'

// t(key, default, params) — 보간 지원(StoryView가 넘기는 useSafeT와 같은 계약).
const t = (k, d, p) => {
  let s = d || k
  if (p) for (const [key, val] of Object.entries(p)) s = s.replaceAll(`{${key}}`, String(val))
  return s
}

describe('SpeakerRegenConfirmModal', () => {
  it('speaker가 null이면 아무것도 렌더하지 않는다', () => {
    const { container } = render(<SpeakerRegenConfirmModal speaker={null} t={t} />)
    expect(container.firstChild).toBeNull()
  })

  it('화자 이름과 세그먼트 수를 보여준다', () => {
    render(<SpeakerRegenConfirmModal speaker={{ id: 'w', name: '과부' }} segmentCount={3} t={t} />)
    expect(screen.getByText(/과부/)).toBeInTheDocument()
    expect(screen.getByText(/3개/)).toBeInTheDocument()
  })

  it('name이 없으면 id로 표시한다', () => {
    render(<SpeakerRegenConfirmModal speaker={{ id: 'widow' }} segmentCount={1} t={t} />)
    expect(screen.getByText(/widow/)).toBeInTheDocument()
  })

  it('재생성/취소 버튼이 각 콜백을 호출한다', () => {
    const onConfirm = vi.fn()
    const onCancel = vi.fn()
    render(<SpeakerRegenConfirmModal speaker={{ id: 'w', name: '과부' }} segmentCount={1} onConfirm={onConfirm} onCancel={onCancel} t={t} />)
    fireEvent.click(screen.getByRole('button', { name: '재생성' }))
    expect(onConfirm).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { name: '취소' }))
    expect(onCancel).toHaveBeenCalledTimes(1)
  })

  it('confirmDisabled면 재생성 버튼이 비활성화된다(모달 열린 사이 다른 실행이 시작된 경우 방지)', () => {
    const onConfirm = vi.fn()
    render(<SpeakerRegenConfirmModal speaker={{ id: 'w', name: '과부' }} segmentCount={1} onConfirm={onConfirm} confirmDisabled t={t} />)
    const btn = screen.getByRole('button', { name: '재생성' })
    expect(btn).toBeDisabled()
    fireEvent.click(btn)
    expect(onConfirm).not.toHaveBeenCalled()
  })
})
