/**
 * VideoDetailModal — 재생성 버튼 (Part A, Task 2)
 *
 * 검증:
 *   1. onRegenerate prop 있으면 재생성 버튼 렌더
 *   2. 클릭 시 onRegenerate(video) 호출 + onClose() 호출
 *   3. onRegenerate prop 없으면 버튼 미렌더 (하위 호환)
 *   4. isGenerating=true 면 버튼 disabled
 *   5. isGenerating=false 면 버튼 enabled
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

const mockGetHistory = vi.fn()
const mockReadHistoryFile = vi.fn()

vi.mock('../../src/hooks/useFileSystem', () => ({
  fileSystemAPI: {
    getHistory: (...a) => mockGetHistory(...a),
    readHistoryFile: (...a) => mockReadHistoryFile(...a),
    restoreFromHistory: vi.fn(),
  }
}))

vi.mock('../../src/components/Toast', () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() }
}))

vi.mock('../../src/components/Modal', () => ({
  default: ({ children, footer }) => (
    <div data-testid="modal">
      {children}
      <div data-testid="footer">{footer}</div>
    </div>
  )
}))

vi.mock('../../src/components/ErrorSection', () => ({
  default: () => null
}))

vi.mock('../../src/components/PromptInput', () => ({ default: () => null }))

import VideoDetailModal from '../../src/components/VideoDetailModal'

const baseVideo = {
  id: 'vscene_1',
  prompt: 'epic battle',
  video: 'data:video/mp4;base64,abc',
  videoPath: '/proj/videos/t2v_1.mp4',
  videoSaveId: 't2v_1',
  status: 'complete',
  seed: 42,
  generatedAt: 1700000000000,
  model: 'veo_3_1_t2v_fast',
}

const t = (k) => k

beforeEach(() => {
  vi.clearAllMocks()
  mockGetHistory.mockResolvedValue({ success: true, histories: [] })
})

describe('VideoDetailModal — 재생성 버튼 렌더', () => {
  it('onRegenerate prop 있으면 재생성 버튼이 footer 에 렌더됨', () => {
    const onRegenerate = vi.fn()
    render(
      <VideoDetailModal
        video={baseVideo}
        onClose={vi.fn()}
        t={t}
        projectName="proj"
        onRegenerate={onRegenerate}
        isGenerating={false}
      />
    )
    expect(screen.getByRole('button', { name: /재생성|regenerate/i })).toBeInTheDocument()
  })

  it('onRegenerate prop 없으면 재생성 버튼이 렌더되지 않음 (하위 호환)', () => {
    render(
      <VideoDetailModal
        video={baseVideo}
        onClose={vi.fn()}
        t={t}
        projectName="proj"
      />
    )
    expect(screen.queryByRole('button', { name: /재생성|regenerate/i })).not.toBeInTheDocument()
  })
})

describe('VideoDetailModal — 재생성 버튼 클릭', () => {
  it('재생성 버튼 클릭 시 onRegenerate(video) 를 호출함', () => {
    const onRegenerate = vi.fn()
    const onClose = vi.fn()
    render(
      <VideoDetailModal
        video={baseVideo}
        onClose={onClose}
        t={t}
        projectName="proj"
        onRegenerate={onRegenerate}
        isGenerating={false}
      />
    )
    fireEvent.click(screen.getByRole('button', { name: /재생성|regenerate/i }))
    expect(onRegenerate).toHaveBeenCalledWith(baseVideo)
  })

  it('재생성 버튼 클릭 시 onClose() 도 호출됨 (모달 닫기)', () => {
    const onRegenerate = vi.fn()
    const onClose = vi.fn()
    render(
      <VideoDetailModal
        video={baseVideo}
        onClose={onClose}
        t={t}
        projectName="proj"
        onRegenerate={onRegenerate}
        isGenerating={false}
      />
    )
    fireEvent.click(screen.getByRole('button', { name: /재생성|regenerate/i }))
    expect(onClose).toHaveBeenCalled()
  })
})

describe('VideoDetailModal — isGenerating 상태', () => {
  it('isGenerating=true 면 재생성 버튼이 disabled', () => {
    render(
      <VideoDetailModal
        video={baseVideo}
        onClose={vi.fn()}
        t={t}
        projectName="proj"
        onRegenerate={vi.fn()}
        isGenerating={true}
      />
    )
    expect(screen.getByRole('button', { name: /재생성|생성 중|generating/i })).toBeDisabled()
  })

  it('isGenerating=false 면 재생성 버튼이 enabled', () => {
    render(
      <VideoDetailModal
        video={baseVideo}
        onClose={vi.fn()}
        t={t}
        projectName="proj"
        onRegenerate={vi.fn()}
        isGenerating={false}
      />
    )
    expect(screen.getByRole('button', { name: /재생성|regenerate/i })).not.toBeDisabled()
  })
})
