// @vitest-environment node
//
// M3-5 — 레퍼런스 업로드의 클립보드 정책(계획서 2026-09-25 M3 D4-c · 사용자 결정 4 · PR P1d).
//   스냅샷: text/uri-list(Finder 파일 복사)가 있으면 fileCopy(호출자가 업로드를 멈춘다). 그 밖엔 text·html·rtf·image 중 있는 것만 보관하고
//   앱 전용 형식(application/x-lexical-editor 등)은 보관하지도 멈추지도 않는다.
//   쓰기: writeImage 1회 + 서명(sha256(readImage().toPNG())) + 쓴 뒤의 형식 목록.
//   복원: 지금 형식·이미지 서명이 쓴 것과 같을 때만 clear 뒤 write(빈 스냅샷이면 clear 만). 다르면 사용자가 그 사이 복사한 것 — 건드리지 않는다.
//   복원 throw 는 로그만(다시 던지지 않는다). 로그는 개수·불리언·상태어만(클립보드 내용 없음).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createHash } from 'node:crypto'
import { snapshotClipboard, writeUploadImage, restoreClipboard } from '../../electron/flow-clipboard.js'
import { makeFakeClipboard, fakeNativeImage, pngBytes } from '../helpers/fakeFlowComposer.js'

const TEXT = 'SECRET-TEXT user copied this'
const HTML = '<b>SECRET-HTML</b>'
const RTF = '{\\rtf1 SECRET-RTF}'
const sha = (b) => createHash('sha256').update(b).digest('hex')

let logSpy, warnSpy
beforeEach(() => {
  logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
  warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
})
afterEach(() => { logSpy.mockRestore(); warnSpy.mockRestore() })
const logged = () => [...logSpy.mock.calls, ...warnSpy.mock.calls].map((c) => c.map(String).join(' ')).join('\n')

/** 스냅샷 → 업로드 이미지 쓰기 → 복원 한 바퀴. 복원 호출만 따로 본다. */
function roundTrip(clip, opts) {
  const saved = snapshotClipboard(clip, opts)
  const written = writeUploadImage(clip, fakeNativeImage.createFromBuffer(pngBytes('ref')))
  clip.calls.length = 0
  const r = restoreClipboard(clip, saved, written)
  return { saved, written, r }
}
const writeArg = (clip, spy) => spy.mock.calls.map((c) => c[0])

