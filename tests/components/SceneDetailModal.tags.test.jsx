/**
 * SceneDetailModal — 태그 입력이 TagInputAutocomplete 콤보로 동작하는지 검증
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

const mockGetHistory = vi.fn()
vi.mock('../../src/hooks/useFileSystem', () => ({
  fileSystemAPI: {
    getHistory: (...a) => mockGetHistory(...a),
    readHistoryFile: vi.fn(),
    restoreFromHistory: vi.fn(),
  }
}))
vi.mock('../../src/hooks/useI18n', () => ({
  default: () => ({ t: (k) => k, lang: 'en', setLang: vi.fn() }),
  useI18n: () => ({ t: (k) => k, lang: 'en', setLang: vi.fn() })
}))
vi.mock('../../src/components/Toast', () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() }
}))
vi.mock('../../src/components/Modal', () => ({
  default: ({ children, footer }) => (
    <div data-testid="modal">{children}<div data-testid="footer">{footer}</div></div>
  )
}))
vi.mock('../../src/components/ErrorSection', () => ({ default: () => null }))

import SceneDetailModal from '../../src/components/SceneDetailModal'

const baseScene = {
  id: 'scene_1',
  prompt: 'a sunset',
  subtitle: '',
  duration: 3,
  startTime: 0,
  image: 'data:image/png;base64,old',
  imagePath: null,
  status: 'done',
  characters: '',
  scene_tag: '',
  style_tag: '',
}

const references = [
  { id: 1, type: 'character', name: 'Hero' },
  { id: 2, type: 'character', name: 'Villain' },
  { id: 3, type: 'scene', name: 'Forest' },
  { id: 4, type: 'style', name: 'Noir' },
]

beforeEach(() => {
  vi.clearAllMocks()
  mockGetHistory.mockResolvedValue({ success: true, histories: [] })
})

function renderModal(extra = {}) {
  const onUpdate = vi.fn()
  render(
    <SceneDetailModal
      scene={baseScene}
      references={references}
      styleThumbnails={{}}
      onUpdate={onUpdate}
      onClose={vi.fn()}
      t={(k) => k}
      projectName="proj"
      aspectRatio="9:16"
      {...extra}
    />
  )
  return { onUpdate }
}

describe('SceneDetailModal — 태그 콤보', () => {
  it('캐릭터 칸이 자동완성 드롭다운으로 렌더되고 ref 옵션이 보인다', () => {
    renderModal()
    fireEvent.focus(screen.getByPlaceholderText('sceneDetail.characterPlaceholder'))
    expect(screen.getByText('Hero')).toBeInTheDocument()
    expect(screen.getByText('Villain')).toBeInTheDocument()
  })

  it('캐릭터를 드롭다운에서 선택하고 저장하면 onUpdate에 반영된다', () => {
    const { onUpdate } = renderModal()
    fireEvent.focus(screen.getByPlaceholderText('sceneDetail.characterPlaceholder'))
    fireEvent.mouseDown(screen.getByText('Hero'))
    fireEvent.click(screen.getByText('sceneDetail.save'))
    expect(onUpdate).toHaveBeenCalledWith('scene_1', expect.objectContaining({ characters: 'Hero' }))
  })

  it('캐릭터 멀티선택 — 두 캐릭터를 누적 선택할 수 있다', () => {
    const { onUpdate } = renderModal()
    fireEvent.focus(screen.getByPlaceholderText('sceneDetail.characterPlaceholder'))
    fireEvent.mouseDown(screen.getByText('Hero'))
    fireEvent.mouseDown(screen.getByText('Villain'))
    fireEvent.click(screen.getByText('sceneDetail.save'))
    expect(onUpdate).toHaveBeenCalledWith('scene_1', expect.objectContaining({ characters: 'Hero, Villain' }))
  })

  it('배경 선택 시 onUpdate에 scene_tag로 반영된다', () => {
    const { onUpdate } = renderModal()
    fireEvent.focus(screen.getByPlaceholderText('sceneDetail.backgroundPlaceholder'))
    fireEvent.mouseDown(screen.getByText('Forest'))
    fireEvent.click(screen.getByText('sceneDetail.save'))
    expect(onUpdate).toHaveBeenCalledWith('scene_1', expect.objectContaining({ scene_tag: 'Forest' }))
  })

  it('스타일 선택 시 onUpdate에 style_tag로 반영된다', () => {
    const { onUpdate } = renderModal()
    fireEvent.focus(screen.getByPlaceholderText('sceneDetail.styleSelect'))
    fireEvent.mouseDown(screen.getByText('Noir'))
    fireEvent.click(screen.getByText('sceneDetail.save'))
    expect(onUpdate).toHaveBeenCalledWith('scene_1', expect.objectContaining({ style_tag: 'Noir' }))
  })
})
