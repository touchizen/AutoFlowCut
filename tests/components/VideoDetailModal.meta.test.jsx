/**
 * VideoDetailModal — 비디오 history 복원 시 메타 저장 회귀 방지
 *
 * 잡는 회귀:
 *   - history 항목에 metadata 가 붙어있어도 복원 시 activeVideo/activeVideoPath 만 갱신,
 *     seed/generatedAt/model 은 부모로 안 흘러감 → 저장 후 project.json 에
 *     이전 비디오의 stale seed/model 이 그대로 남는 케이스
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

const mockGetHistory = vi.fn()
const mockReadHistoryFile = vi.fn()
const mockRestoreFromHistory = vi.fn()

vi.mock('../../src/hooks/useFileSystem', () => ({
  fileSystemAPI: {
    getHistory: (...a) => mockGetHistory(...a),
    readHistoryFile: (...a) => mockReadHistoryFile(...a),
    restoreFromHistory: (...a) => mockRestoreFromHistory(...a)
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

import VideoDetailModal from '../../src/components/VideoDetailModal'

const baseVideo = {
  id: 't2v_1',
  prompt: 'epic battle',
  video: 'data:video/mp4;base64,old',
  videoPath: 'C:/workspace/proj/videos/t2v_1.mp4',
  videoSaveId: 't2v_1',
  status: 'complete',
  seed: 100,
  generatedAt: 1700000000000,
  model: 'veo_3_1_t2v_fast',
}

beforeEach(() => {
  vi.clearAllMocks()
  mockGetHistory.mockResolvedValue({ success: true, histories: [] })
})

describe('VideoDetailModal — history 복원 시 메타 저장', () => {
  it('history 항목의 metadata(seed/timestamp/model)가 저장 patch 에 포함됨', async () => {
    mockGetHistory.mockResolvedValue({
      success: true,
      histories: [{ filename: 't2v_1_20260101_flow.mp4', engine: 'flow' }]
    })
    mockReadHistoryFile.mockResolvedValue({
      success: true,
      data: 'data:video/mp4;base64,history',
      metadata: {
        seed: 8888,
        timestamp: 1500000000000,
        model: 'veo_3_0_t2v_fast',
        mediaId: 'history-media'
      }
    })
    mockRestoreFromHistory.mockResolvedValue({
      success: true,
      path: 'C:/workspace/proj/videos/t2v_1.mp4'
    })

    const onUpdate = vi.fn()
    render(
      <VideoDetailModal
        video={baseVideo}
        onClose={vi.fn()}
        t={(k) => k}
        projectName="proj"
        onUpdate={onUpdate}
      />
    )

    // history thumbnail 로드 대기
    await waitFor(() => {
      expect(document.querySelector('.history-item')).toBeInTheDocument()
    })

    // history 클릭 — restore 트리거
    fireEvent.click(document.querySelector('.history-item'))

    await waitFor(() => {
      expect(mockRestoreFromHistory).toHaveBeenCalled()
    })

    // 저장 — patch 에 메타 포함되어야 함
    const saveBtn = screen.getByText(/Save|actions\.save/i)
    fireEvent.click(saveBtn)

    expect(onUpdate).toHaveBeenCalledWith('t2v_1', expect.objectContaining({
      video: 'data:video/mp4;base64,history',
      seed: 8888,
      generatedAt: 1500000000000,
      model: 'veo_3_0_t2v_fast',
      mediaId: 'history-media',
    }))
  })

  it('복원 안 한 채로 저장하면 메타 patch 없음 (부모 권위 유지)', async () => {
    const onUpdate = vi.fn()
    render(
      <VideoDetailModal
        video={baseVideo}
        onClose={vi.fn()}
        t={(k) => k}
        projectName="proj"
        onUpdate={onUpdate}
      />
    )

    // dirty=false 라 Save 버튼 비활성 — 강제로 dirty 만들 수 없으니
    // 그냥 onUpdate 가 호출 안 됨 확인하는 방향으로 검증.
    // 실제 동작: history 복원 없이는 save 버튼 disabled.
    // (회귀 검증 목적: 복원 안 했으면 메타 갱신 patch 도 안 가야 함)
    const saveBtn = screen.getByText(/Save|actions\.save/i)
    expect(saveBtn).toBeDisabled()
    expect(onUpdate).not.toHaveBeenCalled()
  })

  it('복원한 history 의 메타가 빈 경우 patch 의 seed/model 은 null', async () => {
    mockGetHistory.mockResolvedValue({
      success: true,
      histories: [{ filename: 't2v_1_old.mp4', engine: 'flow' }]
    })
    mockReadHistoryFile.mockResolvedValue({
      success: true,
      data: 'data:video/mp4;base64,nometa',
      metadata: null
    })
    mockRestoreFromHistory.mockResolvedValue({
      success: true,
      path: 'C:/workspace/proj/videos/t2v_1.mp4'
    })

    const onUpdate = vi.fn()
    render(
      <VideoDetailModal
        video={baseVideo}
        onClose={vi.fn()}
        t={(k) => k}
        projectName="proj"
        onUpdate={onUpdate}
      />
    )

    await waitFor(() => {
      expect(document.querySelector('.history-item')).toBeInTheDocument()
    })

    fireEvent.click(document.querySelector('.history-item'))
    await waitFor(() => expect(mockRestoreFromHistory).toHaveBeenCalled())

    fireEvent.click(screen.getByText(/Save|actions\.save/i))

    const callArgs = onUpdate.mock.calls[0][1]
    // 복원했지만 메타 비어있으면 → null 명시 (stale seed=100 안 남기)
    expect(callArgs.seed).toBeNull()
    expect(callArgs.generatedAt).toBeNull()
    expect(callArgs.model).toBeNull()
  })
})
