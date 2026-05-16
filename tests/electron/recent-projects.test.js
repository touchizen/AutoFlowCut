// @vitest-environment node

/**
 * Recent projects (MRU) store — electron/recent-projects.js
 *
 * Backs the native File → "Recent Projects" submenu. mergeRecent is the pure
 * core (most-recent-first, de-duplicated, capped); load/save persist it.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs'

vi.mock('electron', () => ({ app: { getPath: () => '.' } }))

import {
  mergeRecent,
  MAX_RECENT,
  loadRecentProjects,
  saveRecentProjects,
} from '../../electron/recent-projects.js'

describe('mergeRecent', () => {
  it('prepends a new name as most-recent', () => {
    expect(mergeRecent(['a', 'b'], 'c')).toEqual(['c', 'a', 'b'])
  })

  it('moves an already-present name to the front (de-dupe)', () => {
    expect(mergeRecent(['a', 'b', 'c'], 'c')).toEqual(['c', 'a', 'b'])
  })

  it('caps the list at MAX_RECENT (5)', () => {
    const result = mergeRecent(['a', 'b', 'c', 'd', 'e'], 'f')
    expect(result).toEqual(['f', 'a', 'b', 'c', 'd'])
    expect(result).toHaveLength(MAX_RECENT)
  })

  it('ignores a blank or non-string name (list returned sanitized)', () => {
    expect(mergeRecent(['a', 'b'], '   ')).toEqual(['a', 'b'])
    expect(mergeRecent(['a', 'b'], null)).toEqual(['a', 'b'])
    expect(mergeRecent(['a', 'b'], 42)).toEqual(['a', 'b'])
  })

  it('trims whitespace around the name', () => {
    expect(mergeRecent(['a'], '  b  ')).toEqual(['b', 'a'])
  })

  it('drops non-string / blank entries from the existing list', () => {
    expect(mergeRecent(['a', '', 7, null, 'b'], 'c')).toEqual(['c', 'a', 'b'])
  })

  it('tolerates a non-array list', () => {
    expect(mergeRecent(undefined, 'a')).toEqual(['a'])
    expect(mergeRecent(null, null)).toEqual([])
  })
})

describe('loadRecentProjects / saveRecentProjects', () => {
  let dir
  let file

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'afc-recent-'))
    file = path.join(dir, 'recent-projects.json')
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('round-trips a list through save → load', () => {
    expect(saveRecentProjects(['p1', 'p2'], file)).toBe(true)
    expect(loadRecentProjects(file)).toEqual(['p1', 'p2'])
  })

  it('returns [] for a missing file', () => {
    expect(loadRecentProjects(file)).toEqual([])
  })

  it('returns [] for a corrupt file', () => {
    writeFileSync(file, '{not json', 'utf-8')
    expect(loadRecentProjects(file)).toEqual([])
  })

  it('sanitizes a persisted list on load (dedupe + cap)', () => {
    writeFileSync(file, JSON.stringify(['a', 'a', 'b', null, 'c', 'd', 'e', 'f']), 'utf-8')
    expect(loadRecentProjects(file)).toEqual(['a', 'b', 'c', 'd', 'e'])
  })

  it('sanitizes before persisting', () => {
    saveRecentProjects(['x', 'x', '', 'y'], file)
    expect(JSON.parse(readFileSync(file, 'utf-8'))).toEqual(['x', 'y'])
  })

  it('returns false (no throw) when the path is unwritable', () => {
    expect(saveRecentProjects(['p'], path.join(dir, 'no-such-dir', 'f.json'))).toBe(false)
  })
})
