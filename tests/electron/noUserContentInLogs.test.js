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

// electron/ 만 스캔한다 — prod 에서 console 이 살아남는 곳이 여기뿐이기 때문이다(그래야 Sentry
//   breadcrumb 이 생긴다). renderer 의 console 은 prod 빌드에서 통째로 제거되므로 breadcrumb 이
//   되지 않는다. 그 불변식은 vite-console-policy.test.js 가 지킨다 — 거기가 무너지면 renderer 의
//   로그(캐릭터 이름·이메일·경로)가 전부 살아나므로, 그때 이 스캔을 src/ 로 넓혀야 한다.
const ROOTS = [fileURLToPath(new URL('../../electron', import.meta.url))]

// Values that are (or can carry) the user's own words, names, or filesystem layout.
// `\b` means promptLen / editorTextLen / nameLen / captionLen are fine — those are the fix.
//
// `name` and `diag` are here because round three found leaks through exactly those: a bare
// `name` (an @mention = a character the user created) and a `diag` object whose nested
// candidates[].text is Flow page content. The guard only stops what it knows about, so when a
// leak gets past it, the fix is to teach it the name — not just to patch the line.
const CONTENT_BEARING = new RegExp(
  '\\b(' + [
    // the user's words
    'prompt', 'promptKey', 'promptText', 'editorText', 'userText', 'narration', 'script', 'srt', 'caption',
    // the user's names — @mentions are characters they created
    'name', 'displayName', 'label', 'title', 'alt', 'placeholder',
    // page content, raw API bodies, and objects that nest them
    // ('text' and 'body' are here because Flow echoes prompts and names back in error responses —
    //  round nine found four logs dumping up to 1000 chars of raw response.)
    'diag', 'text', 'textButtons', 'body', 'bodyHtml', 'html', 'value',
    // filesystem layout — absolute paths carry the account name
    'path', 'filePath', 'tempDir', 'savePath', 'outputPath', 'workFolder', 'workFolderPath', 'dir',
  ].join('|') + ')\\b',
)

function jsFiles(dir) {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f)
    if (statSync(p).isDirectory()) return jsFiles(p)
    return /\.jsx?$/.test(f) ? [p] : []
  })
}

/** console.log('...', a, b) — the arguments, minus anything that is already safe. */
function consoleCallArgs(line) {
  const m = line.match(/console\.(log|warn|error|info)\s*\(([\s\S]*)$/)
  if (!m) return null
  return m[2]
    // A format string mentioning the word "prompt" is not a leak.
    .replace(/'[^']*'/g, "''").replace(/"[^"]*"/g, '""').replace(/`[^`]*`/g, '``')
    // A trailing // comment is not what gets logged.
    .replace(/\/\/.*$/, '')
    // Taking a LENGTH of the content is the fix, not the leak: prompt?.length, (promptKey || '').length
    .replace(/[\w$.?()|'"\s]*\.length\b/g, 'LEN')
    // A basename is the filename without the account-bearing directories — that is the fix too.
    .replace(/(?:path\.)?basename\([^)]*\)/g, 'BASE')
}

describe('main-process logs must not carry user content', () => {
  it('no console.* in electron/ logs a prompt, name, caption, or user path', () => {
    const offenders = []

    for (const file of ROOTS.flatMap(jsFiles)) {
      const lines = readFileSync(file, 'utf8').split('\n')
      lines.forEach((line, i) => {
        // The escape hatch may sit on the line itself or on the comment line above it, where
        // the reason belongs.
        if (line.includes('safe-log:') || (lines[i - 1] || '').includes('safe-log:')) return
        const args = consoleCallArgs(line)
        if (args && CONTENT_BEARING.test(args)) {
          const rel = ROOTS.reduce((acc, r) => acc.replace(r, r.endsWith('src') ? 'src' : 'electron'), file)
          offenders.push(`${rel}:${i + 1}  ${line.trim().slice(0, 90)}`)
        }
      })
    }

    expect(offenders, `Log the length or an id, not the content:\n${offenders.join('\n')}`).toEqual([])
  })
})
