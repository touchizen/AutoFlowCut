import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import FlowProjectAdoptModal from '../../src/components/FlowProjectAdoptModal.jsx'

// 실제 앱과 같은 계약: t(key, params). (3-arg mock 을 쓰면 params 무시 결함을 가린다.)
const DICT = {
  'flowAdopt.title': 'Flow 프로젝트 연결',
  'flowAdopt.confirm': '연결',
  'flowAdopt.body': 'Flow 에 열려 있는 프로젝트 {id} 를 지금 프로젝트에 연결할까요?',
  'common.cancel': '취소',
}
const t = (k, p) => {
  let s = DICT[k] || ''
  if (p) for (const [key, val] of Object.entries(p)) s = s.replaceAll(`{${key}}`, String(val))
  return s
}

describe('FlowProjectAdoptModal', () => {
  it('projectId 가 없으면 렌더하지 않는다', () => {
    const { container } = render(<FlowProjectAdoptModal projectId={null} t={t} />)
    expect(container.firstChild).toBeNull()
  })

  it('연결 대상 프로젝트 id 를 보여준다', () => {
    render(<FlowProjectAdoptModal projectId="abc-123" t={t} />)
    expect(screen.getByText(/abc-123/)).toBeInTheDocument()
  })

  it('연결/취소가 각 콜백을 호출한다', () => {
    const onConfirm = vi.fn()
    const onCancel = vi.fn()
    render(<FlowProjectAdoptModal projectId="abc-123" onConfirm={onConfirm} onCancel={onCancel} t={t} />)
    fireEvent.click(screen.getByRole('button', { name: '연결' }))
    expect(onConfirm).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { name: '취소' }))
    expect(onCancel).toHaveBeenCalledTimes(1)
  })
})
