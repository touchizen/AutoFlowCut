/**
 * SceneDetailModal — 생성/재생성 버튼 라벨과 침묵 방지
 *
 * 사용자 리포트: 이미지가 없던 씬의 상세 모달에 '재생성' 라벨이 뜨고, 눌러도 아무 피드백이
 * 없어 "생성이 안 된다"고 인지됨. 라벨은 이미지 유무로 갈리고(생성/재생성), 프롬프트가 없어
 * disabled 인 경우 그 이유가 tooltip 으로 보여야 한다.
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

const sceneNoImage = {
  id: 'scene_1', prompt: 'a sunset', subtitle: '', duration: 3, startTime: 0,
  image: null, imagePath: null, status: 'pending',
}
const sceneWithImage = { ...sceneNoImage, image: 'data:image/png;base64,x', status: 'done' }

beforeEach(() => {
  vi.clearAllMocks()
  mockGetHistory.mockResolvedValue({ success: true, histories: [] })
})

function renderModal(scene) {
  const onGenerate = vi.fn()
  render(
    <SceneDetailModal
      scene={scene}
      onUpdate={vi.fn()}
      onClose={vi.fn()}
      onGenerate={onGenerate}
      isGenerating={false}
      t={(k) => k}
      projectName="proj"
    />
  )
  return { onGenerate }
}

describe('SceneDetailModal — 생성/재생성 버튼', () => {
  it('sceneDetail.generate 키가 실제 ko/en locale 의 sceneDetail 블록에 존재한다 — 키 노출 회귀 방지', async () => {
    // 사용자가 실앱에서 raw key('sceneDetail.generate')를 봤던 회귀: 키를 엉뚱한 블록에 넣으면
    // 컴포넌트 테스트(t=(k)=>k)로는 절대 안 잡힌다 — 실제 locale 파일을 직접 검사한다.
    const { default: ko } = await import('../../src/locales/ko.js')
    const { default: en } = await import('../../src/locales/en.js')
    expect(typeof ko.sceneDetail?.generate).toBe('string')
    expect(typeof en.sceneDetail?.generate).toBe('string')
    expect(typeof ko.sceneDetail?.regenerate).toBe('string')
    expect(typeof en.sceneDetail?.regenerate).toBe('string')
  })

  it('이미지가 없는 씬은 버튼 라벨이 sceneDetail.generate(생성)', () => {
    renderModal(sceneNoImage)
    expect(screen.getByText('sceneDetail.generate')).toBeInTheDocument()
    expect(screen.queryByText('sceneDetail.regenerate')).not.toBeInTheDocument()
  })

  it('이미지가 있는 씬은 기존대로 sceneDetail.regenerate(재생성)', () => {
    renderModal(sceneWithImage)
    expect(screen.getByText('sceneDetail.regenerate')).toBeInTheDocument()
    expect(screen.queryByText('sceneDetail.generate')).not.toBeInTheDocument()
  })

  it('이미지 없는 씬에서 버튼 클릭 시 onGenerate 가 호출된다(생성 동작)', () => {
    const { onGenerate } = renderModal(sceneNoImage)
    fireEvent.click(screen.getByText('sceneDetail.generate'))
    expect(onGenerate).toHaveBeenCalledWith('scene_1', undefined, expect.objectContaining({ prompt: 'a sunset' }))
  })

  it('프롬프트가 비어 disabled 인 경우 이유가 title(tooltip)로 노출된다 — 침묵 방지', () => {
    renderModal({ ...sceneNoImage, prompt: '' })
    const btn = screen.getByText('sceneDetail.generate').closest('button')
    expect(btn).toBeDisabled()
    expect(btn).toHaveAttribute('title', 'toast.noPrompt')
  })
})
