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
import {
  ENGLISH_AGENT_SETTINGS,
  ENGLISH_COMPOSER,
} from '../fixtures/flow-live-dom-20260714.js'
import { buildComposer, paragraph, uuid } from '../fixtures/flow-live-dom-m3.js'

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

const REAL_TOGGLE = ENGLISH_COMPOSER.replace('aria-pressed="false"', 'aria-pressed="true"')
const JAPANESE_TOGGLE = REAL_TOGGLE.replace('>Agent<', '>エージェント<')

/** Evaluate a page-expression exactly as webContents.executeJavaScript would: inside the page. */
function runInPage(html, expr) {
  const dom = new JSDOM(`<body>${html}</body>`, { runScripts: 'outside-only' })
  dom.window.Element.prototype.getBoundingClientRect = () => ({ width: 100, height: 30 })
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
    expect(runInPage('<button type="button">No panel</button>', mod.AGENT_CHAT_CLOSE_SELECTOR)).toBeNull()
  })

  // 리뷰 R1: 위 케이스는 close 버튼이 없어 isAgentHeader 까지 가지 않는다 — 판별 경로를 압축본으로 직접 태운다.
  it('the agent chat close selector reaches its header check after minification — header found, composer clear never', () => {
    const header = `<div class="agent-panel-header"><button aria-label="History"><i class="google-symbols">menu</i></button>`
      + `<button aria-label="New session"><i class="google-symbols">edit_square</i></button>`
      + `<button class="target" aria-label="Close"><i class="google-symbols">close</i></button></div>`
    expect(runInPage(header, mod.AGENT_CHAT_CLOSE_SELECTOR)?.className).toBe('target')
    const composer = buildComposer({ chips: [{ id: uuid(1) }], editorHtml: paragraph('조선 왕실의 기록 보관소') })
    expect(runInPage(composer, mod.AGENT_CHAT_CLOSE_SELECTOR)).toBeNull()
  })

  it('the structural toggle selector stays locale-invariant after minification', () => {
    const toggle = runInPage(JAPANESE_TOGGLE, mod.AGENT_TOGGLE_SELECTOR)
    expect(toggle?.textContent.trim()).toBe('エージェント')
  })

  it('the structural settings close selector stays self-contained after minification', () => {
    const button = runInPage(ENGLISH_AGENT_SETTINGS, mod.AGENT_SETTINGS_CLOSE_SELECTOR)
    const icons = [...button.querySelectorAll('i')].map((icon) => icon.textContent.trim())
    expect(icons).toContain('arrow_back')
  })
})
