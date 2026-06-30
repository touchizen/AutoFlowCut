/**
 * VideoDetailModal — 프롬프트 편집 (chip 피커 PromptInput, footer 숨김) + onPromptSave 저장.
 *   - prompt 가 read-only div 가 아니라 PromptInput 으로 렌더 (references 전체 + hideFooter)
 *   - 편집 시 Save 활성화, 저장 시 onPromptSave(video.id, newPrompt) 호출
 *   - prompt-only 변경에서는 restore 용 onUpdate 를 호출하지 않는다(토글 리셋 부작용 방지)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

vi.mock('../../src/hooks/useFileSystem', () => ({
  fileSystemAPI: { getHistory: vi.fn().mockResolvedValue({ success: true, histories: [] }), readHistoryFile: vi.fn(), restoreFromHistory: vi.fn() },
}))
vi.mock('../../src/components/Toast', () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() } }))
vi.mock('../../src/components/Modal', () => ({
  default: ({ children, footer }) => (<div data-testid="modal">{children}<div data-testid="footer">{footer}</div></div>),
}))
vi.mock('../../src/components/ErrorSection', () => ({ default: () => null }))
vi.mock('../../src/components/MediaMetaBar', () => ({ default: () => null }))
vi.mock('../../src/utils/mediaMeta', () => ({ fetchLatestHistoryMeta: vi.fn().mockResolvedValue(null), estimateBase64FileSize: () => 0 }))
vi.mock('../../src/utils/videoSrc', () => ({ resolveVideoSrc: () => null, ensureBase64DataUrl: (v) => v }))
vi.mock('../../src/components/PromptInput', () => ({
  default: ({ value, onChange, references, hideFooter, placeholder }) => (
    <textarea data-testid="prompt-input" data-refs={references?.length ?? 0} data-hide-footer={String(!!hideFooter)}
      value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
  ),
}))

import VideoDetailModal from '../../src/components/VideoDetailModal'

const REFS = [{ id: 1, name: 'Queen', type: 'character' }, { id: 2, name: 'forest', type: 'scene' }]
const video = { id: 't2v_1', prompt: 'epic battle', video: 'data:video/mp4;base64,x', videoPath: '/v/t2v_1.mp4', status: 'complete' }

function renderModal(props = {}) {
  const onPromptSave = vi.fn()
  const onUpdate = vi.fn()
  const onClose = vi.fn()
  render(<VideoDetailModal video={video} references={REFS} onPromptSave={onPromptSave} onUpdate={onUpdate} onClose={onClose} t={(k) => k} {...props} />)
  return { onPromptSave, onUpdate, onClose }
}

beforeEach(() => vi.clearAllMocks())

describe('VideoDetailModal prompt editing (PromptInput)', () => {
  it('renders the prompt as a PromptInput with references and footer hidden', () => {
    renderModal()
    const pi = screen.getByTestId('prompt-input')
    expect(pi.getAttribute('data-refs')).toBe(String(REFS.length))
    expect(pi.getAttribute('data-hide-footer')).toBe('true')
    expect(pi.value).toBe('epic battle')
  })

  it('Save is disabled until the prompt changes, then saves via onPromptSave', () => {
    const { onPromptSave, onUpdate } = renderModal()
    const saveBtn = document.querySelector('.btn-primary')
    expect(saveBtn.disabled).toBe(true)

    fireEvent.change(screen.getByTestId('prompt-input'), { target: { value: 'epic battle @Queen' } })
    expect(saveBtn.disabled).toBe(false)

    fireEvent.click(saveBtn)
    expect(onPromptSave).toHaveBeenCalledWith('t2v_1', 'epic battle @Queen')
    // prompt-only 변경 → restore onUpdate 는 호출 안 함
    expect(onUpdate).not.toHaveBeenCalled()
  })
})
