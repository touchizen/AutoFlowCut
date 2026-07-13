// @vitest-environment node
//
// Seven rounds in, the leaks are no longer in places I forgot to look — they are in the shape of
// the scrubber itself. A value-only regex cannot see that "Basic dXNlcjpwYXNz" is a credential;
// only the KEY (`Authorization`) says so. And a prompt written without quotes runs past the first
// space, so half of it survived redaction.
//
// Scrub by key as well as by value, and make the value patterns actually cover their own claim.
import { describe, it, expect } from 'vitest'
import { scrubSentryString, scrubEvent } from '../../electron/sentry-scrub.js'

describe('scrubbing by KEY, not just by value', () => {
  it('redacts credential headers — the value alone does not look like a secret', () => {
    const event = scrubEvent({
      request: {
        url: 'https://labs.google/fx/api/x',
        headers: { Authorization: 'Basic dXNlcjpwYXNzd29yZA==', Cookie: 'SID=abcdefghijklmnop; refresh=qrstuvwxyzABCDEF' },
      },
    })

    const sent = JSON.stringify(event)
    expect(sent).not.toContain('dXNlcjpwYXNzd29yZA')
    expect(sent).not.toContain('abcdefghijklmnop')
    expect(sent).not.toContain('qrstuvwxyzABCDEF')   // a second cookie after the ';' survived
  })

  it('redacts a prompt nested anywhere, by key', () => {
    const event = scrubEvent({ contexts: { flow: { prompt: 'a lonely lighthouse keeper' } }, tags: { characterName: '홍길동' } })

    const sent = JSON.stringify(event)
    expect(sent).not.toContain('lighthouse keeper')
  })
})

describe('value patterns must cover what they claim', () => {
  it('redacts an unquoted multi-word prompt to the end, not to the first space', () => {
    const out = scrubSentryString('[Flow API] generate: prompt: a lonely lighthouse keeper, cinematic')
    expect(out).not.toContain('lighthouse')
  })

  it('does not eat a word that merely ends in "prompt"', () => {
    const out = scrubSentryString('teleprompt: diagnostics enabled')
    expect(out).toContain('diagnostics enabled')
  })

  it('keeps the sentence after a path that is not followed by more path', () => {
    const out = scrubSentryString('/Users/alice has no home directory')
    expect(out).not.toContain('alice')
    expect(out).toContain('has no home directory')
  })

  it('is linear on a long non-matching string — Sentry hooks run synchronously', () => {
    // The media-URL pattern used to backtrack quadratically: 32KB took ~600ms, 1MB never finished.
    const long = 'https://labs.google/fx/' + 'a'.repeat(200_000)
    const t0 = Date.now()
    scrubSentryString(long)
    expect(Date.now() - t0).toBeLessThan(500)
  })
})
