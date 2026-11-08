import React, { useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'

const sceneFileMocks = vi.hoisted(() => ({ getHistory: vi.fn(() => new Promise(() => {})) }))

vi.mock('../../src/hooks/useFileSystem', () => ({
  fileSystemAPI: {
    getHistory: (...args) => sceneFileMocks.getHistory(...args),
    readHistoryFile: vi.fn(),
    restoreFromHistory: vi.fn(),
  },
}))
vi.mock('../../src/hooks/useI18n', () => ({
  useI18n: () => ({ t: (key) => key, lang: 'en', setLang: vi.fn() }),
  default: () => ({ t: (key) => key, lang: 'en', setLang: vi.fn() }),
}))
vi.mock('../../src/components/Toast', () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() } }))
vi.mock('../../src/components/ErrorSection', () => ({ default: () => null }))
vi.mock('../../src/components/PromptInput', () => ({ default: ({ value, onChange }) => (
  <textarea aria-label="prompt" value={value || ''} onChange={(event) => onChange?.(event.target.value)} />
) }))

import SceneDetailModal from '../../src/components/SceneDetailModal'
import GenerateMenu from '../../src/components/GenerateMenu'
import { __resetFlowSafetyForTests, receiveFlowSafetyStop } from '../../src/utils/flowSafetyStop'

const STOP = {
  success: false,
  safetyStop: true,
  retryBlocked: true,
  errorKind: 'flow-unusual-activity',
  reason: 'flow-unusual-activity',
}
const SCENE = {
  id: 'scene_1', prompt: 'a red apple', subtitle: '', duration: 3, startTime: 0,
  image: 'data:image/png;base64,old', imagePath: null, status: 'done', seed: 123, generatedAt: 1, model: 'test',
}
const BLOCKED_SCENE = {
  ...SCENE,
  flowSubmission: { id: 'submission-1', postClick: true, retryBlocked: true, reason: 'flow-unusual-activity' },
}
const COLLECTED_SCENE = {
  ...SCENE,
  flowSubmission: { id: 'submission-1', postClick: true, retryBlocked: false, reason: 'collected' },
}
const STOP_ALERT = 'errorSection.kind.flow-unusual-activity'

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal('electronAPI', { ...window.electronAPI, setModalVisible: vi.fn() })
})
afterEach(() => {
  __resetFlowSafetyForTests()
  vi.unstubAllGlobals()
})

function renderDetail(scene = SCENE, extra = {}) {
  const onGenerate = vi.fn()
  const onUpdate = vi.fn()
  const onClose = vi.fn()
  render(<SceneDetailModal
    scene={scene} appMode="flow" onGenerate={onGenerate} onUpdate={onUpdate} onClose={onClose}
    isGenerating={false} t={(key) => key} projectName="project" references={[]}
    {...extra}
  />)
  return { onGenerate, onUpdate, onClose }
}

function openForceDialog(props = {}) {
  const onForceRegenerate = vi.fn()
  render(<GenerateMenu onForceRegenerate={onForceRegenerate} appMode="flow" scenes={[SCENE]} {...props} />)
  fireEvent.click(screen.getByRole('button', { name: /actions\.moreGenerateOptions/ }))
  fireEvent.click(screen.getByRole('button', { name: /actions\.forceRegenerate/ }))
  return { onForceRegenerate }
}

