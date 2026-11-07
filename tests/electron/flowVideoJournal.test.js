// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { createVideoJournal } from '../../electron/flow-video-journal.js'

const dirs = new Set()
function tempDir() {
  const root = path.join(process.cwd(), '.work')
  fs.mkdirSync(root, { recursive: true })
  const directory = fs.mkdtempSync(path.join(root, 'video-journal-test-'))
  dirs.add(directory)
  return directory
}
afterEach(() => {
  for (const directory of dirs) fs.rmSync(directory, { recursive: true, force: true })
  dirs.clear()
})

const submission = id => ({ id, submittedAt: 1794042000000, promptHash: `sha256:${id}`, postClick: true,
  retryBlocked: true, reason: 'awaiting-result' })

describe('durable video submission journal', () => {
  it('creates its directory and returns null when a scope has no history', async () => {
    const directory = path.join(tempDir(), 'nested', 'journal')
    const journal = createVideoJournal(directory)
    expect(journal.inspect('scene:one', 't2v:sha256:blue')).toBeNull()
    expect(fs.existsSync(directory)).toBe(true)
  })

  it('persists an unresolved reservation across instances and blocks a different intent', async () => {
    const directory = tempDir()
    const first = createVideoJournal(directory)
    const pending = submission('submit-1')
    first.reserve('scene:one', 't2v:sha256:blue', pending)

    const restarted = createVideoJournal(directory)
    expect(restarted.inspect('scene:one', 't2v:sha256:blue')).toEqual({
      blocked: true, flowSubmission: pending,
    })
    expect(restarted.inspect('scene:one', 't2v:sha256:red')).toEqual({
      blocked: true, flowSubmission: pending,
    })
    expect(JSON.stringify(fs.readFileSync(path.join(directory, fs.readdirSync(directory)[0]), 'utf8'))).not.toContain('blue bird')
  })

  it('turns a matching confirmation into a reusable generation and clears it for the previous generation', async () => {
    const journal = createVideoJournal(tempDir())
    const pending = submission('submit-2')
    journal.reserve('video:two', 'i2v:sha256:blue', pending)
    journal.confirm('video:two', pending.id, '00000022-0000-4000-8000-000000000022')

    expect(journal.inspect('video:two', 'i2v:sha256:blue')).toEqual({ generationId: '00000022-0000-4000-8000-000000000022' })
    expect(journal.inspect('video:two', 'i2v:sha256:blue', '00000022-0000-4000-8000-000000000022')).toBeNull()
  })

  it('keeps an older row epoch blocked after restart and lets only a higher epoch reset it', () => {
    const directory = tempDir()
    const journal = createVideoJournal(directory)
    const pending = submission('submit-epoch-4')
    journal.reserve('stable-row-scope', 't2v:sha256:epoch-four', pending, null, 4)
    journal.confirm('stable-row-scope', pending.id, '00000044-0000-4000-8000-000000000044')

    const restarted = createVideoJournal(directory)
    expect(restarted.inspect('stable-row-scope', 't2v:sha256:epoch-four', '00000044-0000-4000-8000-000000000044', 3))
      .toEqual({ blocked: true, flowSubmission: pending })
    expect(restarted.inspect('stable-row-scope', 't2v:sha256:epoch-five', null, 5)).toBeNull()

    const next = submission('submit-epoch-5')
    restarted.reserve('stable-row-scope', 't2v:sha256:epoch-five', next, '00000044-0000-4000-8000-000000000044', 5)
    expect(restarted.inspect('stable-row-scope', 't2v:sha256:epoch-five', null, 5))
      .toEqual({ blocked: true, flowSubmission: next })
  })

  it('requires an atomic previous-generation match before replacing a completed reservation', async () => {
    const journal = createVideoJournal(tempDir())
    const old = submission('submit-old')
    journal.reserve('video:three', 't2v:sha256:first', old)
    journal.confirm('video:three', old.id, '00000033-0000-4000-8000-000000000033')

    const stale = submission('submit-stale')
    expect(() => journal.reserve('video:three', 't2v:sha256:second', stale,
      '00000000-0000-4000-8000-000000000000')).toThrow()
    expect(journal.inspect('video:three', 't2v:sha256:second')).toEqual({ blocked: true, flowSubmission: old })

    const current = submission('submit-current')
    journal.reserve('video:three', 't2v:sha256:second', current, '00000033-0000-4000-8000-000000000033')
    expect(journal.inspect('video:three', 't2v:sha256:second')).toEqual({
      blocked: true, flowSubmission: current,
    })
  })

  it('cancels only the reservation with the matching submission id', async () => {
    const journal = createVideoJournal(tempDir())
    const pending = submission('submit-4')
    journal.reserve('scene:four', 'r2v:sha256:reference', pending)

    journal.cancel('scene:four', 'different-id')
    expect(journal.inspect('scene:four', 'r2v:sha256:reference')).toEqual({ blocked: true, flowSubmission: pending })
    journal.cancel('scene:four', pending.id)
    expect(journal.inspect('scene:four', 'r2v:sha256:reference')).toBeNull()
  })

  it('isolates completed claims by project and row scope', () => {
    const journal = createVideoJournal(tempDir())
    const record = submission('submit-scope')
    const scope = JSON.stringify(['/work/a', 'Project A', 'project-a', 'video', 'row-1'])
    journal.reserve(scope, 't2v:sha256:prompt', record)
    journal.confirm(scope, record.id, '00000055-0000-4000-8000-000000000055')

    expect(journal.inspect(JSON.stringify(['/work/b', 'Project A', 'project-a', 'video', 'row-1']), 't2v:sha256:prompt')).toBeNull()
    expect(journal.inspect(JSON.stringify(['/work/a', 'Project A', 'project-a', 'video', 'row-2']), 't2v:sha256:prompt')).toBeNull()
  })

  it('fails closed on malformed existing journal data and does not persist malformed new submissions', () => {
    const directory = tempDir()
    const journal = createVideoJournal(directory)
    expect(() => journal.reserve('scene:bad', 't2v:sha256:bad', { id: 'bad' })).toThrow()
    expect(fs.readdirSync(directory)).toHaveLength(0)

    const good = submission('submit-good')
    journal.reserve('scene:bad', 't2v:sha256:good', good)
    for (const file of fs.readdirSync(directory)) {
      const full = path.join(directory, file)
      if (fs.statSync(full).isFile()) fs.writeFileSync(full, '{ malformed')
    }
    expect(() => journal.inspect('scene:bad', 't2v:sha256:good')).toThrow()
  })
})
