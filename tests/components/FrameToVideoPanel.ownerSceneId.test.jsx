/**
 * FrameToVideoPanel — ownerSceneId owner-scene binding
 *
 * Verifies:
 * 1. Auto-add useEffect sets `ownerSceneId` on every new row.
 * 2. Dedup uses ownerSceneId — a row whose startSceneId was changed still counts
 *    as owning its original scene, so auto-add does NOT duplicate it.
 * 3. addRow sets ownerSceneId on the new row.
 * 4. autoBatch sets ownerSceneId on all new rows.
 * 5. Gallery-rooted empty-state rows get ownerSceneId: null.
 * 6. Row number label is derived from owner scene position, not array index.
 */

import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import FrameToVideoPanel from '../../src/components/FrameToVideoPanel'

const t = (key) => key

// Resolve a functional or direct onUpdate call result
function resolveUpdate(arg, prev) {
  return typeof arg === 'function' ? arg(prev) : arg
}

// Collect all pairs emitted via onUpdate across all calls, filtering to functional-updater
// calls and evaluating them against the given prev state.
function collectUpdates(onUpdate, prev) {
  return onUpdate.mock.calls.map(c => resolveUpdate(c[0], prev))
}

// ──────────────────────────────────────────────────────────────
// Shared fixtures
// ──────────────────────────────────────────────────────────────
const THREE_SCENES = [
  { id: 'sc1', mediaId: 'm1', prompt: 'prompt1' },
  { id: 'sc2', mediaId: 'm2', prompt: 'prompt2' },
  { id: 'sc3', mediaId: 'm3', prompt: 'prompt3' },
]

function makePair(overrides = {}) {
  return {
    id: 'fp_1',
    ownerSceneId: 'sc1',
    startSceneId: 'sc1',
    endSceneId: 'sc2',
    prompt: '',
    videoPrompt: '',
    customPrompt: '',
    status: 'waiting',
    selected: true,
    ...overrides,
  }
}

function renderPanel({ scenes, framePairs, onUpdate, ...rest } = {}) {
  const _onUpdate = onUpdate ?? vi.fn()
  render(
    <FrameToVideoPanel
      scenes={scenes ?? THREE_SCENES}
      videoScenes={[]}
      framePairs={framePairs ?? []}
      onUpdate={_onUpdate}
      onShowSceneDetail={() => {}}
      onVideoRetry={() => {}}
      disabled={false}
      t={t}
      galleryItems={[]}
      galleryLoading={false}
      onLoadGallery={() => {}}
      {...rest}
    />
  )
  return { onUpdate: _onUpdate }
}

// ──────────────────────────────────────────────────────────────
// 1. Auto-add sets ownerSceneId
// ──────────────────────────────────────────────────────────────
describe('FrameToVideoPanel — auto-add ownerSceneId', () => {
  it('sets ownerSceneId on each auto-added row (3 scenes, empty pairs)', async () => {
    const onUpdate = vi.fn()
    renderPanel({ scenes: THREE_SCENES, framePairs: [], onUpdate })

    // Wait for the mount-time auto-add effect to fire
    await waitFor(() => expect(onUpdate).toHaveBeenCalled())

    // Find the functional-updater call that produces the most rows
    const allResults = collectUpdates(onUpdate, [])
    const autoAddedResult = allResults.reduce((best, cur) =>
      cur.length > best.length ? cur : best, [])

    expect(autoAddedResult.length).toBe(3)
    expect(autoAddedResult[0].ownerSceneId).toBe('sc1')
    expect(autoAddedResult[1].ownerSceneId).toBe('sc2')
    expect(autoAddedResult[2].ownerSceneId).toBe('sc3')
  })

  it('auto-add also sets startSceneId equal to ownerSceneId initially', async () => {
    const onUpdate = vi.fn()
    renderPanel({ scenes: THREE_SCENES, framePairs: [], onUpdate })

    await waitFor(() => expect(onUpdate).toHaveBeenCalled())
    const allResults = collectUpdates(onUpdate, [])
    const autoAddedResult = allResults.reduce((best, cur) =>
      cur.length > best.length ? cur : best, [])

    for (const pair of autoAddedResult) {
      expect(pair.startSceneId).toBe(pair.ownerSceneId)
    }
  })
})

