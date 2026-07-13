// @vitest-environment node
//
// Six rounds, and each one found the leak had simply moved to a channel I had not looked at:
// main's console → the http breadcrumb URL → the renderer (which had no scrubbing at all) → and
// now the EVENT itself. beforeSend deleted a couple of fields; it never scrubbed event.message,
// the exception value, request.url, or extra. So an error whose message is
// "ENOENT: /Users/alice/Desktop/secret.txt" went out whole.
//
// One scrubber. Every channel. Breadcrumbs AND events.
import { describe, it, expect } from 'vitest'
import { scrubSentryString, scrubEvent } from '../../electron/sentry-scrub.js'

describe('scrubSentryString', () => {
  it('redacts the account name from a path but keeps the rest — the path is the diagnosis', () => {
    // Redacting the whole path deletes the information we need. The account name is the PII;
    // "Desktop/flow-dom-dump.json" is the answer to "where did it go".
    const out = scrubSentryString('failed /Users/Gordon Ahn/Desktop/dump.json because permission denied')
    expect(out).not.toContain('Gordon')
    expect(out).toContain('Desktop/dump.json')
    expect(out).toContain('because permission denied')
  })

  it('redacts a prompt written as a JSON key, not just as prompt:', () => {
    const out = scrubSentryString('payload={"prompt":"a lonely lighthouse keeper"}')
    expect(out).not.toContain('lighthouse keeper')
  })

  it('redacts the credential families that ride in URLs and headers', () => {
    expect(scrubSentryString('?refresh_token=1//0abcdefghijklmnop')).not.toContain('0abcdefghijklmnop')
    expect(scrubSentryString('Authorization: Basic dXNlcjpwYXNzd29yZA==')).not.toContain('dXNlcjpwYXNzd29yZA')
    expect(scrubSentryString('Cookie: SID=abcdefghijklmnopqrstu')).not.toContain('abcdefghijklmnopqrstu')
  })
})

describe('scrubEvent', () => {
  it('scrubs the message, the exception value, request.url and extra', () => {
    const event = scrubEvent({
      message: 'upload failed for /Users/alice/Desktop/private.png',
      exception: { values: [{ type: 'Error', value: 'ENOENT /Users/alice/Desktop/private.png' }] },
      request: { url: 'https://generativelanguage.googleapis.com/v1beta/models:x?key=AIzaSyC-REAL-KEY' },
      extra: { detail: { error: 'ENOENT /Users/alice/Desktop/private.png' } },
    })

    const sent = JSON.stringify(event)
    expect(sent).not.toContain('alice')
    expect(sent).not.toContain('AIzaSyC-REAL-KEY')
    // The shape of the failure survives — that is what we came for.
    expect(event.exception.values[0].value).toContain('ENOENT')
  })

  it('survives a circular event without throwing — cleanup must never be the crash', () => {
    const event = { message: 'x', extra: {} }
    event.extra.self = event.extra

    expect(() => scrubEvent(event)).not.toThrow()
  })
})
