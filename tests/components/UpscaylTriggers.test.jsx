import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { I18nProvider } from '../../src/hooks/useI18n.jsx'

const mockGetHistory = vi.hoisted(() => vi.fn())
const mockContext = vi.hoisted(() => ({
  settings: { kenBurnsPreview: true },
  updateSetting: vi.fn(),
}))

vi.mock('../../src/hooks/useFileSystem', () => ({
  fileSystemAPI: {
    getHistory: (...args) => mockGetHistory(...args),
    readHistoryFile: vi.fn(),
    restoreFromHistory: vi.fn(),
  },
}))
vi.mock('../../src/contexts/ExportSettingsContext', () => ({
  useExportSettingsContext: () => mockContext,
}))
vi.mock('../../src/components/Toast', () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() },
}))
vi.mock('../../src/components/Modal', () => ({
  default: ({ children, footer }) => <div data-testid="modal">{children}{footer}</div>,
}))
vi.mock('../../src/components/ErrorSection', () => ({ default: () => null }))

import AudioTimeline from '../../src/components/AudioTimeline/AudioTimeline.jsx'
import ResultsTable from '../../src/components/ResultsTable.jsx'
import SceneDetailModal from '../../src/components/SceneDetailModal.jsx'

const wrap = (ui) => render(<I18nProvider>{ui}</I18nProvider>)

beforeEach(() => {
  mockGetHistory.mockResolvedValue({ success: true, histories: [] })
})

describe('ResultsTable Upscayl 트리거', () => {
  const item = { id: 'scene_1', status: 'done', prompt: 'test', imagePath: '/scene.png' }

  it.each(['table', 'grid'])('%s 레이아웃의 이미지 공용 툴바에서 콜백을 호출한다', (layout) => {
    const onUpscaleClick = vi.fn()
    wrap(<ResultsTable items={[item]} mediaType="image" layout={layout} onUpscaleClick={onUpscaleClick} />)

    fireEvent.click(screen.getByRole('button', { name: 'Upscale' }))
    expect(onUpscaleClick).toHaveBeenCalledWith()
  })

  it('image가 아닌 인스턴스에는 콜백을 받아도 툴바를 노출하지 않는다', () => {
    wrap(<ResultsTable items={[item]} mediaType="video" onUpscaleClick={vi.fn()} />)
    expect(screen.queryByRole('button', { name: 'Upscale' })).not.toBeInTheDocument()
  })
})

describe('AudioTimeline Upscayl 트리거', () => {
  it('Ken Burns 옆 Upscale 버튼을 콜백에 연결한다', () => {
    const onUpscaleClick = vi.fn()
    const { container } = wrap(
      <AudioTimeline audioPackage={null} scenes={[]} srtEntries={[]} onUpscaleClick={onUpscaleClick} />,
    )

    const button = screen.getByRole('button', { name: 'Upscale' })
    expect(container.querySelector('.atl-kb-toggle').nextElementSibling).toBe(button)
    fireEvent.click(button)
    expect(onUpscaleClick).toHaveBeenCalledWith()
  })
})

describe('SceneDetailModal Upscayl 트리거', () => {
  it('upscaledAt을 표시하고 모달을 먼저 닫은 뒤 해당 scene id로 연다', () => {
    const onClose = vi.fn()
    const onUpscaleClick = vi.fn()
    const t = (key, params = {}) => ({
      'sceneDetail.upscale': 'Upscale',
      'sceneDetail.upscaledAt': `Upscaled: ${params.date}`,
      'sceneDetail.cancel': 'Cancel',
      'sceneDetail.save': 'Save',
    }[key] || key)

    render(
      <I18nProvider>
        <SceneDetailModal
          scene={{
            id: 'scene_1',
            status: 'done',
            prompt: 'test',
            imagePath: '/scene.png',
            upscaledAt: 1700000000000,
          }}
          onUpdate={vi.fn()}
          onClose={onClose}
          onUpscaleClick={onUpscaleClick}
          t={t}
          projectName="project"
        />
      </I18nProvider>,
    )

    expect(screen.getByText(/Upscaled:/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Upscale' }))

    expect(onClose).toHaveBeenCalledTimes(1)
    expect(onUpscaleClick).toHaveBeenCalledWith(['scene_1'])
    expect(onClose.mock.invocationCallOrder[0]).toBeLessThan(onUpscaleClick.mock.invocationCallOrder[0])
  })
})
