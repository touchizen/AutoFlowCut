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
function roundTrip(clip) {
  const saved = snapshotClipboard(clip)
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

  it('rtf 도 보관·복원 → write({text, rtf})', () => {
    const clip = makeFakeClipboard({ formats: ['text/plain', 'text/rtf'], text: TEXT, rtf: RTF })
    const write = vi.spyOn(clip, 'write')
    roundTrip(clip)
    expect(writeArg(clip, write)).toEqual([{ text: TEXT, rtf: RTF }])
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
