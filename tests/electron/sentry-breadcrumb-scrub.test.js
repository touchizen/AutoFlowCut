// @vitest-environment node
//
// @sentry/electron enables node.consoleIntegration() by default, so every main-process
// console.log becomes a Sentry breadcrumb. The Flow generation path logs the user's
// prompt text — flow-api.js "generate-image: { prompt: ... }" and dom.js
// "dom-send-prompt called: ..." — so that text rides along with any captured event.
//
// beforeSend only scrubs event.extra keys; it never touches event.breadcrumbs. Diagnostics
// are worth collecting, the user's prompt is not ours to take.
import { describe, it, expect, vi } from 'vitest'

vi.mock('@sentry/electron/main', () => ({ init: vi.fn(), captureMessage: vi.fn() }))

const { buildSentryOptions } = await import('../../electron/sentry-init.js')

const opts = () => buildSentryOptions({
  env: { ENABLE_SENTRY: '1', SENTRY_DSN: 'https://x@sentry.io/1', VITE_FUNCTION_ENV: 'prod' },
  version: '3.0.0',
})

describe('beforeBreadcrumb — console breadcrumbs must not carry prompt text', () => {
  it('redacts the prompt from the generate-image console breadcrumb', () => {
    const { beforeBreadcrumb } = opts()

    const out = beforeBreadcrumb({
      category: 'console',
      level: 'log',
      message: "[Flow API] generate-image: { prompt: 'a lonely lighthouse keeper at dusk', model: 'x' }",
    })

    expect(out).toBeTruthy()
    expect(out.message).not.toContain('lighthouse keeper')
    expect(out.message).toContain('[Flow API] generate-image')
  })

  it('redacts the prompt from the dom-send-prompt console breadcrumb', () => {
    const { beforeBreadcrumb } = opts()

    const out = beforeBreadcrumb({
      category: 'console',
      level: 'log',
      message: '[DOM IPC] dom-send-prompt called: a lonely lighthouse keeper at dusk',
    })

    expect(out.message).not.toContain('lighthouse keeper')
  })

  it('keeps the diagnostic breadcrumbs we actually need', () => {
    const { beforeBreadcrumb } = opts()

    const kept = beforeBreadcrumb({
      category: 'console',
      level: 'log',
      message: '[Flow API] ensureAgentOff: toggle not found (panel close retries exhausted)',
    })

    expect(kept.message).toBe('[Flow API] ensureAgentOff: toggle not found (panel close retries exhausted)')
  })

  it('redacts OAuth access tokens', () => {
    const { beforeBreadcrumb } = opts()

    // Real line from a packaged run — the Flow session response carries the bearer token.
    // Re-enabling console in the main bundle is what made this reachable; a source fix
    // alone is one forgotten console.log away from shipping a credential to Sentry.
    const out = beforeBreadcrumb({
      category: 'console',
      level: 'log',
      message: '[Flow API] Session: {"access_token":"ya29.a0ARGnu0bK4_CYGQzj4opLWhL-MJl3kNcflKLgvlj7"}',
    })

    expect(out.message).not.toContain('ya29.a0ARGnu0bK4_CYGQzj4opLWhL')
    expect(out.message).toContain('[Flow API] Session')
  })

  it('redacts email addresses', () => {
    const { beforeBreadcrumb } = opts()

    const out = beforeBreadcrumb({
      category: 'console',
      level: 'log',
      message: '[Flow API] user: {"email":"gordon.ahn@gmail.com"}',
    })

    expect(out.message).not.toContain('gordon.ahn@gmail.com')
  })

  it('drops the raw console arguments — scrubbing the message alone is not enough', () => {
    const { beforeBreadcrumb } = opts()

    // Sentry's console integration keeps the original args in data.arguments, so a redacted
    // message still shipped the unredacted object. Regexes can never cover free-form content
    // (character names, captions, folder paths), so the raw args must not leave at all.
    const out = beforeBreadcrumb({
      category: 'console',
      level: 'log',
      message: '[Flow API] generate-image: <redacted>',
      data: { arguments: [{ prompt: 'a lonely lighthouse keeper', name: '홍길동' }], logger: 'console' },
    })

    expect(JSON.stringify(out)).not.toContain('lighthouse keeper')
    expect(JSON.stringify(out)).not.toContain('홍길동')
    expect(out.data?.arguments).toBeUndefined()
  })

  it('redacts absolute filesystem paths — they carry the user name', () => {
    const { beforeBreadcrumb } = opts()

    // Download dirs, dump files, save paths. Scrubbing these at the source is whack-a-mole;
    // the shape is regular, so kill it at the boundary.
    const mac = beforeBreadcrumb({ category: 'console', level: 'log', message: '[FlowDomDump] wrote 63 elements → /Users/gordon/Desktop/flow-dom-dump.json' })
    expect(mac.message).not.toContain('/Users/gordon')
    expect(mac.message).toContain('[FlowDomDump] wrote 63 elements')

    const win = beforeBreadcrumb({ category: 'console', level: 'log', message: '[Flow DOMDownload] Download dir: C:\\Users\\gordon\\AppData\\Local\\Temp\\x' })
    expect(win.message).not.toContain('gordon')
  })

  it('redacts credentials from NON-console breadcrumbs — http breadcrumbs carry the URL', () => {
    const { beforeBreadcrumb } = opts()

    // Sentry's http integration records the request URL. Gemini TTS puts the user's API key in
    // the query string; Flow's token check puts the OAuth token there. Scrubbing only console
    // breadcrumbs left the credential channel wide open.
    const http = beforeBreadcrumb({
      category: 'http',
      type: 'http',
      data: { url: 'https://generativelanguage.googleapis.com/v1beta/models:x?key=AIzaSyC-REAL-USER-KEY', method: 'POST', status_code: 200 },
    })
    expect(JSON.stringify(http)).not.toContain('AIzaSyC-REAL-USER-KEY')

    const tok = beforeBreadcrumb({
      category: 'fetch',
      data: { url: 'https://labs.google/fx/api/auth/token?access_token=ya29.a0ARGnu0bK4_CYGQzj' },
    })
    expect(JSON.stringify(tok)).not.toContain('ya29.a0ARGnu0bK4_CYGQzj')
  })

  it('drops Flow page console entirely — the page is the user\'s content', () => {
    const { beforeBreadcrumb } = opts()

    // main.js forwards the Flow page's console into the main process, so page scripts (the
    // settings dumper, DOM probes) push whole chunks of Flow's DOM into breadcrumbs. The page
    // is the user's project: their prompts, media, character names. None of it is ours.
    const out = beforeBreadcrumb({
      category: 'console',
      level: 'log',
      message: '[Flow Page] [autoflowcut DUMP] panel html: <div>홍길동 캐릭터 · a lonely lighthouse keeper</div>',
    })

    expect(out).toBeNull()
  })

  it('keeps non-console breadcrumbs that carry nothing sensitive', () => {
    const { beforeBreadcrumb } = opts()
    const crumb = { category: 'navigation', data: { from: '/a', to: '/b' } }

    expect(beforeBreadcrumb({ ...crumb })).toMatchObject(crumb)
  })
})

