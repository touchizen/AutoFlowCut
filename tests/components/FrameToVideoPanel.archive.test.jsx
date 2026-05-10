/**
 * FrameToVideoPanel — Flow Archive 2단계 네비게이션
 *
 * 드롭다운에서:
 *   main → "📅 Browse Flow Archive" → dates 목록 (onListFlowProjects)
 *        → 날짜 클릭 → media 목록 (onFetchProjectGallery)
 *        → 이미지 클릭 → onChange('gallery::<mediaId>')
 */

import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import FrameToVideoPanel from '../../src/components/FrameToVideoPanel'

const t = (key) => key

const baseScenes = [
  { id: 's1', mediaId: 'media-1', prompt: 'p1' },
]

const basePair = {
  id: 'fp_1',
  startSceneId: 's1',
  endSceneId: '',
  prompt: '',
  videoPrompt: '',
  customPrompt: '',
  status: 'waiting',
  selected: true,
}

function renderPanel(overrides = {}) {
  const onUpdate = vi.fn()
  const onListFlowProjects = overrides.onListFlowProjects || vi.fn().mockResolvedValue({
    success: true,
    items: [
      { projectId: 'proj-A', title: 'Mar 11 - 14:53', creationTime: '2026-03-11T05:53:44Z' },
      { projectId: 'proj-B', title: 'Mar 11 - 14:39', creationTime: '2026-03-11T05:39:44Z' },
    ],
  })
  const onFetchProjectGallery = overrides.onFetchProjectGallery || vi.fn().mockResolvedValue({
    success: true,
    items: [
      { mediaId: 'm-1', url: 'data:img;a', displayName: 'one.png' },
      { mediaId: 'm-2', url: 'data:img;b', displayName: 'two.png' },
    ],
  })

  render(
    <FrameToVideoPanel
      scenes={baseScenes}
      videoScenes={[]}
      framePairs={[basePair]}
      onUpdate={onUpdate}
      onShowSceneDetail={() => {}}
      onVideoRetry={() => {}}
      disabled={false}
      t={t}
      galleryItems={[]}
      galleryLoading={false}
      onLoadGallery={() => {}}
      onUploadFromDisk={vi.fn()}
      onListFlowProjects={onListFlowProjects}
      onFetchProjectGallery={onFetchProjectGallery}
    />
  )
  return { onUpdate, onListFlowProjects, onFetchProjectGallery }
}

