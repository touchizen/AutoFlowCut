import { describe, it, expect } from 'vitest'
import { resolveProjectBatchId } from '../../src/utils/batchId'

// A batchId is reused only within ONE logical batch of ONE project. Keying by project means:
//  - a full start always mints a new id (= new batch = new charge),
//  - a partial retry reuses that project's id (server idempotent → free),
//  - different projects never share an id (no cross-project free-ride),
//  - switching away and back preserves each project's id (no double charge on retry).
describe('resolveProjectBatchId', () => {
  it('full start (not partial retry) → mints a new id and stores it', () => {
    const map = new Map()
    const { batchId, reused } = resolveProjectBatchId(map, 'projA', false)
    expect(reused).toBe(false)
    expect(batchId).toBeTruthy()
    expect(map.get('projA')).toBe(batchId)
  })

  it('partial retry reuses the same project\'s id (idempotent → free)', () => {
    const map = new Map()
    const first = resolveProjectBatchId(map, 'projA', false).batchId
    const { batchId, reused } = resolveProjectBatchId(map, 'projA', true)
    expect(reused).toBe(true)
    expect(batchId).toBe(first)
  })

  it('partial retry with no prior id for the project → mints fresh (faces gate)', () => {
    const map = new Map()
    const { batchId, reused } = resolveProjectBatchId(map, 'projB', true)
    expect(reused).toBe(false)
    expect(batchId).toBeTruthy()
  })

  it('different projects get different ids — no cross-project free-ride', () => {
    const map = new Map()
    const a = resolveProjectBatchId(map, 'projA', false).batchId
    const b = resolveProjectBatchId(map, 'projB', false).batchId
    expect(a).not.toBe(b)
  })

  it('switching away and back preserves each project\'s id (no double charge on retry)', () => {
    const map = new Map()
    const a = resolveProjectBatchId(map, 'projA', false).batchId  // charge A
    resolveProjectBatchId(map, 'projB', false)                    // work in B
    const aRetry = resolveProjectBatchId(map, 'projA', true)      // back to A, retry
    expect(aRetry.reused).toBe(true)
    expect(aRetry.batchId).toBe(a)                                // same id → idempotent → no re-charge
  })

  it('a fresh full start in a project overwrites its prior id (new batch)', () => {
    const map = new Map()
    const a1 = resolveProjectBatchId(map, 'projA', false).batchId
    const a2 = resolveProjectBatchId(map, 'projA', false).batchId
    expect(a2).not.toBe(a1)
    expect(map.get('projA')).toBe(a2)
  })
})