// M1-6: flow.google.com 의 미디어는 서명 URL(flow-content.google/…?Expires&KeyName&Signature, ~6h 유효) 로 온다.
//   Electron net 브레드크럼·다운로드 로그가 그 URL 을 실으면 Sentry 가 6시간짜리 미디어 접근권을 받는다.
describe('beforeBreadcrumb — flow-content.google 서명 URL (M1-6)', () => {
  const SIGNED = 'https://flow-content.google/video/2f1c9a7e-1111-2222-3333-444455556666?Expires=1790261742&KeyName=labs-flow-prod-cdn-key&Signature=SIG123'

  it('electron.net 브레드크럼의 data.url 에서 서명 URL 을 통째로 지운다(호스트도 남지 않는다)', () => {
    const { beforeBreadcrumb } = opts()
    const out = beforeBreadcrumb({ category: 'electron.net', type: 'http', data: { url: SIGNED, method: 'GET', status_code: 200 } })
    expect(out.data.url).not.toContain('SIG123')
    expect(out.data.url).not.toContain('flow-content.google')
    expect(JSON.stringify(out)).not.toContain('SIG123')
  })

  it('콘솔 메시지 안의 서명 파라미터도 지운다', () => {
    const { beforeBreadcrumb } = opts()
    const out = beforeBreadcrumb({ category: 'console', level: 'log', message: '[Flow VideoDownload] Fetching: ' + SIGNED })
    expect(out.message).not.toContain('SIG123')
    expect(out.message).toContain('[Flow VideoDownload]')
  })
})