describe('snapshotClipboard — 형식 정책(D4-c)', () => {
  it('앱 텍스트창(text/plain · text/html · application/x-lexical-editor) → 막지 않음, 복원 write 가 **정확히** {text, html}(Lexical 없음)', () => {
    const clip = makeFakeClipboard({ formats: ['text/plain', 'text/html', 'application/x-lexical-editor'], text: TEXT, html: HTML })
    const write = vi.spyOn(clip, 'write')
    const { saved, r } = roundTrip(clip)
    expect(saved.fileCopy).toBe(false)
    expect(saved.formats).toBe(3)
    expect(r).toEqual({ restored: true })
    expect(clip.calls).toEqual(['availableFormats', 'readImage', 'clear', 'write'])
    expect(writeArg(clip, write)).toEqual([{ text: TEXT, html: HTML }])
  })

  it('Finder 파일 복사(text/plain · text/uri-list) → fileCopy:true(호출자가 거부)', () => {
    const clip = makeFakeClipboard({ formats: ['text/plain', 'text/uri-list'], text: '/Users/me/secret.png' })
    const saved = snapshotClipboard(clip)
    expect(saved.fileCopy).toBe(true)
    expect(saved.formats).toBe(2)
  })

  it('미리보기에서 복사한 이미지(image/png) → 복원 write({image}) — 같은 바이트', () => {
    const src = pngBytes('user-picture')
    const clip = makeFakeClipboard({ formats: ['image/png'], image: src })
    const write = vi.spyOn(clip, 'write')
    const { saved, r } = roundTrip(clip)
    expect(saved.fileCopy).toBe(false)
    expect(r).toEqual({ restored: true })
    const args = writeArg(clip, write)
    expect(args).toHaveLength(1)
    expect(Object.keys(args[0])).toEqual(['image'])
    expect(Buffer.compare(args[0].image.toPNG(), src)).toBe(0)
    expect(Buffer.compare(clip.state.image, src)).toBe(0)
  })

  it('Windows: rtf 도 보관·복원 → write({text, rtf})', () => {
    const clip = makeFakeClipboard({ formats: ['text/plain', 'text/rtf'], text: TEXT, rtf: RTF })
    const write = vi.spyOn(clip, 'write')
    roundTrip(clip, { platform: 'win32' })
    expect(writeArg(clip, write)).toEqual([{ text: TEXT, rtf: RTF }])
  })

  it('Windows: html 은 형식 목록으로 판정한다(원시 public.html 이 없는 플랫폼) → write({text, html})', () => {
    const clip = makeFakeClipboard({ formats: ['text/plain', 'text/html'], text: TEXT, html: HTML })
    clip.readBuffer = () => Buffer.alloc(0)   // Windows 엔 'public.html' 이 없다 — 이걸 보면 진짜 HTML 을 버린다
    const write = vi.spyOn(clip, 'write')
    roundTrip(clip, { platform: 'win32' })
    expect(writeArg(clip, write)).toEqual([{ text: TEXT, html: HTML }])
  })

  // 실기(2026-09-26 G1 · TextEdit 재현): macOS Chromium 은 HTML 을 두 겹으로 지어낸다 —
  //   ① availableFormats() 는 public.rtf 만 있어도 text/html 을 올린다(ClipboardMac::IsFormatAvailable — "RTF 를 HTML 로 바꿀 수 있다").
  //   ② readHTML() 은 HTML 이 없으면 RTF 변환본이나 plain 문자열로 채운다.
  //   그대로 보관하면 복원 뒤 원래 없던 public.html 이 생긴다(plain 복사 formats=1 · TextEdit 복사 formats=3, 둘 다 실측).
  //   원시 public.html 바이트(readBuffer — 폴백 없음)만 진짜 HTML 의 증거다.
  const macClipboard = (init) => {
    const clip = makeFakeClipboard(init)
    const has = (f) => clip.state.formats.includes(f)
    clip.availableFormats = () => {
      clip.calls.push('availableFormats')
      const list = [...clip.state.formats]
      if (has('text/rtf') && !has('text/html')) list.push('text/html')
      return list
    }
    clip.readHTML = () => {
      clip.calls.push('readHTML')
      if (has('text/html')) return clip.state.html
      if (has('text/rtf')) return `<meta charset='utf-8'><p>${clip.state.text}</p>`
      return clip.state.text ? `<meta charset='utf-8'>${clip.state.text}` : ''
    }
    // ③ write({html}) 은 앞에 <meta charset='utf-8'> 를 붙인다(readHTML 은 떼지 않는다 — 실기 (b) 에서 meta 가 둘이 됐다).
    const baseWrite = clip.write
    clip.write = (data) => baseWrite(data && data.html ? { ...data, html: `<meta charset='utf-8'>${data.html}` } : data)
    return clip
  }
  const MAC = { platform: 'darwin' }
  const CHROME_HTML = "<meta charset='utf-8'><b>SECRET-HTML</b>"

  it('macOS 크롬 복사(<meta charset> 로 시작하는 html) → 복원 뒤 html 이 **바이트 그대로**(쓰기가 붙이는 meta 가 겹치지 않는다)', () => {
    const clip = macClipboard({ formats: ['text/plain', 'text/html'], text: TEXT, html: CHROME_HTML })
    roundTrip(clip, MAC)
    expect(clip.state.html).toBe(CHROME_HTML)
  })

  it('macOS: 이미 meta 가 두 겹(수정 전 복원이 남긴 것)이어도 **하나만** 뗀다 → 바이트 그대로', () => {
    const doubled = `<meta charset='utf-8'>${CHROME_HTML}`
    const clip = macClipboard({ formats: ['text/plain', 'text/html'], text: TEXT, html: doubled })
    roundTrip(clip, MAC)
    expect(clip.state.html).toBe(doubled)
  })

  it('macOS: 맨 앞이 아닌 meta 는 떼지 않는다 → 쓰기가 앞에 하나 붙인 모양으로 돌아온다', () => {
    const inner = "<p>SECRET-HTML</p><meta charset='utf-8'>"
    const clip = macClipboard({ formats: ['text/plain', 'text/html'], text: TEXT, html: inner })
    roundTrip(clip, MAC)
    expect(clip.state.html).toBe(`<meta charset='utf-8'>${inner}`)
  })

  // 프로덕션(flow-reference-driver)은 platform 을 넘기지 않는다 — 기본값이 process.platform 인지 핀으로 묶는다.
  //   'win32' 로 굳으면 macOS 에 TextEdit 버그가 돌아오고, 'darwin' 으로 굳으면 Windows·Linux 의 html 을 전부 버린다.
  const withPlatform = (p, fn) => {
    const orig = Object.getOwnPropertyDescriptor(process, 'platform')
    Object.defineProperty(process, 'platform', { value: p, configurable: true })
    try { return fn() } finally { Object.defineProperty(process, 'platform', orig) }
  }

  it('기본 platform(darwin 에서 실행) → TextEdit 복사가 지어낸 HTML 없이 {text, rtf}', () => {
    const clip = macClipboard({ formats: ['text/plain', 'text/rtf'], text: TEXT, rtf: RTF })
    const write = vi.spyOn(clip, 'write')
    withPlatform('darwin', () => roundTrip(clip))
    expect(writeArg(clip, write)).toEqual([{ text: TEXT, rtf: RTF }])
  })

  it('기본 platform(win32 에서 실행) → html 을 형식 목록으로 판정해 {text, html}', () => {
    const clip = makeFakeClipboard({ formats: ['text/plain', 'text/html'], text: TEXT, html: HTML })
    clip.readBuffer = () => Buffer.alloc(0)
    const write = vi.spyOn(clip, 'write')
    withPlatform('win32', () => roundTrip(clip))
    expect(writeArg(clip, write)).toEqual([{ text: TEXT, html: HTML }])
  })

  it('Windows 는 meta 를 떼지 않는다(쓰기가 다시 붙이지 않는다) → write 의 html 이 읽은 그대로', () => {
    const clip = makeFakeClipboard({ formats: ['text/plain', 'text/html'], text: TEXT, html: CHROME_HTML })
    const write = vi.spyOn(clip, 'write')
    roundTrip(clip, { platform: 'win32' })
    expect(writeArg(clip, write)).toEqual([{ text: TEXT, html: CHROME_HTML }])
  })

  it('macOS plain text 만(터미널·스토리 입력창 복사) → 지어낸 HTML 을 보관하지 않는다, 복원 write 가 **정확히** {text}', () => {
    const clip = macClipboard({ formats: ['text/plain'], text: TEXT })
    const write = vi.spyOn(clip, 'write')
    const { saved, r } = roundTrip(clip, MAC)
    expect(saved.formats).toBe(1)
    expect(r).toEqual({ restored: true })
    expect(writeArg(clip, write)).toEqual([{ text: TEXT }])
    expect(clip.state.formats).toEqual(['text/plain'])
  })

  it('macOS TextEdit 복사(text + rtf, 목록엔 text/html 도 뜬다) → RTF 변환 HTML 을 보관하지 않는다, write 가 **정확히** {text, rtf}', () => {
    const clip = macClipboard({ formats: ['text/plain', 'text/rtf'], text: TEXT, rtf: RTF })
    const write = vi.spyOn(clip, 'write')
    const { saved } = roundTrip(clip, MAC)
    expect(saved.formats).toBe(3)
    expect(writeArg(clip, write)).toEqual([{ text: TEXT, rtf: RTF }])
  })

  it('macOS Word 복사(text + html + rtf) → 진짜 HTML 과 RTF 를 둘 다 보관, write 가 **정확히** {text, html, rtf}', () => {
    const clip = macClipboard({ formats: ['text/plain', 'text/html', 'text/rtf'], text: TEXT, html: HTML, rtf: RTF })
    const write = vi.spyOn(clip, 'write')
    roundTrip(clip, MAC)
    expect(writeArg(clip, write)).toEqual([{ text: TEXT, html: HTML, rtf: RTF }])
  })

  it('macOS 앱 텍스트창(text + html + Lexical) → 진짜 HTML 보관, write 가 **정확히** {text, html}', () => {
    const clip = macClipboard({ formats: ['text/plain', 'text/html', 'application/x-lexical-editor'], text: TEXT, html: HTML })
    const write = vi.spyOn(clip, 'write')
    roundTrip(clip, MAC)
    expect(writeArg(clip, write)).toEqual([{ text: TEXT, html: HTML }])
  })

  it('빈 클립보드 → 복원은 clear() 만(write 없음)', () => {
    const clip = makeFakeClipboard({ formats: [] })
    const { saved, r } = roundTrip(clip)
    expect(saved).toMatchObject({ formats: 0, fileCopy: false })
    expect(r).toEqual({ restored: true })
    expect(clip.calls).toEqual(['availableFormats', 'readImage', 'clear'])
    expect(clip.state.formats).toEqual([])
  })

  it('availableFormats 가 throw → fileCopy:true 로 본다(판정 불가 — 쓰지 않는다, fail-closed)', () => {
    const clip = makeFakeClipboard({ formats: ['text/plain'], text: TEXT })
    clip.failOn('availableFormats')
    expect(snapshotClipboard(clip).fileCopy).toBe(true)
  })
})

