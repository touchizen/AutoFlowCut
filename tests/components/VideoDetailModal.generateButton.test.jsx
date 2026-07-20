/**
 * VideoDetailModal — 생성/재생성 버튼 라벨 (SceneDetailModal 과 동일 규칙)
 * 비디오가 아직 없는 항목은 '재생성'이 아니라 '생성' 라벨이어야 한다.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'

vi.mock('../../src/hooks/useFileSystem', () => ({
  fileSystemAPI: {
    getHistory: vi.fn().mockResolvedValue({ success: true, histories: [] }),
    readHistoryFile: vi.fn(),
    restoreFromHistory: vi.fn(),
  }
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
vi.mock('../../src/components/MediaMetaBar', () => ({ default: () => null }))
vi.mock('../../src/components/PromptInput', () => ({ default: () => null }))
vi.mock('../../src/utils/mediaMeta', () => ({
  fetchLatestHistoryMeta: vi.fn().mockResolvedValue(null),
  estimateBase64FileSize: vi.fn(() => 0),
}))
vi.mock('../../src/utils/videoSrc', () => ({
  resolveVideoSrc: vi.fn(() => null),
  ensureBase64DataUrl: vi.fn((v) => v),
}))

import VideoDetailModal from '../../src/components/VideoDetailModal'

const baseVideo = { id: 't2v_1', prompt: 'a video prompt', video: null, videoPath: null }

beforeEach(() => vi.clearAllMocks())

function renderModal(video) {
  render(
    <VideoDetailModal
      video={video}
      onClose={vi.fn()}
      onRegenerate={vi.fn()}
      isGenerating={false}
      t={(k) => k}
      projectName="proj"
    />
  )
}

describe('VideoDetailModal — 생성/재생성 라벨', () => {
  it('비디오가 없는 항목은 sceneDetail.generate(생성)', () => {
    renderModal(baseVideo)
    expect(screen.getByText('sceneDetail.generate')).toBeInTheDocument()
    expect(screen.queryByText('sceneDetail.regenerate')).not.toBeInTheDocument()
  })

  it('비디오가 있는 항목은 sceneDetail.regenerate(재생성)', () => {
    renderModal({ ...baseVideo, videoPath: '/v.mp4' })
    expect(screen.getByText('sceneDetail.regenerate')).toBeInTheDocument()
  })
})
