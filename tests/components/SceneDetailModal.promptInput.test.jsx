/**
 * SceneDetailModal — 프롬프트 편집이 chip 피커(PromptInput, footer 숨김)로 동작.
 *   - prompt 필드가 plain textarea 가 아니라 PromptInput 으로 렌더된다 (references 전체 전달 + hideFooter)
 *   - 편집 → 저장 시 onUpdate 에 새 prompt 가 실린다
 * PromptInput 은 Lexical 기반이라 stub 으로 대체해 wiring(props/onChange)만 검증.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

vi.mock('../../src/hooks/useFileSystem', () => ({
  fileSystemAPI: { getHistory: vi.fn().mockResolvedValue({ success: true, histories: [] }), readHistoryFile: vi.fn(), restoreFromHistory: vi.fn() },
}))
vi.mock('../../src/hooks/useI18n', () => ({
  default: () => ({ t: (k) => k, lang: 'en', setLang: vi.fn() }),
  useI18n: () => ({ t: (k) => k, lang: 'en', setLang: vi.fn() }),
}))
vi.mock('../../src/components/Toast', () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() },
}))
vi.mock('../../src/components/Modal', () => ({
  default: ({ children, footer }) => (<div data-testid="modal">{children}<div data-testid="footer">{footer}</div></div>),
}))
// PromptInput stub — props 를 DOM 속성으로 노출.
vi.mock('../../src/components/PromptInput', () => ({
  default: ({ value, onChange, references, hideFooter, placeholder }) => (
    <textarea
      data-testid="prompt-input"
      data-refs={references?.length ?? 0}
      data-hide-footer={String(!!hideFooter)}
      value={value}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
    />
  ),
}))

import SceneDetailModal from '../../src/components/SceneDetailModal'

const REFS = [
  { id: 1, name: 'Queen', type: 'character' },
  { id: 2, name: 'forest', type: 'scene' },
  { id: 3, name: 'noir', type: 'style' },
]
const scene = { id: 's1', prompt: 'a sunset', status: 'done' }

function renderModal(props = {}) {
  const onUpdate = vi.fn()
  const onClose = vi.fn()
  render(<SceneDetailModal scene={scene} references={REFS} onUpdate={onUpdate} onClose={onClose} t={(k) => k} {...props} />)
  return { onUpdate, onClose }
}

beforeEach(() => vi.clearAllMocks())

describe('SceneDetailModal prompt → PromptInput (chip picker, compact)', () => {
  it('renders the prompt as a PromptInput with all references and footer hidden', () => {
    renderModal()
    const pi = screen.getByTestId('prompt-input')
    expect(pi).toBeTruthy()
    expect(pi.getAttribute('data-refs')).toBe(String(REFS.length))
    expect(pi.getAttribute('data-hide-footer')).toBe('true')
    expect(pi.value).toBe('a sunset')
  })

  it('saves the edited prompt via onUpdate', () => {
    const { onUpdate } = renderModal()
    fireEvent.change(screen.getByTestId('prompt-input'), { target: { value: 'a wizard @Queen' } })
    fireEvent.click(screen.getByText('sceneDetail.save'))
    expect(onUpdate).toHaveBeenCalledWith('s1', expect.objectContaining({ prompt: 'a wizard @Queen' }))
  })
})