describe('Flow regeneration safety feedback', () => {
  it('shows the live global stop in the detail modal and blocks its regenerate action', () => {
    const { onGenerate, onUpdate, onClose } = renderDetail()
    act(() => { receiveFlowSafetyStop(STOP) })

    expect(screen.getByRole('alert')).toHaveTextContent(STOP_ALERT)
    const button = screen.getByRole('button', { name: /sceneDetail\.regenerate/ })
    expect(button).toBeDisabled()
    fireEvent.click(button)
    expect(onGenerate).not.toHaveBeenCalled()
    expect(onUpdate).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
  })

  it('shows and blocks a persisted paid submission on a completed image scene', () => {
    const { onGenerate, onClose } = renderDetail(BLOCKED_SCENE)
    expect(screen.getByRole('alert')).toHaveTextContent('results.imageRegenerationBlocked')
    const button = screen.getByRole('button', { name: /sceneDetail\.regenerate/ })
    expect(button).toBeDisabled()
    fireEvent.click(button)
    expect(onGenerate).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
  })

  it('allows an explicitly collected Flow submission to regenerate and closes before dispatch', () => {
    const setModalVisible = window.electronAPI.setModalVisible
    const onGenerate = vi.fn(() => setModalVisible.mock.lastCall?.[0])
    function Harness() {
      const [visible, setVisible] = useState(true)
      return visible
        ? <SceneDetailModal scene={COLLECTED_SCENE} appMode="flow" onGenerate={onGenerate}
            onClose={() => setVisible(false)} t={key => key} projectName="project" />
        : <output data-testid="modal-state">closed</output>
    }
    render(<Harness />)
    expect(setModalVisible).toHaveBeenLastCalledWith({ visible: true })
    fireEvent.click(screen.getByRole('button', { name: /sceneDetail\.regenerate/ }))
    expect(onGenerate).toHaveReturnedWith({ visible: false })
    expect(screen.getByTestId('modal-state')).toHaveTextContent('closed')
  })

  it('keeps API-mode detail regeneration available while a Flow stop is latched', () => {
    const onGenerate = vi.fn()
    renderDetail(SCENE, { appMode: 'api', onGenerate })
    act(() => { receiveFlowSafetyStop(STOP) })

    const button = screen.getByRole('button', { name: /sceneDetail\.regenerate/ })
    expect(screen.queryByRole('alert')).toBeNull()
    expect(button).toBeEnabled()
    fireEvent.click(button)
    expect(onGenerate).toHaveBeenCalledTimes(1)
  })

  it('shows the live global stop in the full-regeneration confirmation and blocks confirmation', () => {
    const { onForceRegenerate } = openForceDialog()
    act(() => { receiveFlowSafetyStop(STOP) })

    expect(screen.getByRole('alert')).toHaveTextContent(STOP_ALERT)
    const confirm = screen.getByRole('button', { name: /actions\.forceRegenerate/ })
    expect(confirm).toBeDisabled()
    fireEvent.click(confirm)
    expect(onForceRegenerate).not.toHaveBeenCalled()
  })

  it('blocks full regeneration when a completed scene has a persisted unresolved submission', () => {
    const { onForceRegenerate } = openForceDialog({ scenes: [BLOCKED_SCENE] })
    expect(screen.getByRole('alert')).toHaveTextContent('results.imageRegenerationBlocked')
    const confirm = screen.getByRole('button', { name: /actions\.forceRegenerate/ })
    expect(confirm).toBeDisabled()
    fireEvent.click(confirm)
    expect(onForceRegenerate).not.toHaveBeenCalled()
  })

  it('allows full regeneration for collected Flow scenes and closes the confirm before dispatch', () => {
    const setModalVisible = window.electronAPI.setModalVisible
    const onForceRegenerate = vi.fn(() => setModalVisible.mock.lastCall?.[0])
    openForceDialog({ scenes: [COLLECTED_SCENE], onForceRegenerate })
    expect(setModalVisible).toHaveBeenLastCalledWith({ visible: true })
    fireEvent.click(screen.getByRole('button', { name: /actions\.forceRegenerate/ }))
    expect(onForceRegenerate).toHaveReturnedWith({ visible: false })
  })

  it('keeps API-mode full regeneration available while a Flow stop is latched', () => {
    const onForceRegenerate = vi.fn()
    render(<GenerateMenu appMode="api" scenes={[SCENE]} onForceRegenerate={onForceRegenerate} />)
    act(() => { receiveFlowSafetyStop(STOP) })
    fireEvent.click(screen.getByRole('button', { name: /actions\.moreGenerateOptions/ }))
    fireEvent.click(screen.getByRole('button', { name: /actions\.forceRegenerate/ }))
    const confirm = screen.getByRole('button', { name: /actions\.forceRegenerate/ })
    expect(screen.queryByRole('alert')).toBeNull()
    expect(confirm).toBeEnabled()
    fireEvent.click(confirm)
    expect(onForceRegenerate).toHaveBeenCalledTimes(1)
  })
})
