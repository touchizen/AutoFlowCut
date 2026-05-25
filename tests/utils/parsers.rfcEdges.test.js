/**
 * Legacy CSV parsers — review R10 fix
 *
 * parsers.js 의 parseCSVToScenes, mergeCSVIntoScenes, detectCSVType,
 * parseReferencesCSV 모두 shared RFC parser (parseCSVTextToRows) 사용.
 * Escaped quote / multiline / CRLF edge case 가 옛 parseCSVLine 보다 안전.
 */
import { describe, it, expect } from 'vitest'
import {
  parseCSVToScenes,
  mergeCSVIntoScenes,
  detectCSVType,
  parseReferencesCSV,
} from '../../src/utils/parsers'

describe('R10 — legacy parsers handle RFC edge cases', () => {
  it('parseCSVToScenes — escaped quote in prompt', () => {
    const csv = 'prompt,subtitle\n"He said ""hi""","ok"'
    const result = parseCSVToScenes(csv)
    expect(result).toHaveLength(1)
    expect(result[0].prompt).toBe('He said "hi"')
    expect(result[0].subtitle).toBe('ok')
  })

  it('parseCSVToScenes — multiline subtitle preserved', () => {
    const csv = 'prompt,subtitle\n"P","line A\nline B"'
    const result = parseCSVToScenes(csv)
    expect(result).toHaveLength(1)
    expect(result[0].subtitle).toBe('line A\nline B')
  })

  it('parseCSVToScenes — CRLF', () => {
    const csv = 'prompt,subtitle\r\n"P","S"\r\n"P2","S2"'
    const result = parseCSVToScenes(csv)
    expect(result).toHaveLength(2)
    expect(result[0].prompt).toBe('P')
    expect(result[1].prompt).toBe('P2')
  })

  it('mergeCSVIntoScenes — escaped quote header still detects providedFields', () => {
    const existing = [{ id: 's1', prompt: 'OLD', subtitle: 'OLD_SUB' }]
    const csv = 'prompt,subtitle\n"He said ""hi""",end'
    const result = mergeCSVIntoScenes(existing, csv)
    expect(result).toHaveLength(1)
    expect(result[0].prompt).toBe('He said "hi"')
    expect(result[0].subtitle).toBe('end')
  })

  it('detectCSVType — quoted scene CSV detected', () => {
    const csv = 'prompt,subtitle,duration\n"P","S",3'
    expect(detectCSVType(csv)).toBe('scene')
  })

  it('detectCSVType — quoted reference CSV detected', () => {
    const csv = 'name,type\n"Alice","character"'
    expect(detectCSVType(csv)).toBe('reference')
  })

  it('parseReferencesCSV — escaped quote in name + multiline prompt', () => {
    const csv = 'name,type,prompt\n"Bob ""the bot""","character","line1\nline2"'
    const result = parseReferencesCSV(csv)
    expect(result).toHaveLength(1)
    expect(result[0].name).toBe('Bob "the bot"')
    expect(result[0].prompt).toBe('line1\nline2')
  })
})
