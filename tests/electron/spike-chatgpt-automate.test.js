import { describe, it, expect } from 'vitest'
import { norm, idOf, CDN_RE, baselineIdsOf, pickNewCdnImage, SELECTORS } from '../../electron/spike-chatgpt-automate.js'

const CDN = 'https://chatgpt.com/backend-api/estuary/content'
const img = (src, over = {}) => ({ src, complete: true, w: 1024, h: 1024, ...over })

describe('norm', () => {
  it('strips ZWSP/ZWNJ/ZWJ/BOM and converts nbsp, then trims', () => {
    expect(norm('\u200B a\u00A0b \uFEFF')).toBe('a b')
    expect(norm('\u200C\u200D')).toBe('')
  })
  it('treats null/undefined as empty string', () => {
    expect(norm(null)).toBe('')
    expect(norm(undefined)).toBe('')
  })
  it('does not collapse inner whitespace (exact prompt comparison)', () => {
    expect(norm('a  b')).toBe('a  b')
  })
})

describe('idOf', () => {
  it('extracts the id query param', () => {
    expect(idOf(`${CDN}?id=file_0001&sig=abc`)).toBe('file_0001')
  })
  it('fail-closed: estuary url without id → null', () => {
    expect(idOf(`${CDN}?sig=abc`)).toBe(null)
  })
  it('unparseable src → null', () => {
    expect(idOf('not a url')).toBe(null)
    expect(idOf('')).toBe(null)
  })
})

describe('CDN_RE', () => {
  it('matches estuary content only', () => {
    expect(CDN_RE.test(`${CDN}?id=a`)).toBe(true)
    expect(CDN_RE.test('https://chatgpt.com/backend-api/files/x?id=a')).toBe(false)
    expect(CDN_RE.test('https://evil.com/backend-api/estuary/content?id=a')).toBe(false)
    expect(CDN_RE.test('http://chatgpt.com/backend-api/estuary/content?id=a')).toBe(false)
    expect(CDN_RE.test('blob:https://chatgpt.com/abc')).toBe(false)
  })
})

describe('baselineIdsOf', () => {
  it('keeps only estuary ids, drops non-cdn and id-less', () => {
    expect(baselineIdsOf([
      img(`${CDN}?id=old1&sig=1`),
      img('blob:https://chatgpt.com/x'),
      img(`${CDN}?sig=noid`),
      img('https://chatgpt.com/backend-api/files/f?id=other'),
    ])).toEqual(['old1'])
  })
})

describe('pickNewCdnImage', () => {
  it('(a) stale baseline id → null', () => {
    expect(pickNewCdnImage(['old1'], [img(`${CDN}?id=old1&sig=1`)])).toBe(null)
  })
  it('(b) transient blob/data src → null', () => {
    expect(pickNewCdnImage([], [img('blob:https://chatgpt.com/x'), img('data:image/png;base64,AAA')])).toBe(null)
  })
  it('(c) wrong backend-api path (not estuary) → null', () => {
    expect(pickNewCdnImage([], [img('https://chatgpt.com/backend-api/files/f?id=new1')])).toBe(null)
  })
  it('(d) same id with a new sig → null', () => {
    expect(pickNewCdnImage(['old1'], [img(`${CDN}?id=old1&sig=REFRESHED`)])).toBe(null)
  })
  it('(e) new id but not finished loading → null', () => {
    expect(pickNewCdnImage([], [img(`${CDN}?id=new1`, { complete: false })])).toBe(null)
    expect(pickNewCdnImage([], [img(`${CDN}?id=new1`, { w: 0 })])).toBe(null)
  })
  it('(f) new id, loaded → returns it with id', () => {
    expect(pickNewCdnImage(['old1'], [
      img(`${CDN}?id=old1&sig=1`),
      img(`${CDN}?id=new1&sig=2`),
    ])).toEqual({ src: `${CDN}?id=new1&sig=2`, id: 'new1', w: 1024, h: 1024 })
  })
  it('(g) fail-closed: estuary without id is never a candidate', () => {
    expect(pickNewCdnImage([], [img(`${CDN}?sig=nosuchid`)])).toBe(null)
  })
  it('prefers the most recent (last) new image', () => {
    const r = pickNewCdnImage([], [img(`${CDN}?id=n1`), img(`${CDN}?id=n2`)])
    expect(r.id).toBe('n2')
  })
  it('tolerates missing/garbage input', () => {
    expect(pickNewCdnImage(undefined, undefined)).toBe(null)
    expect(pickNewCdnImage([], [null, {}, { src: 123 }])).toBe(null)
  })
})

