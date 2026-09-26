import { fireEvent, render } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { I18nProvider } from '../../src/hooks/useI18n.jsx'

const captured = vi.hoisted(() => ({ timeline: [], modal: [] }))

vi.mock('../../src/components/AudioTimeline/AudioTimeline', () => ({
  default: (props) => {
    captured.timeline.push(props)
    return <div data-testid="audio-timeline" />
  },
}))
vi.mock('../../src/components/SceneDetailModal', () => ({
  default: (props) => {
    captured.modal.push(props)
    return <div data-testid="scene-detail-modal" />
  },
}))
vi.mock('../../src/components/VideoDetailModal', () => ({ default: () => null }))
vi.mock('../../src/components/TagBatchModal', () => ({ default: () => null }))

import AudioPanel from '../../src/components/AudioPanel.jsx'
import LiveTimeline from '../../src/components/LiveTimeline.jsx'
import SceneList from '../../src/components/SceneList.jsx'

const wrap = (ui) => render(<I18nProvider>{ui}</I18nProvider>)

beforeEach(() => {
  captured.timeline.length = 0
  captured.modal.length = 0
})

describe('Upscayl 트리거 passthrough', () => {
  it('LiveTimeline은 제거된 whole-batch 콜백을 AudioTimeline에 전달하지 않는다', () => {
    const onUpscaleClick = vi.fn()
    wrap(<LiveTimeline scenes={[]} srtEntries={[]} audioPackage={null} onUpscaleClick={onUpscaleClick} />)
    expect(captured.timeline.at(-1)).not.toHaveProperty('onUpscaleClick')
  })

  it('AudioPanel은 제거된 whole-batch 콜백을 AudioTimeline에 전달하지 않는다', () => {
    const onUpscaleClick = vi.fn()
    wrap(
      <AudioPanel
        audioPackage={null}
        scenes={[]}
        srtEntries={[]}
        onUpscaleClick={onUpscaleClick}
      />,
    )
    expect(captured.timeline.at(-1)).not.toHaveProperty('onUpscaleClick')
  })

  it('SceneList가 내부 SceneDetailModal에 onUpscaleClick을 전달한다', () => {
    const onUpscaleClick = vi.fn()
    const view = wrap(
      <SceneList
        scenes={[{
          id: 'scene_1',
          status: 'done',
          prompt: 'test',
          subtitle: '',
          duration: 3,
          imagePath: '/scene.png',
        }]}
        onUpdate={vi.fn()}
        onDelete={vi.fn()}
        onAdd={vi.fn()}
        defaultDuration={3}
        projectName="project"
        onUpscaleClick={onUpscaleClick}
      />,
    )

    fireEvent.click(view.container.querySelector('.media-thumb'))
    expect(captured.modal.at(-1).onUpscaleClick).toBe(onUpscaleClick)
  })
})
