/**
 * SceneDetailModal — 재생성 시 선택한 스타일 영속 + 전달 (Issue #4/#5)
 *
 * 상세 모달에서 스타일을 고르고 "재생성"을 누르면:
 *  - onUpdate 로 editData(선택한 style_tag 포함)를 영속(모달 다시 열 때 선택 유지)
 *  - onGenerate(sceneId, undefined, style_tag) 로 방금 고른 style_tag 를 명시 전달
 *    (stale scenes 클로저로 스타일이 누락돼 항상 실사로 생성되는 문제 방지)
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
vi.mock('../../src/components/Toast', () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() } }))
vi.mock('../../src/components/Modal', () => ({
  default: ({ children, footer }) => (<div data-testid="modal">{children}<div data-testid="footer">{footer}</div></div>),
}))
vi.mock('../../src/components/ErrorSection', () => ({ default: () => null }))

import SceneDetailModal from '../../src/components/SceneDetailModal'

const baseScene = {
  id: 'scene_1', prompt: 'a sunset', subtitle: '', duration: 3, startTime: 0,
  image: 'data:image/png;base64,old', imagePath: null, status: 'done',
  characters: '', scene_tag: '', style_tag: '',
}
const references = [{ id: 4, type: 'style', name: 'Noir' }]

beforeEach(() => vi.clearAllMocks())

function renderModal(extra = {}) {
  const onUpdate = vi.fn()
  const onGenerate = vi.fn()
  const onClose = vi.fn()
  render(
    <SceneDetailModal
      scene={baseScene} references={references} styleThumbnails={{}}
      onUpdate={onUpdate} onGenerate={onGenerate} onClose={onClose}
      t={(k) => k} projectName="proj" aspectRatio="9:16" {...extra}
    />
  )
  return { onUpdate, onGenerate, onClose }
}

describe('SceneDetailModal — 재생성 스타일 영속/전달', () => {
  it('스타일 선택 후 재생성: onUpdate 로 style_tag 영속', () => {
    const { onUpdate } = renderModal()
    fireEvent.focus(screen.getByPlaceholderText('sceneDetail.styleSelect'))
    fireEvent.mouseDown(screen.getByText('Noir'))
    fireEvent.click(screen.getByText('sceneDetail.regenerate'))
    expect(onUpdate).toHaveBeenCalledWith('scene_1', expect.objectContaining({ style_tag: 'Noir' }))
  })

  it('스타일 선택 후 재생성: onGenerate 에 편집 스냅샷(style_tag 포함)을 3번째 인자로 전달', () => {
    const { onGenerate } = renderModal()
    fireEvent.focus(screen.getByPlaceholderText('sceneDetail.styleSelect'))
    fireEvent.mouseDown(screen.getByText('Noir'))
    fireEvent.click(screen.getByText('sceneDetail.regenerate'))
    expect(onGenerate).toHaveBeenCalledWith('scene_1', undefined, expect.objectContaining({ style_tag: 'Noir' }))
  })
})