describe('SELECTORS', () => {
  it('are the Phase-1 confirmed ids', () => {
    expect(SELECTORS).toEqual({ composer: '#prompt-textarea', submit: '#composer-submit-button' })
  })
})

import { PAGE_FNS, callPage } from '../../electron/spike-chatgpt-automate.js'

describe('PAGE_FNS string contract', () => {
  it('defines exactly the six spec functions — no more, no less', () => {
    const defined = [...PAGE_FNS.matchAll(/window\.(__cg_\w+__)\s*=/g)].map((m) => m[1])
    expect(defined.sort()).toEqual(
      ['__cg_baseline__', '__cg_clickSubmit__', '__cg_inject__', '__cg_poll__', '__cg_submitAck__', '__cg_verify__'],
    )   // 일곱 번째 stale 함수가 남아도 실패해야 한다
  })
  it('carries the confirmed selectors and the log prefix', () => {
    expect(PAGE_FNS).toContain('#prompt-textarea')
    expect(PAGE_FNS).toContain('#composer-submit-button')
    expect(PAGE_FNS).toContain('[autoflowcut CGPT GEN]')
  })
  it('contains no Node/CDP tokens', () => {
    for (const bad of ['require(', 'process.', 'webContents', 'Debugger.', 'ipcRenderer', 'module.exports']) {
      expect(PAGE_FNS).not.toContain(bad)
    }
  })
})

describe('callPage', () => {
  it('is self-contained: definitions first, call on the last line', () => {
    const s = callPage('__cg_inject__', 'hi "there"')
    expect(s.startsWith(PAGE_FNS)).toBe(true)
    expect(s.trim().split('\n').pop()).toBe('window.__cg_inject__("hi \\"there\\"")')
  })
  it('serializes args as JSON (prompt cannot break out)', () => {
    expect(callPage('__cg_submitAck__', 'a\n");alert(1)//')).toContain(JSON.stringify('a\n");alert(1)//'))
  })
  it('no-arg call', () => {
    expect(callPage('__cg_poll__').trim().split('\n').pop()).toBe('window.__cg_poll__()')
  })
})

