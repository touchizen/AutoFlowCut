/**
 * SceneDetailModal — 메타 동기화 회귀 방지
 *
 * 잡는 회귀:
 *   1) 재생성 후 부모 scene 의 새 seed/generatedAt/model 이 editData 에 반영 안 되어
 *      모달에 stale 메타가 보이고 저장 시 새 값을 덮어쓰는 케이스
 *   2) history 복원 시 historyItem.metadata 가 무시되어 모달 + project.json 에
 *      잘못된 (직전 생성의) seed/model 이 남는 케이스
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

// fileSystemAPI 모킹
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

vi.mock('../../src/hooks/useI18n', () => ({
  default: () => ({ t: (k) => k, lang: 'en', setLang: vi.fn() }),
  useI18n: () => ({ t: (k) => k, lang: 'en', setLang: vi.fn() })
}))

// formatRelativeTime fallback 까지 그대로 가니 toast 모킹
vi.mock('../../src/components/Toast', () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() }
}))

// MediaMetaBar 가 toast 를 사용 — 위에서 잡힘.

// Modal 은 portal 사용 → 테스트 환경에서 portal target 이 없어도 createPortal 이
// 부모 트리에 mount 되도록 stub. 또는 그냥 children 렌더로 대체.
vi.mock('../../src/components/Modal', () => ({
  default: ({ children, footer }) => (
    <div data-testid="modal">
      {children}
      <div data-testid="footer">{footer}</div>
    </div>
  )
}))

// ErrorSection 도 단순화
vi.mock('../../src/components/ErrorSection', () => ({
  default: () => null
}))

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
  seed: 100,
  generatedAt: 1700000000000,
  model: 'flow',
  image_size: { width: 1024, height: 1024 },
  mediaId: 'old-media-id',
}

beforeEach(() => {
  vi.clearAllMocks()
  mockGetHistory.mockResolvedValue({ success: true, histories: [] })
})

describe('SceneDetailModal — 재생성 후 editData 동기화', () => {
  it('scene props 가 새 seed/generatedAt/model 로 갱신되면 editData 도 같이 갱신', async () => {
    const onUpdate = vi.fn()
    const onClose = vi.fn()
    const t = (k) => k

    const { rerender } = render(
      <SceneDetailModal
        scene={baseScene}
        onUpdate={onUpdate}
        onClose={onClose}
        t={t}
        projectName="proj"
        aspectRatio="9:16"
      />
    )

    // 초기엔 old seed
    await waitFor(() => {
      expect(screen.getByText(/100/)).toBeInTheDocument()
    })

    // 재생성 시뮬레이션 — 부모 가 새 메타로 props 갱신
    rerender(
      <SceneDetailModal
        scene={{
          ...baseScene,
          image: 'data:image/png;base64,new',
          seed: 999,
          generatedAt: 1700000099999,
          model: 'flow-v2',
        }}
        onUpdate={onUpdate}
        onClose={onClose}
        t={t}
        projectName="proj"
        aspectRatio="9:16"
      />
    )

    // 새 seed 가 즉시 반영되어야 함 (editData 에 동기화)
    await waitFor(() => {
      expect(screen.getByText(/999/)).toBeInTheDocument()
    })
    // 옛 seed 는 사라짐
    expect(screen.queryByText(/^100$/)).not.toBeInTheDocument()
  })

  it('재생성 후 저장 시 새 메타가 onUpdate 로 전달 (stale editData 가 덮어쓰지 않음)', async () => {
    const onUpdate = vi.fn()
    const t = (k) => k

    const { rerender } = render(
      <SceneDetailModal
        scene={baseScene}
        onUpdate={onUpdate}
        onClose={vi.fn()}
        t={t}
        projectName="proj"
      />
    )

    rerender(
      <SceneDetailModal
        scene={{
          ...baseScene,
          seed: 999,
          generatedAt: 1700000099999,
          model: 'flow-v2',
        }}
        onUpdate={onUpdate}
        onClose={vi.fn()}
        t={t}
        projectName="proj"
      />
    )

    // 동기화 끝날 때까지 대기
    await waitFor(() => {
      expect(screen.getByText(/999/)).toBeInTheDocument()
    })

    // 저장 클릭
    const saveBtn = screen.getByText('sceneDetail.save')
    fireEvent.click(saveBtn)

    expect(onUpdate).toHaveBeenCalledWith('scene_1', expect.objectContaining({
      seed: 999,
      generatedAt: 1700000099999,
      model: 'flow-v2',
    }))
  })
})

describe('SceneDetailModal — history 복원 시 메타 반영', () => {
  it('history 항목 클릭 시 metadata 의 seed/generatedAt/model 이 editData 에 들어감', async () => {
    // history 1건 + metadata 포함
    mockGetHistory.mockResolvedValue({
      success: true,
      histories: [{ filename: 'scene_1_20260101_flow.png', engine: 'flow' }]
    })
    mockReadHistoryFile.mockResolvedValue({
      success: true,
      data: 'data:image/png;base64,history',
      metadata: {
        seed: 7777,
        timestamp: 1600000000000,
        model: 'flow-old',
        mediaId: 'history-media-id'
      }
    })
    mockRestoreFromHistory.mockResolvedValue({ success: true, path: '/restored.png' })

    const onUpdate = vi.fn()
    const t = (k) => k

    render(
      <SceneDetailModal
        scene={baseScene}
        onUpdate={onUpdate}
        onClose={vi.fn()}
        t={t}
        projectName="proj"
      />
    )

    // history thumbnail 로드 대기
    await waitFor(() => {
      const histImg = document.querySelector('.history-item img')
      expect(histImg).toBeInTheDocument()
    })

    // history 항목 클릭
    fireEvent.click(document.querySelector('.history-item'))

    // 복원 + editData 갱신 대기
    await waitFor(() => {
      expect(mockRestoreFromHistory).toHaveBeenCalled()
    })

    // 저장하여 onUpdate 패치 확인
    fireEvent.click(screen.getByText('sceneDetail.save'))

    expect(onUpdate).toHaveBeenCalledWith('scene_1', expect.objectContaining({
      seed: 7777,
      generatedAt: 1600000000000,
      model: 'flow-old',
      mediaId: 'history-media-id',
    }))
  })

  it('history.metadata 가 비어있으면 seed/generatedAt/model 이 null 로 명시 (stale 값 유지 X)', async () => {
    mockGetHistory.mockResolvedValue({
      success: true,
      histories: [{ filename: 'scene_1.png', engine: 'flow' }]
    })
    // metadata 없음
    mockReadHistoryFile.mockResolvedValue({
      success: true,
      data: 'data:image/png;base64,nometa',
      metadata: null
    })
    mockRestoreFromHistory.mockResolvedValue({ success: true, path: '/x.png' })

    const onUpdate = vi.fn()
    render(
      <SceneDetailModal
        scene={baseScene}
        onUpdate={onUpdate}
        onClose={vi.fn()}
        t={(k) => k}
        projectName="proj"
      />
    )

    await waitFor(() => {
      expect(document.querySelector('.history-item')).toBeInTheDocument()
    })

    fireEvent.click(document.querySelector('.history-item'))
    await waitFor(() => expect(mockRestoreFromHistory).toHaveBeenCalled())

    fireEvent.click(screen.getByText('sceneDetail.save'))

    // 핵심: 저장 시 stale seed=100 이 아니라 null 로 가야 함
    const callArgs = onUpdate.mock.calls[0][1]
    expect(callArgs.seed).toBeNull()
    expect(callArgs.generatedAt).toBeNull()
    expect(callArgs.model).toBeNull()
  })
})