describe('writeUploadImage — writeImage 1회 + 서명', () => {
  it('writeImage 한 번, sig = sha256(readImage().toPNG()), 쓴 뒤 형식 목록', () => {
    const clip = makeFakeClipboard({ formats: ['text/plain'], text: TEXT })
    const bytes = pngBytes('ref-a')
    const w = writeUploadImage(clip, fakeNativeImage.createFromBuffer(bytes))
    expect(clip.calls.filter((c) => c === 'writeImage')).toHaveLength(1)
    expect(w.sig).toBe(sha(bytes))
    expect(w.fmts).toEqual(['image/png'])
  })
})

describe('restoreClipboard — 서명이 같을 때만', () => {
  it('서명·형식 같음 → clear 뒤 write', () => {
    const clip = makeFakeClipboard({ formats: ['text/plain'], text: TEXT })
    const { r } = roundTrip(clip)
    expect(r).toEqual({ restored: true })
    expect(clip.calls.indexOf('clear')).toBeLessThan(clip.calls.indexOf('write'))
    expect(clip.state).toMatchObject({ text: TEXT, formats: ['text/plain'] })
  })

  it('우리가 쓴 뒤 사용자가 다른 텍스트를 복사 → {restored:false, reason:"changed-by-user"}, write·clear 미호출', () => {
    const clip = makeFakeClipboard({ formats: ['text/plain'], text: TEXT })
    const saved = snapshotClipboard(clip)
    const written = writeUploadImage(clip, fakeNativeImage.createFromBuffer(pngBytes('ref')))
    clip.userCopiesText('something new')
    clip.calls.length = 0
    expect(restoreClipboard(clip, saved, written)).toEqual({ restored: false, reason: 'changed-by-user' })
    expect(clip.calls).not.toContain('write')
    expect(clip.calls).not.toContain('clear')
    expect(clip.state.text).toBe('something new')
    expect(logged()).toMatch(/\[Flow Upload\] clipboard changed during upload — not restored/)
  })

  it('사용자가 **다른 이미지**를 복사(형식은 같은 image/png) → changed-by-user — 형식만 보는 구현은 빨갛다', () => {
    const clip = makeFakeClipboard({ formats: ['text/plain'], text: TEXT })
    const saved = snapshotClipboard(clip)
    const written = writeUploadImage(clip, fakeNativeImage.createFromBuffer(pngBytes('ref')))
    clip.userCopiesImage(pngBytes('another-picture'))
    clip.calls.length = 0
    expect(restoreClipboard(clip, saved, written)).toEqual({ restored: false, reason: 'changed-by-user' })
    expect(clip.calls).not.toContain('write')
    expect(clip.calls).not.toContain('clear')
  })

  it('write 가 throw → {restored:false, reason:"restore-threw"}, 다시 던지지 않는다', () => {
    const clip = makeFakeClipboard({ formats: ['text/plain'], text: TEXT })
    const saved = snapshotClipboard(clip)
    const written = writeUploadImage(clip, fakeNativeImage.createFromBuffer(pngBytes('ref')))
    clip.failOn('write')
    let r
    expect(() => { r = restoreClipboard(clip, saved, written) }).not.toThrow()
    expect(r).toEqual({ restored: false, reason: 'restore-threw' })
    expect(logged()).toMatch(/\[Flow Upload\] clipboard restore failed/)
  })

  it('로그에 스냅샷 텍스트·html·rtf 가 없다(개수·불리언·상태어만)', () => {
    const clip = makeFakeClipboard({ formats: ['text/plain', 'text/html', 'text/rtf'], text: TEXT, html: HTML, rtf: RTF })
    roundTrip(clip)
    const clip2 = makeFakeClipboard({ formats: ['text/plain'], text: TEXT })
    const saved = snapshotClipboard(clip2)
    const written = writeUploadImage(clip2, fakeNativeImage.createFromBuffer(pngBytes('ref')))
    clip2.userCopiesText(TEXT + ' again')
    restoreClipboard(clip2, saved, written)
    const out = logged()
    expect(out).toMatch(/clipboard restored/)
    expect(out).not.toMatch(/SECRET/)
  })
})