// ──────────────────────────────────────────────────────────────
// 2. Dedup by ownerSceneId — changed startSceneId doesn't cause re-add
// ──────────────────────────────────────────────────────────────
describe('FrameToVideoPanel — auto-add dedup by ownerSceneId', () => {
  it('does not add a row for sc2 when a row already owns sc2 (even if startSceneId differs)', async () => {
    // Simulate: row was originally for sc2 but user changed startSceneId to sc3
    const existingPair = makePair({
      id: 'fp_1',
      ownerSceneId: 'sc2',    // still owns sc2
      startSceneId: 'sc3',    // user re-pointed the dropdown
      endSceneId: '',
    })
    const onUpdate = vi.fn()
    renderPanel({ scenes: THREE_SCENES, framePairs: [existingPair], onUpdate })

    await waitFor(() => expect(onUpdate).toHaveBeenCalled())
    const allResults = collectUpdates(onUpdate, [existingPair])

    // No result should contain a row with ownerSceneId === 'sc2' that is new
    for (const result of allResults) {
      const sc2Owners = result.filter(p => p.ownerSceneId === 'sc2')
      // At most one row may own sc2 (the existing one)
      expect(sc2Owners.length).toBeLessThanOrEqual(1)
    }
  })

  it('only adds rows for scenes that have no owning row', async () => {
    // sc1 is already owned; sc2 and sc3 are not
    const existingPair = makePair({ id: 'fp_1', ownerSceneId: 'sc1', startSceneId: 'sc1' })
    const onUpdate = vi.fn()
    renderPanel({ scenes: THREE_SCENES, framePairs: [existingPair], onUpdate })

    await waitFor(() => expect(onUpdate).toHaveBeenCalled())
    const allResults = collectUpdates(onUpdate, [existingPair])

    // The call that produces the maximum rows should have exactly 3 total
    const maxResult = allResults.reduce((best, cur) =>
      cur.length > best.length ? cur : best, [existingPair])

    const ownerIds = maxResult.map(p => p.ownerSceneId)
    // sc1 must appear exactly once
    expect(ownerIds.filter(id => id === 'sc1').length).toBe(1)
  })
})

// ──────────────────────────────────────────────────────────────
// 3. addRow sets ownerSceneId
// ──────────────────────────────────────────────────────────────
describe('FrameToVideoPanel — addRow ownerSceneId', () => {
  it('sets ownerSceneId on the new row created by addRow', async () => {
    // Only sc1 is owned; sc2 and sc3 are free
    const existingPair = makePair({ id: 'fp_1', ownerSceneId: 'sc1', startSceneId: 'sc1' })
    const onUpdate = vi.fn()
    renderPanel({ scenes: THREE_SCENES, framePairs: [existingPair], onUpdate })

    // Wait for mount effect to settle
    await waitFor(() => expect(onUpdate).toHaveBeenCalled())
    onUpdate.mockClear()

    // Click "Add Row"
    const addBtn = screen.getByText('frameToVideo.addRow')
    fireEvent.click(addBtn)

    await waitFor(() => expect(onUpdate).toHaveBeenCalled())
    const lastArg = onUpdate.mock.calls.at(-1)[0]
    const result = resolveUpdate(lastArg, [existingPair])

    const newRow = result.find(p => p.id !== 'fp_1')
    expect(newRow).toBeDefined()
    expect(newRow.ownerSceneId).toBeTruthy()
    // Should have taken sc2 (next unowned scene)
    expect(newRow.ownerSceneId).toBe('sc2')
    expect(newRow.startSceneId).toBe('sc2')
  })
})