// ── eval-boundary: 페이지 함수 문자열을 jsdom 에서 실제로 실행해 "반환 키"를 고정한다.
//    (통합 테스트는 eval 을 mock 하므로 실제 shape 를 못 잡는다 — v3 submitGone 버그 재발 방지)
describe('page functions executed in jsdom', () => {
  const PROMPT = 'a single red apple on a white background'
  const CDNU = 'https://chatgpt.com/backend-api/estuary/content'

  function setup({ composerText = '', hasSubmit = true, images = [] } = {}) {
    document.body.innerHTML = ''
    delete window.__cg_v1
    const c = document.createElement('div')
    c.id = 'prompt-textarea'
    c.setAttribute('contenteditable', 'true')
    c.textContent = composerText
    document.body.appendChild(c)
    if (hasSubmit) {
      const b = document.createElement('button')
      b.id = 'composer-submit-button'
      document.body.appendChild(b)
    }
    for (const im of images) {
      const el = document.createElement('img')
      el.setAttribute('src', im.src)
      Object.defineProperty(el, 'src', { value: im.src, configurable: true })
      Object.defineProperty(el, 'complete', { value: im.complete !== false, configurable: true })
      Object.defineProperty(el, 'naturalWidth', { value: im.w ?? 1024, configurable: true })
      Object.defineProperty(el, 'naturalHeight', { value: im.h ?? 1024, configurable: true })
      el.scrollIntoView = () => {}
      document.body.appendChild(el)
    }
    // jsdom 에 execCommand 가 없다 — ProseMirror 대역으로 텍스트를 실제로 바꾸는 스텁.
    document.execCommand = (cmd, _ui, value) => {
      if (cmd === 'selectAll') return true
      if (cmd === 'delete') { c.textContent = ''; return true }
      if (cmd === 'insertText') { c.textContent += String(value); return true }
      return false
    }
    // eslint-disable-next-line no-new-func
    new Function(PAGE_FNS)()
    return c
  }

  it('__cg_inject__ clears then inserts, and reports textMatches', () => {
    const c = setup({ composerText: 'stale text' })
    const r = window.__cg_inject__(PROMPT)
    expect(r).toEqual({ textMatches: true, submitPresent: true })
    expect(c.textContent).toBe(PROMPT)
  })

  it('__cg_inject__ reports textMatches:false when execCommand does nothing', () => {
    setup({ composerText: '' })
    document.execCommand = () => false
    const r = window.__cg_inject__(PROMPT)
    expect(r.textMatches).toBe(false)
  })

  it('__cg_verify__ does not modify the composer', () => {
    const c = setup({ composerText: PROMPT })
    const r = window.__cg_verify__(PROMPT)
    expect(r).toEqual({ textMatches: true, submitPresent: true })
    expect(c.textContent).toBe(PROMPT)   // 재-inject(clear) 로 지워지면 안 됨
  })

  it('__cg_verify__ normalizes nbsp/ZWSP before comparing', () => {
    setup({ composerText: '\u200Ba single\u00A0red apple on a white background' })
    expect(window.__cg_verify__('a single red apple on a white background').textMatches).toBe(true)
  })

  it('__cg_submitAck__ returns exactly the three keys the state machine reads', () => {
    setup({ composerText: PROMPT })
    const ack = window.__cg_submitAck__(PROMPT)
    expect(Object.keys(ack).sort()).toEqual(['composerCleared', 'stillHasPrompt', 'submitPresent'])
    expect(ack).toEqual({ composerCleared: false, submitPresent: true, stillHasPrompt: true })
    expect('submitGone' in ack).toBe(false)   // v3 옛 키가 다시 들어오면 실패
  })

  it('__cg_submitAck__ after a real submit: cleared composer, submit button gone', () => {
    setup({ composerText: '', hasSubmit: false })
    expect(window.__cg_submitAck__(PROMPT)).toEqual({ composerCleared: true, submitPresent: false, stillHasPrompt: false })
  })

  it('__cg_clickSubmit__ clicks the button and reports it', () => {
    setup({ composerText: PROMPT })
    let clicked = 0
    document.querySelector('#composer-submit-button').addEventListener('click', () => { clicked++ })
    expect(window.__cg_clickSubmit__()).toEqual({ clicked: true })
    expect(clicked).toBe(1)
  })

  it('__cg_clickSubmit__ reports clicked:false when the button is absent', () => {
    setup({ composerText: '', hasSubmit: false })
    expect(window.__cg_clickSubmit__()).toEqual({ clicked: false })
  })

  it('__cg_baseline__ / __cg_poll__ serialize raw images (no filtering in page)', () => {
    setup({ images: [{ src: `${CDNU}?id=a&sig=1` }, { src: 'blob:https://chatgpt.com/x', complete: false, w: 0, h: 0 }] })
    const b = window.__cg_baseline__()
    expect(b.imgs).toHaveLength(2)                      // 필터도 개수 상한도 없다(D1)
    expect(b.imgs[0]).toEqual({ src: `${CDNU}?id=a&sig=1`, complete: true, w: 1024, h: 1024 })
    expect(b.imgs[1]).toEqual({ src: 'blob:https://chatgpt.com/x', complete: false, w: 0, h: 0 })
    expect(window.__cg_poll__().imgs).toHaveLength(2)
  })

  it('serializes every image — no slice cap (stale-acceptance guard)', () => {
    const many = Array.from({ length: 45 }, (_, i) => ({ src: `${CDNU}?id=i${i}&sig=1` }))
    setup({ images: many })
    expect(window.__cg_baseline__().imgs).toHaveLength(45)
    expect(window.__cg_baseline__().imgs[0].src).toContain('id=i0')   // 앞쪽이 잘리면 안 된다
  })

  it('missing composer never throws (returns falsy state)', () => {
    setup({})
    document.querySelector('#prompt-textarea').remove()
    expect(window.__cg_inject__(PROMPT).textMatches).toBe(false)
    expect(window.__cg_verify__(PROMPT).textMatches).toBe(false)
    expect(window.__cg_submitAck__(PROMPT)).toEqual({ composerCleared: false, submitPresent: true, stillHasPrompt: false })
  })

  it('with neither composer nor submit button, every flag is falsy (unknown, never "submitted")', () => {
    setup({ hasSubmit: false })
    document.querySelector('#prompt-textarea').remove()
    expect(window.__cg_submitAck__(PROMPT)).toEqual({ composerCleared: false, submitPresent: false, stillHasPrompt: false })
  })

  it('definition block is idempotent (re-eval keeps existing fns)', () => {
    setup({})
    const first = window.__cg_poll__
    // eslint-disable-next-line no-new-func
    new Function(PAGE_FNS)()
    expect(window.__cg_poll__).toBe(first)
  })

  it('main-side helpers agree with the images the page emits', () => {
    setup({ images: [{ src: `${CDNU}?id=old&sig=1` }, { src: `${CDNU}?id=new&sig=2` }] })
    const imgs = window.__cg_poll__().imgs
    expect(baselineIdsOf(imgs)).toEqual(['old', 'new'])
    expect(pickNewCdnImage(['old'], imgs).id).toBe('new')
  })
})

