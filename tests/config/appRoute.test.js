import { describe, it, expect, vi } from 'vitest'
import {
  MODE_STORAGE_KEY, SESSION_TARGET_STORAGE_KEY,
  parseRoute, normalizeStoredRoute, loadRoute, serializeRoute,
  isSessionMode, isFlowTarget, sourceForStage,
} from '../../src/config/appRoute.js'

function storage(values = {}) {
  return { getItem: vi.fn((key) => values[key] ?? null) }
}

describe('stored route normalization — §10 table (1)', () => {
  it.each([
    [null, null, null],
    [null, 'stale-target', null],
    ['flow', null, { mode: 'flow', sessionTarget: 'flow' }],
    ['flow', 'flow', { mode: 'flow', sessionTarget: 'flow' }],
    ['api', null, { mode: 'api', sessionTarget: 'flow' }],
    ['unknown', 'flow', null],
  ])('mode=%s target=%s → %j', (mode, target, expected) => {
    expect(normalizeStoredRoute(mode, target, vi.fn())).toEqual(expected)
  })

  // A previously stored target that no longer has an implementation (e.g. the removed
  // 'chatgpt' value) must recover to flow instead of wedging the boot route.
  it.each([['flow'], ['api']])('unregistered stored target is recovered to flow and logged for %s', (mode) => {
    const log = vi.fn()
    expect(normalizeStoredRoute(mode, 'chatgpt', log)).toEqual({ mode, sessionTarget: 'flow' })
    expect(normalizeStoredRoute(mode, 'bogus', log)).toEqual({ mode, sessionTarget: 'flow' })
    expect(log).toHaveBeenCalledTimes(2)
  })

  it('loadRoute reads only the two canonical keys', () => {
    const s = storage({ [MODE_STORAGE_KEY]: 'flow', [SESSION_TARGET_STORAGE_KEY]: 'flow' })
    expect(loadRoute(s)).toEqual({ mode: 'flow', sessionTarget: 'flow' })
    expect(s.getItem.mock.calls).toEqual([[MODE_STORAGE_KEY], [SESSION_TARGET_STORAGE_KEY]])
  })
})

describe('strict route and selectors', () => {
  it.each([
    [{ mode: 'flow', sessionTarget: 'flow' }, true],
    [{ mode: 'api', sessionTarget: 'flow' }, true],
    [{ mode: 'flow', sessionTarget: 'chatgpt' }, false],
    [{ mode: 'wat', sessionTarget: 'flow' }, false],
    [{ mode: 'flow' }, false],
    [null, false],
  ])('parseRoute(%j)', (input, valid) => {
    expect(Boolean(parseRoute(input))).toBe(valid)
  })

  it('serialize rejects invalid input instead of repairing it', () => {
    expect(() => serializeRoute({ mode: 'flow', sessionTarget: 'wat' })).toThrow('invalid-route')
  })

  it.each([
    [{ mode: 'api', sessionTarget: 'flow' }, 'image', 'api'],
    [{ mode: 'api', sessionTarget: 'flow' }, 't2v', 'api'],
    [{ mode: 'flow', sessionTarget: 'flow' }, 'image', 'flow'],
    [{ mode: 'flow', sessionTarget: 'flow' }, 't2v', 'flow'],
    [{ mode: 'flow', sessionTarget: 'flow' }, 'i2v', 'flow'],
    [{ mode: 'flow', sessionTarget: 'flow' }, 'unknown', null],
    [{ mode: 'flow', sessionTarget: 'not-registered' }, 'image', null],
  ])('sourceForStage(%j, %s) → %s', (route, stage, source) => {
    expect(sourceForStage(route, stage)).toBe(source)
  })

  it('keeps mode and target predicates distinct', () => {
    expect(isSessionMode({ mode: 'api', sessionTarget: 'flow' })).toBe(false)
    expect(isSessionMode({ mode: 'flow', sessionTarget: 'flow' })).toBe(true)
    expect(isFlowTarget({ mode: 'api', sessionTarget: 'flow' })).toBe(false)
    expect(isFlowTarget({ mode: 'flow', sessionTarget: 'flow' })).toBe(true)
  })
})
