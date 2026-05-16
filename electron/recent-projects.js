/**
 * Recent projects (MRU) store for the native File menu.
 *
 * The native menu is built in the main process, so the recent list must be
 * readable here at menu-build time. It is persisted as JSON in userData so it
 * survives restarts. The renderer notifies the main process whenever a project
 * becomes active (app:project-activated), which feeds mergeRecent().
 */

import { app } from 'electron'
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

export const MAX_RECENT = 5

/**
 * Merge a newly-activated project name into the MRU list.
 *
 * Pure: most-recent-first, de-duplicated, capped at `max`. Blank or non-string
 * names are ignored (the list is returned sanitized but otherwise unchanged) —
 * passing name = null is the canonical way to just sanitize an existing list.
 *
 * @param {string[]} list
 * @param {string|null} name
 * @param {number} [max]
 * @returns {string[]}
 */
export function mergeRecent(list, name, max = MAX_RECENT) {
  const seen = new Set()
  const base = (Array.isArray(list) ? list : [])
    .filter((n) => typeof n === 'string' && n.trim())
    .filter((n) => (seen.has(n) ? false : (seen.add(n), true)))
  if (typeof name !== 'string' || !name.trim()) {
    return base.slice(0, max)
  }
  const trimmed = name.trim()
  return [trimmed, ...base.filter((n) => n !== trimmed)].slice(0, max)
}

function storePath() {
  return path.join(app.getPath('userData'), 'recent-projects.json')
}

/**
 * Load the persisted recent list. Returns [] on a missing or corrupt file.
 * @param {string} [filePath] - override for tests
 */
export function loadRecentProjects(filePath = storePath()) {
  try {
    const parsed = JSON.parse(readFileSync(filePath, 'utf-8'))
    return mergeRecent(parsed, null) // sanitize stray/duplicate entries + cap
  } catch {
    return []
  }
}

/**
 * Persist the recent list. Returns false (never throws) on a write failure.
 * @param {string[]} list
 * @param {string} [filePath] - override for tests
 */
export function saveRecentProjects(list, filePath = storePath()) {
  try {
    writeFileSync(filePath, JSON.stringify(mergeRecent(list, null)), 'utf-8')
    return true
  } catch {
    return false
  }
}