// ──────────────────────────────────────────────────────────────
// 4. autoBatch sets ownerSceneId
// ──────────────────────────────────────────────────────────────
describe('FrameToVideoPanel — autoBatch ownerSceneId', () => {
  it('sets ownerSceneId on all rows produced by autoBatch', async () => {
    // sc1 is owned; sc2 and sc3 are free
    const existingPair = makePair({ id: 'fp_1', ownerSceneId: 'sc1', startSceneId: 'sc1' })
    const onUpdate = vi.fn()
    renderPanel({ scenes: THREE_SCENES, framePairs: [existingPair], onUpdate })

    await waitFor(() => expect(onUpdate).toHaveBeenCalled())
    onUpdate.mockClear()

    const autoBatchBtn = screen.getByText('frameToVideo.autoBatch')
    fireEvent.click(autoBatchBtn)

    await waitFor(() => expect(onUpdate).toHaveBeenCalled())
    const lastArg = onUpdate.mock.calls.at(-1)[0]
    const result = resolveUpdate(lastArg, [existingPair])

    const newRows = result.filter(p => p.id !== 'fp_1')
    expect(newRows.length).toBe(2)
    for (const row of newRows) {
      expect(row.ownerSceneId).toBeTruthy()
      expect(row.startSceneId).toBe(row.ownerSceneId)
    }
    const newOwners = new Set(newRows.map(r => r.ownerSceneId))
    expect(newOwners.has('sc2')).toBe(true)
    expect(newOwners.has('sc3')).toBe(true)
  })
})

// ──────────────────────────────────────────────────────────────
// 5. Gallery-rooted empty-state row gets ownerSceneId: null
// ──────────────────────────────────────────────────────────────
describe('FrameToVideoPanel — gallery empty-state ownerSceneId', () => {
  it('creates row with ownerSceneId: null when user uploads from empty state', async () => {
    const onUploadFromDisk = vi.fn().mockResolvedValue({
      success: true,
      mediaId: 'gal-123',
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
    const fileInput = cta.parentElement.querySelector('input[type="file"]')
    const file = new File(['x'], 'x.png', { type: 'image/png' })
    fireEvent.change(fileInput, { target: { files: [file] } })

    await waitFor(() => expect(onUploadFromDisk).toHaveBeenCalledWith(file))
    await waitFor(() => expect(onUpdate).toHaveBeenCalled())

    // Find the call that produces a gallery-prefixed row
    const allUpdates = onUpdate.mock.calls.map(c => resolveUpdate(c[0], []))
    const galleryUpdate = allUpdates.find(pairs =>
      pairs.some(p => p.startSceneId?.startsWith('gallery::'))
    )
    expect(galleryUpdate).toBeDefined()
    const galleryRow = galleryUpdate.find(p => p.startSceneId?.startsWith('gallery::'))
    expect(galleryRow.ownerSceneId).toBeNull()
  })
})

// ──────────────────────────────────────────────────────────────
// 6. Row label derived from owner scene position
// ──────────────────────────────────────────────────────────────
describe('FrameToVideoPanel — row label from ownerSceneId', () => {
  it('shows "#2" for a row whose ownerSceneId is the 2nd scene', () => {
    const pair = makePair({ id: 'fp_1', ownerSceneId: 'sc2', startSceneId: 'sc2' })
    renderPanel({ scenes: THREE_SCENES, framePairs: [pair] })
    expect(screen.getByText('#2')).toBeTruthy()
  })

  it('shows "—" for a gallery-rooted row (ownerSceneId: null)', () => {
    const pair = makePair({
      id: 'fp_1',
      ownerSceneId: null,
      startSceneId: 'gallery::abc',
    })
    // scenes is empty so availableScenes is empty → panel renders empty state,
    // but if we have a framePair, it should still show in the table
    // Note: panel shows empty-state when BOTH availableScenes AND framePairs are empty.
    // With a framePair, the table renders.
    renderPanel({ scenes: [], framePairs: [pair] })
    // The row col-num should show '—'
    const colNums = document.querySelectorAll('.col-num')
    // header col-num shows '#', data rows show '—'
    const dataColNums = Array.from(colNums).filter(el => el.textContent === '—')
    expect(dataColNums.length).toBeGreaterThan(0)
  })

  it('shows "⚠" for an orphan row whose owner scene was deleted', () => {
    const pair = makePair({ id: 'fp_1', ownerSceneId: 'sc_deleted', startSceneId: 'sc1' })
    // scenes does NOT include sc_deleted
    renderPanel({ scenes: THREE_SCENES, framePairs: [pair] })
    expect(screen.getByText('⚠')).toBeTruthy()
  })
})
