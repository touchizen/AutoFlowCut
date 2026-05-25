/**
 * csvParser — review R7 fix
 *
 * RFC-식 character-stream parser. escaped quote, multiline field, CRLF 처리.
 */
import { describe, it, expect } from 'vitest'
import { parseCSVText, parseCSVTextToRows } from '../../src/utils/csvParser'

describe('parseCSVText', () => {
  it('단순 CSV 파싱', () => {
    expect(parseCSVText('a,b,c\n1,2,3')).toEqual([
      ['a', 'b', 'c'],
      ['1', '2', '3'],
    ])
  })

  it('escaped double quote (""→") 처리', () => {
    const text = 'a,b\n"He said ""hi""",end'
    expect(parseCSVText(text)).toEqual([
      ['a', 'b'],
      ['He said "hi"', 'end'],
    ])
  })

  it('quoted multiline field 보존', () => {
    const text = 'a,b\n"line1\nline2","x"'
    expect(parseCSVText(text)).toEqual([
      ['a', 'b'],
      ['line1\nline2', 'x'],
    ])
  })

  it('CRLF 처리', () => {
    expect(parseCSVText('a,b\r\n1,2\r\n3,4')).toEqual([
      ['a', 'b'],
      ['1', '2'],
      ['3', '4'],
    ])
  })

  it('quoted comma 보존', () => {
    expect(parseCSVText('a,b\n"x,y",z')).toEqual([
      ['a', 'b'],
      ['x,y', 'z'],
    ])
  })

  it('빈 입력 → 빈 결과', () => {
    expect(parseCSVText('')).toEqual([])
  })
})

describe('parseCSVTextToRows', () => {
  it('첫 행 headers, 이후 row objects', () => {
    const result = parseCSVTextToRows('name,age\nAlice,30\nBob,25')
    expect(result.headers).toEqual(['name', 'age'])
    expect(result.rows).toEqual([
      { name: 'Alice', age: '30' },
      { name: 'Bob', age: '25' },
    ])
  })

  it('BOM 제거', () => {
    const result = parseCSVTextToRows('﻿a,b\n1,2')
    expect(result.headers).toEqual(['a', 'b'])
  })

  it('escaped quotes in row values', () => {
    const result = parseCSVTextToRows('scene,subtitle\n1,"He said ""hi"" then left"')
    expect(result.rows[0].subtitle).toBe('He said "hi" then left')
  })

  it('multiline subtitle preserved', () => {
    const result = parseCSVTextToRows('scene,subtitle\n1,"line A\nline B"')
    expect(result.rows[0].subtitle).toBe('line A\nline B')
  })
})
