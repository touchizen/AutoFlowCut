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

describe('분산 whole-batch Upscayl 트리거 제거', () => {
  const item = { id: 'scene_1', status: 'done', prompt: 'test', imagePath: '/scene.png' }

  it.each(['table', 'grid'])('ResultsTable %s 레이아웃에 Upscale 툴바가 없다', (layout) => {
    wrap(<ResultsTable items={[item]} mediaType="image" layout={layout} onUpscaleClick={vi.fn()} />)
    expect(screen.queryByRole('button', { name: 'Upscale' })).not.toBeInTheDocument()
  })

  it('AudioTimeline 툴바에 Upscale 버튼이 없다', () => {
    wrap(<AudioTimeline audioPackage={null} scenes={[]} srtEntries={[]} onUpscaleClick={vi.fn()} />)
    expect(screen.queryByRole('button', { name: 'Upscale' })).not.toBeInTheDocument()
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
