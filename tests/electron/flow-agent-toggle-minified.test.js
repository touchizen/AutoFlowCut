// @vitest-environment node
//
// THE bug behind "Flow Agent 를 OFF 로 전환하지 못했습니다".
//
// AGENT_TOGGLE_PROBE injects functions into the page with Function.prototype.toString()
// and then calls them BY NAME:
//
//   `(function() {
//      ${isToggleOn.toString()}
//      ${findAgentToggle.toString()}
//      const el = findAgentToggle(document);   // <-- by name
//    })()`
//
// Production minifies the main bundle, so those declarations arrive as `function H$(...)`
// while the call site still says `findAgentToggle`. The page script throws ReferenceError,
// executeJavaScript rejects, ensureAgentOff catches, and generation fails closed — on EVERY
// scene, in EVERY packaged build, no matter what the Flow page looks like. The reporter was
// right the whole time: they were on 모든 미디어 with the Agent off, and it still failed.
//
// Unminified dev builds work, which is exactly why this survived: no ordinary test, and no
// amount of clicking around in `npm run dev`, can see it. So minify for real and run it.
import { describe, it, expect, beforeAll } from 'vitest'
import { buildSync } from 'esbuild'
import { JSDOM } from 'jsdom'
import { fileURLToPath } from 'node:url'
import { writeFileSync, mkdtempSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const SRC = fileURLToPath(new URL('../../electron/flow-agent-toggle.js', import.meta.url))

/** Bundle + minify the module the way `vite build --mode production` does, then load it. */
async function loadMinified() {
  const out = buildSync({
    entryPoints: [SRC],
    bundle: true,
    minify: true,          // mangles identifiers — the whole point
    format: 'esm',
    write: false,
  })
  const dir = mkdtempSync(join(tmpdir(), 'agent-toggle-min-'))
  const file = join(dir, 'bundle.mjs')
  writeFileSync(file, out.outputFiles[0].text)
  return import(file)
}

const REAL_TOGGLE = `<button type="button" aria-pressed="true"><span class="content">에이전트</span></button>`

/** Evaluate a page-expression exactly as webContents.executeJavaScript would: inside the page. */
function runInPage(html, expr) {
  const dom = new JSDOM(`<body>${html}</body>`, { runScripts: 'outside-only' })
  return dom.window.eval(expr)
}

describe('page-injected probes under production minification', () => {
  let mod
  beforeAll(async () => { mod = await loadMinified() })

  it('AGENT_TOGGLE_PROBE finds the toggle after minification', () => {
    // A ReferenceError in the injected source is what surfaces as "Script failed to execute".
    const result = runInPage(REAL_TOGGLE, mod.AGENT_TOGGLE_PROBE)

    expect(result).toMatchObject({ found: true, on: true })
  })

  it('AGENT_TOGGLE_DIAGNOSTIC survives minification too', () => {
    const result = runInPage(REAL_TOGGLE, mod.AGENT_TOGGLE_DIAGNOSTIC)

    expect(result.error).toBeUndefined()
    expect(result.candidates[0]).toMatchObject({ ariaPressed: 'true' })
  })

  it('AGENT_OFF_SCRIPT survives minification too', () => {
    const result = runInPage(REAL_TOGGLE, mod.AGENT_OFF_SCRIPT)

    expect(result).toMatchObject({ found: true, wasOn: true })
  })

  it('the element-returning selectors survive minification (they already did — keep it that way)', () => {
    expect(runInPage(REAL_TOGGLE, mod.AGENT_TOGGLE_SELECTOR)).toBeTruthy()
    expect(runInPage(REAL_TOGGLE, mod.AGENT_CHAT_CLOSE_SELECTOR)).toBeNull()
  })
})