import { vi } from 'vitest'
import { clearComposerAndType, pressEnter, withEvalTimeout, SPIKE_PROMPT } from '../../electron/spike-chatgpt-automate.js'

// focus 가 첫 입력 이벤트보다 **먼저** 인지까지 봐야 한다 — 나중에 focus 해도 통과하면 false-green.
function fakeView() {
  const order = []
  return {
    order,
    webContents: {
      focus: vi.fn(() => order.push('focus')),
      sendInputEvent: vi.fn((e) => order.push(`${e.type}:${e.keyCode}`)),
    },
  }
}

describe('clearComposerAndType', () => {
  it('focuses FIRST, then selects all, deletes, then types each character', () => {
    const v = fakeView()
    clearComposerAndType(v, 'ab')
    expect(v.order[0]).toBe('focus')
    expect(v.order).toEqual(['focus', 'keyDown:a', 'keyUp:a', 'keyDown:Delete', 'keyUp:Delete', 'char:a', 'char:b'])
    const evs = v.webContents.sendInputEvent.mock.calls.map(([e]) => e)
    expect(evs[0]).toEqual({ type: 'keyDown', keyCode: 'a', modifiers: ['cmd'] })
    expect(evs[1]).toEqual({ type: 'keyUp', keyCode: 'a', modifiers: ['cmd'] })
    expect(evs[2]).toEqual({ type: 'keyDown', keyCode: 'Delete' })
    expect(evs[3]).toEqual({ type: 'keyUp', keyCode: 'Delete' })
    expect(evs.slice(4)).toEqual([
      { type: 'char', keyCode: 'a' },
      { type: 'char', keyCode: 'b' },
    ])
  })
})

describe('pressEnter', () => {
  it('focuses first, then sends the Flow-proven Return sequence once', () => {
    const v = fakeView()
    pressEnter(v)
    expect(v.order).toEqual(['focus', 'keyDown:Return', 'char:\r', 'keyUp:Return'])
    expect(v.webContents.sendInputEvent.mock.calls.map(([e]) => e)).toEqual([
      { type: 'keyDown', keyCode: 'Return' },
      { type: 'char', keyCode: '\r' },
      { type: 'keyUp', keyCode: 'Return' },
    ])
  })
})

describe('withEvalTimeout', () => {
  it('passes the resolved value through', async () => {
    await expect(withEvalTimeout(Promise.resolve(7), 1000)).resolves.toBe(7)
  })
  it('rejects when the promise never settles (a hung executeJavaScript cannot hang the shortcut)', async () => {
    await expect(withEvalTimeout(new Promise(() => {}), 5)).rejects.toThrow(/eval timeout/)
  })
  it('swallows a late rejection from the loser so it is not an unhandled rejection', async () => {
    let reject
    const p = new Promise((_, rj) => { reject = rj })
    await expect(withEvalTimeout(p, 5)).rejects.toThrow(/eval timeout/)
    reject(new Error('late'))                       // 흡수 안 하면 unhandledRejection
    await new Promise((r) => setTimeout(r, 10))
  })
})

describe('SPIKE_PROMPT', () => {
  it('is ASCII-only so sendInputEvent char typing can reproduce it', () => {
    // 타입 단언이 먼저 — 정규식은 undefined 도 'undefined' 로 강제 변환해 통과시킨다.
    expect(typeof SPIKE_PROMPT).toBe('string')
    expect(SPIKE_PROMPT.length).toBeGreaterThan(10)
    // eslint-disable-next-line no-control-regex
    expect(/^[\x20-\x7E]+$/.test(SPIKE_PROMPT)).toBe(true)
  })
})
