// @vitest-environment node
/**
 * Preload contract test — guards against renderer calling window.electronAPI.<name>
 * that is NOT exposed in electron/preload.js (the silent-no-op class of bug).
 *
 * Motivation: review C1 found that setMode was dropped from preload during M4 T5
 * rewrite while App.jsx kept calling window.electronAPI?.setMode?.(). The call
 * silently no-oped → Flow view never attached → Flow mode completely broken.
 *
 * This test prevents that class of regression.
 */
import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'

// ---------------------------------------------------------------------------
// Known pre-existing gaps — methods called in src/ that are intentionally NOT
// in preload.js and are out of scope for this branch. Each entry must have a
// comment explaining why it is allowlisted.
// ---------------------------------------------------------------------------
const ALLOWLIST = new Set([])

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Recursively collect all .js/.jsx files under a directory.
 */
function collectSrcFiles(dir) {
  const results = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      results.push(...collectSrcFiles(fullPath))
    } else if (entry.isFile() && /\.(js|jsx)$/.test(entry.name)) {
      results.push(fullPath)
    }
  }
  return results
}

/**
 * Extract every method name called as window.electronAPI?.<name>( or
 * window.electronAPI.<name>( from source text.
 *
 * Skips lines that begin with // or * (comment lines) to avoid false positives
 * from JSDoc / inline comments describing the API surface.
 */
function extractRendererCalls(srcText) {
  const names = new Set()
  for (const line of srcText.split('\n')) {
    const trimmed = line.trimStart()
    // Skip pure comment lines (// ... or * ...)
    if (trimmed.startsWith('//') || trimmed.startsWith('*')) continue

    // Match: electronAPI?.<name>  or  electronAPI.<name>  followed by non-word
    // (i.e. actual usage, not just a string literal of the name)
    const re = /electronAPI\??\.(\w+)/g
    let m
    while ((m = re.exec(line)) !== null) {
      // Skip if this specific match is inside a // comment on the same line
      const beforeMatch = line.slice(0, m.index)
      if (beforeMatch.includes('//')) continue
      names.add(m[1])
    }
  }
  return names
}

/**
 * Extract every top-level key exposed in contextBridge.exposeInMainWorld('electronAPI', { ... })
 * from preload source text.
 *
 * Reads lines inside the exposeInMainWorld block and picks up `  key:` patterns.
 */
function extractPreloadKeys(preloadText) {
  const keys = new Set()
  // Match property keys of the form:  <spaces><identifier>: (anything)
  // We restrict to lines that look like object property assignments inside
  // exposeInMainWorld (they are all at 2-space indent level in this file).
  const re = /^\s{2}(\w+)\s*:/gm
  let m
  while ((m = re.exec(preloadText)) !== null) {
    keys.add(m[1])
  }
  return keys
}

// ---------------------------------------------------------------------------
// Test
// ---------------------------------------------------------------------------

describe('preload contract', () => {
  const root = path.resolve(process.cwd())
  const srcDir = path.join(root, 'src')
  const preloadPath = path.join(root, 'electron', 'preload.js')

  it('every window.electronAPI.<name> called in src/ has a matching key in preload.js (or is allowlisted)', () => {
    // Collect renderer calls
    const rendererCalls = new Set()
    for (const filePath of collectSrcFiles(srcDir)) {
      const text = fs.readFileSync(filePath, 'utf8')
      for (const name of extractRendererCalls(text)) {
        rendererCalls.add(name)
      }
    }

    // Collect preload keys
    const preloadText = fs.readFileSync(preloadPath, 'utf8')
    const preloadKeys = extractPreloadKeys(preloadText)

    // Find gaps: called in renderer but not in preload and not allowlisted
    const gaps = [...rendererCalls].filter(
      (name) => !preloadKeys.has(name) && !ALLOWLIST.has(name)
    )

    expect(gaps, `Renderer calls missing from preload.js (not allowlisted): ${gaps.join(', ')}\n` +
      'Either add the bridge to electron/preload.js, or add to ALLOWLIST with a comment explaining why.'
    ).toHaveLength(0)
  })

  it('setMode is in preload (regression guard for review C1)', () => {
    const preloadText = fs.readFileSync(preloadPath, 'utf8')
    const preloadKeys = extractPreloadKeys(preloadText)
    expect(preloadKeys.has('setMode')).toBe(true)
  })

  it('allowlist entries are documented (not silently growing)', () => {
    // Ensure the allowlist is small and intentional — this test will fail if
    // someone adds new entries without updating this comment.
    // Current expected allowlist size: 0 (Vrew bridges now in preload.js).
    expect(ALLOWLIST.size).toBe(0)
  })
})
