import { describe, it, expect, vi } from 'vitest'
import {
  MODE_STORAGE_KEY, SESSION_TARGET_STORAGE_KEY,
  parseRoute, normalizeStoredRoute, loadRoute, serializeRoute,
  isSessionMode, isFlowTarget, isChatgptTarget, sourceForStage,
} from '../../src/config/appRoute.js'

function storage(values = {}) {
  return { getItem: vi.fn((key) => values[key] ?? null) }
}

describe('stored route normalization — §10 table (1)', () => {
  it.each([
    [null, null, null],
    [null, 'chatgpt', null],
    ['flow', null, { mode: 'flow', sessionTarget: 'flow' }],
    ['flow', 'flow', { mode: 'flow', sessionTarget: 'flow' }],
    ['flow', 'chatgpt', { mode: 'flow', sessionTarget: 'chatgpt' }],
    ['api', null, { mode: 'api', sessionTarget: 'flow' }],
    ['api', 'chatgpt', { mode: 'api', sessionTarget: 'chatgpt' }],
    ['unknown', 'chatgpt', null],
  ])('mode=%s target=%s → %j', (mode, target, expected) => {
    expect(normalizeStoredRoute(mode, target, vi.fn())).toEqual(expected)
  })

  it.each([['flow'], ['api']])('invalid target is recovered to flow and logged for %s', (mode) => {
    const log = vi.fn()
    expect(normalizeStoredRoute(mode, 'bogus', log)).toEqual({ mode, sessionTarget: 'flow' })
    expect(log).toHaveBeenCalledOnce()
  })

  it('loadRoute reads only the two canonical keys', () => {
    const s = storage({ [MODE_STORAGE_KEY]: 'flow', [SESSION_TARGET_STORAGE_KEY]: 'chatgpt' })
    expect(loadRoute(s)).toEqual({ mode: 'flow', sessionTarget: 'chatgpt' })
    expect(s.getItem.mock.calls).toEqual([[MODE_STORAGE_KEY], [SESSION_TARGET_STORAGE_KEY]])
  })
})

describe('strict route and selectors', () => {
  it.each([
    [{ mode: 'flow', sessionTarget: 'flow' }, true],
    [{ mode: 'flow', sessionTarget: 'chatgpt' }, true],
    [{ mode: 'api', sessionTarget: 'flow' }, true],
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
    [{ mode: 'api', sessionTarget: 'chatgpt' }, 't2v', 'api'],
    [{ mode: 'flow', sessionTarget: 'flow' }, 'image', 'flow'],
    [{ mode: 'flow', sessionTarget: 'flow' }, 't2v', 'flow'],
    [{ mode: 'flow', sessionTarget: 'flow' }, 'i2v', 'flow'],
    [{ mode: 'flow', sessionTarget: 'chatgpt' }, 'image', 'chatgpt'],
    [{ mode: 'flow', sessionTarget: 'chatgpt' }, 't2v', 'api'],
    [{ mode: 'flow', sessionTarget: 'chatgpt' }, 'i2v', 'api'],
    [{ mode: 'flow', sessionTarget: 'chatgpt' }, 'unknown', null],
  ])('sourceForStage(%j, %s) → %s', (route, stage, source) => {
    expect(sourceForStage(route, stage)).toBe(source)
  })

  it('keeps mode and target predicates distinct', () => {
    const route = { mode: 'api', sessionTarget: 'chatgpt' }
    expect(isSessionMode(route)).toBe(false)
    expect(isFlowTarget(route)).toBe(false)
    expect(isChatgptTarget(route)).toBe(false)
    expect(isChatgptTarget({ ...route, mode: 'flow' })).toBe(true)
  })
})
