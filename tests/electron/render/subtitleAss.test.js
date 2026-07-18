import { describe, it, expect } from 'vitest'
import { msToAssTime, escapeAssText, assFontsize, buildAss } from '../../../electron/render/subtitleAss.js'

describe('msToAssTime', () => {
  it('formats ms to h:mm:ss.cs (centiseconds)', () => {
    expect(msToAssTime(0)).toBe('0:00:00.00')
    expect(msToAssTime(3610)).toBe('0:00:03.61')
    expect(msToAssTime(3661230)).toBe('1:01:01.23')
  })
})

describe('escapeAssText', () => {
  it('escapes braces, backslash, and newline', () => {
    expect(escapeAssText('a{b}c')).toBe('a\\{b\\}c')
    expect(escapeAssText('a\\b')).toBe('a\\\\b')
    expect(escapeAssText('a\nb')).toBe('a\\Nb')
  })
})

describe('assFontsize', () => {
  it('scales relative to output height', () => {
    expect(assFontsize({ subtitleFontSize: 8, outputHeight: 1920 })).toBe(Math.round(8 * 1920 / 100))
  })
})

describe('buildAss', () => {
  const opts = { subtitleFontSize: 8, outputWidth: 1080, outputHeight: 1920 }
  it('emits a Dialogue line per entry with rebased times when offsetMs>0', () => {
    const ass = buildAss([{ startMs: 20000, endMs: 22000, text: '안녕' }], { ...opts, offsetMs: 20000 })
    expect(ass).toContain('Dialogue:')
    expect(ass).toContain('0:00:00.00,0:00:02.00')
    expect(ass).toContain('안녕')
  })
  it('drops entries fully before the offset window', () => {
    const ass = buildAss([{ startMs: 0, endMs: 1000, text: 'x' }], { ...opts, offsetMs: 20000 })
    expect(ass).not.toContain('Dialogue:')
  })
  it('clamps a boundary-crossing entry start to 0', () => {
    const ass = buildAss([{ startMs: 19000, endMs: 21000, text: 'y' }], { ...opts, offsetMs: 20000 })
    expect(ass).toContain('0:00:00.00,0:00:01.00')
  })
  it('drops entries with endMs<=startMs', () => {
    const ass = buildAss([{ startMs: 1000, endMs: 1000, text: 'z' }], opts)
    expect(ass).not.toContain('Dialogue:')
  })
})
