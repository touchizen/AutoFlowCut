import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
vi.mock('electron', () => ({ screen: { getAllDisplays: () => [] } }))
vi.mock('../../electron/flow-native-settings.js', () => ({ applyNativeSettings: vi.fn(async () => ({ ok: true })) }))

import { createVideoJournal } from '../../electron/flow-video-journal.js'
import { _resetDomStageForTests } from '../../electron/ipc/flow-angular.js'
import { harness } from '../fixtures/flow-passive-harness.js'
import { PROJECT, PROMPT } from '../fixtures/flow-passive-image.js'

const WORK = '/work/video-journal-wiring'
const MODEL = 'Omni Flash'
const GENERATION = '00000066-0000-4000-8000-000000000066'
const ROW = { projectName: 'Project A', id: 'vscene_1', epoch: '7', previousId: null }
const payload = row => ({ prompt: PROMPT, projectId: PROJECT, model: MODEL, aspectRatio: '16:9',
  duration: 6, resolution: '720p', videoBatchCount: 1, row })

function durableJournal() {
  const directory = pathForTests()
  const journal = createVideoJournal(directory)
  return { journal, directory }
}
function pathForTests() {
  const root = path.join(process.cwd(), '.work')
  fs.mkdirSync(root, { recursive: true })
  return fs.mkdtempSync(path.join(root, 'video-journal-wiring-'))
}
function scopeFor(row = ROW) {
  return JSON.stringify([WORK, row.projectName, PROJECT, 'video', row.id])
}
function intentFor() {
  return JSON.stringify([PROMPT, { model: MODEL, duration: 6, resolution: '720p', ratio: '16:9', kind: 't2v' }, null, []])
}
function record(id) {
  return { id, submittedAt: 1794042000000, promptHash: 'sha256:prompt', postClick: true,
    retryBlocked: true, reason: 'awaiting-result' }
}

let tempDirs = []
beforeEach(() => { vi.useFakeTimers(); _resetDomStageForTests() })
afterEach(() => {
  vi.useRealTimers()
  for (const dir of tempDirs) fs.rmSync(dir, { recursive: true, force: true })
  tempDirs = []
})

describe('video journal through registered Flow IPC', () => {
  it('recovers a matching confirmed generation through IPC without a second submit click', async () => {
    const { journal, directory } = durableJournal(); tempDirs.push(directory)
    const pending = record('flow-submit-recovered')
    journal.reserve(scopeFor(), intentFor(), pending, null, 7)
    journal.confirm(scopeFor(), pending.id, GENERATION)
    const inspect = vi.spyOn(journal, 'inspect')
    const h = harness({ videoJournal: journal, activeWorkFolder: WORK })
    const sender = { send: vi.fn() }

    const pendingCall = h.handlers.get('flow:generate-video-t2v')({ sender }, {
      ...payload(ROW), submissionRequestId: 'request-recovery',
    })
    await vi.runAllTimersAsync()
    const result = await pendingCall

    expect(result).toEqual({ success: true, generationId: GENERATION })
    expect(inspect).toHaveBeenCalledWith(expect.stringContaining(ROW.id), intentFor(), null, 7)
    expect(h.deps.trustedClickOnFlowView).not.toHaveBeenCalled()
    expect(h.submit).not.toHaveBeenCalled()
    expect(sender.send).not.toHaveBeenCalled()
  })

  it('refuses an unresolved different intent before capture or click', async () => {
    const { journal, directory } = durableJournal(); tempDirs.push(directory)
    const pending = record('flow-submit-unresolved')
    journal.reserve(scopeFor(), 'other-intent-hash', pending, null, 7)
    const h = harness({ videoJournal: journal, activeWorkFolder: WORK })
    const sender = { send: vi.fn() }

    const pendingCall = h.handlers.get('flow:generate-video-t2v')({ sender }, {
      ...payload(ROW), submissionRequestId: 'request-retry',
    })
    await vi.runAllTimersAsync()
    const result = await pendingCall

    expect(result).toMatchObject({ success: false, reason: 'previous-submit-unresolved', postClick: true,
      flowSubmission: { ...pending, reason: 'previous-submit-unresolved' } })
    expect(h.deps.trustedClickOnFlowView).not.toHaveBeenCalled()
    expect(h.submit).not.toHaveBeenCalled()
    expect(sender.send).not.toHaveBeenCalled()
  })

  it('does not retain a reservation when the final native dispatch is refused', async () => {
    const { journal, directory } = durableJournal(); tempDirs.push(directory)
    const h = harness({ videoJournal: journal, activeWorkFolder: WORK, nativeClickFailure: 'bounds' })
    const pending = h.handlers.get('flow:generate-video-t2v')({}, payload(ROW))
    await vi.runAllTimersAsync()
    const result = await pending

    expect(result).toMatchObject({ success: false })
    expect(h.submit).not.toHaveBeenCalled()
    expect(journal.inspect(scopeFor(), intentFor(), null, 7)).toBeNull()
  })

  it('does not recover a generation owned by a different row', async () => {
    const { journal, directory } = durableJournal(); tempDirs.push(directory)
    const otherRow = { ...ROW, id: 'vscene_other' }
    const pending = record('flow-submit-other-row')
    journal.reserve(scopeFor(otherRow), intentFor(), pending, null, 7)
    journal.confirm(scopeFor(otherRow), pending.id, GENERATION)
    const h = harness({ videoJournal: journal, activeWorkFolder: WORK, nativeClickFailure: 'bounds' })
    const thisRow = { ...ROW, id: 'vscene_this' }
    const promise = h.handlers.get('flow:generate-video-t2v')({}, payload(thisRow))
    await vi.runAllTimersAsync()
    const result = await promise

    expect(result).toMatchObject({ success: false })
    expect(result.generationId).toBeUndefined()
    expect(h.submit).not.toHaveBeenCalled()
    expect(journal.inspect(scopeFor(thisRow), intentFor(), null, 7)).toBeNull()
  })
})
