/**
 * ReferencePanel.handleUpdateRef — functional id-patch, no stale-array clobber (#R27-3).
 *
 * Manual reference upload calls onUpdate(index, updatedRef) AFTER an async upload/save. If the
 * user switched projects during that window, the old handler sent the entire stale `references`
 * array to setReferences → wholesale replacement of the current project's refs. The fix sends a
 * functional updater that patches the CURRENT state by stable id, and no-ops when that id isn't
 * in the (switched-to) current array.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render } from '@testing-library/react'

vi.mock('../../src/hooks/useI18n', () => ({
  default: () => ({ t: (k) => k, lang: 'en', setLang: vi.fn() }),
  useI18n: () => ({ t: (k) => k, lang: 'en', setLang: vi.fn() }),
}))
vi.mock('../../src/hooks/useElapsedTimer', () => ({ useElapsedTimer: () => 0 }))
vi.mock('../../src/hooks/useModalVisibility', () => ({ useModalVisibility: () => {} }))
vi.mock('../../src/components/Toast', () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() },
}))
vi.mock('../../src/components/ReferenceDetailModal', () => ({ default: () => null }))
vi.mock('../../src/components/StylePicker', () => ({ default: () => null }))

// Capture the onUpdate prop (= handleUpdateRef) that ReferencePanel passes to each card.
let capturedOnUpdate = null
vi.mock('../../src/components/ReferenceCard', () => ({
  default: (props) => { capturedOnUpdate = props.onUpdate; return null },
}))

import ReferencePanel from '../../src/components/ReferencePanel'

function renderPanel(references, onUpdate) {
  return render(
    <ReferencePanel
      references={references} onUpdate={onUpdate} onUpload={vi.fn()}
      onGenerate={vi.fn()} onGenerateAll={vi.fn()} onStopGenerateAll={vi.fn()} onClearAll={vi.fn()}
      aspectRatio="16:9" generatingRefs={[]} stoppingRefs={false} preparingRefs={false}
      selectedStyleRefId={null} onStyleRefChange={vi.fn()} projectName="proj"
    />
  )
}

beforeEach(() => { capturedOnUpdate = null })

describe('ReferencePanel handleUpdateRef — #R27-3 functional id-patch', () => {
  it('calls onUpdate with a FUNCTION (not the stale array)', () => {
    const onUpdate = vi.fn()
    renderPanel([{ id: 1, name: 'A', type: 'character' }, { id: 2, name: 'B', type: 'character' }], onUpdate)
    capturedOnUpdate(0, { id: 1, name: 'A-updated' })
    expect(onUpdate).toHaveBeenCalledTimes(1)
    expect(typeof onUpdate.mock.calls[0][0]).toBe('function')
  })

  it('patches by id into current state when project unchanged', () => {
    const onUpdate = vi.fn()
    const refs = [{ id: 1, name: 'A', type: 'character' }, { id: 2, name: 'B', type: 'character' }]
    renderPanel(refs, onUpdate)
    capturedOnUpdate(0, { id: 1, name: 'A-updated' })
    const updater = onUpdate.mock.calls[0][0]
    const result = updater(refs)
    expect(result).toEqual([{ id: 1, name: 'A-updated' }, { id: 2, name: 'B', type: 'character' }])
  })

  it('does NOT clobber a switched-to project (id absent in current array → no-op)', () => {
    const onUpdate = vi.fn()
    const oldRefs = [{ id: 1, name: 'A', type: 'character' }, { id: 2, name: 'B', type: 'character' }]
    renderPanel(oldRefs, onUpdate)
    // upload completes after the user switched to a different project (non-colliding ids)
    capturedOnUpdate(0, { id: 1, name: 'A-updated', mediaId: 'stale' })
    const updater = onUpdate.mock.calls[0][0]
    const newProjectRefs = [{ id: 7, name: 'X', type: 'character' }]
    const result = updater(newProjectRefs)
    // current project's refs are untouched — no wholesale replacement with the old array
    expect(result).toEqual(newProjectRefs)
  })
})