describe('FrameToVideoPanel — Flow Archive 2-stage navigation', () => {
  it('shows the Browse Flow Archive entry in the main view', () => {
    renderPanel()
    fireEvent.click(document.querySelectorAll('.scene-dropdown-trigger')[0])
    expect(screen.getAllByText(/Browse Flow Archive/i).length).toBeGreaterThan(0)
  })

  it('clicking Browse Flow Archive switches to dates view and lists projects', async () => {
    const { onListFlowProjects } = renderPanel()
    fireEvent.click(document.querySelectorAll('.scene-dropdown-trigger')[0])
    fireEvent.click(screen.getAllByText(/Browse Flow Archive/i)[0])

    await waitFor(() => expect(onListFlowProjects).toHaveBeenCalledTimes(1))
    await waitFor(() => {
      // Both project titles should now be present in the open dropdown
      expect(screen.getAllByText('Mar 11 - 14:53').length).toBeGreaterThan(0)
      expect(screen.getAllByText('Mar 11 - 14:39').length).toBeGreaterThan(0)
    })
  })

  it('picking a date fetches that project gallery and lists images', async () => {
    const { onFetchProjectGallery, onListFlowProjects } = renderPanel()
    fireEvent.click(document.querySelectorAll('.scene-dropdown-trigger')[0])
    fireEvent.click(screen.getAllByText(/Browse Flow Archive/i)[0])
    await waitFor(() => expect(onListFlowProjects).toHaveBeenCalled())

    fireEvent.click(screen.getAllByText('Mar 11 - 14:53')[0])
    await waitFor(() => expect(onFetchProjectGallery).toHaveBeenCalledWith('proj-A'))
    await waitFor(() => {
      expect(screen.getAllByText('one.png').length).toBeGreaterThan(0)
      expect(screen.getAllByText('two.png').length).toBeGreaterThan(0)
    })
  })

  it('selecting a media image sets gallery::<mediaId> on the pair and closes the dropdown', async () => {
    const { onUpdate, onFetchProjectGallery, onListFlowProjects } = renderPanel()
    fireEvent.click(document.querySelectorAll('.scene-dropdown-trigger')[0])
    fireEvent.click(screen.getAllByText(/Browse Flow Archive/i)[0])
    await waitFor(() => expect(onListFlowProjects).toHaveBeenCalled())
    fireEvent.click(screen.getAllByText('Mar 11 - 14:53')[0])
    await waitFor(() => expect(onFetchProjectGallery).toHaveBeenCalled())

    onUpdate.mockClear()
    fireEvent.click(screen.getAllByText('two.png')[0])

    await waitFor(() => expect(onUpdate).toHaveBeenCalled())
    const lastUpdate = onUpdate.mock.calls.at(-1)[0]
    const updatedPairs = typeof lastUpdate === 'function'
      ? lastUpdate([basePair])
      : lastUpdate
    expect(updatedPairs[0].startSceneId).toBe('gallery::m-2')

    // Dropdown should be closed (no media list visible anymore)
    await waitFor(() => {
      expect(screen.queryByText('one.png')).toBeNull()
    })
  })

  it('Back button returns from media view to dates view', async () => {
    const { onFetchProjectGallery, onListFlowProjects } = renderPanel()
    fireEvent.click(document.querySelectorAll('.scene-dropdown-trigger')[0])
    fireEvent.click(screen.getAllByText(/Browse Flow Archive/i)[0])
    await waitFor(() => expect(onListFlowProjects).toHaveBeenCalled())
    fireEvent.click(screen.getAllByText('Mar 11 - 14:53')[0])
    await waitFor(() => expect(onFetchProjectGallery).toHaveBeenCalled())

    // From media view, click "← <project title>" to go back to dates
    const backBtn = screen.getAllByText(/← Mar 11 - 14:53/)[0]
    fireEvent.click(backBtn)

    // Both date entries should be visible again, no more image labels
    await waitFor(() => {
      expect(screen.getAllByText('Mar 11 - 14:39').length).toBeGreaterThan(0)
      expect(screen.queryByText('one.png')).toBeNull()
    })
  })

  it('does not open archive flow when SceneSelect is disabled', async () => {
    const onListFlowProjects = vi.fn().mockResolvedValue({ success: true, items: [] })
    const onFetchProjectGallery = vi.fn()
    render(
      <FrameToVideoPanel
        scenes={baseScenes}
        videoScenes={[]}
        framePairs={[basePair]}
        onUpdate={vi.fn()}
        onShowSceneDetail={() => {}}
        onVideoRetry={() => {}}
        disabled={true}
        t={t}
        galleryItems={[]}
        galleryLoading={false}
        onLoadGallery={() => {}}
        onUploadFromDisk={vi.fn()}
        onListFlowProjects={onListFlowProjects}
        onFetchProjectGallery={onFetchProjectGallery}
      />
    )
    // disabled scene select should not open on click — but if anyone forces the menu open,
    // enterDatesView itself must skip work.
    fireEvent.click(document.querySelectorAll('.scene-dropdown-trigger')[0])
    const browseEntries = screen.queryAllByText(/Browse Flow Archive/i)
    if (browseEntries.length > 0) {
      fireEvent.click(browseEntries[0])
    }
    await new Promise(r => setTimeout(r, 10))
    expect(onListFlowProjects).not.toHaveBeenCalled()
    expect(onFetchProjectGallery).not.toHaveBeenCalled()
  })

  it('shows Browse Flow Archive in empty state and creates a pair from picked image', async () => {
    const onListFlowProjects = vi.fn().mockResolvedValue({
      success: true,
      items: [{ projectId: 'proj-X', title: 'Mar 11 - 14:53' }],
    })
    const onFetchProjectGallery = vi.fn().mockResolvedValue({
      success: true,
      items: [{ mediaId: 'mx-1', url: 'data:img;c', displayName: 'first.png' }],
    })
    const onUpdate = vi.fn()
    render(
      <FrameToVideoPanel
        scenes={[]}
        videoScenes={[]}
        framePairs={[]}
        onUpdate={onUpdate}
        onShowSceneDetail={() => {}}
        onVideoRetry={() => {}}
        disabled={false}
        t={t}
        galleryItems={[]}
        galleryLoading={false}
        onLoadGallery={() => {}}
        onUploadFromDisk={vi.fn()}
        onListFlowProjects={onListFlowProjects}
        onFetchProjectGallery={onFetchProjectGallery}
      />
    )

    fireEvent.click(screen.getByText(/Browse Flow Archive/i))
    await waitFor(() => expect(onListFlowProjects).toHaveBeenCalled())
    fireEvent.click(screen.getByText('Mar 11 - 14:53'))
    await waitFor(() => expect(onFetchProjectGallery).toHaveBeenCalledWith('proj-X'))

    const imgBtn = await screen.findByText('first.png')
    fireEvent.click(imgBtn)

    await waitFor(() => expect(onUpdate).toHaveBeenCalled())
    const pairs = onUpdate.mock.calls.at(-1)[0]
    expect(Array.isArray(pairs)).toBe(true)
    expect(pairs[0].startSceneId).toBe('gallery::mx-1')
  })

  it('empty state hides disk-upload button when onUploadFromDisk is not provided', async () => {
    const onListFlowProjects = vi.fn().mockResolvedValue({
      success: true,
      items: [{ projectId: 'p1', title: 'Mar 11 - 14:53' }],
    })
    render(
      <FrameToVideoPanel
        scenes={[]}
        videoScenes={[]}
        framePairs={[]}
        onUpdate={vi.fn()}
        onShowSceneDetail={() => {}}
        onVideoRetry={() => {}}
        disabled={false}
        t={t}
        galleryItems={[]}
        galleryLoading={false}
        onLoadGallery={() => {}}
        // intentionally no onUploadFromDisk
        onListFlowProjects={onListFlowProjects}
        onFetchProjectGallery={vi.fn().mockResolvedValue({ success: true, items: [] })}
      />
    )
    expect(screen.queryByText(/Upload image from disk/i)).toBeNull()
    expect(screen.getByText(/Browse Flow Archive/i)).toBeTruthy()
  })

  it('closing and reopening the dropdown resets to main view', async () => {
    const { onListFlowProjects } = renderPanel()
    const trigger = document.querySelectorAll('.scene-dropdown-trigger')[0]
    fireEvent.click(trigger)
    fireEvent.click(screen.getAllByText(/Browse Flow Archive/i)[0])
    await waitFor(() => expect(onListFlowProjects).toHaveBeenCalled())

    // Close dropdown by clicking outside
    fireEvent.mouseDown(document.body)
    // Reopen
    fireEvent.click(trigger)

    // Main-view markers should be present again, dates list should not
    expect(screen.getAllByText(/Browse Flow Archive/i).length).toBeGreaterThan(0)
    expect(screen.queryByText('Mar 11 - 14:53')).toBeNull()
  })
})
