// @vitest-environment node
//
// Three review rounds found user content in main-process console logs, each time in a place the
// previous round missed: the generate prompt, then the T2V prompt, then the composer's editorText,
// then mention names. Hunting them one by one does not converge.
//
// It matters because @sentry/electron turns every main-process console call into a breadcrumb, and
// we deliberately keep console in the main bundle so those breadcrumbs exist. So a single forgotten
// console.log ships the user's prompt — or their character names — to our servers.
//
// This test is the stop: it fails if a console.* call in electron/ passes a content-bearing value.
// Log a LENGTH or an ID, never the content. If a name here is a false positive, rename the variable
// or add the `safe-log:` marker with a reason.
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('../../electron', import.meta.url))

// Values that are (or can carry) the user's own words, names, or filesystem layout.
// `\b` means promptLen / editorTextLen / nameLen / captionLen are fine — those are the fix.
const CONTENT_BEARING = /\b(prompt|promptKey|promptText|editorText|caption|displayName|narration|script|srt|workFolderPath|userText)\b/

function jsFiles(dir) {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f)
    if (statSync(p).isDirectory()) return jsFiles(p)
    return f.endsWith('.js') ? [p] : []
  })
}

/** console.log('...', a, b) — the arguments, minus anything that is already safe. */
function consoleCallArgs(line) {
  const m = line.match(/console\.(log|warn|error|info)\s*\(([\s\S]*)$/)
  if (!m) return null
  return m[2]
    // A format string mentioning the word "prompt" is not a leak.
    .replace(/'[^']*'/g, "''").replace(/"[^"]*"/g, '""').replace(/`[^`]*`/g, '``')
    // Taking a LENGTH of the content is the fix, not the leak: prompt?.length, (promptKey || '').length
    .replace(/[\w$.?()|'"\s]*\.length\b/g, 'LEN')
}

describe('main-process logs must not carry user content', () => {
  it('no console.* in electron/ logs a prompt, name, caption, or user path', () => {
    const offenders = []

    for (const file of jsFiles(ROOT)) {
      readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
        if (line.includes('safe-log:')) return
        const args = consoleCallArgs(line)
        if (args && CONTENT_BEARING.test(args)) {
          offenders.push(`${file.replace(ROOT, 'electron')}:${i + 1}  ${line.trim().slice(0, 90)}`)
        }
      })
    }

    expect(offenders, `Log the length or an id, not the content:\n${offenders.join('\n')}`).toEqual([])
  })
})
