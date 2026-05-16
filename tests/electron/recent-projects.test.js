// @vitest-environment node

/**
 * Recent projects (MRU) store — electron/recent-projects.js
 *
 * Backs the native File → "Recent Projects" submenu. Entries are
 * { name, workFolder } so the same project name in two work folders never
 * collides — clicking a recent must reopen the project in *its own* folder,
 * not silently create an empty same-named project in the current one.
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

const e = (name, workFolder = '/wfA') => ({ name, workFolder })

describe('mergeRecent', () => {
  it('prepends a new entry as most-recent', () => {
    expect(mergeRecent([e('a'), e('b')], e('c'))).toEqual([e('c'), e('a'), e('b')])
  })

  it('moves an already-present entry to the front (de-dupe)', () => {
    expect(mergeRecent([e('a'), e('b'), e('c')], e('c'))).toEqual([e('c'), e('a'), e('b')])
  })

  it('treats the same name in different work folders as distinct entries', () => {
    const result = mergeRecent([e('proj', '/wfA')], e('proj', '/wfB'))
    expect(result).toEqual([e('proj', '/wfB'), e('proj', '/wfA')])
  })

  it('caps per work folder at MAX_RECENT (5), keeping other folders', () => {
    const folderA = ['a', 'b', 'c', 'd', 'e'].map((n) => e(n, '/wfA'))
    const result = mergeRecent([...folderA, e('keep', '/wfB')], e('f', '/wfA'))
    const wfA = result.filter((r) => r.workFolder === '/wfA')
    expect(wfA).toEqual(['f', 'a', 'b', 'c', 'd'].map((n) => e(n, '/wfA')))
    expect(wfA).toHaveLength(MAX_RECENT)
    expect(result).toContainEqual(e('keep', '/wfB'))
  })

  it('ignores an invalid entry (list returned sanitized)', () => {
    expect(mergeRecent([e('a'), e('b')], null)).toEqual([e('a'), e('b')])
    expect(mergeRecent([e('a')], { name: '  ', workFolder: '/wf' })).toEqual([e('a')])
    expect(mergeRecent([e('a')], { name: 'x' })).toEqual([e('a')]) // missing workFolder
    expect(mergeRecent([e('a')], 'plain-string')).toEqual([e('a')])
  })

  it('trims whitespace around name and workFolder', () => {
    expect(mergeRecent([e('a')], { name: '  b  ', workFolder: '  /wfA  ' }))
      .toEqual([e('b'), e('a')])
  })

  it('drops invalid / legacy entries from the existing list', () => {
    const messy = [e('a'), 'legacy-string', null, { name: 'x' }, e('b')]
    expect(mergeRecent(messy, e('c'))).toEqual([e('c'), e('a'), e('b')])
  })

  it('tolerates a non-array list', () => {
    expect(mergeRecent(undefined, e('a'))).toEqual([e('a')])
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
    const list = [e('p1', '/wfA'), e('p2', '/wfB')]
    expect(saveRecentProjects(list, file)).toBe(true)
    expect(loadRecentProjects(file)).toEqual(list)
  })

  it('returns [] for a missing file', () => {
    expect(loadRecentProjects(file)).toEqual([])
  })

  it('returns [] for a corrupt file', () => {
    writeFileSync(file, '{not json', 'utf-8')
    expect(loadRecentProjects(file)).toEqual([])
  })

  it('drops legacy string entries on load (pre-workFolder format)', () => {
    writeFileSync(file, JSON.stringify(['old-a', 'old-b']), 'utf-8')
    expect(loadRecentProjects(file)).toEqual([])
  })

  it('sanitizes a persisted list on load (dedupe + per-folder cap)', () => {
    const raw = [
      e('a'), e('a'), e('b'), null, e('c'), e('d'), e('e'), e('f'),
    ]
    writeFileSync(file, JSON.stringify(raw), 'utf-8')
    expect(loadRecentProjects(file)).toEqual(['a', 'b', 'c', 'd', 'e'].map((n) => e(n)))
  })

  it('returns false (no throw) when the path is unwritable', () => {
    expect(saveRecentProjects([e('p')], path.join(dir, 'no-such-dir', 'f.json'))).toBe(false)
  })
})
