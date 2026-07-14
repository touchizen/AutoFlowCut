// @vitest-environment node
//
// Main-process failures cross IPC as plain objects. If an `error` value contains Korean, an English
// user sees that Korean sentence because Electron cannot call the renderer's useI18n hook. The
// stable contract is `errorKind` + an English, content-free fallback; the renderer translates the
// kind at display time.
//
// This test is the stop. It scans electron/ for Korean string literals assigned to `error:` or an
// intermediate property such as `clickError:`, plus messages thrown via `new Error(...)`, including
// multiline ternaries. A developer-only diagnostic may use the adjacent `locale-error-ok: <reason>`
// escape, but the reason is mandatory. There is deliberately no baseline: user-facing errors must
// be codified instead of grandfathered in.
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('../../electron', import.meta.url))
const KOREAN = /[가-힣]/
const ESCAPE = 'locale-error-ok:'

function jsFiles(dir) {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f)
    if (statSync(p).isDirectory()) return jsFiles(p)
    return /\.jsx?$/.test(f) ? [p] : []
  })
}

function isComment(line) {
  const t = line.trim()
  return t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')
}

/** Collect one error-bearing property, including the multiline ternary shape used by IPC handlers. */
function errorExpression(lines, index) {
  const line = lines[index]
  if (isComment(line)) return null
  const match = line.match(/\b[A-Za-z_$][\w$]*error[\w$]*\s*:\s*(.*)$/i)
  if (!match) return null

  // API/schema objects such as `error: { type: 'integer', description: '오류 수' }` are not an
  // error message. Only scalar/string expressions can cross IPC as the user-visible error field.
  if (match[1].trimStart().startsWith('{')) return null

  const chunks = [match[1]]
  for (let i = index + 1; i < Math.min(lines.length, index + 6); i++) {
    const prior = chunks[chunks.length - 1].replace(/\/\/.*$/, '').trim()
    if (/[,;})]\s*$/.test(prior)) break
    chunks.push(lines[i])
  }
  return chunks.join('\n')
}

/** Story step failures are caught into IPC state, so thrown Error messages use the same contract. */
function thrownErrorExpression(lines, index) {
  const line = lines[index]
  if (isComment(line)) return null
  const match = line.match(/\bnew\s+Error\s*\((.*)$/)
  if (!match) return null

  const chunks = [match[1]]
  for (let i = index + 1; i < Math.min(lines.length, index + 6); i++) {
    const prior = chunks[chunks.length - 1].replace(/\/\/.*$/, '').trim()
    if (/\)\s*[,;}]?\s*$/.test(prior)) break
    chunks.push(lines[i])
  }
  return chunks.join('\n')
}

function escapeReason(lines, index) {
  for (const line of [lines[index - 1] || '', lines[index] || '']) {
    const at = line.indexOf(ESCAPE)
    if (at >= 0) return line.slice(at + ESCAPE.length).trim()
  }
  return null
}

describe('main-process IPC errors must not be Korean', () => {
  it('also recognizes intermediate error properties that are later copied into IPC results', () => {
    const expression = errorExpression([
      "return { clickError: '생성 버튼 클릭 실패' }",
    ], 0)

    expect(expression).toContain('생성 버튼 클릭 실패')
    expect(KOREAN.test(expression)).toBe(true)
  })

  it('no direct or intermediate error value in electron/ carries a Korean user-facing sentence', () => {
    const offenders = []

    for (const file of jsFiles(ROOT)) {
      const lines = readFileSync(file, 'utf8').split('\n')
      lines.forEach((line, i) => {
        const expression = errorExpression(lines, i) || thrownErrorExpression(lines, i)
        const codeOnly = expression?.replace(/\/\/.*$/gm, '')
        if (!codeOnly || !KOREAN.test(codeOnly)) return
        const reason = escapeReason(lines, i)
        if (reason) return
        offenders.push(`${file.replace(ROOT, 'electron')}:${i + 1}  ${line.trim().slice(0, 100)}`)
      })
    }

    expect(
      offenders,
      `Return a stable errorKind and an English, content-free error fallback. ` +
      `Never interpolate names, prompts, paths, or response bodies. ` +
      `Developer-only diagnostics require an adjacent "${ESCAPE} <reason>" escape:\n` +
      offenders.join('\n'),
    ).toEqual([])
  })

  it('escape hatches require a stated reason', () => {
    const invalid = []
    for (const file of jsFiles(ROOT)) {
      const lines = readFileSync(file, 'utf8').split('\n')
      lines.forEach((line, i) => {
        const at = line.indexOf(ESCAPE)
        if (at >= 0 && !line.slice(at + ESCAPE.length).trim()) {
          invalid.push(`${file.replace(ROOT, 'electron')}:${i + 1}`)
        }
      })
    }
    expect(invalid, `Explain why each ${ESCAPE} escape cannot be a localized user-facing error.`).toEqual([])
  })
})
