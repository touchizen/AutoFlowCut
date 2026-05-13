import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

vi.mock('../../src/hooks/useFileSystem', () => ({
  fileSystemAPI: {
    getHistory: vi.fn().mockResolvedValue({ success: true, history: [] }),
    readHistoryFile: vi.fn().mockResolvedValue({ success: false }),
    restoreFromHistory: vi.fn(),
    checkPermission: vi.fn().mockResolvedValue({ hasPermission: false }),
    saveReference: vi.fn().mockResolvedValue({ success: false })
  }
}))

vi.mock('../../src/hooks/useI18n', () => ({
  default: () => ({ t: (k) => k, lang: 'ko', setLang: vi.fn() }),
  useI18n: () => ({ t: (k) => k, lang: 'ko', setLang: vi.fn() })
}))

vi.mock('../../src/components/Toast', () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() }
}))

// Modal 은 portal 사용 — 단순 div 로 stub
vi.mock('../../src/components/Modal', () => ({
  default: ({ children, footer }) => (
    <div data-testid="modal">
      {children}
      <div data-testid="footer">{footer}</div>
    </div>
  )
}))

// ErrorSection 단순화 (i18n 의존)
vi.mock('../../src/components/ErrorSection', () => ({
  default: () => null
}))

import ReferenceDetailModal from '../../src/components/ReferenceDetailModal'

const t = (k, vars) => {
  const map = {
    'reference.name': '이름',
    'reference.namePlaceholder': '이름 (태그 매칭용)',
    'reference.fillFromPreset': '프리셋에서 채우기',
    'reference.selectStyle': '스타일 선택',
    'reference.type': '타입',
    'reference.prompt': '프롬프트',
    'common.copy': '복사',
    'common.close': '닫기',
    'common.save': '저장',
  }
  let s = map[k] || k
  if (vars) for (const [v, val] of Object.entries(vars)) s = s.replace(`{${v}}`, val)
  return s
}

const baseProps = {
  index: 0,
  onUpdate: vi.fn(),
  onUpload: vi.fn(),
  onGenerate: vi.fn(),
  onClose: vi.fn(),
  isGenerating: false,
  t,
  isKo: true,
  projectName: 'test',
  thumbnails: {},
}

describe('ReferenceDetailModal — style card name', () => {
  it('renders editable text input for style card name (no dropdown-only mode)', () => {
    const reference = { id: 1, type: 'style', name: '내 시그니처', prompt: 'custom' }
    render(<ReferenceDetailModal {...baseProps} reference={reference} />)
    const nameInput = screen.getByPlaceholderText('이름 (태그 매칭용)')
    expect(nameInput).toBeInTheDocument()
    expect(nameInput.value).toBe('내 시그니처')
  })

  it('allows typing custom name into the style card', () => {
    const onUpdate = vi.fn()
    const reference = { id: 1, type: 'style', name: '', prompt: '' }
    render(<ReferenceDetailModal {...baseProps} onUpdate={onUpdate} reference={reference} />)
    const nameInput = screen.getByPlaceholderText('이름 (태그 매칭용)')
    fireEvent.change(nameInput, { target: { value: '내 누아르' } })
    expect(nameInput.value).toBe('내 누아르')
  })

  it('shows "fill from preset" helper button only for style cards', () => {
    const styleRef = { id: 1, type: 'style', name: '', prompt: '' }
    const { unmount } = render(<ReferenceDetailModal {...baseProps} reference={styleRef} />)
    expect(screen.getByRole('button', { name: /프리셋에서 채우기/ })).toBeInTheDocument()
    unmount()

    // 별도 mount — editData 가 useState 초기값으로 reference 를 받기 때문에
    // 다른 type 으로 검증하려면 새로 마운트해야 한다 (rerender 는 초기 state 를 보존)
    const charRef = { id: 2, type: 'character', name: '', prompt: '' }
    render(<ReferenceDetailModal {...baseProps} reference={charRef} />)
    expect(screen.queryByRole('button', { name: /프리셋에서 채우기/ })).not.toBeInTheDocument()
  })

  it('opens style preset dropdown when "fill from preset" is clicked', () => {
    const reference = { id: 1, type: 'style', name: '', prompt: '' }
    render(<ReferenceDetailModal {...baseProps} reference={reference} />)
    const fillBtn = screen.getByRole('button', { name: /프리셋에서 채우기/ })
    fireEvent.click(fillBtn)
    // 실제 컴포넌트에서 showStyleDropdown=true 일 때 .style-picker-overlay 가 렌더됨
    expect(document.querySelector('.style-picker-overlay')).toBeTruthy()
  })
})
