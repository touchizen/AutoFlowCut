/**
 * FrameToVideoPanel — Upload from disk
 *
 * 로컬 파일을 선택하면 onUploadFromDisk가 호출되고,
 * 성공 시 framePair의 startSceneId가 'gallery::<mediaId>'로 업데이트되는지 검증.
 */

import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import FrameToVideoPanel from '../../src/components/FrameToVideoPanel'

const t = (key) => key

const baseScenes = [
  { id: 's1', mediaId: 'media-1', prompt: 'p1' },
  { id: 's2', mediaId: 'media-2', prompt: 'p2' },
]

const basePair = {
  id: 'fp_1',
  startSceneId: 's1',
  endSceneId: 's2',
  prompt: '',
  videoPrompt: '',
  customPrompt: '',
  status: 'waiting',
  selected: true,
}

function renderPanel(overrides = {}) {
  const onUpdate = vi.fn()
  const onUploadFromDisk = overrides.onUploadFromDisk || vi.fn()
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
      onUploadFromDisk={onUploadFromDisk}
    />
  )
  return { onUpdate, onUploadFromDisk }
}

describe('FrameToVideoPanel — Upload from disk', () => {
  it('renders the upload-from-disk option in the dropdown', () => {
    renderPanel()
    // Open the first SceneSelect (Start Image dropdown)
    const triggers = document.querySelectorAll('.scene-dropdown-trigger')
    expect(triggers.length).toBeGreaterThan(0)
    fireEvent.click(triggers[0])
    expect(screen.getAllByText(/Upload from disk/i).length).toBeGreaterThan(0)
  })

  it('calls onUploadFromDisk and updates pair value on successful upload', async () => {
    const onUploadFromDisk = vi.fn().mockResolvedValue({
      success: true,
      mediaId: 'uploaded-xyz',
      url: 'data:image/png;base64,AAA',
    })
    const { onUpdate } = renderPanel({ onUploadFromDisk })

    const triggers = document.querySelectorAll('.scene-dropdown-trigger')
    fireEvent.click(triggers[0])

    const uploadBtn = screen.getAllByText(/Upload from disk/i)[0].closest('.gallery-upload-btn')
    expect(uploadBtn).toBeTruthy()

    const fileInput = uploadBtn.querySelector('input[type="file"]')
    expect(fileInput).toBeTruthy()

    const file = new File(['hello'], 'pic.png', { type: 'image/png' })
    fireEvent.change(fileInput, { target: { files: [file] } })

    await waitFor(() => expect(onUploadFromDisk).toHaveBeenCalledWith(file))
    await waitFor(() => expect(onUpdate).toHaveBeenCalled())

    const lastUpdate = onUpdate.mock.calls.at(-1)[0]
    const updatedPairs = typeof lastUpdate === 'function'
      ? lastUpdate([basePair])
      : lastUpdate
    expect(updatedPairs[0].startSceneId).toBe('gallery::uploaded-xyz')
  })

  it('shows upload CTA in empty state and creates a gallery-prefixed pair on success', async () => {
    const onUploadFromDisk = vi.fn().mockResolvedValue({
      success: true,
      mediaId: 'fresh-1',
      url: 'data:image/png;base64,AAA',
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
        onUploadFromDisk={onUploadFromDisk}
      />
    )

    const cta = screen.getByText(/Upload image from disk/i)
    expect(cta).toBeTruthy()

    const fileInput = cta.parentElement.querySelector('input[type="file"]')
    const file = new File(['x'], 'x.png', { type: 'image/png' })
    fireEvent.change(fileInput, { target: { files: [file] } })

    await waitFor(() => expect(onUploadFromDisk).toHaveBeenCalledWith(file))
    await waitFor(() => expect(onUpdate).toHaveBeenCalled())

    const pairs = onUpdate.mock.calls.at(-1)[0]
    expect(Array.isArray(pairs)).toBe(true)
    expect(pairs).toHaveLength(1)
    expect(pairs[0].startSceneId).toBe('gallery::fresh-1')
  })

  it('does not upload from empty-state CTA when disabled', async () => {
    const onUploadFromDisk = vi.fn().mockResolvedValue({ success: true, mediaId: 'm' })
    const onUpdate = vi.fn()
    render(
      <FrameToVideoPanel
        scenes={[]}
        videoScenes={[]}
        framePairs={[]}
        onUpdate={onUpdate}
        onShowSceneDetail={() => {}}
        onVideoRetry={() => {}}
        disabled={true}
        t={t}
        galleryItems={[]}
        galleryLoading={false}
        onLoadGallery={() => {}}
        onUploadFromDisk={onUploadFromDisk}
      />
    )
    const btn = screen.getByText(/Upload image from disk/i).closest('button')
    expect(btn.disabled).toBe(true)

    // Mount-time effects may call onUpdate (auto-fill / id reassignment guard); we only care
    // that the disabled gate prevents the upload work itself from happening.
    onUpdate.mockClear()

    // Even if the file input is dispatched directly, disabled gate must skip work
    const fileInput = btn.parentElement.querySelector('input[type="file"]')
    const file = new File(['x'], 'x.png', { type: 'image/png' })
    fireEvent.change(fileInput, { target: { files: [file] } })

    // Allow any async no-op to settle
    await new Promise(r => setTimeout(r, 10))
    expect(onUploadFromDisk).not.toHaveBeenCalled()
    // No gallery::-prefixed pair should appear from this disabled flow
    for (const u of onUpdate.mock.calls) {
      const arg = u[0]
      const pairs = typeof arg === 'function' ? arg([]) : arg
      for (const p of pairs || []) {
        expect(p.startSceneId || '').not.toMatch(/^gallery::/)
      }
    }
  })

  it('does not update pair value when upload fails', async () => {
    const onUploadFromDisk = vi.fn().mockResolvedValue({ success: false, error: 'nope' })
    const { onUpdate } = renderPanel({ onUploadFromDisk })

    const triggers = document.querySelectorAll('.scene-dropdown-trigger')
    fireEvent.click(triggers[0])

    const uploadBtn = screen.getAllByText(/Upload from disk/i)[0].closest('.gallery-upload-btn')
    const fileInput = uploadBtn.querySelector('input[type="file"]')
    const file = new File(['x'], 'pic.png', { type: 'image/png' })
    fireEvent.change(fileInput, { target: { files: [file] } })

    await waitFor(() => expect(onUploadFromDisk).toHaveBeenCalled())
    // No update should propagate from upload-failure path. Allow any unrelated effect-driven
    // updates to settle, but verify none of them set a gallery:: value on this pair.
    const allUpdates = onUpdate.mock.calls.map(c => c[0])
    for (const u of allUpdates) {
      const pairs = typeof u === 'function' ? u([basePair]) : u
      expect(pairs[0].startSceneId).not.toMatch(/^gallery::/)
    }
  })
})
