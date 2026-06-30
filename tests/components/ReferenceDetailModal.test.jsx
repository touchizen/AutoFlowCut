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

// PromptInput(Lexical) stub — placeholder 가진 textarea 로 대체해 기존 편집 테스트 유지 + props 노출.
vi.mock('../../src/components/PromptInput', () => ({
  default: ({ value, onChange, placeholder, references, hideFooter }) => (
    <textarea
      data-testid="prompt-input"
      data-refs={references?.length ?? 0}
      data-ref-types={(references || []).map(r => r.type).join(',')}
      data-hide-footer={String(!!hideFooter)}
      placeholder={placeholder}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    />
  ),
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
    'reference.regenerate': '재생성',
    'reference.promptPlaceholder': '이미지 생성용 프롬프트를 입력하세요',
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
  it('prompt 는 PromptInput(chip 피커, footer 숨김)으로 렌더된다', () => {
    const reference = { id: 1, type: 'style', name: 's', prompt: 'p' }
    render(<ReferenceDetailModal {...baseProps} reference={reference} />)
    const pi = screen.getByTestId('prompt-input')
    expect(pi.getAttribute('data-hide-footer')).toBe('true')
    expect(pi.value).toBe('p')
  })

  it('scene 타입 레퍼런스 → @ 피커에 character 만 제공', () => {
    const allRefs = [
      { id: 10, type: 'character', name: 'Queen' },
      { id: 11, type: 'character', name: 'King' },
      { id: 12, type: 'scene', name: 'Throne' },
      { id: 13, type: 'style', name: 'Noir' },
    ]
    const sceneRef = { id: 12, type: 'scene', name: 'Throne', prompt: '' }
    render(<ReferenceDetailModal {...baseProps} reference={sceneRef} references={allRefs} />)
    const pi = screen.getByTestId('prompt-input')
    expect(pi.getAttribute('data-refs')).toBe('2')
    expect(pi.getAttribute('data-ref-types')).toBe('character,character')
  })

  it('비-scene(style/character) 타입 → @ 피커 비움(picking 없음)', () => {
    const allRefs = [{ id: 10, type: 'character', name: 'Queen' }, { id: 13, type: 'style', name: 'Noir' }]
    const styleRef = { id: 13, type: 'style', name: 'Noir', prompt: '' }
    render(<ReferenceDetailModal {...baseProps} reference={styleRef} references={allRefs} />)
    expect(screen.getByTestId('prompt-input').getAttribute('data-refs')).toBe('0')
  })

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

describe('ReferenceDetailModal — regenerate race guard', () => {
  it('passes latest editData as overrideRef (4th arg) to onGenerate', () => {
    // Regression guard: handleRegenerate calls onUpdate then immediately onGenerate.
    // Without the 4th-arg override, _executeGenerateRef reads stale references[index]
    // and either fails with noPrompt or generates with the old prompt.
    const onGenerate = vi.fn()
    const onUpdate = vi.fn()
    const reference = { id: 1, type: 'style', name: '내 누아르', prompt: 'old prompt' }
    render(<ReferenceDetailModal {...baseProps} reference={reference} onUpdate={onUpdate} onGenerate={onGenerate} />)

    // User edits the prompt
    const promptArea = screen.getByPlaceholderText('이미지 생성용 프롬프트를 입력하세요')
    fireEvent.change(promptArea, { target: { value: 'new prompt' } })

    // User clicks regenerate
    const regenerateBtn = screen.getByRole('button', { name: /재생성/ })
    fireEvent.click(regenerateBtn)

    // onUpdate persists editData to parent (async commit)
    expect(onUpdate).toHaveBeenCalledWith(0, expect.objectContaining({ prompt: 'new prompt' }))

    // onGenerate must receive (index, skipPermissionCheck, overrideStyleId, overrideRef-with-new-prompt)
    // so _executeGenerateRef sees the fresh prompt without waiting for React state commit.
    expect(onGenerate).toHaveBeenCalledWith(0, false, null, expect.objectContaining({ prompt: 'new prompt' }))
  })
})

describe('ReferenceDetailModal — §3.8 close-on-regenerate', () => {
  it('재생성 클릭 시 onGenerate AND onClose 모두 호출됨 (onUpdate→onGenerate→onClose 순서)', () => {
    // §3.8: 모달은 재생성 dispatch 후 즉시 닫혀야 한다.
    // 순서: onUpdate(index, editData) → onGenerate(index, false, null, editData) → onClose()
    const onGenerate = vi.fn()
    const onUpdate = vi.fn()
    const onClose = vi.fn()
    const reference = { id: 1, type: 'character', name: '히어로', prompt: 'hero prompt' }
    render(
      <ReferenceDetailModal
        {...baseProps}
        reference={reference}
        onUpdate={onUpdate}
        onGenerate={onGenerate}
        onClose={onClose}
      />
    )

    const regenerateBtn = screen.getByRole('button', { name: /재생성/ })
    fireEvent.click(regenerateBtn)

    // §3.8: 재생성이 dispatch 됐으므로 모달이 닫혀야 한다
    expect(onGenerate).toHaveBeenCalled()
    expect(onClose).toHaveBeenCalled()

    // 순서 검증: onUpdate → onGenerate → onClose
    const updateOrder = onUpdate.mock.invocationCallOrder[0]
    const generateOrder = onGenerate.mock.invocationCallOrder[0]
    const closeOrder = onClose.mock.invocationCallOrder[0]
    expect(updateOrder).toBeLessThan(generateOrder)
    expect(generateOrder).toBeLessThan(closeOrder)
  })

  it('onGenerate 없을 때 재생성 버튼 자체가 렌더 안 되고 onClose 도 호출 안 됨', () => {
    const onClose = vi.fn()
    const reference = { id: 1, type: 'character', name: '히어로', prompt: 'hero prompt' }
    render(
      <ReferenceDetailModal
        {...baseProps}
        reference={reference}
        onGenerate={undefined}
        onClose={onClose}
      />
    )

    expect(screen.queryByRole('button', { name: /재생성/ })).not.toBeInTheDocument()
    expect(onClose).not.toHaveBeenCalled()
  })
})
