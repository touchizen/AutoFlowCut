import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import FlowProjectAdoptModal from '../../src/components/FlowProjectAdoptModal.jsx'
import { I18nProvider, useI18n } from '../../src/hooks/useI18n.jsx'

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

// ID 는 이 확인의 유일한 증거라 반드시 치환돼야 한다. 목 t 는 계약을 흉내 낼 뿐이므로,
// 실제 사전 + 실제 보간으로 한 번 더 고정한다(예전에 여기서 '{id}' 가 리터럴로 노출됐다).
describe('FlowProjectAdoptModal — 실제 I18nProvider 보간', () => {
  function RealT({ projectId }) {
    const { t } = useI18n()
    return <FlowProjectAdoptModal projectId={projectId} t={t} onConfirm={() => {}} onCancel={() => {}} />
  }

  it('실제 사전으로도 {id} 가 치환된다', () => {
    render(<I18nProvider><RealT projectId="real-id-42" /></I18nProvider>)

    expect(screen.getByText(/real-id-42/)).toBeInTheDocument()
    expect(screen.queryByText(/\{id\}/)).toBeNull()
  })
})
